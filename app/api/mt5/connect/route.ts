import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const TOKEN = process.env.METAAPI_TOKEN ?? '';
const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

async function provReq(path: string, method = 'GET', body?: any) {
  const res = await fetch(`${PROV}${path}`, {
    method,
    headers: {
      'auth-token': TOKEN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// POST — register MT5 account with MetaApi
export async function POST(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: 'METAAPI_TOKEN not set in Vercel env vars' }, { status: 500 });

  const { login, password, server, accountName } = await req.json();
  if (!login || !password || !server) return NextResponse.json({ error: 'login, password, server required' }, { status: 400 });

  // Check if already exists
  const list = await provReq(`/users/current/accounts?limit=100`);
  if (list.ok) {
    const items: any[] = Array.isArray(list.data) ? list.data : (list.data.items ?? []);
    const existing = items.find((a: any) => String(a.login) === String(login) && a.server === server);
    if (existing) {
      // Re-deploy if not deployed
      if (existing.state !== 'DEPLOYED') {
        await provReq(`/users/current/accounts/${existing.id}/deploy`, 'POST');
      }
      return NextResponse.json({
        success: true,
        accountId: existing.id,
        state: existing.state,
        message: existing.state === 'DEPLOYED'
          ? 'Account already connected — click Accounts tab'
          : `Account exists (${existing.state}) — redeploying...`,
      });
    }
  }

  // Create account
  const create = await provReq('/users/current/accounts', 'POST', {
    name: accountName || `VECTOR-${login}`,
    type: 'cloud',
    login: String(login),
    password,
    server,
    platform: 'mt5',
    application: 'MetaApi',
    magic: 73921,
    reliability: 'regular',
    quoteStreamingIntervalInSeconds: 2.5,
  });

  if (!create.ok) {
    // Return the full MetaApi error — includes suggested server names
    const msg = create.data?.message ?? create.data?.details ?? JSON.stringify(create.data);
    return NextResponse.json({ error: `MetaApi: ${msg}` }, { status: create.status });
  }

  const acc = create.data;
  // Handle "retry" response from MetaApi (broker detection in progress)
  if (acc.message && !acc.id) {
    return NextResponse.json({
      success: true,
      pending: true,
      retryAfter: acc.retryAfterSeconds ?? 60,
      message: acc.message,
    });
  }

  return NextResponse.json({
    success: true,
    accountId: acc.id,
    state: acc.state ?? 'DEPLOYING',
    message: 'Account registered. MetaApi is connecting to your broker (30-90s)...',
  });
}

// GET — list all MT5 accounts with full status
export async function GET() {
  if (!TOKEN) return NextResponse.json({ accounts: [], error: 'METAAPI_TOKEN not set' });

  const { ok, data, status } = await provReq('/users/current/accounts?limit=100');
  if (!ok) {
    return NextResponse.json({
      accounts: [],
      error: `MetaApi returned ${status}: ${data?.message ?? JSON.stringify(data)}`,
    });
  }

  const items: any[] = Array.isArray(data) ? data : (data.items ?? []);
  const accounts = items.map((a: any) => ({
    id: a.id ?? a._id,
    name: a.name,
    login: a.login,
    server: a.server,
    platform: a.platform ?? 'mt5',
    state: a.state,
    // connectionStatus is only in the client API, provisioning only has state
    connectionStatus: a.connectionStatus ?? a.state,
  }));

  return NextResponse.json({ accounts, count: accounts.length });
}
