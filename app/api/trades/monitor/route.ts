import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MT5_BASE = 'https://mt5.mtapi.io';

// Yahoo Finance symbols for price lookups
const YAHOO_MAP: Record<string, string> = {
  NQ: 'NQ=F', ES: 'ES=F', GC: 'GC=F', CL: 'CL=F',
  BTC: 'BTC-USD', ETH: 'ETH-USD',
  EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X',
};

const MT5_SYMBOL_MAP: Record<string, string> = {
  NQ: 'US100.', ES: 'US500.', GC: 'XAUUSD.', CL: 'USOIL.c',
  BTC: 'BTCUSD.', ETH: 'ETHUSD.',
  EURUSD: 'EURUSD.', GBPUSD: 'GBPUSD.', USDJPY: 'USDJPY.',
};

async function getPrice(symbol: string): Promise<number | null> {
  try {
    const yahooSym = YAHOO_MAP[symbol];
    if (!yahooSym) return null;
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1m&range=1d`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d = await r.json();
    const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price ? Number(price) : null;
  } catch {
    return null;
  }
}

async function closePosition(token: string, ticket: string): Promise<any> {
  try {
    const r = await fetch(`${MT5_BASE}/OrderClose?id=${token}&ticket=${ticket}`, {
      headers: { accept: 'text/json' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function POST() {
  try {
    // Get MT5 token
    const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
    const rawData = mt5Session?.data;
    const sessionData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    const token = sessionData?.token;
    if (!token) return NextResponse.json({ ok: true, skipped: 'no MT5 token', checked: 0 });

    // Get all open trades from Supabase that were agent-executed (have stop_loss or take_profit set)
    const { data: openTrades } = await sb
      .from('trades')
      .select('*')
      .eq('result', 'open')
      .not('stop_loss', 'is', null)
      .not('take_profit', 'is', null);

    if (!openTrades?.length) return NextResponse.json({ ok: true, checked: 0, closed: [] });

    const closed: any[] = [];
    const errors: any[] = [];

    for (const trade of openTrades) {
      // Extract MT5 ticket from notes field: "... | Ticket: 59201089 | ..."
      const ticketMatch = trade.notes?.match(/Ticket:\s*(\d+)/);
      if (!ticketMatch) continue;
      const ticket = ticketMatch[1];

      const currentPrice = await getPrice(trade.symbol);
      if (!currentPrice) continue;

      const sl = Number(trade.stop_loss);
      const tp = Number(trade.take_profit);
      const isLong = trade.direction === 'long';

      const slHit = isLong ? currentPrice <= sl : currentPrice >= sl;
      const tpHit = isLong ? currentPrice >= tp : currentPrice <= tp;

      if (slHit || tpHit) {
        const reason = slHit ? 'SL_HIT' : 'TP_HIT';
        const closeResult = await closePosition(token, ticket);
        const closePrice = closeResult?.closePrice || currentPrice;
        const profit = isLong
          ? (closePrice - Number(trade.entry_price)) * (trade.risk_percent / 100)
          : (Number(trade.entry_price) - closePrice) * (trade.risk_percent / 100);

        // Update trade record in Supabase
        await sb.from('trades').update({
          result: slHit ? 'loss' : 'win',
          exit_price: closePrice,
          notes: (trade.notes ?? '') + ` | ${reason} @ ${closePrice} | Auto-closed by monitor`,
        }).eq('id', trade.id);

        closed.push({
          symbol: trade.symbol,
          ticket,
          reason,
          entry: trade.entry_price,
          exit: closePrice,
          sl, tp,
          currentPrice,
        });
      }
    }

    // Save monitor status
    await sb.from('agent_status').upsert({
      agent: 'position_monitor',
      status: 'running',
      last_action: closed.length
        ? `Closed ${closed.length} position(s): ${closed.map(c => `${c.symbol} (${c.reason})`).join(', ')}`
        : `Monitored ${openTrades.length} open position(s) — no stops hit`,
      data: JSON.stringify({ checked: openTrades.length, closed, last_run: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent' });

    return NextResponse.json({ ok: true, checked: openTrades.length, closed, errors });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export const GET = POST;
