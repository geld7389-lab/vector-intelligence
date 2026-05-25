import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const FMP_KEY = process.env.FMP_API_KEY ?? '';
const FMP = 'https://financialmodelingprep.com/api/v3';

interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number; }

async function getHistory(symbol: string): Promise<Bar[]> {
  try {
    const r = await fetch(`${FMP}/digital_currency_historical_price/${symbol}?from=2016-01-01&apikey=${FMP_KEY}`, { cache: 'no-store' });
    const data = await r.json();
    if (!Array.isArray(data)) return [];
    return data.map((d: {date?:string;open?:number;high?:number;low?:number;price?:number;volume?:number}) => ({
      date: d.date ?? '',
      open: d.open ?? d.price ?? 0,
      high: d.high ?? d.price ?? 0,
      low: d.low ?? d.price ?? 0,
      close: d.price ?? 0,
      volume: d.volume ?? 0,
    })).filter(d => d.date && d.close > 0).reverse();
  } catch { return []; }
}

function detectPatterns(bars: Bar[]) {
  const signals: {idx:number;type:string;dir:string;entry:number;sl:number;tp:number}[] = [];
  const lb = 5;
  for (let i = lb + 2; i < bars.length - 5; i++) {
    const w = bars.slice(i-lb, i);
    const swH = Math.max(...w.map(b=>b.high));
    const swL = Math.min(...w.map(b=>b.low));
    const mid = (swH + swL) / 2;
    const rng = swH - swL;
    if (rng < 1) continue;
    const c = bars[i], p1 = bars[i-1], p2 = bars[i-2];

    // Bullish FVG: gap between p2.high and c.low, bullish middle candle
    if (p2.high < c.low && p1.close > p1.open && c.close < mid) {
      const entry = (p2.high + c.low) / 2;
      const sl = entry - rng * 0.025;
      const tp = swH + rng * 0.05;
      if (Math.abs(tp-entry) / Math.abs(entry-sl) >= 1.5)
        signals.push({ idx: i, type: 'Bullish FVG', dir: 'bull', entry, sl, tp });
    }
    // Bearish FVG
    if (p2.low > c.high && p1.close < p1.open && c.close > mid) {
      const entry = (p2.low + c.high) / 2;
      const sl = entry + rng * 0.025;
      const tp = swL - rng * 0.05;
      if (Math.abs(tp-entry) / Math.abs(sl-entry) >= 1.5)
        signals.push({ idx: i, type: 'Bearish FVG', dir: 'bear', entry, sl, tp });
    }
    // Bullish OB: last bearish candle before bullish impulse in discount
    if (p1.close < p1.open && c.close > p1.high && c.close < mid) {
      const entry = (p1.open + p1.close) / 2;
      const sl = p1.low - rng * 0.015;
      const tp = swH;
      if (Math.abs(tp-entry) / Math.abs(entry-sl) >= 1.5)
        signals.push({ idx: i, type: 'Bullish OB', dir: 'bull', entry, sl, tp });
    }
    // Bearish OB
    if (p1.close > p1.open && c.close < p1.low && c.close > mid) {
      const entry = (p1.open + p1.close) / 2;
      const sl = p1.high + rng * 0.015;
      const tp = swL;
      if (Math.abs(tp-entry) / Math.abs(sl-entry) >= 1.5)
        signals.push({ idx: i, type: 'Bearish OB', dir: 'bear', entry, sl, tp });
    }
  }
  return signals;
}

function simulate(bars: Bar[], sig: {idx:number;dir:string;entry:number;sl:number;tp:number}, maxBars=15): 'win'|'loss'|null {
  for (let i = sig.idx+1; i < Math.min(sig.idx+maxBars, bars.length); i++) {
    const b = bars[i];
    if (sig.dir==='bull') { if(b.low<=sig.sl)return 'loss'; if(b.high>=sig.tp)return 'win'; }
    else { if(b.high>=sig.sl)return 'loss'; if(b.low<=sig.tp)return 'win'; }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { symbol='BTCUSD', marketSection='crypto' } = await req.json();
    const bars = await getHistory(symbol);
    if (bars.length < 50) return NextResponse.json({ error: `Only ${bars.length} bars — FMP may need a higher plan for this symbol` }, { status: 400 });

    const signals = detectPatterns(bars);
    const trades: {date:string;type:string;result:string;rr:number;year:string}[] = [];
    const yStats: Record<string,{wins:number;losses:number;total:number}> = {};

    for (const sig of signals) {
      const result = simulate(bars, sig);
      if (!result) continue;
      const date = bars[sig.idx].date;
      const year = date.slice(0,4);
      const rr = result==='win' ? Math.abs(sig.tp-sig.entry)/Math.abs(sig.entry-sig.sl) : 1;
      trades.push({ date, type: sig.type, result, rr: +rr.toFixed(2), year });
      if (!yStats[year]) yStats[year] = {wins:0,losses:0,total:0};
      yStats[year].total++;
      if (result==='win') yStats[year].wins++; else yStats[year].losses++;
    }

    if (!trades.length) return NextResponse.json({ error: 'No completed trades detected in data' }, { status: 400 });

    const wins = trades.filter(t=>t.result==='win').length;
    const losses = trades.length - wins;
    const wr = +(wins/trades.length*100).toFixed(1);
    const avgRR = +(trades.reduce((a,t)=>a+t.rr,0)/trades.length).toFixed(2);
    const gW = trades.filter(t=>t.result==='win').reduce((a,t)=>a+t.rr,0);
    const pf = losses>0 ? +(gW/losses).toFixed(2) : gW;
    const yrList = Object.entries(yStats).map(([y,s])=>({year:y,wr:s.total>0?s.wins/s.total:0}));
    const bestYear = [...yrList].sort((a,b)=>b.wr-a.wr)[0]?.year??'—';
    const worstYear = [...yrList].sort((a,b)=>a.wr-b.wr)[0]?.year??'—';

    const run = {
      symbol, timeframe:'D', market_section:marketSection, setup_type:'FVG+OB',
      from_date:bars[0].date, to_date:bars[bars.length-1].date,
      total_signals:signals.length, wins, losses, win_rate:wr, avg_rr:avgRR,
      total_pnl:+(wins*avgRR-losses).toFixed(2),
      max_drawdown:0, profit_factor:pf, best_year:bestYear, worst_year:worstYear,
      yearly_breakdown:yStats,
    };
    await sb.from('backtest_results').insert(run);
    return NextResponse.json({ run, totalBars:bars.length, dateRange:`${bars[0].date} → ${bars[bars.length-1].date}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  const {data} = await sb.from('backtest_results').select('*').order('created_at',{ascending:false}).limit(20);
  return NextResponse.json({ results: data??[] });
}
