import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { sb } from '../../../../lib/supabase';

const MT5_BASE = 'https://mt5.mtapi.io';

// TEMP: cross-check every trade our DB thinks is closed against what's
// actually still open on the real broker account, to find out whether close
// operations have been silently failing.
export async function GET() {
  const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
  const sessionData = typeof mt5Session?.data === 'string' ? JSON.parse(mt5Session.data) : mt5Session?.data;
  const token = sessionData?.token;
  if (!token) return NextResponse.json({ ok: false, error: 'no MT5 token' });

  const r = await fetch(`${MT5_BASE}/OpenedOrders?id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let positions: any[] = [];
  try { positions = JSON.parse(text); } catch { positions = []; }
  const liveTickets = new Set(positions.map((p: any) => String(p.ticket)));

  const { data: closedTrades } = await sb.from('trades').select('id, symbol, ticket, result, closed_at, notes').not('result', 'eq', 'open');

  const stillActuallyOpen = (closedTrades ?? []).filter((t: any) => {
    const m = t.notes?.match(/Ticket:\s*(\d+)/);
    const ticket = m ? m[1] : null;
    return ticket && liveTickets.has(ticket);
  });

  return NextResponse.json({
    live_broker_tickets: Array.from(liveTickets),
    db_says_closed_count: (closedTrades ?? []).length,
    mismatches: stillActuallyOpen.map((t: any) => ({ id: t.id, symbol: t.symbol, result: t.result, closed_at: t.closed_at })),
  });
}
