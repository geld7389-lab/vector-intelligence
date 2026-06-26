import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const METAAPI_TOKEN = process.env.METAAPI_TOKEN ?? '';
const BASE = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const MGMT_BASE = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

// Connect an MT5 account to MetaApi cloud — fully online, no local install needed
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { login, password, server, accountName, platform = 'mt5' } = body;

    if (!login || !password || !server) {
      return NextResponse.json({ error: 'login, password, and server are required' }, { status: 400 });
    }
    if (!METAAPI_TOKEN) {
      return NextResponse.json(
        { error: 'METAAPI_TOKEN not set. Get free token at https://app.metaapi.cloud/token' },
        { status: 500 }
      );
    }

    // Check if account already exists
    const listRes = await fetch(`${BASE}/users/current/accounts?limit=100`, {
      headers: { 'auth-token': METAAPI_TOKEN },
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      const existing = (listData.items ?? listData ?? []).find(
        (a: any) => a.login === String(login) && a.server === server
      );
      if (existing) {
        return NextResponse.json({
          success: true,
          accountId: existing._id ?? existing.id,
          status: existing.state,
          message: 'Account already connected',
        });
      }
    }

    // Create new account
    const createRes = await fetch(`${BASE}/users/current/accounts`, {
      method: 'POST',
      headers: { 'auth-token': METAAPI_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: accountName ?? `VECTOR-${login}`,
        type: 'cloud',
        login: String(login),
        password,
        server,
        platform,
        application: 'MetaApi',
        magic: 73921,
        quoteStreamingIntervalInSeconds: 2.5,
        reliability: 'regular',
      }),
    });

    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.message ?? `MetaApi error ${createRes.status}` },
        { status: createRes.status }
      );
    }

    const account = await createRes.json();
    return NextResponse.json({
      success: true,
      accountId: account.id,
      status: 'connecting',
      message: 'Account registered with MetaApi cloud. Connecting to broker (takes 30-60s)...',
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Get connected accounts
export async function GET(_req: NextRequest) {
  if (!METAAPI_TOKEN) {
    return NextResponse.json({ accounts: [], error: 'METAAPI_TOKEN not set — add METAAPI_TOKEN to Vercel env vars' });
  }
  try {
    const res = await fetch(`${BASE}/users/current/accounts?limit=100&offset=0`, {
      headers: { 'auth-token': METAAPI_TOKEN },
      cache: 'no-store',
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return NextResponse.json({ accounts: [], error: `MetaApi ${res.status}: ${errData.message ?? JSON.stringify(errData)}` });
    }
    const raw = await res.json();
    // MetaApi returns array directly or { items: [] }
    const list: any[] = Array.isArray(raw) ? raw : (raw.items ?? raw.accounts ?? []);
    const accounts = list.map((a: any) => ({
      id: a._id ?? a.id ?? a.accountId,
      name: a.name,
      login: a.login,
      server: a.server,
      platform: a.platform ?? 'mt5',
      state: a.state,
      connectionStatus: a.connectionStatus ?? a.state,
    }));
    return NextResponse.json({ accounts, total: accounts.length });
  } catch (err) {
    return NextResponse.json({ accounts: [], error: err instanceof Error ? err.message : String(err) });
  }
}
