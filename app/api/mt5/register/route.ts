export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const TOKEN = process.env.METAAPI_TOKEN ?? '';
  const pw = searchParams.get('p') ?? '';
  const action = searchParams.get('action') ?? 'list';
  const accountId = searchParams.get('id') ?? '';

  if (!TOKEN) return Response.json({ error: 'METAAPI_TOKEN not set' });
  const headers = { 'auth-token': TOKEN, 'Content-Type': 'application/json' };

  if (action === 'list') {
    const r = await fetch(`${PROV}/users/current/accounts?limit=100`, { headers });
    const text = await r.text();
    let items: any[] = [];
    try { const p = JSON.parse(text); items = Array.isArray(p) ? p : (p.items ?? []); } catch {}
    return Response.json({ httpStatus: r.status, count: items.length, accounts: items, tokenOk: r.ok });
  }

  if (action === 'deploy') {
    const id = accountId;
    if (!id) return Response.json({ error: 'no id' });
    const r = await fetch(`${PROV}/users/current/accounts/${id}/deploy`, { method: 'POST', headers });
    return Response.json({ status: r.status, deployed: r.ok });
  }

  if (action === 'delete') {
    const id = accountId;
    if (!id) return Response.json({ error: 'no id' });
    await fetch(`${PROV}/users/current/accounts/${id}/undeploy`, { method: 'POST', headers });
    await new Promise(r => setTimeout(r, 3000));
    const r = await fetch(`${PROV}/users/current/accounts/${id}`, { method: 'DELETE', headers });
    return Response.json({ deleted: r.ok, status: r.status });
  }

  if (action === 'register') {
    if (!pw) return Response.json({ error: 'no password' });
    const body = JSON.stringify({
      name: 'VECTOR-ExclusiveMarkets',
      type: 'cloud',
      login: '8029341',
      password: pw,
      server: 'ExclusiveMarkets-Demo',
      platform: 'mt5',
      application: 'MetaApi',
      magic: 73921,
      reliability: 'regular',
      quoteStreamingIntervalInSeconds: 2.5,
    });
    const r = await fetch(`${PROV}/users/current/accounts`, { method: 'POST', headers, body });
    const text = await r.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    if (!r.ok) return Response.json({ error: data.message ?? text, httpStatus: r.status });
    // immediately deploy it
    const id = data.id ?? data._id;
    if (id) {
      await fetch(`${PROV}/users/current/accounts/${id}/deploy`, { method: 'POST', headers });
    }
    return Response.json({ success: true, accountId: id, state: data.state, reliability: data.reliability });
  }

  return Response.json({ error: 'unknown action' });
}
