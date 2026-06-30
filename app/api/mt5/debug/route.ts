export const runtime = 'edge';
export const dynamic = 'force-dynamic';
const BASE = 'https://mt5.mtapi.io';

// SAFETY: this route previously placed a REAL market order on every single GET
// request, regardless of params — including from accidental hits, crawlers, or
// manual testing. It now requires an explicit ?action= and a real trade is only
// ever placed with action=testtrade AND confirm=yes.

async function connect(login: string, password: string, server: string) {
  const cr = await fetch(
    `${BASE}/ConnectEx?user=${login}&password=${encodeURIComponent(password)}&server=${encodeURIComponent(server)}&connectTimeoutSeconds=30&connectTimeoutClusterMemberSeconds=15&errorReplyStatusCode=201`,
    { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(35000) }
  );
  const t = (await cr.text()).replace(/"/g, '').trim();
  return t && t.length > 10 ? t : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const login = searchParams.get('login') ?? '8029341';
  const password = searchParams.get('password') ?? '';
  const server = searchParams.get('server') ?? 'ExclusiveMarkets-Demo';
  let token = searchParams.get('token');

  if (!action) {
    return Response.json({
      error: 'action required',
      available_actions: ['raw_positions', 'symbols', 'close', 'testtrade'],
      note: 'This route no longer auto-trades. Pass an explicit action.',
    });
  }

  if (!token && password) {
    token = await connect(login, password, server);
    if (!token) return Response.json({ error: 'connect failed' });
  }
  if (!token) return Response.json({ error: 'token or password required' });

  if (action === 'raw_positions') {
    const r = await fetch(`${BASE}/OpenedOrders?id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    return Response.json({ status: r.status, raw: text });
  }

  if (action === 'symbols') {
    const r = await fetch(`${BASE}/Symbols?id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}
    const oilLike = parsed && typeof parsed === 'object'
      ? Object.keys(parsed).filter(k => /OIL|WTI|CRUDE|CL\b/i.test(k))
      : [];
    return Response.json({ total: parsed ? Object.keys(parsed).length : 0, oilLike, sampleKeys: parsed ? Object.keys(parsed).slice(0, 30) : [] });
  }

  if (action === 'test_ordersend_sltp') {
    // Test whether OrderSend accepts sl/tp inline for market orders
    const symbol = searchParams.get('symbol') ?? 'ETHUSD.';
    const operation = searchParams.get('operation') ?? 'Sell';
    const sl = searchParams.get('sl') ?? '1590';
    const tp = searchParams.get('tp') ?? '1544';
    const volume = searchParams.get('volume') ?? '0.01';
    const url = `${BASE}/OrderSend?id=${token}&symbol=${encodeURIComponent(symbol)}&operation=${operation}&volume=${volume}&sl=${sl}&tp=${tp}`;
    const r = await fetch(url, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(12000) });
    const text = await r.text();
    return Response.json({ status: r.status, raw: text, urlUsed: url, token });
  }

  if (action === 'sltp') {
    // Try every known MT5 REST endpoint for setting SL/TP on an open position
    const ticket = searchParams.get('ticket') ?? '59201089';
    const sl = searchParams.get('sl') ?? '1510';
    const tp = searchParams.get('tp') ?? '1620';
    const results: Record<string, any> = {};

    const endpoints = [
      `PositionModify?id=${token}&ticket=${ticket}&sl=${sl}&tp=${tp}`,
      `OrderSendNew?id=${token}&ticket=${ticket}&sl=${sl}&tp=${tp}&action=SL_TP`,
      `SetSLTP?id=${token}&ticket=${ticket}&sl=${sl}&tp=${tp}`,
      `ModifyPosition?id=${token}&ticket=${ticket}&sl=${sl}&tp=${tp}`,
      `OrderModifyPosition?id=${token}&ticket=${ticket}&sl=${sl}&tp=${tp}`,
      `TradeTransaction?id=${token}&ticket=${ticket}&sl=${sl}&tp=${tp}&action=TRADE_ACTION_SLTP`,
    ];

    for (const ep of endpoints) {
      try {
        const r = await fetch(`${BASE}/${ep}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(6000) });
        const text = await r.text();
        results[ep.split('?')[0]] = { status: r.status, raw: text.slice(0, 200) };
      } catch (e: any) {
        results[ep.split('?')[0]] = { error: e.message };
      }
    }
    return Response.json({ token, results });
  }

  if (action === 'modify') {
    const ticket = searchParams.get('ticket');
    const sl = searchParams.get('sl');
    const tp = searchParams.get('tp');
    if (!ticket || !sl || !tp) return Response.json({ error: 'ticket, sl, tp required' });
    const url = `${BASE}/OrderModify?id=${token}&ticket=${ticket}&sl=${sl}&tp=${tp}`;
    const r = await fetch(url, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    return Response.json({ status: r.status, raw: text, urlUsed: url });
  }

  if (action === 'close') {
    const ticket = searchParams.get('ticket');
    if (!ticket) return Response.json({ error: 'ticket required' });
    const r = await fetch(`${BASE}/OrderClose?id=${token}&ticket=${ticket}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    return Response.json({ status: r.status, raw: text });
  }

  if (action === 'testtrade') {
    if (searchParams.get('confirm') !== 'yes') {
      return Response.json({ error: 'this places a REAL order — add &confirm=yes to proceed' });
    }
    const symbol = searchParams.get('symbol') ?? 'EURUSD.';
    const operation = searchParams.get('operation') ?? 'Sell';
    const volume = searchParams.get('volume') ?? '0.01';
    const r = await fetch(`${BASE}/OrderSend?id=${token}&symbol=${encodeURIComponent(symbol)}&operation=${operation}&volume=${volume}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    return Response.json({ status: r.status, raw: text, token });
  }

  return Response.json({ error: `unknown action: ${action}` });
}
