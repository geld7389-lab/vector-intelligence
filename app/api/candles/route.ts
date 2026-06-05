import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') ?? 'NQ';
  const timeframe = req.nextUrl.searchParams.get('timeframe') ?? '15m';
  try {
    const yahooMap: Record<string,string> = {
      NQ:'NQ=F', ES:'ES=F', GC:'GC=F', CL:'CL=F',
      BTC:'BTC-USD', ETH:'ETH-USD', SOL:'SOL-USD',
      EURUSD:'EURUSD=X', GBPUSD:'GBPUSD=X',
      SPY:'SPY', QQQ:'QQQ', NVDA:'NVDA',
    };
    const ySym = yahooMap[symbol] ?? `${symbol}=F`;
    const intervalMap: Record<string,string> = { '15m':'15m','1h':'60m','4h':'1d','1d':'1d' };
    const rangeMap: Record<string,string> = { '15m':'5d','1h':'1mo','4h':'3mo','1d':'1y' };
    const interval = intervalMap[timeframe] ?? '60m';
    const range = rangeMap[timeframe] ?? '1mo';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0' }, cache:'no-store' });
    if (!res.ok) return NextResponse.json({ candles:[], error:`Yahoo ${res.status}` });
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return NextResponse.json({ candles:[], error:'No data' });
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const candles = ts.map((t,i) => ({ t:t*1000, o:q.open?.[i], h:q.high?.[i], l:q.low?.[i], c:q.close?.[i], v:q.volume?.[i] }))
      .filter(c => c.o!=null&&c.h!=null&&c.l!=null&&c.c!=null);
    return NextResponse.json({ candles, symbol, timeframe });
  } catch (err) {
    return NextResponse.json({ candles:[], error: err instanceof Error ? err.message : String(err) });
  }
}
