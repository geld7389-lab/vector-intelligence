import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.GJgxNwP6LfphbHTijGhrHK5DMpDcarJin2bVmoxU4bo';
const sb = createClient(SB_URL, SB_KEY);

interface Bar { date:string; open:number; high:number; low:number; close:number; volume:number; }

async function getHistory(symbol: string): Promise<Bar[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=10y`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    const d = await r.json();
    const result = d?.chart?.result?.[0];
    if (!result) return [];
    const times = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    return times.map((t: number, i: number) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? 0, high: q.high?.[i] ?? 0,
      low: q.low?.[i] ?? 0, close: q.close?.[i] ?? 0, volume: q.volume?.[i] ?? 0,
    })).filter((b: Bar) => b.close > 0);
  } catch { return []; }
}

function detect(bars: Bar[]) {
  const sigs: {idx:number;type:string;dir:string;entry:number;sl:number;tp:number}[] = [];
  for (let i = 7; i < bars.length - 5; i++) {
    const w = bars.slice(i-5, i);
    const swH = Math.max(...w.map(b=>b.high));
    const swL = Math.min(...w.map(b=>b.low));
    const mid = (swH + swL) / 2;
    const rng = swH - swL; if (rng < 1) continue;
    const c = bars[i], p1 = bars[i-1], p2 = bars[i-2];

    if (p2.high < c.low && p1.close > p1.open && c.close < mid) {
      const entry=(p2.high+c.low)/2, sl=entry-rng*0.025, tp=swH+rng*0.05;
      if (Math.abs(tp-entry)/Math.abs(entry-sl)>=1.5) sigs.push({idx:i,type:'Bullish FVG',dir:'bull',entry,sl,tp});
    }
    if (p2.low > c.high && p1.close < p1.open && c.close > mid) {
      const entry=(p2.low+c.high)/2, sl=entry+rng*0.025, tp=swL-rng*0.05;
      if (Math.abs(tp-entry)/Math.abs(sl-entry)>=1.5) sigs.push({idx:i,type:'Bearish FVG',dir:'bear',entry,sl,tp});
    }
    if (p1.close < p1.open && c.close > p1.high && c.close < mid) {
      const entry=(p1.open+p1.close)/2, sl=p1.low-rng*0.015, tp=swH;
      if (Math.abs(tp-entry)/Math.abs(entry-sl)>=1.5) sigs.push({idx:i,type:'Bullish OB',dir:'bull',entry,sl,tp});
    }
    if (p1.close > p1.open && c.close < p1.low && c.close > mid) {
      const entry=(p1.open+p1.close)/2, sl=p1.high+rng*0.015, tp=swL;
      if (Math.abs(tp-entry)/Math.abs(sl-entry)>=1.5) sigs.push({idx:i,type:'Bearish OB',dir:'bear',entry,sl,tp});
    }
  }
  return sigs;
}

function sim(bars: Bar[], sig: {idx:number;dir:string;entry:number;sl:number;tp:number}): 'win'|'loss'|null {
  for (let i=sig.idx+1; i<Math.min(sig.idx+15,bars.length); i++) {
    const b=bars[i];
    if (sig.dir==='bull') { if(b.low<=sig.sl)return 'loss'; if(b.high>=sig.tp)return 'win'; }
    else { if(b.high>=sig.sl)return 'loss'; if(b.low<=sig.tp)return 'win'; }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { symbol='BTC-USD', marketSection='crypto' } = await req.json();
    const bars = await getHistory(symbol);
    if (bars.length < 50) return NextResponse.json({ error: `Only ${bars.length} bars available for ${symbol}` }, { status: 400 });

    const sigs = detect(bars);
    const trades: {date:string;type:string;result:string;rr:number;year:string}[] = [];
    const yS: Record<string,{wins:number;losses:number;total:number}> = {};

    for (const sig of sigs) {
      const result = sim(bars, sig); if (!result) continue;
      const date = bars[sig.idx].date, year = date.slice(0,4);
      const rr = result==='win' ? Math.abs(sig.tp-sig.entry)/Math.abs(sig.entry-sig.sl) : 1;
      trades.push({date,type:sig.type,result,rr:+rr.toFixed(2),year});
      if (!yS[year]) yS[year]={wins:0,losses:0,total:0};
      yS[year].total++; if(result==='win') yS[year].wins++; else yS[year].losses++;
    }
    if (!trades.length) return NextResponse.json({ error: 'No completed trades in data' }, { status: 400 });

    const wins=trades.filter(t=>t.result==='win').length, losses=trades.length-wins;
    const wr=+(wins/trades.length*100).toFixed(1);
    const avgRR=+(trades.reduce((a,t)=>a+t.rr,0)/trades.length).toFixed(2);
    const gW=trades.filter(t=>t.result==='win').reduce((a,t)=>a+t.rr,0);
    const pf=losses>0?+(gW/losses).toFixed(2):gW;
    const yrList=Object.entries(yS).map(([y,s])=>({year:y,wr:s.total>0?s.wins/s.total:0}));
    const bestYear=[...yrList].sort((a,b)=>b.wr-a.wr)[0]?.year??'—';
    const worstYear=[...yrList].sort((a,b)=>a.wr-b.wr)[0]?.year??'—';

    const run={symbol,timeframe:'D',market_section:marketSection,setup_type:'FVG+OB',
      from_date:bars[0].date,to_date:bars[bars.length-1].date,
      total_signals:sigs.length,wins,losses,win_rate:wr,avg_rr:avgRR,
      total_pnl:+(wins*avgRR-losses).toFixed(2),max_drawdown:0,profit_factor:pf,
      best_year:bestYear,worst_year:worstYear,yearly_breakdown:yS};
    await sb.from('backtest_results').insert(run);
    return NextResponse.json({run,totalBars:bars.length,dateRange:`${bars[0].date} → ${bars[bars.length-1].date}`});
  } catch(err) { return NextResponse.json({error:err instanceof Error?err.message:String(err)},{status:500}); }
}

export async function GET() {
  const {data}=await sb.from('backtest_results').select('*').order('created_at',{ascending:false}).limit(20);
  return NextResponse.json({results:data??[]});
}
