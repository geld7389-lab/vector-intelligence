import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const TOKEN = process.env.METAAPI_TOKEN ?? '';
const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  if (!accountId || !TOKEN) return NextResponse.json({ error: 'missing params' }, { status: 400 });

  const res = await fetch(`${PROV}/users/current/accounts/${accountId}`, {
    headers: { 'auth-token': TOKEN },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: data.message ?? `${res.status}` }, { status: res.status });

  return NextResponse.json({
    id: data.id,
    state: data.state,           // DEPLOYING | DEPLOYED | UNDEPLOYING | UNDEPLOYED | ERROR
    connectionStatus: data.connectionStatus ?? data.state,
    name: data.name,
    login: data.login,
    server: data.server,
  });
}
