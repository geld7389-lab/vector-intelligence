import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const FMP_KEY = process.env.FMP_API_KEY ?? '';
const FMP = 'https://financialmodelingprep.com/api/v3';

const CRYPTO = [
  { fmp: 'BTCUSD', name: 'Bitcoin', symbol: 'BTC' },
  { fmp: 'ETHUSD', name: 'Ethereum', symbol: 'ETH' },
  { fmp: 'SOLUSD', name: 'Solana', symbol: 'SOL' },
  { fmp: 'BNBUSD', name: 'BNB', symbol: 'BNB' },
  { fmp: 'XRPUSD', name: 'XRP', symbol: 'XRP' },
  { fmp: 'ADAUSD', name: 'Cardano', symbol: 'ADA' },
  { fmp: 'AVAXUSD', name: 'Avalanche', symbol: 'AVAX' },
  { fmp: 'DOGEUSD', name: 'Dogecoin', symbol: 'DOGE' },
];

async function getQuote(fmpSym: string) {
  try {
    const r = await fetch(`${FMP}/cryptocurrency/${fmpSym}?apikey=${FMP_KEY}`, { cache: 'no-store' });
    const d = await r.json();
    return Array.isArray(d) ? d[0] : null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? 'prices';
  const symbol = req.nextUrl.searchParams.get('symbol') ?? 'BTCUSD';

  if (type === 'history') {
    try {
      const r = await fetch(`${FMP}/digital_currency_historical_price/${symbol}?from=2016-01-01&apikey=${FMP_KEY}`, { cache: 'no-store' });
      const data = await r.json();
      return NextResponse.json({ symbol, history: Array.isArray(data) ? data : [] });
    } catch (e) {
      return NextResponse.json({ symbol, history: [], error: String(e) });
    }
  }

  // Live prices
  const quotes = await Promise.all(CRYPTO.map(c => getQuote(c.fmp)));
  const prices = CRYPTO.map((c, i) => {
    const q = quotes[i];
    return {
      symbol: c.symbol, name: c.name, fmp: c.fmp,
      price: q?.price ?? null,
      change24h: q?.changesPercentage ?? null,
      high24h: q?.dayHigh ?? null,
      low24h: q?.dayLow ?? null,
      volume24h: q?.volume ?? null,
      marketCap: q?.marketCap ?? null,
    };
  });
  return NextResponse.json({ prices, ts: Date.now() });
}
