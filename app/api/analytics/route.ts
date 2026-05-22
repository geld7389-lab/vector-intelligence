import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export async function GET() {
  const { data: trades } = await supabase.from('trades').select('*').order('opened_at', { ascending: true });
  if (!trades || !trades.length) return NextResponse.json({ stats: null, trades: [] });

  const ptVal = (t: {symbol:string}) => t.symbol === 'NQ' ? 20 : 50;
  const pnl = (t: {result:string,entry_price:number,take_profit:number,stop_loss:number,symbol:string,pnl?:number}) => {
    if (t.pnl) return t.pnl;
    return t.result === 'win' ? Math.abs(t.take_profit - t.entry_price)*ptVal(t) : -Math.abs(t.entry_price - t.stop_loss)*ptVal(t);
  };

  const wins = trades.filter(t=>t.result==='win');
  const losses = trades.filter(t=>t.result==='loss');
  const totalPnl = trades.reduce((a,t)=>a+pnl(t),0);
  const winRate = trades.length ? wins.length/trades.length : 0;
  const avgWin = wins.length ? wins.reduce((a,t)=>a+pnl(t),0)/wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a,t)=>a+Math.abs(pnl(t)),0)/losses.length : 0;
  const profitFactor = avgLoss > 0 ? (wins.length*avgWin)/(losses.length*avgLoss) : 0;
  const expectancy = totalPnl / trades.length;

  // By session
  const sessions = ['London','NY','Silver Bullet','Asia'];
  const bySession = sessions.map(s => {
    const st = trades.filter(t=>t.session===s);
    const wr = st.length ? st.filter(t=>t.result==='win').length/st.length : 0;
    const p = st.reduce((a,t)=>a+pnl(t),0);
    return { session: s, trades: st.length, winRate: +(wr*100).toFixed(1), pnl: +p.toFixed(0) };
  }).filter(s=>s.trades>0);

  // By day of week
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  const byDay = days.map(d => {
    const dt = trades.filter(t=>t.day_of_week===d || new Date(t.opened_at).toLocaleDateString('en-US',{weekday:'long'})===d);
    const wr = dt.length ? dt.filter(t=>t.result==='win').length/dt.length : 0;
    return { day: d, trades: dt.length, winRate: +(wr*100).toFixed(1), pnl: +dt.reduce((a,t)=>a+pnl(t),0).toFixed(0) };
  }).filter(d=>d.trades>0);

  // Equity curve
  let equity = 0;
  const equityCurve = trades.map(t => { equity += pnl(t); return { date: t.opened_at?.slice(0,10), equity: +equity.toFixed(0) }; });

  // Max drawdown
  let peak = 0, maxDD = 0; equity = 0;
  for (const t of trades) {
    equity += pnl(t);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  // Consecutive
  let maxConsecLoss = 0, curConsec = 0;
  for (const t of trades) {
    if (t.result !== 'win') { curConsec++; maxConsecLoss = Math.max(maxConsecLoss, curConsec); } else curConsec = 0;
  }

  return NextResponse.json({
    stats: {
      totalTrades: trades.length, wins: wins.length, losses: losses.length,
      winRate: +(winRate*100).toFixed(1), totalPnl: +totalPnl.toFixed(0),
      avgWin: +avgWin.toFixed(0), avgLoss: +avgLoss.toFixed(0),
      profitFactor: +profitFactor.toFixed(2), expectancy: +expectancy.toFixed(0),
      maxDrawdown: +maxDD.toFixed(0), maxConsecLoss,
    },
    bySession, byDay, equityCurve, trades
  });
}
