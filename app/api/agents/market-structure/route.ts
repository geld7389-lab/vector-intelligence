import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Candle { t:number; o:number; h:number; l:number; c:number; v?:number; }

const YAHOO_MAP: Record<string,string> = {
  NQ:'NQ=F', ES:'ES=F', GC:'GC=F', CL:'CL=F', SI:'SI=F',
  BTC:'BTC-USD', ETH:'ETH-USD',
  EURUSD:'EURUSD=X', GBPUSD:'GBPUSD=X', USDJPY:'USDJPY=X',
  AUDUSD:'AUDUSD=X', USDCAD:'USDCAD=X', USDCHF:'USDCHF=X',
  XAUUSD:'GC=F', XAGUSD:'SI=F', USOIL:'CL=F',
  US30:'YM=F', SPX500:'ES=F', GER40:'GDAXI',
};

async function fetchCandles(symbol: string, interval='60m', range='1mo'): Promise<Candle[]> {
  try {
    const ySym = YAHOO_MAP[symbol] ?? `${symbol}=F`;
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${interval}&range=${range}`,
      { headers:{'User-Agent':'Mozilla/5.0'}, cache:'no-store' }
    );
    if (!res.ok) return [];
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return [];
    const ts: number[] = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    return ts.map((t,i)=>({ t:t*1000,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i],v:q.volume?.[i] }))
      .filter(c=>c.o!=null&&c.h!=null&&c.l!=null&&c.c!=null) as Candle[];
  } catch { return []; }
}

function detectBias(candles: Candle[]): 'bullish'|'bearish'|'neutral' {
  if (candles.length < 20) return 'neutral';
  const last = candles.slice(-20);
  const mid = Math.floor(last.length/2);
  const hh = last[last.length-1].h > last[mid].h;
  const hl = last[last.length-1].l > last[mid].l;
  const lh = last[last.length-1].h < last[mid].h;
  const ll = last[last.length-1].l < last[mid].l;
  if (hh && hl) return 'bullish';
  if (lh && ll) return 'bearish';
  return 'neutral';
}

function detectBOS(candles: Candle[], lookback=5) {
  const events: {type:string; level:number; direction:string; index:number}[] = [];
  let trend: 'bull'|'bear'|null = null;
  for (let i=lookback; i<candles.length; i++) {
    const slice = candles.slice(Math.max(0,i-lookback), i);
    const prevHigh = Math.max(...slice.map(c=>c.h));
    const prevLow  = Math.min(...slice.map(c=>c.l));
    const c = candles[i];
    if (!trend) {
      if (c.c > prevHigh) trend='bull';
      else if (c.c < prevLow) trend='bear';
    } else if (trend==='bull' && c.c < prevLow) {
      events.push({ type:'CHoCH', level:prevLow, direction:'bear', index:i });
      trend='bear';
    } else if (trend==='bear' && c.c > prevHigh) {
      events.push({ type:'CHoCH', level:prevHigh, direction:'bull', index:i });
      trend='bull';
    } else if (trend==='bull' && c.c > prevHigh) {
      events.push({ type:'BOS', level:prevHigh, direction:'bull', index:i });
    } else if (trend==='bear' && c.c < prevLow) {
      events.push({ type:'BOS', level:prevLow, direction:'bear', index:i });
    }
  }
  return events.slice(-5);
}

function detectSwings(candles: Candle[], lookback=3) {
  const highs: {price:number; index:number}[] = [];
  const lows:  {price:number; index:number}[] = [];
  for (let i=lookback; i<candles.length-lookback; i++) {
    const window = candles.slice(i-lookback, i+lookback+1);
    const maxH = Math.max(...window.map(c=>c.h));
    const minL = Math.min(...window.map(c=>c.l));
    if (candles[i].h === maxH) highs.push({ price:candles[i].h, index:i });
    if (candles[i].l === minL) lows.push({ price:candles[i].l, index:i });
  }
  return {
    swing_highs: highs.slice(-3).map(s=>s.price),
    swing_lows: lows.slice(-3).map(s=>s.price),
  };
}

export async function POST(req: NextRequest) {
  const { symbols = ['NQ','ES','GC','EURUSD','GBPUSD','BTC'] } = await req.json().catch(()=>({}));
  const biases: Record<string,string> = {};
  const structure: Record<string,any> = {};

  await Promise.all(symbols.map(async (sym: string) => {
    const [h1, h4] = await Promise.all([
      fetchCandles(sym, '60m', '1mo'),
      fetchCandles(sym, '1d', '3mo'),
    ]);
    const bias_h1  = detectBias(h1);
    const bias_h4  = detectBias(h4);
    const bos      = detectBOS(h1);
    const swings   = detectSwings(h1);
    const price    = h1[h1.length-1]?.c ?? 0;

    // Overall bias: h4 takes priority
    biases[sym] = bias_h4 !== 'neutral' ? bias_h4 : bias_h1;

    structure[sym] = {
      bias_h1, bias_h4,
      overall: biases[sym],
      price,
      bos_choch: bos,
      ...swings,
      last_candle: h1[h1.length-1] ?? null,
    };
  }));

  return NextResponse.json({ biases, structure });
}
