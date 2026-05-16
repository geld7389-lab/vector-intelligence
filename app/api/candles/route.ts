import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

async function fetchCandles(yahooSymbol: string, interval: string, range: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 0 } });
  if (!res.ok) return null;
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return null;
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  return ts.map((t, i) => ({
    t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i]
  })).filter(c => c.o != null && c.h != null && c.l != null && c.c != null);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol') ?? 'NQ';
  const tf = searchParams.get('tf') ?? '15m';
  const yahooSymbol = symbol === 'NQ' ? 'NQ=F' : symbol === 'ES' ? 'ES=F' : `${symbol}=F`;
  const interval = tf === '15m' ? '15m' : tf === '1h' ? '60m' : tf === '4h' ? '60m' : '1d';
  const range = tf === '15m' ? '5d' : tf === '1h' ? '1mo' : tf === '4h' ? '3mo' : '1y';
  try {
    let candles = await fetchCandles(yahooSymbol, interval, range);
    if (!candles) return NextResponse.json({ error: 'No data' }, { status: 502 });
    if (tf === '4h') {
      const g: typeof candles = [];
      for (let i = 0; i < candles.length; i += 4) {
        const ch = candles.slice(i, i + 4);
        if (!ch.length) continue;
        g.push({ t: ch[0].t, o: ch[0].o, h: Math.max(...ch.map(c => c.h!)), l: Math.min(...ch.map(c => c.l!)), c: ch[ch.length-1].c, v: ch.reduce((a,c)=>a+(c.v??0),0) });
      }
      candles = g;
    }
    return NextResponse.json({ candles: candles.slice(-150), symbol, tf }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
