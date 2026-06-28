export const runtime = 'edge';
export const dynamic = 'force-dynamic';
const BASE = 'https://mt5.mtapi.io';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const login = searchParams.get('login') ?? '8029341';
  const password = searchParams.get('password') ?? '';
  const server = searchParams.get('server') ?? 'ExclusiveMarkets-Demo';
  if (!password) return Response.json({ error: 'password required' });

  // Fresh connect
  const cr = await fetch(`${BASE}/ConnectEx?user=${login}&password=${encodeURIComponent(password)}&server=${encodeURIComponent(server)}&connectTimeoutSeconds=30&connectTimeoutClusterMemberSeconds=15&errorReplyStatusCode=201`, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(35000) });
  const t = (await cr.text()).replace(/"/g, '').trim();
  if (!t || t.length < 10) return Response.json({ error: `Connect failed: ${t}` });

  // Get Yahoo price for EURUSD
  const yr = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1m&range=1d', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
  const yj = await yr.json();
  const price = yj?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;
  if (!price) return Response.json({ error: 'no yahoo price', token: t });

  const sl = +(price + 0.001).toFixed(5);
  const tp = +(price - 0.002).toFixed(5);

  // Place SELL order using "Sell" string operation
  const orderUrl = `${BASE}/OrderSend?id=${t}&symbol=EURUSD.&operation=Sell&volume=0.01&sl=${sl}&tp=${tp}`;
  const tr = await fetch(orderUrl, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(10000) });
  const tradeResult = await tr.text();

  return Response.json({ token: t, price, sl, tp, tradeResult, tradeStatus: tr.status });
}
