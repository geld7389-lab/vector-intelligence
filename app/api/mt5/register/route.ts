import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

async function createAccount(TOKEN: string, pw: string) {
  const r = await fetch(`${PROV}/users/current/accounts`, {
    method: 'POST',
    headers: { 'auth-token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'VECTOR-ExclusiveMarkets', type: 'cloud',
      login: '8029341', password: pw,
      server: 'ExclusiveMarkets-Demo', platform: 'mt5',
      application: 'MetaApi', magic: 73921, reliability: 'regular',
      quoteStreamingIntervalInSeconds: 2.5,
    }),
    cache: 'no-store',
  });
  const text = await r.text();
  console.log(`MetaApi create response ${r.status}: ${text.substring(0,500)}`);
  return { status: r.status, text };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const TOKEN = process.env.METAAPI_TOKEN ?? '';
  const pw = searchParams.get('p') ?? '0777564264a-Z';
  const action = searchParams.get('action') ?? 'list';

  if (!TOKEN) return NextResponse.json({ error: 'METAAPI_TOKEN not set' });

  // List accounts
  const listR = await fetch(`${PROV}/users/current/accounts?limit=100`, {
    headers: { 'auth-token': TOKEN }, cache: 'no-store'
  });
  const listText = await listR.text();
  let items: any[] = [];
  try { const p = JSON.parse(listText); items = Array.isArray(p) ? p : (p.items ?? []); } catch {}

  if (action === 'list') {
    return NextResponse.json({ httpStatus: listR.status, count: items.length, accounts: items, tokenOk: listR.ok });
  }

  // Already exists?
  const existing = items.find((a: any) => String(a.login) === '8029341');
  if (existing) {
    if (existing.state !== 'DEPLOYED') {
      waitUntil(fetch(`${PROV}/users/current/accounts/${existing.id}/deploy`, {
        method: 'POST', headers: { 'auth-token': TOKEN }
      }));
    }
    return NextResponse.json({ found: true, accountId: existing.id, state: existing.state });
  }

  // Fire create async with waitUntil — returns response immediately, MetaApi call continues in background
  waitUntil(createAccount(TOKEN, pw));

  return NextResponse.json({ 
    fired: true,
    message: 'Registration request sent to MetaApi (processing in background). Wait 60s then call ?action=list to check.',
    password: pw.substring(0,3)+'***'
  });
}
