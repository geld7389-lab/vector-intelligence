import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MT5_BASE = 'https://mt5.mtapi.io';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticket = url.searchParams.get('ticket');
  const lots = url.searchParams.get('lots');
  if (!ticket) return NextResponse.json({ ok: false, error: 'missing ?ticket=' });

  const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
  const sessionData = typeof mt5Session?.data === 'string' ? JSON.parse(mt5Session.data) : mt5Session?.data;
  const token = sessionData?.token;
  if (!token) return NextResponse.json({ ok: false, error: 'no MT5 token' });

  const lotsParam = lots ? `&lots=${lots}` : '';
  const closeUrl = `${MT5_BASE}/OrderClose?id=${token}&ticket=${ticket}${lotsParam}`;
  const r = await fetch(closeUrl, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(12000) });
  const text = await r.text();
  let closeResult: any; try { closeResult = JSON.parse(text); } catch { closeResult = { raw: text }; }

  await new Promise(res => setTimeout(res, 2000));
  const checkR = await fetch(`${MT5_BASE}/OpenedOrders?id=${token}`, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(10000) });
  const checkText = await checkR.text();
  let positions: any; try { positions = JSON.parse(checkText); } catch { positions = null; }
  const stillOpen = Array.isArray(positions) && positions.some((p: any) => String(p.ticket) === ticket);

  return NextResponse.json({ ok: true, closed: !stillOpen, closeUrl, closeResult });
}
