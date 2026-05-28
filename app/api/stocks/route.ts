import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const INDICES = [
  {symbol:'^GSPC',name:'S&P 500'},
  {symbol:'^IXIC',name:'Nasdaq'},
  {symbol:'^DJI', name:'Dow Jones'},
  {symbol:'^RUT', name:'Russell 2000'},
  {symbol:'^VIX', name:'VIX'},
];
const ETFS = [
  {symbol:'SPY', name:'S&P 500 ETF'},
  {symbol:'QQQ', name:'Nasdaq ETF'},
  {symbol:'IWM', name:'Russell ETF'},
  {symbol:'GLD', name:'Gold ETF'},
  {symbol:'TLT', name:'20yr Bond ETF'},
  {symbol:'XLF', name:'Financials'},
  {symbol:'XLK', name:'Technology'},
  {symbol:'XLE', name:'Energy'},
  {symbol:'ARKK',name:'ARK Innovation'},
  {symbol:'DIA', name:'Dow ETF'},
];
const STOCKS = [
  {symbol:'AAPL',name:'Apple'},
  {symbol:'NVDA',name:'Nvidia'},
  {symbol:'MSFT',name:'Microsoft'},
  {symbol:'AMZN',name:'Amazon'},
  {symbol:'META',name:'Meta'},
  {symbol:'GOOGL',name:'Alphabet'},
  {symbol:'TSLA',name:'Tesla'},
  {symbol:'BRK-B',name:'Berkshire'},
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
    const chg = price && prev ? +((price-prev)/prev*100).toFixed(2) : null;
    const mktCap = meta?.marketCap ?? null;
    return {price, change: chg, high: meta?.regularMarketDayHigh??null, low: meta?.regularMarketDayLow??null, mktCap};
  } catch { return {price:null,change:null,high:null,low:null,mktCap:null}; }
}

export async function GET() {
  const [idxQ, etfQ, stkQ] = await Promise.all([
    Promise.all(INDICES.map(i=>yp(i.symbol))),
    Promise.all(ETFS.map(e=>yp(e.symbol))),
    Promise.all(STOCKS.map(s=>yp(s.symbol))),
  ]);
  return NextResponse.json({
    indices: INDICES.map((x,i)=>({...x,...idxQ[i]})),
    etfs: ETFS.map((x,i)=>({...x,...etfQ[i]})),
    stocks: STOCKS.map((x,i)=>({...x,...stkQ[i]})),
    ts: Date.now()
  });
}
