import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

async function fetchPrice(sym: string): Promise<{price:number|null;change:number|null;changePct:number|null}> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`, {
      headers:{ 'User-Agent':'Mozilla/5.0' }, cache:'no-store'
    });
    if (!r.ok) return { price:null, change:null, changePct:null };
    const d = await r.json();
    const meta = d?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? null;
    const prev = meta?.previousClose ?? meta?.chartPreviousClose ?? null;
    const change = price && prev ? +(price - prev).toFixed(2) : null;
    const changePct = price && prev ? +((price - prev) / prev * 100).toFixed(2) : null;
    return { price, change, changePct };
  } catch { return { price:null, change:null, changePct:null }; }
}

export async function GET() {
  const [nq,es,gc,dxy,vix] = await Promise.all([
    fetchPrice('NQ=F'), fetchPrice('ES=F'), fetchPrice('GC=F'),
    fetchPrice('DX=F'), fetchPrice('^VIX')
  ]);
  return NextResponse.json({
    prices: {
      NQ: nq.price, ES: es.price, GC: gc.price, DXY: dxy.price, VIX: vix.price,
    },
    changes: { NQ: nq, ES: es, GC: gc, DXY: dxy, VIX: vix }
  });
}
