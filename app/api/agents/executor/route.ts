import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MT5_BASE = 'https://mt5.mtapi.io';

// Symbol mapping: VECTOR symbol → MT5 broker symbol (ExclusiveMarkets-Demo)
const MT5_SYMBOL_MAP: Record<string, string> = {
  NQ: 'US100.',
  ES: 'US500.',
  GC: 'XAUUSD.',
  CL: 'USOIL.',
  BTC: 'BTCUSD.',
  ETH: 'ETHUSD.',
  EURUSD: 'EURUSD.',
  GBPUSD: 'GBPUSD.',
  USDJPY: 'USDJPY.',
};

// Yahoo Finance fallback symbols for price if MT5 quote fails
const YAHOO_MAP: Record<string, string> = {
  NQ: 'NQ=F', ES: 'ES=F', GC: 'GC=F', CL: 'CL=F',
  BTC: 'BTC-USD', ETH: 'ETH-USD',
  EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X',
};

// Pip/point sizes per symbol for SL/TP calculation
const POINT_SIZE: Record<string, number> = {
  EURUSD: 0.0001, GBPUSD: 0.0001, USDJPY: 0.01,
  XAUUSD: 0.1, USOIL: 0.01,
  NQ100: 1, SP500: 0.25, BTCUSD: 1, ETHUSD: 0.1,
};

// Default SL/TP in points if AI Brain doesn't provide specific levels
const DEFAULT_SL_POINTS: Record<string, number> = {
  EURUSD: 30, GBPUSD: 35, USDJPY: 40,
  XAUUSD: 200, USOIL: 50,
  NQ100: 50, SP500: 15, BTCUSD: 500, ETHUSD: 50,
};

async function mt5Request(path: string, token: string) {
  const r = await fetch(`${MT5_BASE}/${path}&id=${token}`, {
    headers: { accept: 'text/json' },
    signal: AbortSignal.timeout(15000),
  });
  return r.ok ? r.json() : null;
}

async function getAccountInfo(token: string) {
  const r = await fetch(`${MT5_BASE}/AccountSummary?id=${token}`, {
    headers: { accept: 'text/json' },
    signal: AbortSignal.timeout(10000),
  });
  return r.ok ? r.json() : null;
}

