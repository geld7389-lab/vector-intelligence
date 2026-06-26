import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const TOKEN = process.env.METAAPI_TOKEN ?? '';
const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

async function doRegister(token: string, login: string, password: string, server: string, name: string) {
  // Check existing
  const listRes = await fetch(`${PROV}/users/current/accounts?limit=100`, {
    headers: { 'auth-token': token }, cache: 'no-store'
  });
  const listRaw = await listRes.text();
  let items: any[] = [];
  try {
    const parsed = JSON.parse(listRaw);
    items = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
  } catch {}

  const existing = items.find((a: any) => String(a.login) === String(login));
  if (existing) {
    if (existing.state !== 'DEPLOYED') {
      await fetch(`${PROV}/users/current/accounts/${existing.id}/deploy`, {
        method: 'POST', headers: { 'auth-token': token }
      });
    }
    return { success: true, existed: true, accountId: existing.id, state: existing.state, message: `Existing account found (${existing.state}) — redeployed` };
  }

  // Create
  const createRes = await fetch(`${PROV}/users/current/accounts`, {
    method: 'POST',
    headers: { 'auth-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, type: 'cloud', login: String(login), password,
      server, platform: 'mt5', application: 'MetaApi',
      magic: 73921, reliability: 'regular',
      quoteStreamingIntervalInSeconds: 2.5,
    }),
    cache: 'no-store',
  });

  const createRaw = await createRes.text();
  let createData: any = {};
  try { createData = JSON.parse(createRaw); } catch {}

  if (!createRes.ok) {
    return { error: createData.message ?? createRaw, status: createRes.status, details: createData };
  }
  return { success: true, accountId: createData.id, state: createData.state, message: 'Registered! Connecting to broker (30-90s)...' };
}

// GET — self-registering with hardcoded credentials for direct Vercel call
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const t = searchParams.get('t') || TOKEN;

  if (!t) return NextResponse.json({ error: 'no token' });

  // List accounts
  if (action === 'list' || !action) {
    const res = await fetch(`${PROV}/users/current/accounts?limit=100`, {
      headers: { 'auth-token': t }, cache: 'no-store'
    });
    const raw = await res.text();
    return NextResponse.json({ httpStatus: res.status, body: raw.substring(0, 3000) });
  }

  // Register with password variants
  if (action === 'register') {
    const passwords = [
      searchParams.get('p') ?? '',
      '0777564264a-Z', '0777564264a-Z@', '0777564264aZ@', '0777564264aZ'
    ].filter(Boolean);
    
    const results: any[] = [];
    for (const pw of passwords) {
      const r = await doRegister(t, '8029341', pw, 'ExclusiveMarkets-Demo', 'VECTOR-ExclusiveMarkets-Demo');
      results.push({ password: pw.substring(0, 4) + '***', result: r });
      if ((r as any).success) return NextResponse.json({ success: true, usedPassword: pw.substring(0,4)+'***', ...r, allResults: results });
      if ((r as any).existed) return NextResponse.json({ success: true, ...r });
    }
    return NextResponse.json({ allFailed: true, results });
  }

  return NextResponse.json({ usage: '?action=list or ?action=register' });
}

// POST — accept token + credentials in body
export async function POST(req: NextRequest) {
  const { token: bodyToken, login, password, server, name } = await req.json().catch(() => ({}));
  const t = bodyToken || TOKEN;
  if (!t) return NextResponse.json({ error: 'no token' }, { status: 400 });
  const result = await doRegister(t, login || '8029341', password || '0777564264a-Z', server || 'ExclusiveMarkets-Demo', name || 'VECTOR-Demo');
  return NextResponse.json(result);
}
