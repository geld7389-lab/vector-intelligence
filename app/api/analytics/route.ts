import { NextResponse } from 'next/server';
import { sb as supabase } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';



export async function GET() {
  const { data: rows, error } = await supabase
    .from('trades')
    .select('*')
    .neq('result', 'open')
    .order('closed_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const trades = (rows ?? []).map(t => {
    let extra: any = {};
    try { extra = JSON.parse(t.notes?.split('__META__')[1] ?? '{}'); } catch {}
    return {
      id: t.id, symbol: t.symbol,
      direction: t.direction === 'long' ? 'bull' : 'bear',
      result: t.result, r_multiple: t.rr_achieved ?? 0,
      pnl_dollars: extra.pnl_dollars ?? 0,
      setup_type: extra.setup_type ?? 'Manual',
      session: extra.session ?? 'Unknown',
      mistakes: extra.mistakes ?? [],
      closed_at: t.closed_at ?? t.opened_at,
    };
  });

  if (!trades.length) return NextResponse.json({ stats: { total: 0, winRate: 0, totalR: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, maxWinStreak: 0, maxLossStreak: 0, curve: [], byType: {}, bySess: {}, bySym: {}, mistakeCounts: {} } });

  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');
  const totalR = +trades.reduce((a, t) => a + (t.r_multiple ?? 0), 0).toFixed(2);
  const winR = wins.reduce((a, t) => a + Math.abs(t.r_multiple ?? 0), 0);
  const lossR = losses.reduce((a, t) => a + Math.abs(t.r_multiple ?? 0), 0);
  const profitFactor = lossR > 0 ? +(winR / lossR).toFixed(2) : winR > 0 ? 99 : 0;
  const avgWin = wins.length ? +(winR / wins.length).toFixed(2) : 0;
  const avgLoss = losses.length ? +(lossR / losses.length).toFixed(2) : 0;

  // Streaks
  let maxWin = 0, maxLoss = 0, curW = 0, curL = 0;
  trades.forEach(t => {
    if (t.result === 'win') { curW++; curL = 0; maxWin = Math.max(maxWin, curW); }
    else if (t.result === 'loss') { curL++; curW = 0; maxLoss = Math.max(maxLoss, curL); }
    else { curW = 0; curL = 0; }
  });

  // Equity curve (cumulative R by date)
  const curve: { date: string; equity: number }[] = [];
  let running = 0;
  trades.forEach(t => {
    running = +(running + (t.r_multiple ?? 0)).toFixed(2);
    const d = (t.closed_at ?? '').slice(0, 10);
    if (d && (curve.length === 0 || curve[curve.length-1].date !== d)) {
      curve.push({ date: d, equity: running });
    } else if (curve.length > 0) {
      curve[curve.length-1].equity = running;
    }
  });

  // By type
  const byType: Record<string, { wins: number; losses: number; totalR: number }> = {};
  trades.forEach(t => {
    const k = t.setup_type ?? 'Manual';
    if (!byType[k]) byType[k] = { wins: 0, losses: 0, totalR: 0 };
    if (t.result === 'win') byType[k].wins++;
    else if (t.result === 'loss') byType[k].losses++;
    byType[k].totalR = +(byType[k].totalR + (t.r_multiple ?? 0)).toFixed(2);
  });

  // By session
  const bySess: Record<string, { wins: number; losses: number; totalR: number }> = {};
  trades.forEach(t => {
    const k = t.session ?? 'Unknown';
    if (!bySess[k]) bySess[k] = { wins: 0, losses: 0, totalR: 0 };
    if (t.result === 'win') bySess[k].wins++;
    else if (t.result === 'loss') bySess[k].losses++;
    bySess[k].totalR = +(bySess[k].totalR + (t.r_multiple ?? 0)).toFixed(2);
  });

  // By symbol
  const bySym: Record<string, { wins: number; losses: number; totalR: number }> = {};
  trades.forEach(t => {
    const k = t.symbol;
    if (!bySym[k]) bySym[k] = { wins: 0, losses: 0, totalR: 0 };
    if (t.result === 'win') bySym[k].wins++;
    else if (t.result === 'loss') bySym[k].losses++;
    bySym[k].totalR = +(bySym[k].totalR + (t.r_multiple ?? 0)).toFixed(2);
  });

  // Mistake counts
  const mistakeCounts: Record<string, number> = {};
  trades.forEach(t => (t.mistakes ?? []).forEach((m: string) => {
    mistakeCounts[m] = (mistakeCounts[m] ?? 0) + 1;
  }));

  return NextResponse.json({
    stats: {
      total: trades.length,
      winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
      totalR, profitFactor, avgWin, avgLoss,
      maxWinStreak: maxWin, maxLossStreak: maxLoss,
      curve, byType, bySess, bySym, mistakeCounts,
    }
  });
}
