export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const TOKEN = process.env.METAAPI_TOKEN ?? '';
  const pw = searchParams.get('p') ?? '0777564264a-Z';
  const action = searchParams.get('action') ?? 'list';

  if (!TOKEN) return Response.json({ error: 'METAAPI_TOKEN not set' });

  // List accounts
  const listR = await fetch(`${PROV}/users/current/accounts?limit=100`, {
    headers: { 'auth-token': TOKEN },
  });
  const listText = await listR.text();
  let items: any[] = [];
  try { const p = JSON.parse(listText); items = Array.isArray(p) ? p : (p.items ?? []); } catch {}

  if (action === 'list') {
    return Response.json({ httpStatus: listR.status, count: items.length, accounts: items, tokenOk: listR.ok });
  }

  // Already exists?
  const existing = items.find((a: any) => String(a.login) === '8029341');
  if (existing) {
    if (existing.state !== 'DEPLOYED') {
      // Kick off deploy — edge can await this since we have more time
      fetch(`${PROV}/users/current/accounts/${existing.id}/deploy`, {
        method: 'POST', headers: { 'auth-token': TOKEN }
      });
    }
    return Response.json({ found: true, accountId: existing.id, state: existing.state, login: existing.login, server: existing.server });
  }

  // Edge runtime has longer timeout — create account and wait
  const body = JSON.stringify({
    name: 'VECTOR-ExclusiveMarkets', type: 'cloud',
    login: '8029341', password: pw,
    server: 'ExclusiveMarkets-Demo', platform: 'mt5',
    application: 'MetaApi', magic: 73921, reliability: 'regular',
    quoteStreamingIntervalInSeconds: 2.5,
  });

  const r = await fetch(`${PROV}/users/current/accounts`, {
    method: 'POST',
    headers: { 'auth-token': TOKEN, 'Content-Type': 'application/json' },
    body,
  });

  const text = await r.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch {}

  if (!r.ok) {
    return Response.json({ error: data.message ?? text, httpStatus: r.status, hint: data.recommendedBrokerServers ?? null });
  }
  return Response.json({ success: true, accountId: data.id, state: data.state });
}
