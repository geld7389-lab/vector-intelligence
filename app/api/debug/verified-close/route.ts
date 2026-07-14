import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';

const MT5_BASE = 'https://mt5.mtapi.io';

// TEMP: robustly close a specific ticket with real verification — retries
// OrderClose and re-checks OpenedOrders after each attempt until the ticket
// genuinely disappears, instead of trusting a single response.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticket = url.searchParams.get('ticket');
  if (!ticket) return NextResponse.json({ ok: false, error: 'missing ?ticket=' });

  const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
  const sessionData = typeof mt5Session?.data === 'string' ? JSON.parse(mt5Session.data) : mt5Session?.data;
  const token = sessionData?.token;
  if (!token) return NextResponse.json({ ok: false, error: 'no MT5 token' });

  const attempts: any[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${MT5_BASE}/OrderClose?id=${token}&ticket=${ticket}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let result: any; try { result = JSON.parse(text); } catch { result = { raw: text }; }
    attempts.push({ attempt: i + 1, status: r.status, result });

    await new Promise(res => setTimeout(res, 3000));
    const checkR = await fetch(`${MT5_BASE}/OpenedOrders?id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(15000) });
    const checkText = await checkR.text();
    let positions: any; try { positions = JSON.parse(checkText); } catch { positions = null; }
    const stillOpen = Array.isArray(positions) && positions.some((p: any) => String(p.ticket) === ticket);
    if (!stillOpen) return NextResponse.json({ ok: true, closed: true, attempts });
  }
  return NextResponse.json({ ok: false, closed: false, attempts, note: 'still open after 5 verified attempts' });
}
