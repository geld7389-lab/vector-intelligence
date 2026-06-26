import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const TOKEN = process.env.METAAPI_TOKEN ?? '';
// MetaApi client API — try multiple regions
const REGIONS = ['new-york', 'london', 'singapore'];

async function clientReq(accountId: string, endpoint: string) {
  for (const region of REGIONS) {
    try {
      const res = await fetch(
        `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}${endpoint}`,
        { headers: { 'auth-token': TOKEN }, cache: 'no-store' }
      );
      if (res.status === 404) continue; // try next region
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `${res.status}`);
      }
      return await res.json();
    } catch (e: any) {
      if (e.message?.includes('404') || e.message?.includes('not found')) continue;
      throw e;
    }
  }
  throw new Error('Account not found in any region — it may still be deploying');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  if (!TOKEN) return NextResponse.json({ error: 'METAAPI_TOKEN not set' }, { status: 500 });

  try {
    const [info, positions, orders] = await Promise.allSettled([
      clientReq(accountId, '/account-information'),
      clientReq(accountId, '/positions'),
      clientReq(accountId, '/pending-orders'),
    ]);

    return NextResponse.json({
      info: info.status === 'fulfilled' ? info.value : null,
      positions: positions.status === 'fulfilled' ? (Array.isArray(positions.value) ? positions.value : []) : [],
      orders: orders.status === 'fulfilled' ? (Array.isArray(orders.value) ? orders.value : []) : [],
      error: info.status === 'rejected' ? (info.reason as Error).message : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
