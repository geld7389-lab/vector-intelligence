import { NextRequest, NextResponse } from 'next/server';
import { sb as supabase } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';


const PAIRS: [string,string][] = [['NQ','ES'],['BTC','ETH'],['EURUSD','GBPUSD']];
const YAHOO: Record<string,string> = { NQ:'NQ=F', ES:'ES=F', GC:'GC=F', BTC:'BTC-USD', ETH:'ETH-USD', SOL:'SOL-USD', EURUSD:'EURUSD=X', GBPUSD:'GBPUSD=X' };

async function fetchCandles(symbol: string) {
  try {
    const ySym = YAHOO[symbol] ?? `${symbol}=F`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=15m&range=5d`;
    const res = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'}, cache:'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    return ts.map((t,i)=>({t:t*1000,h:q.high?.[i],l:q.low?.[i],c:q.close?.[i]})).filter((c:any)=>c.h!=null&&c.l!=null&&c.c!=null);
  } catch { return []; }
}

function findSwings(candles:{h:number;l:number}[], lookback=3) {
  const highs:number[]=[], lows:number[]=[];
  for (let i=lookback;i<candles.length-lookback;i++) {
    if (candles.slice(i-lookback,i).every(c=>c.h<candles[i].h)&&candles.slice(i+1,i+lookback+1).every(c=>c.h<candles[i].h)) highs.push(candles[i].h);
    if (candles.slice(i-lookback,i).every(c=>c.l>candles[i].l)&&candles.slice(i+1,i+lookback+1).every(c=>c.l>candles[i].l)) lows.push(candles[i].l);
  }
  return { highs:highs.slice(-3), lows:lows.slice(-3) };
}

async function runSMTScan() {
  const signals: any[] = [];
  for (const [symA, symB] of PAIRS) {
    const [cA, cB] = await Promise.all([fetchCandles(symA), fetchCandles(symB)]);
    if (!cA.length||!cB.length) continue;
    const sA=findSwings(cA), sB=findSwings(cB);
    const lastA=cA[cA.length-1], lastB=cB[cB.length-1];
    // Bearish SMT: A makes HH, B does NOT
    if (sA.highs.length>=2&&sB.highs.length>=2) {
      if (sA.highs[sA.highs.length-1]>sA.highs[sA.highs.length-2]&&sB.highs[sB.highs.length-1]<sB.highs[sB.highs.length-2]) {
        signals.push({ type:'bearish_smt', description:`${symA} HH — ${symB} LH. Bearish divergence. Distribution likely.`, nq_price:lastA.c, es_price:lastB.c, nq_swing:'HH', es_swing:'LH', strength:'high', timeframe:'15m', pair:`${symA}/${symB}` });
      }
    }
    // Bullish SMT: A makes LL, B does NOT
    if (sA.lows.length>=2&&sB.lows.length>=2) {
      if (sA.lows[sA.lows.length-1]<sA.lows[sA.lows.length-2]&&sB.lows[sB.lows.length-1]>sB.lows[sB.lows.length-2]) {
        signals.push({ type:'bullish_smt', description:`${symA} LL — ${symB} HL. Bullish divergence. Accumulation likely.`, nq_price:lastA.c, es_price:lastB.c, nq_swing:'LL', es_swing:'HL', strength:'high', timeframe:'15m', pair:`${symA}/${symB}` });
      }
    }
  }
  if (signals.length>0) {
    await supabase.from('smt_signals').insert(signals.map(s=>({
      nq_price:s.nq_price, es_price:s.es_price, nq_swing:s.nq_swing, es_swing:s.es_swing,
      divergence_type:s.type, timeframe:s.timeframe, notes:`${s.description} (${s.pair})`
    })));
  }
  return signals;
}

export async function GET() {
  const { data:history } = await supabase.from('smt_signals').select('*').order('detected_at',{ascending:false}).limit(15);
  return NextResponse.json({ recent:history??[] });
}

export async function POST() {
  const signals = await runSMTScan();
  const { data:history } = await supabase.from('smt_signals').select('*').order('detected_at',{ascending:false}).limit(15);
  return NextResponse.json({ signals, recent:history??[], count:signals.length });
}
