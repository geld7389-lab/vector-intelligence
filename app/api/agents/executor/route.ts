import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MT5_BASE = 'https://mt5.mtapi.io';

// Symbol mapping: VECTOR symbol → MT5 broker symbol (ExclusiveMarkets-Demo)
const MT5_SYMBOL_MAP: Record<string, string> = {
  NQ: 'US30',        // Try US30 first — ExclusiveMarkets uses US30 for NQ/Dow
  ES: 'US500',       // ES → US500
  GC: 'XAUUSD',     // Gold
  CL: 'USOIL',      // Crude oil
  BTC: 'BTCUSD',
  ETH: 'ETHUSD',
  EURUSD: 'EURUSD',
  GBPUSD: 'GBPUSD',
  USDJPY: 'USDJPY',
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
  return mt5Request('AccountSummary?', token);
}

async function placeTrade(token: string, symbol: string, direction: string, volume: number, sl: number, tp: number) {
  const op = direction === 'buy' ? 0 : 1;
  const path = `OrderSend?symbol=${symbol}&operation=${op}&volume=${volume}&sl=${sl}&tp=${tp}`;
  const r = await fetch(`${MT5_BASE}/${path}&id=${token}`, {
    headers: { accept: 'text/json' },
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
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
    const reconnectUrl = `${MT5_BASE}/ConnectEx?user=${session.login}&password=${encodeURIComponent(session.password)}&server=${encodeURIComponent(session.server)}&connectTimeoutSeconds=30&connectTimeoutClusterMemberSeconds=15&errorReplyStatusCode=201`;
    const rr = await fetch(reconnectUrl, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(35000) });
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
      // Get live price
      const quote = await getCurrentPrice(token, mt5Symbol, trade.symbol);
      const price = trade.direction === 'buy'
        ? (quote?.ask ?? 0)
        : (quote?.bid ?? 0);

      if (!price) {
        failed.push({ symbol: trade.symbol, reason: `Could not get price for ${mt5Symbol} (tried MT5 + Yahoo)` });
        continue;
      }

      // Calculate SL/TP
      const slPoints = defaultSl * pointSize;
      const tpPoints = slPoints * 2; // 1:2 RR minimum
      const sl = trade.direction === 'buy' ? price - slPoints : price + slPoints;
      const tp = trade.direction === 'buy' ? price + tpPoints : price - tpPoints;

      // Position size: risk$ / SL in $ = lots
      // Simplified: for forex 1 lot = $10/pip, for indices = $1/point
      const pipValue = ['EURUSD','GBPUSD'].includes(mt5Symbol) ? 10 :
                       mt5Symbol === 'USDJPY' ? 7 :
                       mt5Symbol === 'XAUUSD' ? 10 :
                       mt5Symbol === 'NQ100' ? 20 : 1;
      const slPips = defaultSl;
      let volume = parseFloat((riskAmount / (slPips * pipValue)).toFixed(2));
      volume = Math.max(0.01, Math.min(volume, 0.1)); // cap between 0.01-0.10 lots for safety

      // Execute trade — try multiple symbol name variants
      const symbolVariants: Record<string, string[]> = {
        NQ: ['US100', 'NAS100', 'USTEC', 'US30', 'NDX'],
        ES: ['US500', 'SPX500', 'SP500', 'USA500'],
        GC: ['XAUUSD', 'GOLD'],
        CL: ['USOIL', 'WTI', 'OIL'],
        BTC: ['BTCUSD', 'BTC/USD'],
        ETH: ['ETHUSD', 'ETH/USD'],
      };
      const variants = symbolVariants[trade.symbol] ?? [mt5Symbol];
      
      let result: any = null;
      let usedSymbol = variants[0];
      for (const sym of variants) {
        // First check if quote works for this symbol
        const qTest = await fetch(`${MT5_BASE}/Quote?symbol=${sym}&id=${token}`, {
          headers: { accept: 'text/json' }, signal: AbortSignal.timeout(5000)
        }).catch(() => null);
        if (!qTest?.ok) continue;
        const qData = await qTest.json().catch(() => null);
        if (!qData?.Ask && !qData?.Bid) continue;
        
        // This symbol works — use it for the trade
        usedSymbol = sym;
        const usePrice = trade.direction === 'buy' ? (qData.Ask ?? price) : (qData.Bid ?? price);
        const useSl = trade.direction === 'buy' ? +(usePrice - (DEFAULT_SL_POINTS[sym] ?? defaultSl) * pointSize).toFixed(5) : +(usePrice + (DEFAULT_SL_POINTS[sym] ?? defaultSl) * pointSize).toFixed(5);
        const useTp = trade.direction === 'buy' ? +(usePrice + (DEFAULT_SL_POINTS[sym] ?? defaultSl) * pointSize * 2).toFixed(5) : +(usePrice - (DEFAULT_SL_POINTS[sym] ?? defaultSl) * pointSize * 2).toFixed(5);
        result = await placeTrade(token, sym, trade.direction, volume, useSl, useTp);
        break;
      }
      const ticket = result?.Id ?? result?.id ?? result?.ticket ?? result?.Ticket ?? result?.raw;

      if (ticket && !String(ticket).includes('error') && !String(ticket).includes('Error')) {
        // Save to Supabase trades table
        await sb.from('trades').insert({
          symbol: trade.symbol,
          direction: trade.direction,
          entry: price,
          sl: parseFloat(sl.toFixed(5)),
          tp: parseFloat(tp.toFixed(5)),
          volume,
          risk_pct: riskPct * 100,
          status: 'open',
          setup_score: trade.setup_score,
          notes: `Agent: ${trade.primary_reason ?? ''}`,
          mt5_ticket: String(ticket),
          open_time: new Date().toISOString(),
        });

        executed.push({
          symbol: trade.symbol,
          mt5Symbol,
          direction: trade.direction,
          volume,
          entry: price,
          sl: parseFloat(sl.toFixed(5)),
          tp: parseFloat(tp.toFixed(5)),
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
