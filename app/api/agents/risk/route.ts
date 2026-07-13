import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';

export async function POST() {
  // Load open trades from Supabase — NOTE: the real column is `result`, not `status`.
  // The previous version of this route queried `.eq('status','open')` against a table
  // that has no `status` column at all, so it silently always returned zero rows,
  // meaning Risk Manager thought there were never any open positions — which meant
  // it never blocked re-entering a symbol that already had a live trade running.
  const { data: openTrades } = await sb.from('trades').select('*').eq('result', 'open');
  const trades = openTrades ?? [];

  // Symbols currently open — this is what actually prevents duplicate entries.
  // Downstream agents (AI Brain, Executor) both check against this list.
  const openSymbols = [...new Set(trades.map((t: any) => t.symbol))];

  // Closed trades today, for daily P&L tracking
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const { data: closedToday } = await sb.from('trades')
    .select('*')
    .in('result', ['win', 'loss', 'closed_manual', 'closed_external'])
    .gte('opened_at', startOfDay);
  const todayTrades = closedToday ?? [];

  const dailyWins = todayTrades.filter((t: any) => t.result === 'win').length;
  const dailyLosses = todayTrades.filter((t: any) => t.result === 'loss').length;

  const { data: recent } = await sb.from('trades')
    .select('result')
    .in('result', ['win', 'loss'])
    .order('opened_at', { ascending: false })
    .limit(10);

  let consecutiveLosses = 0;
  for (const t of (recent ?? [])) {
    if (t.result === 'loss') consecutiveLosses++;
    else break;
  }

  const ASSUMED_RISK_PER_TRADE = 1.0;
  const portfolioHeat = trades.length * ASSUMED_RISK_PER_TRADE;

  const maxHeat = 5.0;
  const maxConsecLoss = 4;
  const maxPositions = 5;

  const canTrade = portfolioHeat < maxHeat
    && consecutiveLosses < maxConsecLoss
    && trades.length < maxPositions;

  const blockedReason = !canTrade ? (
    portfolioHeat >= maxHeat ? `Portfolio heat ${portfolioHeat.toFixed(1)}% >= max ${maxHeat}%` :
    consecutiveLosses >= maxConsecLoss ? `${consecutiveLosses} consecutive losses — paused` :
    `Max ${trades.length}/${maxPositions} positions open`
  ) : null;

  // ── Feed self-learning back into future decisions ─────────────────────
  // Self-learning was computing win-rate-per-symbol every single cycle and
  // storing it purely for display — nothing downstream ever read it, so a
  // symbol could lose 20 times in a row and the system would keep trading it
  // exactly the same as a symbol with a 70% win rate. Mirrors the same
  // threshold self-learning itself uses (>=20 trades, <40% win rate) so the
  // two stay consistent; recomputed here rather than calling the self-learning
  // route over HTTP to avoid an extra network hop on every risk check.
  const { data: history } = await sb.from('trades').select('symbol, result').in('result', ['win', 'loss']);
  const perSymbol: Record<string, { w: number; t: number }> = {};
  for (const t of history ?? []) {
    const s = (t as any).symbol ?? 'UNKNOWN';
    perSymbol[s] ??= { w: 0, t: 0 };
    perSymbol[s].t++;
    if ((t as any).result === 'win') perSymbol[s].w++;
  }
  const pausedSymbols = Object.entries(perSymbol)
    .filter(([, { w, t }]) => t >= 20 && (w / t) < 0.4)
    .map(([sym]) => sym);

  return NextResponse.json({
    can_trade: canTrade,
    blocked_reason: blockedReason,
    portfolio_heat: portfolioHeat,
    open_positions: trades.length,
    open_symbols: openSymbols,
    paused_symbols: pausedSymbols,
    daily_wins: dailyWins,
    daily_losses: dailyLosses,
    consecutive_losses: consecutiveLosses,
    limits: {
      max_heat: maxHeat,
      max_consec_losses: maxConsecLoss,
      max_positions: maxPositions,
    },
  });
}
