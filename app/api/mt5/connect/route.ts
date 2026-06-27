export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// mtapi.io - free MT5 REST API, no registration needed
// Docs: https://mt5doc.mtapi.io/
const BASE = 'https://mt5.mtapi.io';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { login, password, server } = body;
    if (!login || !password || !server) {
      return Response.json({ error: 'login, password, server required' }, { status: 400 });
    }

    // Step 1: Search for broker host by server name
    const searchRes = await fetch(`${BASE}/Search?keywords=${encodeURIComponent(server)}`);
    if (!searchRes.ok) {
      return Response.json({ error: 'broker search failed', status: searchRes.status });
    }
    const brokers = await searchRes.json();
    if (!brokers || brokers.length === 0) {
      return Response.json({ error: `Broker "${server}" not found. Check server name.` });
    }

    // Use first matching broker
    const broker = brokers[0];
    const host = broker.Host ?? broker.host ?? broker.ip;
    const port = broker.Port ?? broker.port ?? 443;

    // Step 2: Connect with credentials
    const connectRes = await fetch(
      `${BASE}/Connect?user=${login}&password=${encodeURIComponent(password)}&host=${host}&port=${port}`
    );
    const connectText = await connectRes.text();
    let token = '';
    try { token = JSON.parse(connectText); } catch { token = connectText.replace(/"/g, ''); }

    if (!token || token.startsWith('Error') || token.includes('error')) {
      return Response.json({ error: `Connection failed: ${token}` });
    }

    return Response.json({ success: true, token, host, port, brokerName: broker.CompanyName ?? server });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const action = searchParams.get('action') ?? 'account';

  if (!token) return Response.json({ error: 'token required' });

  const BASE = 'https://mt5.mtapi.io';

  if (action === 'account') {
    const r = await fetch(`${BASE}/AccountSummary?id=${token}`);
    const data = await r.json();
    return Response.json(data);
  }

  if (action === 'positions') {
    const r = await fetch(`${BASE}/Positions?id=${token}`);
    const data = await r.json();
    return Response.json(data);
  }

  if (action === 'orders') {
    const r = await fetch(`${BASE}/PendingOrders?id=${token}`);
    const data = await r.json();
    return Response.json(data);
  }

  return Response.json({ error: 'unknown action' });
}
