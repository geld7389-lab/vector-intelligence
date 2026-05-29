import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const supabase = createClient((process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co'), (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'));

async function fetchCandles(symbol: string): Promise<{h:number,l:number,c:number,t:number}[]> {
  try {
    try {
      const yahooMap: Record<string,string> = { NQ:'NQ=F', ES:'ES=F', GC:'GC=F' };
      const ySym = yahooMap[symbol] ?? `${symbol}=F`;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=15m&range=5d`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
      if (!res.ok) return [];
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) return [];
      const ts: number[] = result.timestamp ?? [];
      const q = result.indicators?.quote?.[0] ?? {};
      return ts.map((t,i)=>({ t:t*1000, o:q.open?.[i], h:q.high?.[i], l:q.low?.[i], c:q.close?.[i], v:q.volume?.[i] })).filter((c:any)=>c.o!=null&&c.l!=null&&c.c!=null);
    } catch { return []; }
  } catch { return []; }
}

function findSwings(candles: {h:number,l:number}[], lookback=3) {
  const highs: number[] = [], lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const isHH = candles.slice(i-lookback,i).every(c=>c.h<candles[i].h) && candles.slice(i+1,i+lookback+1).every(c=>c.h<candles[i].h);
    const isLL = candles.slice(i-lookback,i).every(c=>c.l>candles[i].l) && candles.slice(i+1,i+lookback+1).every(c=>c.l>candles[i].l);
    if (isHH) highs.push(candles[i].h);
    if (isLL) lows.push(candles[i].l);
  }
  return { highs: highs.slice(-3), lows: lows.slice(-3) };
}

export async function GET() {
  const [nqC, esC] = await Promise.all([fetchCandles('NQ'), fetchCandles('ES')]);
  if (!nqC.length || !esC.length) return NextResponse.json({ signals: [], error: 'No candle data' });

  const nqSwings = findSwings(nqC);
  const esSwings = findSwings(esC);
  const signals = [];

  const nqLast = nqC[nqC.length-1];
  const esLast = esC[esC.length-1];

  // Bearish SMT: NQ makes higher high, ES does NOT confirm (lower high)
  if (nqSwings.highs.length >= 2 && esSwings.highs.length >= 2) {
    const nqHH = nqSwings.highs[nqSwings.highs.length-1] > nqSwings.highs[nqSwings.highs.length-2];
    const esNoHH = esSwings.highs[esSwings.highs.length-1] < esSwings.highs[esSwings.highs.length-2];
    if (nqHH && esNoHH) {
      signals.push({ type: 'bearish_smt', description: 'NQ made higher high — ES did NOT confirm. Bearish SMT divergence. Institutional distribution likely.', nq_price: nqLast.c, es_price: esLast.c, nq_swing: 'HH', es_swing: 'LH', strength: 'high', timeframe: '15m' });
    }
  }

  // Bullish SMT: NQ makes lower low, ES does NOT confirm (higher low)
  if (nqSwings.lows.length >= 2 && esSwings.lows.length >= 2) {
    const nqLL = nqSwings.lows[nqSwings.lows.length-1] < nqSwings.lows[nqSwings.lows.length-2];
    const esNoLL = esSwings.lows[esSwings.lows.length-1] > esSwings.lows[esSwings.lows.length-2];
    if (nqLL && esNoLL) {
      signals.push({ type: 'bullish_smt', description: 'NQ made lower low — ES did NOT confirm. Bullish SMT divergence. Institutional accumulation likely.', nq_price: nqLast.c, es_price: esLast.c, nq_swing: 'LL', es_swing: 'HL', strength: 'high', timeframe: '15m' });
    }
  }

  // Save to DB if found
  if (signals.length > 0) {
    await supabase.from('smt_signals').insert(signals.map(s => ({
      nq_price: s.nq_price, es_price: s.es_price, nq_swing: s.nq_swing,
      es_swing: s.es_swing, divergence_type: s.type, timeframe: s.timeframe, notes: s.description
    })));
  }

  // Also return recent historical
  const { data: history } = await supabase.from('smt_signals').select('*').order('detected_at', { ascending: false }).limit(10);
  return NextResponse.json({ signals, recent: history ?? [], nqSwings, esSwings });
}
