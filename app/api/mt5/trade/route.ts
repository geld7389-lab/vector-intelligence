import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const METAAPI_TOKEN = process.env.METAAPI_TOKEN ?? '';
const RPC_BASE = 'https://mt-client-api-v1.london.agiliumtrade.ai';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accountId, action, ...params } = body;

    if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 });
    if (!METAAPI_TOKEN) return NextResponse.json({ error: 'METAAPI_TOKEN not set' }, { status: 500 });

    const base = `${RPC_BASE}/users/current/accounts/${accountId}`;
    let url = '';
    let payload: any = {};

    switch (action) {
      // Open market order
      case 'buy':
      case 'sell': {
        const { symbol, volume, stopLoss, takeProfit, comment } = params;
        url = `${base}/trade`;
        payload = {
          actionType: action === 'buy' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
          symbol,
          volume: parseFloat(volume),
          stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
          takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
          comment: comment ?? 'VECTOR-AI',
          clientId: `VECTOR-${Date.now()}`,
        };
        break;
      }

      // Close position
      case 'close': {
        const { positionId } = params;
        url = `${base}/positions/${positionId}/close`;
        payload = {};
        break;
      }

      // Close all positions
      case 'closeAll': {
        url = `${base}/positions/close-all`;
        payload = {};
        break;
      }

      // Modify position SL/TP
      case 'modify': {
        const { positionId, stopLoss, takeProfit } = params;
        url = `${base}/positions/${positionId}`;
        payload = {
          stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
          takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
        };
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'auth-token': METAAPI_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json(res.ok ? { success: true, ...data } : { error: data.message ?? `${res.status}` });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'auth-token': METAAPI_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json({ error: data.message ?? `MetaApi error ${res.status}` }, { status: res.status });
    }

    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
