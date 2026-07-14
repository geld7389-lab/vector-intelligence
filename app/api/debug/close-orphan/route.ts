import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';

const MT5_BASE = 'https://mt5.mtapi.io';

// TEMP: one-off close for orphaned ticket 60050666 (ES/US500, opened 2026-07-10,
// never tracked in our trades table, no stop-loss on the broker side). Remove
// this route after use.
export async function GET() {
  const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
  const sessionData = typeof mt5Session?.data === 'string' ? JSON.parse(mt5Session.data) : mt5Session?.data;
  const token = sessionData?.token;
  if (!token) return NextResponse.json({ ok: false, error: 'no MT5 token' });

  const r = await fetch(`${MT5_BASE}/OrderClose?id=${token}&ticket=60050666`, {
    headers: { accept: 'text/json' },
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let result: any;
  try { result = JSON.parse(text); } catch { result = { raw: text }; }
  return NextResponse.json({ ok: true, result });
}
