export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const ACCOUNT_ID = '0fdb41d7-f542-4bf8-b996-4758b3579d50';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const TOKEN = process.env.METAAPI_TOKEN ?? '';
  const pw = searchParams.get('p') ?? '';
  const action = searchParams.get('action') ?? 'list';

  if (!TOKEN) return Response.json({ error: 'METAAPI_TOKEN not set' });

  const headers = { 'auth-token': TOKEN, 'Content-Type': 'application/json' };

  // List accounts
  if (action === 'list') {
    const r = await fetch(`${PROV}/users/current/accounts?limit=100`, { headers });
    const text = await r.text();
    let items: any[] = [];
    try { const p = JSON.parse(text); items = Array.isArray(p) ? p : (p.items ?? []); } catch {}
    return Response.json({ httpStatus: r.status, count: items.length, accounts: items, tokenOk: r.ok });
  }

  // Update password on existing account
  if (action === 'updatepw') {
    if (!pw) return Response.json({ error: 'no password provided' });
    // Undeploy first
    await fetch(`${PROV}/users/current/accounts/${ACCOUNT_ID}/undeploy`, { method: 'POST', headers });
    await new Promise(r => setTimeout(r, 3000));
    // Update password
    const r = await fetch(`${PROV}/users/current/accounts/${ACCOUNT_ID}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ password: pw }),
    });
    const text = await r.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    if (!r.ok) return Response.json({ error: data.message ?? text, httpStatus: r.status });
    // Redeploy
    const deployR = await fetch(`${PROV}/users/current/accounts/${ACCOUNT_ID}/deploy`, { method: 'POST', headers });
    return Response.json({ success: true, updated: true, deployStatus: deployR.status, accountId: ACCOUNT_ID });
  }

  // Delete account
  if (action === 'delete') {
    await fetch(`${PROV}/users/current/accounts/${ACCOUNT_ID}/undeploy`, { method: 'POST', headers });
    await new Promise(r => setTimeout(r, 5000));
    const r = await fetch(`${PROV}/users/current/accounts/${ACCOUNT_ID}`, { method: 'DELETE', headers });
    return Response.json({ deleted: true, status: r.status });
  }

  // Register new
  if (action === 'register') {
    if (!pw) return Response.json({ error: 'no password provided' });
    const body = JSON.stringify({
      name: 'VECTOR-ExclusiveMarkets', type: 'cloud',
      login: '8029341', password: pw,
      server: 'ExclusiveMarkets-Demo', platform: 'mt5',
      application: 'MetaApi', magic: 73921, reliability: 'regular',
      quoteStreamingIntervalInSeconds: 2.5,
    });
    const r = await fetch(`${PROV}/users/current/accounts`, { method: 'POST', headers, body });
    const text = await r.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    if (!r.ok) return Response.json({ error: data.message ?? text, httpStatus: r.status });
    return Response.json({ success: true, accountId: data.id, state: data.state });
  }

  return Response.json({ error: 'unknown action' });
}
