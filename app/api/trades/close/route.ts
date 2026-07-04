import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';
const MT5_BASE = 'https://mt5.mtapi.io';

export async function POST(req: Request) {
  try {
    const { ticket, tradeId } = await req.json();
    if (!ticket) return NextResponse.json({ error: 'ticket required' }, { status: 400 });

    // Get MT5 token
    const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
    const rawData = mt5Session?.data;
    const sessionData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    const token = sessionData?.token;
    if (!token) return NextResponse.json({ error: 'no MT5 token' }, { status: 400 });

    const r = await fetch(`${MT5_BASE}/OrderClose?id=${token}&ticket=${ticket}`, {
      headers: { accept: 'text/json' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    let result: any;
    try { result = JSON.parse(text); } catch { result = { raw: text }; }

    // Mark as closed in Supabase if we have the trade id
    if (tradeId) {
      await sb.from('trades').update({
        result: 'closed_manual',
        exit_price: result?.closePrice ?? null,
        notes: `Manually closed by user @ ${new Date().toISOString()}`,
      }).eq('id', tradeId);
    }

    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
