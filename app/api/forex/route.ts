import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const FOREX = [
  {symbol:'EURUSD=X',name:'EUR/USD',pair:'EUR/USD'},
  {symbol:'GBPUSD=X',name:'GBP/USD',pair:'GBP/USD'},
  {symbol:'USDJPY=X',name:'USD/JPY',pair:'USD/JPY'},
  {symbol:'AUDUSD=X',name:'AUD/USD',pair:'AUD/USD'},
  {symbol:'USDCAD=X',name:'USD/CAD',pair:'USD/CAD'},
  {symbol:'USDCHF=X',name:'USD/CHF',pair:'USD/CHF'},
  {symbol:'GBPJPY=X',name:'GBP/JPY',pair:'GBP/JPY'},
  {symbol:'EURJPY=X',name:'EUR/JPY',pair:'EUR/JPY'},
];
const COMMODITIES = [
  {symbol:'GC=F',name:'Gold',unit:'oz'},
  {symbol:'SI=F',name:'Silver',unit:'oz'},
  {symbol:'CL=F',name:'Crude Oil',unit:'bbl'},
  {symbol:'NG=F',name:'Natural Gas',unit:'MMBtu'},
  {symbol:'HG=F',name:'Copper',unit:'lb'},
  {symbol:'PL=F',name:'Platinum',unit:'oz'},
  {symbol:'DX-Y.NYB',name:'DXY Index',unit:''},
];

async function yp(symbol: string) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
      {headers:{'User-Agent':'Mozilla/5.0'},cache:'no-store'});
    const d = await r.json();
    const meta = d?.chart?.result?.[0]?.meta;
    const closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close??[];
    const prev = closes[0];
    const price = meta?.regularMarketPrice ?? null;
    const chg = price && prev ? +((price-prev)/prev*100).toFixed(3) : null;
    return {price, change: chg, high: meta?.regularMarketDayHigh??null, low: meta?.regularMarketDayLow??null};
  } catch { return {price:null,change:null,high:null,low:null}; }
}

export async function GET() {
  const [fxQuotes, cmQuotes] = await Promise.all([
    Promise.all(FOREX.map(f=>yp(f.symbol))),
    Promise.all(COMMODITIES.map(c=>yp(c.symbol))),
  ]);
  const forex = FOREX.map((f,i)=>({...f,...fxQuotes[i]}));
  const commodities = COMMODITIES.map((c,i)=>({...c,...cmQuotes[i]}));
  return NextResponse.json({forex,commodities,ts:Date.now()});
}
