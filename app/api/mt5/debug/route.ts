export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BASE = 'https://mt5.mtapi.io';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'fulltest';

  if (action === 'fulltest') {
    const login = searchParams.get('login') ?? '8029341';
    const password = searchParams.get('password') ?? '';
    const server = searchParams.get('server') ?? 'ExclusiveMarkets-Demo';
    if (!password) return Response.json({ error: 'password required' });

    // Fresh connect
    const connUrl = `${BASE}/ConnectEx?user=${login}&password=${encodeURIComponent(password)}&server=${encodeURIComponent(server)}&connectTimeoutSeconds=30&connectTimeoutClusterMemberSeconds=15&errorReplyStatusCode=201`;
    const cr = await fetch(connUrl, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(35000) });
    const t = (await cr.text()).replace(/"/g, '').trim();
    if (!t || t.length < 10) return Response.json({ error: `Connect failed: ${t}` });

    // Get ALL symbols from broker
    const symR = await fetch(`${BASE}/Symbols?id=${t}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(8000) });
    const symText = await symR.text();
    let symData: any = {};
    try { symData = JSON.parse(symText); } catch {}
    
    // Find forex/index symbols
    const allSyms = Object.keys(symData);
    const forexSyms = allSyms.filter(s => 
      s.includes('EUR') || s.includes('USD') || s.includes('GBP') || 
      s.includes('US100') || s.includes('US500') || s.includes('NAS') ||
      s.includes('BTC') || s.includes('XAU') || s.includes('GOLD')
    ).slice(0, 30);

    // Test Quote on first few forex symbols
    const quoteTests: any = {};
    for (const sym of forexSyms.slice(0, 10)) {
      const qr = await fetch(`${BASE}/Quote?symbol=${encodeURIComponent(sym)}&id=${t}`, {
        headers: { accept: 'text/json' }, signal: AbortSignal.timeout(4000)
      }).catch(() => null);
      const raw = qr ? await qr.text() : 'timeout';
      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch {}
      quoteTests[sym] = { ask: parsed?.Ask, bid: parsed?.Bid, raw: raw.slice(0, 80) };
    }

    return Response.json({ 
      token: t,
      totalSymbols: allSyms.length,
      forexSymbols: forexSyms,
      quoteTests
    });
  }

  return Response.json({ error: 'unknown action' });
}
