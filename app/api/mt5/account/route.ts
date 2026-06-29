export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BASE = 'https://mt5.mtapi.io';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return Response.json({ error: 'token required', connected: false }, { status: 400 });

  try {
    const [accountRes, posRes, ordersRes] = await Promise.all([
      fetch(`${BASE}/AccountSummary?id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(8000) }),
      fetch(`${BASE}/Positions?id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(8000) }),
      fetch(`${BASE}/PendingOrders?id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(8000) }),
    ]);

    let account = null, positions: any[] = [], orders: any[] = [];
    try { account = await accountRes.json(); } catch {}
    try { const p = await posRes.json(); positions = Array.isArray(p) ? p : []; } catch {}
    try { const o = await ordersRes.json(); orders = Array.isArray(o) ? o : []; } catch {}

    const connected = accountRes.ok && account && !account.message && (account.Balance !== undefined || account.balance !== undefined);

    return Response.json({ account, positions, orders, connected });
  } catch (e: any) {
    return Response.json({ error: e.message, connected: false });
  }
}
