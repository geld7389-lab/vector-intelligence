export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BASE = 'https://mt5.mtapi.io';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, action, symbol, volume, sl, tp, ticket } = body;
    if (!token) return Response.json({ error: 'token required' }, { status: 400 });

    let url = '';

    if (action === 'buy') {
      url = `${BASE}/OrderSend?id=${token}&symbol=${symbol}&operation=0&volume=${volume}${sl ? `&sl=${sl}` : ''}${tp ? `&tp=${tp}` : ''}`;
    } else if (action === 'sell') {
      url = `${BASE}/OrderSend?id=${token}&symbol=${symbol}&operation=1&volume=${volume}${sl ? `&sl=${sl}` : ''}${tp ? `&tp=${tp}` : ''}`;
    } else if (action === 'close' && ticket) {
      url = `${BASE}/CloseOrder?id=${token}&ticket=${ticket}`;
    } else {
      return Response.json({ error: 'invalid action' }, { status: 400 });
    }

    const r = await fetch(url, { method: 'GET' });
    const data = await r.json();
    return Response.json({ success: r.ok, result: data });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
