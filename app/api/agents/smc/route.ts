import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Candle { t:number; o:number; h:number; l:number; c:number; v?:number; }

const YAHOO_MAP: Record<string,string> = {
  NQ:'NQ=F', ES:'ES=F', GC:'GC=F', CL:'CL=F',
  BTC:'BTC-USD', ETH:'ETH-USD',
  EURUSD:'EURUSD=X', GBPUSD:'GBPUSD=X', USDJPY:'USDJPY=X',
  XAUUSD:'GC=F', XAGUSD:'SI=F', USOIL:'CL=F',
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

function detectFVGs(candles: Candle[], symbol: string, tf: string) {
  const fvgs: any[] = [];
  const price = candles[candles.length-1]?.c ?? 0;
  for (let i=2; i<candles.length; i++) {
    const prev  = candles[i-2];
    const curr  = candles[i];
    // Bullish FVG: gap between prev.high and curr.low
    if (curr.l > prev.h) {
      const filled = price < curr.l || price > curr.l + (curr.l - prev.h);
      fvgs.push({ symbol, timeframe:tf, type:'bull', high:curr.l, low:prev.h,
        mid:(curr.l+prev.h)/2, filled, fill_pct: filled?100:Math.min(100,Math.max(0,((price-prev.h)/(curr.l-prev.h))*100)),
        created_at: new Date(candles[i].t).toISOString() });
    }
    // Bearish FVG: gap between curr.high and prev.low
    if (curr.h < prev.l) {
      const filled = price > curr.h || price < curr.h - (prev.l - curr.h);
      fvgs.push({ symbol, timeframe:tf, type:'bear', high:prev.l, low:curr.h,
        mid:(prev.l+curr.h)/2, filled, fill_pct: filled?100:Math.min(100,Math.max(0,((prev.l-price)/(prev.l-curr.h))*100)),
        created_at: new Date(candles[i].t).toISOString() });
    }
  }
  return fvgs.filter(f=>!f.filled).slice(-6);
}

function detectOrderBlocks(candles: Candle[], symbol: string, tf: string) {
  const obs: any[] = [];
  const price = candles[candles.length-1]?.c ?? 0;
  for (let i=1; i<candles.length-2; i++) {
    const c = candles[i];
    const next = candles[i+1];
    const isBull = c.c < c.o; // bearish candle before big bull move
    const isBear = c.c > c.o; // bullish candle before big bear move
    const bigMoveUp   = next.c > c.h * 1.001;
    const bigMoveDown = next.c < c.l * 0.999;

    if (isBull && bigMoveUp) {
      const mitigated = price < c.l;
      obs.push({ symbol, timeframe:tf, type:'bull', high:c.h, low:c.l, mitigated,
        strength: (c.h-c.l) > (next.h-next.l) ? 'strong' : 'normal',
        created_at: new Date(c.t).toISOString() });
    }
    if (isBear && bigMoveDown) {
      const mitigated = price > c.h;
      obs.push({ symbol, timeframe:tf, type:'bear', high:c.h, low:c.l, mitigated,
        strength: (c.h-c.l) > (next.h-next.l) ? 'strong' : 'normal',
        created_at: new Date(c.t).toISOString() });
    }
  }
  return obs.filter(o=>!o.mitigated).slice(-4);
}

function detectLiquidity(candles: Candle[], symbol: string) {
  const highs = candles.map(c=>c.h);
  const lows  = candles.map(c=>c.l);
  const price = candles[candles.length-1]?.c ?? 0;

  // Equal highs/lows = liquidity pools
  const eqHighs: number[] = [];
  const eqLows:  number[] = [];
  for (let i=0; i<highs.length-1; i++) {
    for (let j=i+1; j<highs.length; j++) {
      if (Math.abs(highs[i]-highs[j])/highs[i] < 0.001) eqHighs.push(highs[i]);
      if (Math.abs(lows[i]-lows[j])/lows[i] < 0.001) eqLows.push(lows[i]);
    }
  }

  return {
    symbol,
    buy_side_liq: [...new Set(eqHighs)].slice(-3),   // above price
    sell_side_liq: [...new Set(eqLows)].slice(-3),    // below price
    recent_high: Math.max(...highs.slice(-20)),
    recent_low:  Math.min(...lows.slice(-20)),
    price,
  };
}

export async function POST(req: NextRequest) {
  const { symbols = ['NQ','ES','GC','EURUSD','GBPUSD','BTC'] } = await req.json().catch(()=>({}));

  const allFvgs:   any[] = [];
  const allObs:    any[] = [];
  const allLiq:    any[] = [];

  await Promise.all(symbols.map(async (sym: string) => {
    const [h1, h4] = await Promise.all([
      fetchCandles(sym, '60m', '1mo'),
      fetchCandles(sym, '1d', '3mo'),
    ]);
    allFvgs.push(...detectFVGs(h1, sym, 'H1'));
    allFvgs.push(...detectFVGs(h4, sym, 'H4'));
    allObs.push(...detectOrderBlocks(h1, sym, 'H1'));
    allObs.push(...detectOrderBlocks(h4, sym, 'H4'));
    allLiq.push(detectLiquidity(h1, sym));
  }));

  return NextResponse.json({
    fvgs:         allFvgs,
    order_blocks: allObs,
    liquidity:    allLiq,
    total_fvgs:   allFvgs.length,
    total_obs:    allObs.length,
  });
}
