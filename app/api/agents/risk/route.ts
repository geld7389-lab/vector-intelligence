import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';

export async function POST() {
  // Load open trades from Supabase
  const { data: openTrades } = await sb.from('trades').select('*').eq('status','open');
  const { data: closedToday } = await sb.from('trades')
    .select('*')
    .eq('status','closed')
    .gte('close_time', new Date(new Date().setHours(0,0,0,0)).toISOString());

  const trades = openTrades ?? [];
  const todayTrades = closedToday ?? [];

  // Portfolio heat = sum of all open risk %
  const portfolioHeat = trades.reduce((sum:number, t:any) => sum + (t.risk_pct ?? 1), 0);

  // Daily PnL
  const dailyPnl = todayTrades.reduce((sum:number, t:any) => sum + (t.pnl ?? 0), 0);

  // Consecutive losses
  const { data: recent } = await sb.from('trades')
    .select('result')
    .eq('status','closed')
    .order('close_time',{ascending:false})
    .limit(10);

  let consecutiveLosses = 0;
  for (const t of (recent ?? [])) {
    if (t.result === 'loss') consecutiveLosses++;
    else break;
  }

  const maxHeat        = 3.0;
  const maxDailyLoss   = -300; // $300 daily stop (adjust per account)
  const maxConsecLoss  = 4;

  const canTrade = portfolioHeat < maxHeat
    && dailyPnl > maxDailyLoss
    && consecutiveLosses < maxConsecLoss
    && trades.length < 5;

  const blockedReason = !canTrade ? (
    portfolioHeat >= maxHeat      ? `Portfolio heat ${portfolioHeat.toFixed(1)}% >= max ${maxHeat}%` :
    dailyPnl <= maxDailyLoss      ? `Daily loss limit hit: $${dailyPnl.toFixed(0)}` :
    consecutiveLosses >= maxConsecLoss ? `${consecutiveLosses} consecutive losses — paused 24h` :
    `Max ${trades.length} positions open`
  ) : null;

  return NextResponse.json({
    can_trade:          canTrade,
    blocked_reason:     blockedReason,
    portfolio_heat:     portfolioHeat,
    open_positions:     trades.length,
    daily_pnl:          dailyPnl,
    consecutive_losses: consecutiveLosses,
    limits: {
      max_heat: maxHeat,
      max_daily_loss: maxDailyLoss,
      max_consec_losses: maxConsecLoss,
      max_positions: 5,
    },
  });
}
