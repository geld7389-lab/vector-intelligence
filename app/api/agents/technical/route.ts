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

function ema(data: number[], period: number): number[] {
  const k = 2/(period+1);
  const result = [data[0]];
  for (let i=1; i<data.length; i++) result.push(data[i]*k + result[i-1]*(1-k));
  return result;
}

function rsi(closes: number[], period=14): number {
  if (closes.length < period+1) return 50;
  let gains=0, losses=0;
  for (let i=closes.length-period; i<closes.length; i++) {
    const diff = closes[i]-closes[i-1];
    if (diff>0) gains+=diff; else losses+=Math.abs(diff);
  }
  const rs = gains/period / (losses/period || 0.001);
  return 100 - 100/(1+rs);
}

function atr(candles: Candle[], period=14): number {
  const trs = candles.slice(1).map((c,i)=>
    Math.max(c.h-c.l, Math.abs(c.h-candles[i].c), Math.abs(c.l-candles[i].c))
  );
  return trs.slice(-period).reduce((a,b)=>a+b,0)/period;
}

function vwap(candles: Candle[]): number {
  // Session VWAP from last 24 candles
  const session = candles.slice(-24);
  let pvSum=0, vSum=0;
  for (const c of session) {
    const tp = (c.h+c.l+c.c)/3;
    const v  = c.v ?? 1;
    pvSum += tp*v; vSum += v;
  }
  return vSum>0 ? pvSum/vSum : session[session.length-1]?.c ?? 0;
}

function analyzeConfluence(candles: Candle[], sym: string) {
  const closes = candles.map(c=>c.c);
  const price  = closes[closes.length-1];

  const ema9  = ema(closes,9);
  const ema21 = ema(closes,21);
  const ema50 = ema(closes,50);
  const ema200= ema(closes,200);

  const rsiVal  = rsi(closes);
  const atrVal  = atr(candles);
  const vwapVal = vwap(candles);

  // RSI divergence: price makes new high but RSI doesn't (or vice versa)
  const last20closes = closes.slice(-20);
  const last20rsi    = closes.slice(-20).map((_,i)=>rsi(closes.slice(0,closes.length-20+i+1)));
  const priceHigher  = last20closes[last20closes.length-1] > last20closes[0];
  const rsiLower     = last20rsi[last20rsi.length-1] < last20rsi[0];
  const bearDiv      = priceHigher && rsiLower;
  const bullDiv      = !priceHigher && !rsiLower;

  // EMA stack
  const emaStack = price > ema9[ema9.length-1] && ema9[ema9.length-1] > ema21[ema21.length-1] &&
    ema21[ema21.length-1] > ema50[ema50.length-1] ? 'bullish' :
    price < ema9[ema9.length-1] && ema9[ema9.length-1] < ema21[ema21.length-1] &&
    ema21[ema21.length-1] < ema50[ema50.length-1] ? 'bearish' : 'mixed';

  // Volatility
  const avgAtr = atrVal;
  const volatility = avgAtr/price*100 > 1.5 ? 'high' : avgAtr/price*100 < 0.3 ? 'low' : 'normal';

  return {
    symbol: sym, price,
    rsi: Math.round(rsiVal*10)/10,
    rsi_signal: rsiVal>70?'overbought':rsiVal<30?'oversold':'neutral',
    rsi_divergence: bearDiv?'bearish':bullDiv?'bullish':'none',
    ema9: Math.round(ema9[ema9.length-1]*100)/100,
    ema21: Math.round(ema21[ema21.length-1]*100)/100,
    ema50: Math.round(ema50[ema50.length-1]*100)/100,
    ema200: ema200.length>0 ? Math.round(ema200[ema200.length-1]*100)/100 : null,
    ema_stack: emaStack,
    vwap: Math.round(vwapVal*100)/100,
    price_vs_vwap: price > vwapVal ? 'above' : 'below',
    atr: Math.round(atrVal*10000)/10000,
    volatility,
    score: [
      emaStack==='bullish'?1:emaStack==='bearish'?-1:0,
      rsiVal<70&&rsiVal>30?0.5:0,
      bearDiv?-1:bullDiv?1:0,
      price>vwapVal?0.5:-0.5,
    ].reduce((a,b)=>a+b,0),
  };
}

export async function POST(req: NextRequest) {
  const { symbols = ['NQ','ES','GC','EURUSD','GBPUSD','BTC'] } = await req.json().catch(()=>({}));
  const confluence: Record<string,any> = {};

  await Promise.all(symbols.map(async (sym: string) => {
    const candles = await fetchCandles(sym, '60m', '1mo');
    if (candles.length > 50) {
      confluence[sym] = analyzeConfluence(candles, sym);
    }
  }));

  return NextResponse.json({ confluence });
}
