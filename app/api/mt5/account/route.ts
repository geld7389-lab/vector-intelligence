export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BASE = 'https://mt5.mtapi.io';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return Response.json({ error: 'token required' }, { status: 400 });

  const [accountRes, posRes] = await Promise.all([
    fetch(`${BASE}/AccountSummary?id=${token}`, { headers: { accept: 'text/json' } }),
    fetch(`${BASE}/Positions?id=${token}`, { headers: { accept: 'text/json' } }),
  ]);

  let account = null, positions = [];
  try { account = await accountRes.json(); } catch {}
  try { positions = await posRes.json(); } catch {}

  return Response.json({ account, positions, connected: accountRes.ok });
}