async function placeTrade(token: string, symbol: string, direction: string, volume: number, sl: number, tp: number) {
  // mtapi.io uses "Buy"/"Sell" strings for market orders, no price needed
  const operation = direction === 'buy' ? 'Buy' : 'Sell';
  const url = `${MT5_BASE}/OrderSend?id=${token}&symbol=${encodeURIComponent(symbol)}&operation=${operation}&volume=${volume}&sl=${sl}&tp=${tp}`;
  try {
    const r = await fetch(url, {
      headers: { accept: 'text/json' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } catch (e: any) {
    return { error: e.message };
  }
}

async function getCurrentPrice(token: string, symbol: string, vectorSymbol: string) {
  // Try MT5 quote first
  try {
    const r = await fetch(`${MT5_BASE}/Quote?symbol=${symbol}&id=${token}`, {
      headers: { accept: 'text/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const d = await r.json();
      const price = d?.Ask ?? d?.ask ?? d?.Bid ?? d?.bid;
      if (price && price > 0) return { ask: d?.Ask ?? d?.ask, bid: d?.Bid ?? d?.bid, source: 'mt5' };
    }
  } catch {}

  // Fallback: Yahoo Finance
  try {
    const ySym = YAHOO_MAP[vectorSymbol] ?? `${vectorSymbol}=F`;
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ySym}?interval=1m&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (r.ok) {
      const j = await r.json();
      const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price && price > 0) return { ask: price, bid: price, source: 'yahoo' };
    }
  } catch {}

  return null;
}

export async function POST(req: NextRequest) {
  const { approved_trades = [], risk = {}, mt5_token } = await req.json().catch(() => ({}));

  // Get MT5 session from Supabase
  let token = mt5_token;
  let session: any = null;
  const { data: sessionData } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
  session = sessionData?.data ? JSON.parse(sessionData.data) : null;
  if (!token) token = session?.token ?? null;

  if (!session?.login || !session?.password || !session?.server) {
    return NextResponse.json({
      ok: false,
      error: 'No MT5 credentials. Connect MT5 in the Agents tab first.',
      trades_executed: 0,
    });
  }

  // Always get a fresh token before trading — avoids stale session issues
  try {
    const reconnectUrl = `${MT5_BASE}/ConnectEx?user=${session.login}&password=${encodeURIComponent(session.password)}&server=${encodeURIComponent(session.server)}&connectTimeoutSeconds=20&connectTimeoutClusterMemberSeconds=10&errorReplyStatusCode=201`;
    const rr = await fetch(reconnectUrl, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(25000) });
    const newToken = (await rr.text()).replace(/"/g, '').trim();
    if (newToken && newToken.length > 10 && !newToken.includes('error')) {
      token = newToken;
      // Save fresh token back to Supabase
      await sb.from('agent_status').upsert({
        agent: 'mt5_session',
        status: 'connected',
        last_action: `Auto-reconnected to ${session.server}`,
        data: JSON.stringify({ ...session, token: newToken, connected_at: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent' });
    }
  } catch (e) {
    // Use existing token if reconnect fails
  }

  if (!token) {
    return NextResponse.json({ ok: false, error: 'Failed to get MT5 token', trades_executed: 0 });
  }

  if (!risk.can_trade) {
    return NextResponse.json({
      ok: false,
      blocked: true,
      reason: risk.blocked_reason ?? 'Risk manager blocked trading',
      trades_executed: 0,
    });
  }

  if (!approved_trades.length) {
    return NextResponse.json({ ok: true, trades_executed: 0, message: 'No approved trades to execute' });
  }

  // Get live account balance for position sizing
  const account = await getAccountInfo(token);
  const balance = account?.Balance ?? account?.balance ?? 100;
  const riskPct = 0.01; // 1% risk per trade
  const riskAmount = balance * riskPct;

  const executed: any[] = [];
  const failed: any[] = [];

  for (const trade of approved_trades.slice(0, 2)) { // max 2 trades per cycle
    if (executed.length > 0) await new Promise(r => setTimeout(r, 1500)); // 1.5s delay between trades
    const mt5Symbol = MT5_SYMBOL_MAP[trade.symbol] ?? trade.symbol;
    const pointSize = POINT_SIZE[mt5Symbol] ?? 0.0001;
    const defaultSl = DEFAULT_SL_POINTS[mt5Symbol] ?? 30;

    try {
      // Get price from Yahoo Finance (MT5 Quote endpoint needs WebSocket subscription to stream)
      let usePrice = 0;
      const ySym = YAHOO_MAP[trade.symbol] ?? `${trade.symbol}=F`;
      try {
        const yr = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${ySym}?interval=1m&range=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
        );
        const yj = await yr.json();
        usePrice = yj?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;
      } catch {}

      if (!usePrice) {
        failed.push({ symbol: trade.symbol, reason: 'Could not get price from Yahoo Finance' });
        continue;
      }

      // SL/TP calculation
      const ptSize = POINT_SIZE[trade.symbol] ?? pointSize;
      const slPts = DEFAULT_SL_POINTS[trade.symbol] ?? defaultSl;
      const useSl = trade.direction === 'buy'
        ? +(usePrice - slPts * ptSize).toFixed(5)
        : +(usePrice + slPts * ptSize).toFixed(5);
      const useTp = trade.direction === 'buy'
        ? +(usePrice + slPts * ptSize * 2).toFixed(5)
        : +(usePrice - slPts * ptSize * 2).toFixed(5);

      let volume = parseFloat((riskAmount / (slPts * 1)).toFixed(2));
      volume = Math.max(0.01, Math.min(volume, 0.10));

      // Use dot-suffix symbol name for ExclusiveMarkets
      const usedSymbol = MT5_SYMBOL_MAP[trade.symbol] ?? (trade.symbol + '.');

      // Place market order — operation is "Buy" or "Sell" string
      const result = await placeTrade(token, usedSymbol, trade.direction, volume, useSl, useTp);
      const ticket = result?.Id ?? result?.id ?? result?.ticket ?? result?.Ticket ?? result?.raw;

      if (ticket && !String(ticket).includes('error') && !String(ticket).includes('Error') && !String(ticket).includes('message')) {
        await sb.from('trades').insert({
          symbol: trade.symbol,
          direction: trade.direction === 'buy' ? 'long' : 'short',
          entry_price: usePrice,
          stop_loss: useSl,
          take_profit: useTp,
          risk_percent: riskPct * 100,
          result: 'open',
          opened_at: new Date().toISOString(),
          notes: `Agent execution | Score: ${trade.setup_score} | ${trade.primary_reason ?? ''} | Ticket: ${String(ticket)} | MT5: ${usedSymbol}`,
        });

        executed.push({
          symbol: trade.symbol,
          mt5Symbol: usedSymbol,
          direction: trade.direction,
          volume,
          entry: usePrice,
          sl: useSl,
          tp: useTp,
          ticket: String(ticket),
          score: trade.setup_score,
        });
      } else {
        failed.push({ symbol: trade.symbol, reason: `MT5 rejected: ${JSON.stringify(result)}` });
      }
    } catch (e: any) {
      failed.push({ symbol: trade.symbol, reason: e.message });
    }
  }

  // Update executor agent status
  await sb.from('agent_status').upsert({
    agent: 'executor',
    status: 'running',
    last_action: executed.length
      ? `Executed ${executed.length} trade(s): ${executed.map(e => `${e.direction.toUpperCase()} ${e.symbol}`).join(', ')}`
      : failed.length ? `${failed.length} trade(s) failed: ${failed[0]?.reason}` : 'No trades to execute',
    data: JSON.stringify({ executed, failed, balance, last_run: new Date().toISOString() }),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'agent' });

  return NextResponse.json({
    ok: true,
    trades_executed: executed.length,
    trades_failed: failed.length,
    executed,
    failed,
    account_balance: balance,
    risk_per_trade: `$${riskAmount.toFixed(2)} (1%)`,
  });
}
