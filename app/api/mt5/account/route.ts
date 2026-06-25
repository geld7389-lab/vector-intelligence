import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const METAAPI_TOKEN = process.env.METAAPI_TOKEN ?? '';
const RPC_BASE = 'https://mt-client-api-v1.london.agiliumtrade.ai';

async function rpcCall(accountId: string, endpoint: string) {
  const res = await fetch(`${RPC_BASE}/users/current/accounts/${accountId}${endpoint}`, {
    headers: { 'auth-token': METAAPI_TOKEN },
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `${res.status}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  if (!METAAPI_TOKEN) return NextResponse.json({ error: 'METAAPI_TOKEN not set' }, { status: 500 });

  try {
    const [info, positions, orders] = await Promise.allSettled([
      rpcCall(accountId, '/account-information'),
      rpcCall(accountId, '/positions'),
      rpcCall(accountId, '/pending-orders'),
    ]);

    return NextResponse.json({
      info: info.status === 'fulfilled' ? info.value : null,
      positions: positions.status === 'fulfilled' ? positions.value : [],
      orders: orders.status === 'fulfilled' ? orders.value : [],
      error: info.status === 'rejected' ? (info.reason as Error).message : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
