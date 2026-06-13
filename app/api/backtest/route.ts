import { NextRequest, NextResponse } from 'next/server';
import { sb as supabase } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';


async function fetchCandles(symbol: string, tf: string) {
  try {
    const map:Record<string,string>={NQ:'NQ=F',ES:'ES=F',GC:'GC=F',BTC:'BTC-USD',ETH:'ETH-USD',EURUSD:'EURUSD=X',GBPUSD:'GBPUSD=X',SPY:'SPY',QQQ:'QQQ'};
    const ySym = map[symbol]??`${symbol}=F`;
    const intv = tf==='15m'?'15m':tf==='1h'?'60m':'1d';
    const rng = tf==='15m'?'1mo':tf==='1h'?'3mo':'1y';
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${intv}&range=${rng}`,{headers:{'User-Agent':'Mozilla/5.0'},cache:'no-store'});
    if(!r.ok) return [];
    const d = await r.json();
    const res = d?.chart?.result?.[0];
    if(!res) return [];
    const ts:number[]=res.timestamp??[];
    const q=res.indicators?.quote?.[0]??{};
    return ts.map((t,i)=>({t:t*1000,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i]})).filter((c:any)=>c.o!=null&&c.h!=null&&c.l!=null&&c.c!=null);
  } catch { return []; }
}

function runBacktest(candles: any[], direction: string) {
  const trades: {entry:number;sl:number;tp:number;result:'win'|'loss';rr:number;pnl:number}[] = [];
  const isBull = direction==='bull';

  for (let i=20; i<candles.length-5; i++) {
    const c = candles[i];
    const range = c.h - c.l;
    if (range < 0.001) continue;

    // Simple ICT-style entry: look for FVG-like moves
    const prev3 = candles.slice(i-3,i);
    const impulse = Math.abs(c.c - c.o) / range;
    if (impulse < 0.6) continue; // not strong enough candle

    if (isBull && c.c > c.o) {
      const entry = c.h * 0.9997 + c.l * 0.0003;
      const sl = c.l - range * 0.5;
      const tp = entry + (entry - sl) * 2.5;
      const future = candles.slice(i+1, i+8);
      let result: 'win'|'loss' = 'loss';
      for (const fc of future) {
        if (fc.l <= sl) { result='loss'; break; }
        if (fc.h >= tp) { result='win'; break; }
      }
      const rr = result==='win' ? 2.5 : -1;
      trades.push({ entry, sl, tp, result, rr, pnl: rr * 100 });
    }
    if (!isBull && c.c < c.o) {
      const entry = c.l * 0.9997 + c.h * 0.0003;
      const sl = c.h + range * 0.5;
      const tp = entry - (sl - entry) * 2.5;
      const future = candles.slice(i+1, i+8);
      let result: 'win'|'loss' = 'loss';
      for (const fc of future) {
        if (fc.h >= sl) { result='loss'; break; }
        if (fc.l <= tp) { result='win'; break; }
      }
      const rr = result==='win' ? 2.5 : -1;
      trades.push({ entry, sl, tp, result, rr, pnl: rr * 100 });
    }
  }
  return trades;
}

export async function GET() {
  try {
    const { data } = await sb.from('backtest_runs').select('*').order('created_at',{ascending:false}).limit(20);
    return NextResponse.json({ runs: data ?? [] });
  } catch { return NextResponse.json({ runs: [] }); }
}

export async function POST(req: NextRequest) {
  const { symbol='NQ', timeframe='1h', direction='bull' } = await req.json();
  const candles = await fetchCandles(symbol, timeframe);
  if (candles.length < 50) return NextResponse.json({ error:'Insufficient data' }, { status:400 });

  const trades = runBacktest(candles, direction);
  if (!trades.length) return NextResponse.json({ error:'No setups found in data' }, { status:400 });

  const wins = trades.filter(t=>t.result==='win');
  const losses = trades.filter(t=>t.result==='loss');
  const totalPnl = trades.reduce((a,t)=>a+t.pnl,0);
  const winR = wins.reduce((a,t)=>a+t.rr,0);
  const lossR = Math.abs(losses.reduce((a,t)=>a+t.rr,0));
  const winRate = +(wins.length/trades.length*100).toFixed(1);
  const pf = lossR>0 ? +(winR/lossR).toFixed(2) : 99;

  let peak=0, dd=0, maxDD=0, cur=0;
  trades.forEach(t=>{ cur+=t.pnl; if(cur>peak)peak=cur; dd=peak-cur; if(dd>maxDD)maxDD=dd; });
  let streak=0,maxStreak=0;
  trades.forEach(t=>{ if(t.result==='loss'){streak++;maxStreak=Math.max(maxStreak,streak);}else streak=0; });

  const run = {
    symbol, timeframe, start_date:new Date(candles[0].t).toISOString().slice(0,10),
    end_date:new Date(candles[candles.length-1].t).toISOString().slice(0,10),
    total_trades:trades.length, wins:wins.length, losses:losses.length,
    win_rate:winRate, total_pnl:+totalPnl.toFixed(2), max_drawdown:+maxDD.toFixed(2),
    profit_factor:pf, sharpe_ratio:+(totalPnl/(trades.length*10)).toFixed(2),
    expectancy:+(totalPnl/trades.length).toFixed(2),
    avg_rr:+(trades.reduce((a,t)=>a+t.rr,0)/trades.length).toFixed(2),
    max_consecutive_losses:maxStreak,
    parameters:{direction}
  };

  try {
    await sb.from('backtest_runs').insert(run);
  } catch {}

  return NextResponse.json({ run });
}
