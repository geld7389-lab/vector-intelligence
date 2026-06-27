export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BASE = 'https://mt5.mtapi.io';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return Response.json({ error: 'token required' }, { status: 400 });

  const [accountRes, posRes] = await Promise.all([
    fetch(`${BASE}/AccountSummary?id=${token}`),
    fetch(`${BASE}/Positions?id=${token}`),
  ]);

  const account = await accountRes.json();
  const positions = await posRes.json();

  return Response.json({ account, positions, connected: accountRes.ok });
}
