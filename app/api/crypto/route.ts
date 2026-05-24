import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const COINDESK = 'https://data-api.coindesk.com/v1/index/cc/v1/latest/tick';
const FMP = 'https://financialmodelingprep.com/api/v3';

const CRYPTO_UNIVERSE = [
  { symbol: 'BTC-USD', name: 'Bitcoin', fmp: 'BTCUSD' },
  { symbol: 'ETH-USD', name: 'Ethereum', fmp: 'ETHUSD' },
  { symbol: 'SOL-USD', name: 'Solana', fmp: 'SOLUSD' },
  { symbol: 'BNB-USD', name: 'BNB', fmp: 'BNBUSD' },
  { symbol: 'XRP-USD', name: 'XRP', fmp: 'XRPUSD' },
  { symbol: 'ADA-USD', name: 'Cardano', fmp: 'ADAUSD' },
  { symbol: 'AVAX-USD', name: 'Avalanche', fmp: 'AVAXUSD' },
  { symbol: 'DOGE-USD', name: 'Dogecoin', fmp: 'DOGEUSD' },
  { symbol: 'LINK-USD', name: 'Chainlink', fmp: 'LINKUSD' },
  { symbol: 'DOT-USD', name: 'Polkadot', fmp: 'DOTUSD' },
];

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? 'prices';
  const symbol = req.nextUrl.searchParams.get('symbol') ?? 'BTCUSD';

  if (type === 'history') {
    const key = process.env.FMP_API_KEY ?? '';
    const from = req.nextUrl.searchParams.get('from') ?? '2016-01-01';
    const r = await fetch(`${FMP}/digital_currency_historical_price/${symbol}?from=${from}&apikey=${key}`, { cache: 'no-store' });
    const data = await r.json();
    return NextResponse.json({ symbol, history: Array.isArray(data) ? data : [] });
  }

  // Live prices via CoinDesk index
  try {
    const instruments = CRYPTO_UNIVERSE.map(c => c.symbol).join(',');
    const r = await fetch(`https://data-api.coindesk.com/v1/index/cc/v1/latest/tick?market=ccix&instruments=${instruments}&apply_mapping=true`, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store'
    });
    const data = await r.json();
    const prices = CRYPTO_UNIVERSE.map(c => {
      const d = data?.Data?.[c.symbol];
      return {
        symbol: c.symbol, name: c.name, fmp: c.fmp,
        price: d?.VALUE ?? null,
        change24h: d?.MOVING_24_HOUR_CHANGE_PERCENTAGE ?? null,
        high24h: d?.MOVING_24_HOUR_HIGH ?? null,
        low24h: d?.MOVING_24_HOUR_LOW ?? null,
        volume24h: d?.MOVING_24_HOUR_QUOTE_VOLUME ?? null,
      };
    });
    return NextResponse.json({ prices, ts: Date.now() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
