import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const FMP = 'https://financialmodelingprep.com/api/v3';
const FMP_KEY = process.env.FMP_API_KEY ?? '';
const COINDESK = 'https://data-api.coindesk.com/v1';

async function fmp(path: string) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${FMP}${path}${sep}apikey=${FMP_KEY}`, { cache: 'no-store' });
  return r.json();
}

// ── CRYPTO via CoinDesk ─────────────────────────────────────────────
async function getCrypto() {
  const symbols = ['BTC-USD','ETH-USD','SOL-USD','BNB-USD','XRP-USD'];
  const results = await Promise.allSettled(
    symbols.map(s => fetch(`${COINDESK}/spot/v1/historical/days?market=cadli&instrument=${s.replace('-USD','')}-USD&limit=2&api_key=`, { cache: 'no-store' }).then(r => r.json()))
  );
  // Fallback to FMP crypto
  const fmpCrypto = await fmp('/quotes/crypto?').catch(() => []);
  const top = (Array.isArray(fmpCrypto) ? fmpCrypto : []).filter((c: {symbol: string}) => ['BTCUSD','ETHUSD','SOLUSD','BNBUSD','XRPUSD'].includes(c.symbol)).slice(0, 5);
  return top;
}

// ── FOREX + COMMODITIES ─────────────────────────────────────────────
async function getForex() {
  const [forex, commodities] = await Promise.all([
    fmp('/quotes/forex'),
    fmp('/quotes/commodity'),
  ]);
  const fxPairs = ['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','GBPJPY','EURJPY'];
  const commods = ['GCUSD','SIUSD','CLUSD','NGUSD','HGUSD','PLUSD','WTIUSD'];
  const fx = (Array.isArray(forex) ? forex : []).filter((f: {symbol: string}) => fxPairs.some(p => f.symbol.includes(p))).slice(0, 8);
  const cm = (Array.isArray(commodities) ? commodities : []).filter((c: {symbol: string}) => commods.some(p => c.symbol.includes(p))).slice(0, 7);
  return { forex: fx, commodities: cm };
}

// ── STOCKS + ETFs ───────────────────────────────────────────────────
async function getStocks() {
  const [indices, etfs, movers] = await Promise.all([
    fmp('/quotes/index'),
    fmp('/etf/list'),
    fmp('/stock_market/gainers'),
  ]);
  const mainIndices = ['^SPX','^IXIC','^DJI','^RUT','^VIX'].map(sym => {
    const found = (Array.isArray(indices) ? indices : []).find((i: {symbol: string}) => i.symbol === sym);
    return found ?? { symbol: sym, price: null, change: null, changesPercentage: null };
  });
  const mainEtfs = ['SPY','QQQ','IWM','DIA','GLD','TLT','XLF','XLK','XLE','ARKK'];
  const etfData = (Array.isArray(etfs) ? etfs : []).filter((e: {symbol: string}) => mainEtfs.includes(e.symbol));
  return { indices: mainIndices, etfs: etfData.slice(0, 10), movers: (Array.isArray(movers) ? movers : []).slice(0, 5) };
}

// ── INSTITUTIONAL ───────────────────────────────────────────────────
async function getInstitutional() {
  const [institutional, economic] = await Promise.all([
    fmp('/institutional-holder/AAPL').catch(() => []),
    fmp('/economic_calendar?from=2026-05-01&to=2026-06-30').catch(() => []),
  ]);
  // Major institutional stocks to track
  const bigNames = ['BLK','GS','MS','JPM','BAC','BRK-B','WFC','C'];
  const stocks = await fmp(`/quote/${bigNames.join(',')}`).catch(() => []);
  const cot = await fmp('/commitment_of_traders_report/ES').catch(() => null);
  return {
    stocks: Array.isArray(stocks) ? stocks : [],
    economic: (Array.isArray(economic) ? economic : []).filter((e: {impact: string}) => e.impact === 'High').slice(0, 10),
    cot,
  };
}

// ── NEWS via MT Newswires ────────────────────────────────────────────
async function getNews(query: string) {
  try {
    const r = await fetch(`https://vast-mcp.blueskyapi.com/mcp`, { cache: 'no-store' });
    return [];
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const section = req.nextUrl.searchParams.get('section') ?? 'crypto';

  try {
    let data;
    switch (section) {
      case 'crypto': data = await getCrypto(); break;
      case 'forex': data = await getForex(); break;
      case 'stocks': data = await getStocks(); break;
      case 'institutional': data = await getInstitutional(); break;
      default: data = {};
    }
    return NextResponse.json({ section, data, ts: Date.now() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
