import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);
export async function GET() {
  const { data: trades } = await sb.from('trade_log').select('*').order('entry_time', { ascending: true });
  if (!trades || trades.length === 0) return NextResponse.json({ trades: [], stats: null });
  const closed = trades.filter(t => t.result && t.result !== 'open');
  const wins = closed.filter(t => t.result === 'win');
  const losses = closed.filter(t => t.result === 'loss');
  const totalR = closed.reduce((a,t) => a + (t.r_multiple ?? 0), 0);
  const grossWin = wins.reduce((a,t) => a + (t.r_multiple ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((a,t) => a + (t.r_multiple ?? 0), 0));
  // By setup type
  const byType: Record<string,{wins:number;losses:number;totalR:number}> = {};
  closed.forEach(t => {
    const k = t.setup_type || 'Manual';
    if (!byType[k]) byType[k] = { wins:0, losses:0, totalR:0 };
    if (t.result==='win') byType[k].wins++;
    else byType[k].losses++;
    byType[k].totalR += t.r_multiple ?? 0;
  });
  // By session
  const bySess: Record<string,{wins:number;losses:number;totalR:number}> = {};
  closed.forEach(t => {
    const k = t.session || 'Unknown';
    if (!bySess[k]) bySess[k] = { wins:0, losses:0, totalR:0 };
    if (t.result==='win') bySess[k].wins++;
    else bySess[k].losses++;
    bySess[k].totalR += t.r_multiple ?? 0;
  });
  // By symbol
  const bySym: Record<string,{wins:number;losses:number;totalR:number}> = {};
  closed.forEach(t => {
    const k = t.symbol || '?';
    if (!bySym[k]) bySym[k] = { wins:0, losses:0, totalR:0 };
    if (t.result==='win') bySym[k].wins++;
    else bySym[k].losses++;
    bySym[k].totalR += t.r_multiple ?? 0;
  });
  // By mistake
  const mistakeCounts: Record<string,number> = {};
  trades.forEach(t => {
    (t.mistakes ?? []).forEach((m: string) => { mistakeCounts[m] = (mistakeCounts[m]??0)+1; });
  });
  // Equity curve
  let equity = 0;
  const curve = closed.map(t => { equity += t.r_multiple??0; return { date: t.entry_time?.slice(0,10)??'', r: +(t.r_multiple??0).toFixed(2), equity: +equity.toFixed(2) }; });
  // Streaks
  let curStreak = 0, maxWin = 0, maxLoss = 0;
  let streak = 0;
  for (const t of closed) {
    if (t.result === 'win') { streak = streak > 0 ? streak+1 : 1; }
    else { streak = streak < 0 ? streak-1 : -1; }
    if (streak > maxWin) maxWin = streak;
    if (streak < maxLoss) maxLoss = streak;
  }
  curStreak = streak;
  return NextResponse.json({
    trades,
    stats: {
      total: closed.length, wins: wins.length, losses: losses.length,
      winRate: closed.length ? +((wins.length/closed.length)*100).toFixed(1) : 0,
      totalR: +totalR.toFixed(2),
      avgWin: wins.length ? +(grossWin/wins.length).toFixed(2) : 0,
      avgLoss: losses.length ? +(grossLoss/losses.length).toFixed(2) : 0,
      profitFactor: grossLoss > 0 ? +(grossWin/grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0,
      currentStreak: curStreak, maxWinStreak: maxWin, maxLossStreak: Math.abs(maxLoss),
      byType, bySess, bySym, mistakeCounts, curve
    }
  });
}
