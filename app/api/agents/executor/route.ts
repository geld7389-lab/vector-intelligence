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
  CL: 'USOIL.c',
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

// Pip/point sizes per VECTOR symbol (trade.symbol) for SL/TP calculation
// IMPORTANT: keys must match trade.symbol exactly (NQ, ES, GC, CL, BTC, ETH, EURUSD, GBPUSD, USDJPY)
// Previous keys (NQ100, SP500, BTCUSD, ETHUSD) never matched trade.symbol or mt5Symbol — silently
// fell back to the forex default of 0.0001, producing near-zero stop distances on index/crypto trades.
const POINT_SIZE: Record<string, number> = {
  EURUSD: 0.0001, GBPUSD: 0.0001, USDJPY: 0.01,
  GC: 0.1, CL: 0.01,
  NQ: 1, ES: 0.25, BTC: 1, ETH: 0.1,
};

// Default SL distance in points (TP = 2x this) if AI Brain doesn't provide specific levels
const DEFAULT_SL_POINTS: Record<string, number> = {
  EURUSD: 30, GBPUSD: 35, USDJPY: 40,
  GC: 200, CL: 50,
  NQ: 50, ES: 15, BTC: 500, ETH: 50,
};

async function mt5Request(path: string, token: string) {
  const r = await fetch(`${MT5_BASE}/${path}&id=${token}`, {
    headers: { accept: 'text/json' },
    signal: AbortSignal.timeout(15000),
  });
  return r.ok ? r.json() : null;
}

// Position sizing was assuming $1 of P&L per "point" per 1.0 lot for every
// instrument — true for indices like NQ/ES (contractSize=1) and coincidentally
// true for USOIL.c (contractSize 100 x point 0.01 = $1), but badly wrong for
// gold: XAUUSD is 100oz/lot, so real $/point/lot is $10, not $1. At the 0.01
// lot floor, that meant every GC trade risked ~$20 against an intended ~$1.50
// (1% of a small account) — confirmed as the dominant source of real losses
// (GC: 3/3 losses, -$52 total, avg R:R -1.31, i.e. losing MORE than the
// "intended" 1R because the intended R was never the real R to begin with).
// Now fetches the broker's actual contract size per symbol instead of assuming.
async function getSymbolSpec(token: string, mt5Symbol: string): Promise<{ contractSize: number; minLots: number; lotsStep: number } | null> {
  try {
    const data = await mt5Request(`SymbolParams?symbol=${encodeURIComponent(mt5Symbol)}`, token);
    const contractSize = Number(data?.symbolInfo?.contractSize);
    const minLots = Number(data?.symbolGroup?.minLots);
    const lotsStep = Number(data?.symbolGroup?.lotsStep);
    if (!Number.isFinite(contractSize) || contractSize <= 0) return null;
    return {
      contractSize,
      minLots: Number.isFinite(minLots) && minLots > 0 ? minLots : 0.01,
      lotsStep: Number.isFinite(lotsStep) && lotsStep > 0 ? lotsStep : 0.01,
    };
  } catch {
    return null;
  }
}

async function getAccountInfo(token: string) {
  const r = await fetch(`${MT5_BASE}/AccountSummary?id=${token}`, {
    headers: { accept: 'text/json' },
    signal: AbortSignal.timeout(10000),
  });
  return r.ok ? r.json() : null;
}

