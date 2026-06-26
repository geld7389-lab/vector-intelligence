import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const TOKEN = process.env.METAAPI_TOKEN ?? '';
  const pw = searchParams.get('p') ?? '0777564264a-Z';
  const action = searchParams.get('action') ?? 'register';

  if (!TOKEN) return NextResponse.json({ error: 'METAAPI_TOKEN env var not set' });

  if (action === 'list') {
    const r = await fetch(`${PROV}/users/current/accounts?limit=100`, {
      headers: { 'auth-token': TOKEN }, cache: 'no-store'
    });
    return NextResponse.json({ status: r.status, body: await r.text() });
  }

  // Check existing first
  const listR = await fetch(`${PROV}/users/current/accounts?limit=100`, {
    headers: { 'auth-token': TOKEN }, cache: 'no-store'
  });
  const listText = await listR.text();
  let items: any[] = [];
  try { const p = JSON.parse(listText); items = Array.isArray(p) ? p : (p.items ?? []); } catch {}
  
  const existing = items.find((a: any) => String(a.login) === '8029341');
  if (existing) {
    if (existing.state !== 'DEPLOYED') {
      await fetch(`${PROV}/users/current/accounts/${existing.id}/deploy`, {
        method: 'POST', headers: { 'auth-token': TOKEN }
      });
    }
    return NextResponse.json({ success: true, existed: true, accountId: existing.id, state: existing.state });
  }

  // Create with provided password
  const body = {
    name: 'VECTOR-ExclusiveMarkets', type: 'cloud',
    login: '8029341', password: pw,
    server: 'ExclusiveMarkets-Demo', platform: 'mt5',
    application: 'MetaApi', magic: 73921, reliability: 'regular',
    quoteStreamingIntervalInSeconds: 2.5,
  };

  const r = await fetch(`${PROV}/users/current/accounts`, {
    method: 'POST',
    headers: { 'auth-token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });

  const text = await r.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch {}

  if (!r.ok) {
    return NextResponse.json({ error: data.message ?? text, httpStatus: r.status, tried: pw, body });
  }
  return NextResponse.json({ success: true, accountId: data.id, state: data.state, tried: pw });
}
