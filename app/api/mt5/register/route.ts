import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// Hardcoded token for direct registration — bypasses env var
const HARDCODED_TOKEN = process.env.METAAPI_TOKEN ?? '';
const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

export async function POST(req: NextRequest) {
  const { token: bodyToken, login, password, server, name } = await req.json();
  const TOKEN = bodyToken || HARDCODED_TOKEN;
  if (!TOKEN) return NextResponse.json({ error: 'no token' }, { status: 400 });

  // 1. Check existing
  const listRes = await fetch(`${PROV}/users/current/accounts?limit=100`, {
    headers: { 'auth-token': TOKEN }, cache: 'no-store'
  });
  const listRaw = await listRes.text();
  
  let items: any[] = [];
  try { 
    const parsed = JSON.parse(listRaw);
    items = Array.isArray(parsed) ? parsed : (parsed.items ?? parsed.accounts ?? []);
  } catch {}

  const existing = items.find((a: any) => String(a.login) === String(login));
  if (existing) {
    // Deploy it if not deployed
    if (existing.state !== 'DEPLOYED') {
      await fetch(`${PROV}/users/current/accounts/${existing.id}/deploy`, {
        method: 'POST', headers: { 'auth-token': TOKEN }
      });
    }
    return NextResponse.json({ 
      success: true, existed: true,
      accountId: existing.id, state: existing.state,
      message: `Account already exists (${existing.state}) — deploying`
    });
  }

  // 2. Create
  const body = {
    name: name || `VECTOR-${login}`,
    type: 'cloud', login: String(login), password,
    server, platform: 'mt5', application: 'MetaApi',
    magic: 73921, reliability: 'regular',
    quoteStreamingIntervalInSeconds: 2.5,
    tags: ['vector-intelligence'],
  };

  const createRes = await fetch(`${PROV}/users/current/accounts`, {
    method: 'POST',
    headers: { 'auth-token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const createRaw = await createRes.text();
  let createData: any = {};
  try { createData = JSON.parse(createRaw); } catch {}

  if (!createRes.ok) {
    return NextResponse.json({ 
      error: createData.message ?? createRaw,
      status: createRes.status,
      details: createData,
      sentBody: body,
      listStatus: listRes.status,
      listItems: items.length,
    }, { status: createRes.status });
  }

  return NextResponse.json({ 
    success: true,
    accountId: createData.id,
    state: createData.state,
    message: 'Registered! MetaApi connecting to broker (30-90s)...'
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const TOKEN = searchParams.get('t') || HARDCODED_TOKEN;
  if (!TOKEN) return NextResponse.json({ error: 'no token' });
  
  const res = await fetch(`${PROV}/users/current/accounts?limit=100`, {
    headers: { 'auth-token': TOKEN }, cache: 'no-store'
  });
  const raw = await res.text();
  return NextResponse.json({ status: res.status, raw: raw.substring(0, 2000) });
}
