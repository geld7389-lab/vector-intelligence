export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BASE = 'https://mt5.mtapi.io';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'symbols';
  const token = searchParams.get('token') ?? '';

  // fulltest: reconnect + quote + trade in one shot
  if (action === 'fulltest') {
    const login = searchParams.get('login') ?? '8029341';
    const password = searchParams.get('password') ?? '';
    const server = searchParams.get('server') ?? 'ExclusiveMarkets-Demo';
    if (!password) return Response.json({ error: 'password required' });

    // Connect
    const connUrl = `${BASE}/ConnectEx?user=${login}&password=${encodeURIComponent(password)}&server=${encodeURIComponent(server)}&connectTimeoutSeconds=30&connectTimeoutClusterMemberSeconds=15&errorReplyStatusCode=201`;
    const cr = await fetch(connUrl, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(35000) });
    const freshToken = (await cr.text()).replace(/"/g, '').trim();
    if (!freshToken || freshToken.length < 10) return Response.json({ error: `Connect failed: ${freshToken}` });

    // Try quote with multiple symbol formats
    const symVariants = ['EURUSD.', 'EURUSD', 'eurusd.', 'EURUSDm'];
    let price = 0, workingSym = '';
    for (const sym of symVariants) {
      const qr = await fetch(`${BASE}/Quote?symbol=${encodeURIComponent(sym)}&id=${freshToken}`, {
        headers: { accept: 'text/json' }, signal: AbortSignal.timeout(6000)
      });
      const raw = await qr.text();
      let q: any = null;
      try { q = JSON.parse(raw); } catch {}
      const p = q?.Bid ?? q?.bid ?? q?.Ask ?? q?.ask;
      if (p && p > 0) { price = p; workingSym = sym; break; }
    }

    if (!price) {
      // Try getting available symbols list
      const symR = await fetch(`${BASE}/Symbols?id=${freshToken}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(6000) });
      const symText = await symR.text();
      return Response.json({ error: 'no quote for any symbol variant', token: freshToken, symbolsRaw: symText.slice(0, 500) });
    }

    // Place trade
    const sl = +(price + 0.001).toFixed(5);
    const tp = +(price - 0.002).toFixed(5);
    const orderUrl = `${BASE}/OrderSend?id=${freshToken}&symbol=${encodeURIComponent(workingSym)}&operation=1&volume=0.01&sl=${sl}&tp=${tp}`;
    const tr = await fetch(orderUrl, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(10000) });
    const tradeResult = await tr.text();
    return Response.json({ token: freshToken, workingSym, price, sl, tp, tradeResult, tradeStatus: tr.status });
  }

  if (!token) return Response.json({ error: 'token required' });

  if (action === 'symbols') {
    const symbols = ['EURUSD.','GBPUSD.','USDJPY.','XAUUSD.','US100.','US500.','BTCUSD.','EURUSD','GBPUSD','US100','US500'];
    const results: Record<string,any> = {};
    await Promise.all(symbols.map(async (sym) => {
      try {
        const r = await fetch(`${BASE}/Quote?symbol=${encodeURIComponent(sym)}&id=${token}`, {
          headers: { accept: 'text/json' }, signal: AbortSignal.timeout(5000)
        });
        const text = await r.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch {}
        const hasPrice = parsed?.Ask || parsed?.Bid || parsed?.ask || parsed?.bid;
        results[sym] = { ok: r.status === 200 && !!hasPrice, ask: parsed?.Ask, bid: parsed?.Bid, raw: text.slice(0,100) };
      } catch (e: any) { results[sym] = { error: e.message }; }
    }));
    const working = Object.entries(results).filter(([,v]:any) => v.ok).map(([k]) => k);
    return Response.json({ working, all: results });
  }

  return Response.json({ error: 'unknown action' });
}