async function placeTrade(token: string, symbol: string, direction: string, volume: number) {
  // NOTE: This broker (ExclusiveMarkets-Demo via mtapi.io) silently strips SL/TP
  // from OrderSend and rejects OrderModify with SAME_PARAMS regardless of values.
  // SL/TP levels are saved to Supabase and enforced client-side by /api/trades/monitor
  // which runs at the start of every agent cycle.
  const operation = direction === 'buy' ? 'Buy' : 'Sell';
  const url = `${MT5_BASE}/OrderSend?id=${token}&symbol=${encodeURIComponent(symbol)}&operation=${operation}&volume=${volume}`;
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

  const { data: shadowRow } = await sb.from('agent_status').select('data').eq('agent', 'shadow_mode').single();
  const shadowData = typeof shadowRow?.data === 'string' ? JSON.parse(shadowRow.data) : shadowRow?.data;
  const isShadowMode = shadowData?.enabled === true;

  if (!isShadowMode && !risk.can_trade) {
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

  // Live open-symbols check, queried fresh right now (not just trusting the risk
  // snapshot from earlier in this cycle) — this is what actually stops the same
  // coin/symbol from being re-entered while a position is already open on it.
  const { data: currentOpenTrades } = await sb.from('trades').select('symbol').eq('result', 'open');
  const openSymbolsNow = new Set((currentOpenTrades ?? []).map((t: any) => t.symbol));
  const symbolsUsedThisCycle = new Set<string>();

  // Cooldown: don't immediately re-bet the same symbol+direction right after
  // it just lost. Confirmed in the data this was happening — e.g. ETH long
  // and NQ short got re-approved and re-entered every single cycle with zero
  // pause, even right after stopping out, repeatedly eating the same ~1R loss
  // on what was often the same chop. 90 min covers 3 cycles at the current
  // 30-min cron interval — enough for conditions to genuinely change instead
  // of immediately re-firing on stale/unchanged structure.
  const COOLDOWN_MIN = 90;
  const { data: recentLosses } = await sb.from('trades')
    .select('symbol, direction, closed_at')
    .eq('result', 'loss')
    .gte('closed_at', new Date(Date.now() - COOLDOWN_MIN * 60 * 1000).toISOString());
  const cooldownKeys = new Set((recentLosses ?? []).map((t: any) => `${t.symbol}:${t.direction}`));

  for (const trade of approved_trades.slice(0, 2)) { // max 2 trades per cycle
    if (openSymbolsNow.has(trade.symbol) || symbolsUsedThisCycle.has(trade.symbol)) {
      failed.push({ symbol: trade.symbol, reason: `Skipped — already have an open ${trade.symbol} position` });
      continue;
    }
    const dirNormalized = trade.direction === 'buy' ? 'long' : 'short';
    if (cooldownKeys.has(`${trade.symbol}:${dirNormalized}`)) {
      failed.push({ symbol: trade.symbol, reason: `Skipped — ${trade.symbol} ${dirNormalized} lost within the last ${COOLDOWN_MIN}min, cooling down before re-entering the same thesis` });
      continue;
    }
    if (executed.length > 0) await new Promise(r => setTimeout(r, 1500)); // 1.5s delay between trades
    const mt5Symbol = MT5_SYMBOL_MAP[trade.symbol] ?? trade.symbol;
    const pointSize = POINT_SIZE[mt5Symbol] ?? 0.0001;
    const defaultSl = DEFAULT_SL_POINTS[mt5Symbol] ?? 30;

    try {
      // Real broker quote instead of Yahoo — GetQuote doesn't require an open
      // position, works for both live and paper trades, and is the same real
      // price source the monitor now uses for SL/TP decisions (fixing the
      // exact futures-vs-broker mismatch that caused false closes earlier).
      let usePrice = 0;
      const usedSymbolForQuote = MT5_SYMBOL_MAP[trade.symbol] ?? (trade.symbol + '.');
      try {
        const qr = await fetch(`${MT5_BASE}/GetQuote?id=${token}&symbol=${encodeURIComponent(usedSymbolForQuote)}`, {
          headers: { accept: 'text/json' }, signal: AbortSignal.timeout(10000),
        });
        const qj = await qr.json();
        usePrice = trade.direction === 'buy' ? (qj?.ask ?? qj?.bid ?? 0) : (qj?.bid ?? qj?.ask ?? 0);
      } catch {}
      // Yahoo fallback only if the broker quote genuinely failed
      if (!usePrice) {
        const ySym = YAHOO_MAP[trade.symbol] ?? `${trade.symbol}=F`;
        try {
          const yr = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${ySym}?interval=1m&range=1d`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
          );
          const yj = await yr.json();
          usePrice = yj?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;
        } catch {}
      }

      if (!usePrice) {
        failed.push({ symbol: trade.symbol, reason: 'Could not get a live price (broker quote and Yahoo fallback both failed)' });
        continue;
      }

      // SL/TP point distance — actual price levels are computed after fill, against the broker's
      // real fill price for accurate SL/TP calculation
      const ptSize = POINT_SIZE[trade.symbol] ?? pointSize;
      const slPts = DEFAULT_SL_POINTS[trade.symbol] ?? defaultSl;
      const priceDistance = slPts * ptSize; // real price distance the SL sits at

      const usedSymbol = MT5_SYMBOL_MAP[trade.symbol] ?? (trade.symbol + '.');
      const spec = await getSymbolSpec(token, usedSymbol);
      // Real $ risked per 1.0 lot for this exact price distance. Fall back to
      // the old $1/point assumption only if the broker genuinely didn't return
      // spec data — better to trade with a possibly-wrong-but-reasonable
      // number than to fail every trade if SymbolParams has a bad day.
      const dollarsPerLotAtDistance = spec ? priceDistance * spec.contractSize : priceDistance;
      const minLots = spec?.minLots ?? 0.01;
      const lotsStep = spec?.lotsStep ?? 0.01;

      let volume = dollarsPerLotAtDistance > 0 ? riskAmount / dollarsPerLotAtDistance : 0;
      volume = Math.round(volume / lotsStep) * lotsStep;
      volume = Math.min(volume, 0.10);
      volume = parseFloat(volume.toFixed(2));

      if (volume < minLots) {
        // Even the broker's smallest tradeable size for this instrument would
        // risk more than the intended 1% — this is exactly what silently
        // happened with gold before. Skip rather than force-trade oversized.
        const impliedRiskAtMinLot = dollarsPerLotAtDistance * minLots;
        failed.push({
          symbol: trade.symbol,
          reason: `Skipped — minimum lot size (${minLots}) would risk ~$${impliedRiskAtMinLot.toFixed(2)} against a $${riskAmount.toFixed(2)} budget (1%). Account too small to trade this instrument safely right now.`,
        });
        continue;
      }
      if (isShadowMode) {
        // No broker call at all — this is the whole point of shadow mode.
        // Use the real quote price as the simulated fill (no slippage model,
        // but it's the same live number a real order would have used).
        const fillPrice = usePrice;
        const finalSl = trade.direction === 'buy'
          ? +(fillPrice - slPts * ptSize).toFixed(5)
          : +(fillPrice + slPts * ptSize).toFixed(5);
        const finalTp = trade.direction === 'buy'
          ? +(fillPrice + slPts * ptSize * 2).toFixed(5)
          : +(fillPrice - slPts * ptSize * 2).toFixed(5);

        await sb.from('trades').insert({
          symbol: trade.symbol,
          direction: trade.direction === 'buy' ? 'long' : 'short',
          entry_price: fillPrice,
          stop_loss: finalSl,
          take_profit: finalTp,
          result: 'open',
          is_paper: true,
          opened_at: new Date().toISOString(),
          notes: `PAPER (shadow mode) | Score: ${trade.setup_score} | Risk: ${(riskPct * 100).toFixed(1)}% | ${trade.primary_reason ?? ''} | MT5: ${usedSymbol} | Simulated volume: ${volume} lots`,
        });
        executed.push({
          symbol: trade.symbol, mt5Symbol: usedSymbol, direction: trade.direction,
          volume, entry: fillPrice, sl: finalSl, tp: finalTp,
          score: trade.setup_score, risk_percent: riskPct, paper: true,
        });
        symbolsUsedThisCycle.add(trade.symbol);
        continue;
      }

      const result = await placeTrade(token, usedSymbol, trade.direction, volume);
      const ticket = result?.Id ?? result?.id ?? result?.ticket ?? result?.Ticket ?? result?.raw;
      // Use broker's actual fill price for SL/TP levels — more accurate than Yahoo estimate
      const fillPrice = Number(result?.openPrice ?? result?.OpenPrice ?? usePrice) || usePrice;

      if (ticket && !String(ticket).includes('error') && !String(ticket).includes('Error') && !String(ticket).includes('message')) {
        // SL/TP: broker strips these so we save them to Supabase.
        // /api/trades/monitor runs each cycle and closes positions when price hits these levels.
        const finalSl = trade.direction === 'buy'
          ? +(fillPrice - slPts * ptSize).toFixed(5)
          : +(fillPrice + slPts * ptSize).toFixed(5);
        const finalTp = trade.direction === 'buy'
          ? +(fillPrice + slPts * ptSize * 2).toFixed(5)
          : +(fillPrice - slPts * ptSize * 2).toFixed(5);

        const insertRes = await sb.from('trades').insert({
          symbol: trade.symbol,
          direction: trade.direction === 'buy' ? 'long' : 'short',
          entry_price: fillPrice,
          stop_loss: finalSl,
          take_profit: finalTp,
          result: 'open',
          is_paper: false,
          opened_at: new Date().toISOString(),
          notes: `Agent execution | Score: ${trade.setup_score} | Risk: ${(riskPct * 100).toFixed(1)}% | ${trade.primary_reason ?? ''} | Ticket: ${String(ticket)} | MT5: ${usedSymbol} | SL/TP client-side @ ${finalSl}/${finalTp}`,
        });
        const dbError = insertRes?.error?.message ?? null;

        executed.push({
          symbol: trade.symbol,
          mt5Symbol: usedSymbol,
          direction: trade.direction,
          volume,
          entry: fillPrice,
          sl: finalSl,
          tp: finalTp,
          ticket: String(ticket),
          score: trade.setup_score,
          slTpMode: 'client-side',
          risk_percent: riskPct,
          dbError,
        });
        symbolsUsedThisCycle.add(trade.symbol);
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
      ? `✓ ${executed.length} trade(s): ${executed.map(e => `${e.direction.toUpperCase()} ${e.symbol} @ ${e.entry} | SL ${e.sl} / TP ${e.tp}`).join('  |  ')}`
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
