import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// Yahoo Finance — no API key needed
const CRYPTO = [
  { yahoo: 'BTC-USD', name: 'Bitcoin',   symbol: 'BTC' },
  { yahoo: 'ETH-USD', name: 'Ethereum',  symbol: 'ETH' },
  { yahoo: 'SOL-USD', name: 'Solana',    symbol: 'SOL' },
  { yahoo: 'BNB-USD', name: 'BNB',       symbol: 'BNB' },
  { yahoo: 'XRP-USD', name: 'XRP',       symbol: 'XRP' },
  { yahoo: 'ADA-USD', name: 'Cardano',   symbol: 'ADA' },
  { yahoo: 'AVAX-USD',name: 'Avalanche', symbol: 'AVAX' },
  { yahoo: 'DOGE-USD',name: 'Dogecoin',  symbol: 'DOGE' },
];

async function yahooPrice(symbol: string) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    const d = await r.json();
    const meta = d?.chart?.result?.[0]?.meta;
    const prev = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.[0];
    const price = meta?.regularMarketPrice ?? null;
    const change = price && prev ? ((price - prev) / prev) * 100 : null;
    return {
      price,
      change24h: change ? parseFloat(change.toFixed(2)) : null,
      high24h: meta?.regularMarketDayHigh ?? null,
      low24h: meta?.regularMarketDayLow ?? null,
      volume24h: meta?.regularMarketVolume ?? null,
    };
  } catch { return { price: null, change24h: null, high24h: null, low24h: null, volume24h: null }; }
}

// 10-year historical via Yahoo
async function yahooHistory(symbol: string) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=10y`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    const d = await r.json();
    const result = d?.chart?.result?.[0];
    if (!result) return [];
    const times = result.timestamp ?? [];
    const ohlcv = result.indicators?.quote?.[0] ?? {};
    return times.map((t: number, i: number) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: ohlcv.open?.[i] ?? 0,
      high: ohlcv.high?.[i] ?? 0,
      low: ohlcv.low?.[i] ?? 0,
      close: ohlcv.close?.[i] ?? 0,
      volume: ohlcv.volume?.[i] ?? 0,
    })).filter((b: {close: number}) => b.close > 0);
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? 'prices';
  const symbol = req.nextUrl.searchParams.get('symbol') ?? 'BTC-USD';

  if (type === 'history') {
    const history = await yahooHistory(symbol);
    return NextResponse.json({ symbol, history });
  }

  const quotes = await Promise.all(CRYPTO.map(c => yahooPrice(c.yahoo)));
  const prices = CRYPTO.map((c, i) => ({ ...c, ...quotes[i] }));
  return NextResponse.json({ prices, ts: Date.now() });
}
