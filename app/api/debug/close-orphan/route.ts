import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';

const MT5_BASE = 'https://mt5.mtapi.io';

export async function GET() {
  const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
  const sessionData = typeof mt5Session?.data === 'string' ? JSON.parse(mt5Session.data) : mt5Session?.data;
  const token = sessionData?.token;
  if (!token) return NextResponse.json({ ok: false, error: 'no MT5 token' });

  const r = await fetch(`${MT5_BASE}/OpenedOrders?id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  return NextResponse.json({ raw: text, status: r.status });
}
