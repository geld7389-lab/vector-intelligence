export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BASE = 'https://mt5.mtapi.io';

async function reconnect(login: string, password: string, server: string) {
  const url = `${BASE}/ConnectEx?user=${login}&password=${encodeURIComponent(password)}&server=${encodeURIComponent(server)}&connectTimeoutSeconds=60&connectTimeoutClusterMemberSeconds=20&errorReplyStatusCode=201`;
  const r = await fetch(url, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(60000) });
  const text = await r.text();
  return text.replace(/"/g, '').trim();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token') ?? '';
  const action = searchParams.get('action') ?? 'symbols';
  if (!token) return Response.json({ error: 'token required' });

  if (action === 'symbols') {
    const symbols = ['EURUSD.','GBPUSD.','USDJPY.','XAUUSD.','USOIL.','US100.','US500.','BTCUSD.','ETHUSD.','EURUSD','GBPUSD','US100','US500','BTCUSD'];
    const results: Record<string,any> = {};
    await Promise.all(symbols.map(async (sym) => {
      try {
        const r = await fetch(`${BASE}/Quote?symbol=${sym}&id=${token}`, {
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

  if (action === 'trade') {
    const sym = searchParams.get('sym') ?? 'EURUSD';
    const dir = searchParams.get('dir') ?? 'sell';
    const op = dir === 'buy' ? 0 : 1;
    const qr = await fetch(`${BASE}/Quote?symbol=${sym}&id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(8000) });
    const quote = await qr.json().catch(() => null);
    const price = dir === 'buy' ? (quote?.Ask ?? quote?.ask) : (quote?.Bid ?? quote?.bid);
    if (!price) return Response.json({ error: 'no price - token may be expired, reconnect MT5', quote });
    const sl = dir === 'buy' ? +(price - 0.001).toFixed(5) : +(price + 0.001).toFixed(5);
    const tp = dir === 'buy' ? +(price + 0.002).toFixed(5) : +(price - 0.002).toFixed(5);
    const url = `${BASE}/OrderSend?symbol=${sym}&operation=${op}&volume=0.01&sl=${sl}&tp=${tp}&id=${token}`;
    const tr = await fetch(url, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(15000) });
    const tradeResult = await tr.text();
    return Response.json({ symbol: sym, direction: dir, price, sl, tp, result: tradeResult, status: tr.status });
  }

  if (action === 'fulltest') {
    // Reconnect fresh then test OrderSend
    const login = searchParams.get('login') ?? '8029341';
    const password = searchParams.get('password') ?? '';
    const server = searchParams.get('server') ?? 'ExclusiveMarkets-Demo';
    if (!password) return Response.json({ error: 'password required' });

    // Step 1: Connect
    const connUrl = `${BASE}/ConnectEx?user=${login}&password=${encodeURIComponent(password)}&server=${encodeURIComponent(server)}&connectTimeoutSeconds=30&connectTimeoutClusterMemberSeconds=15&errorReplyStatusCode=201`;
    const cr = await fetch(connUrl, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(35000) });
    const freshToken = (await cr.text()).replace(/"/g, '').trim();
    if (!freshToken || freshToken.length < 10) return Response.json({ error: `Connect failed: ${freshToken}` });

    // Step 2: Get quote for EURUSD.
    const qr = await fetch(`${BASE}/Quote?symbol=EURUSD.&id=${freshToken}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(8000) });
    const quote = await qr.json().catch(() => null);
    const price = quote?.Bid ?? quote?.bid;
    if (!price) return Response.json({ error: 'no quote', quote, token: freshToken });

    // Step 3: Place real 0.01 lot SELL on EURUSD.
    const sl = +(price + 0.001).toFixed(5);
    const tp = +(price - 0.002).toFixed(5);
    const orderUrl = `${BASE}/OrderSend?id=${freshToken}&symbol=EURUSD.&operation=1&volume=0.01&sl=${sl}&tp=${tp}`;
    const tr = await fetch(orderUrl, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(10000) });
    const tradeResult = await tr.text();

    return Response.json({ token: freshToken, quote, price, sl, tp, orderUrl: orderUrl.replace(freshToken, 'HIDDEN'), tradeResult, tradeStatus: tr.status });
  }
}
