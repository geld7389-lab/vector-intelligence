import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';

const MT5_BASE = 'https://mt5.mtapi.io';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get('symbol') || 'XAUUSD.';
  const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
  const sessionData = typeof mt5Session?.data === 'string' ? JSON.parse(mt5Session.data) : mt5Session?.data;
  const token = sessionData?.token;
  if (!token) return NextResponse.json({ error: 'no token' });
  const r = await fetch(`${MT5_BASE}/SymbolParams?id=${token}&symbol=${encodeURIComponent(symbol)}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(12000) });
  const text = await r.text();
  return NextResponse.json({ status: r.status, raw: text });
}
