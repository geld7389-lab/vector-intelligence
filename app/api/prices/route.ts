import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SYMBOLS: Record<string, string> = {
  NQ: 'NQ=F',
  ES: 'ES=F',
  GC: 'GC=F',
  DXY: 'DX-Y.NYB',
  VIX: '^VIX',
};

async function fetchPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    return meta?.regularMarketPrice ?? meta?.previousClose ?? null;
  } catch { return null; }
}

export async function GET() {
  const [NQ, ES, GC, DXY, VIX] = await Promise.all([
    fetchPrice(SYMBOLS.NQ),
    fetchPrice(SYMBOLS.ES),
    fetchPrice(SYMBOLS.GC),
    fetchPrice(SYMBOLS.DXY),
    fetchPrice(SYMBOLS.VIX),
  ]);

  const prices = { NQ, ES, GC, DXY, VIX };
  return NextResponse.json(
    { prices, timestamp: Date.now() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
