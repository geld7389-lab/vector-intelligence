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

  return NextResponse.json({
    can_trade: canTrade,
    blocked_reason: blockedReason,
    portfolio_heat: portfolioHeat,
    open_positions: trades.length,
    open_symbols: openSymbols,
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
