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

    // Cross-check against REAL live MT5 positions. If a trade was closed manually
    // on MT5 directly (outside this app), its Supabase row never gets updated and
    // the monitor would otherwise "watch" a phantom position forever, since price
    // may never naturally cross that trade's old SL/TP again.
    let livePositionTickets = new Set<string>();
    try {
      const posRes = await fetch(`${MT5_BASE}/OpenedOrders?id=${token}`, {
        headers: { accept: 'text/json' },
        signal: AbortSignal.timeout(10000),
      });
      const posText = await posRes.text();
      const positions = JSON.parse(posText);
      if (Array.isArray(positions)) {
        livePositionTickets = new Set(
          positions.map((p: any) => String(p.ticket ?? p.Ticket ?? p.orderTicket ?? ''))
        );
      }
    } catch {
      // If we can't reach MT5 at all, don't wipe out trades based on a failed fetch —
      // skip the orphan-check this run rather than risk false-closing everything.
      livePositionTickets = null as any;
    }

    const orphaned: any[] = [];
    const stillOpenTrades: any[] = [];
    if (livePositionTickets) {
      for (const trade of openTrades) {
        const ticketMatch = trade.notes?.match(/Ticket:\s*(\d+)/);
        const ticket = ticketMatch?.[1];
        if (ticket && !livePositionTickets.has(ticket)) {
          // Position no longer exists on the broker — mark closed so we stop watching it
          await sb.from('trades').update({
            result: 'closed_external',
            notes: (trade.notes ?? '') + ` | Closed outside app (not found in live MT5 positions) @ ${new Date().toISOString()}`,
          }).eq('id', trade.id);
          orphaned.push({ symbol: trade.symbol, ticket });
        } else {
          stillOpenTrades.push(trade);
        }
      }
    } else {
      stillOpenTrades.push(...openTrades);
    }

    if (!stillOpenTrades.length) {
      await sb.from('agent_status').upsert({
        agent: 'position_monitor',
        status: 'running',
        last_action: orphaned.length
          ? `Removed ${orphaned.length} stale position(s) closed outside the app: ${orphaned.map(o => o.symbol).join(', ')}`
          : 'No open positions to monitor',
        data: JSON.stringify({ checked: 0, closed: [], watching: [], orphaned, last_run: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent' });
      return NextResponse.json({ ok: true, checked: 0, closed: [], orphaned });
    }

    const closed: any[] = [];
    const watching: any[] = [];
    const errors: any[] = [];

    for (const trade of stillOpenTrades) {
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
          ? (closePrice - Number(trade.entry_price))
          : (Number(trade.entry_price) - closePrice);

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
      } else {
        watching.push({
          id: trade.id,
          symbol: trade.symbol,
          ticket,
          direction: trade.direction,
          entry: Number(trade.entry_price),
          sl, tp,
          currentPrice,
        });
      }
    }

    // Save monitor status
    await sb.from('agent_status').upsert({
      agent: 'position_monitor',
      status: 'running',
      last_action: (() => {
        const parts = [];
        if (orphaned.length) parts.push(`Removed ${orphaned.length} closed-outside-app: ${orphaned.map(o=>o.symbol).join(', ')}`);
        if (closed.length) parts.push(`Closed ${closed.length}: ${closed.map(c => `${c.symbol} (${c.reason})`).join(', ')}`);
        if (!parts.length) parts.push(watching.length ? `Watching ${watching.length} open position(s) — no stops hit` : 'No open positions to monitor');
        return parts.join(' | ');
      })(),
      data: JSON.stringify({ checked: stillOpenTrades.length, closed, watching, orphaned, last_run: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent' });

    return NextResponse.json({ ok: true, checked: stillOpenTrades.length, closed, watching, orphaned, errors });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

