import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MT5_BASE = 'https://mt5.mtapi.io';

// Symbol mapping: VECTOR symbol → MT5 broker symbol
const MT5_SYMBOL_MAP: Record<string, string> = {
  NQ: 'NQ100',       // NQ futures — try NQ100, NASDAQ, US100
  ES: 'SP500',       // ES futures
  GC: 'XAUUSD',     // Gold
  CL: 'USOIL',      // Crude oil
  BTC: 'BTCUSD',
  ETH: 'ETHUSD',
  EURUSD: 'EURUSD',
  GBPUSD: 'GBPUSD',
  USDJPY: 'USDJPY',
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

async function getCurrentPrice(token: string, symbol: string) {
  const r = await fetch(`${MT5_BASE}/Quote?symbol=${symbol}&id=${token}`, {
    headers: { accept: 'text/json' },
    signal: AbortSignal.timeout(10000),
  });
  return r.ok ? r.json() : null;
}

export async function POST(req: NextRequest) {
  const { approved_trades = [], risk = {}, mt5_token } = await req.json().catch(() => ({}));

  // Get MT5 token — from request body or Supabase stored token
  let token = mt5_token;
  if (!token) {
    const { data } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
    token = data?.data ? JSON.parse(data.data)?.token : null;
  }

  if (!token) {
    return NextResponse.json({
      ok: false,
      error: 'No MT5 token available. Connect MT5 in the Agents tab first.',
      trades_executed: 0,
    });
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
    const mt5Symbol = MT5_SYMBOL_MAP[trade.symbol] ?? trade.symbol;
    const pointSize = POINT_SIZE[mt5Symbol] ?? 0.0001;
    const defaultSl = DEFAULT_SL_POINTS[mt5Symbol] ?? 30;

    try {
      // Get live price
      const quote = await getCurrentPrice(token, mt5Symbol);
      const price = trade.direction === 'buy'
        ? (quote?.Ask ?? quote?.ask ?? 0)
        : (quote?.Bid ?? quote?.bid ?? 0);

      if (!price) {
        failed.push({ symbol: trade.symbol, reason: `Could not get price for ${mt5Symbol}` });
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

      // Execute trade
      const result = await placeTrade(token, mt5Symbol, trade.direction, volume, sl, tp);
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
