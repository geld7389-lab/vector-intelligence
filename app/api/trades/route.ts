import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);
function detectSession(entryTime: string) {
  const d = new Date(entryTime);
  const h = parseInt(d.toLocaleString('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}));
  if (h >= 2 && h < 5) return 'London';
  if (h >= 9 && h < 11) return 'NY AM';
  if (h >= 14 && h < 16) return 'NY PM';
  if (h >= 20 || h < 2) return 'Asia';
  return 'Off-session';
}
export async function GET() {
  const { data, error } = await sb.from('trade_log').select('*').order('entry_time', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trades: data ?? [] });
}
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, direction, entry_price, stop_loss, target, risk_dollars, risk_pct, setup_id, setup_type, timeframe, notes, mistakes = [], entry_time } = body;
  const eTime = entry_time || new Date().toISOString();
  const session = detectSession(eTime);
  const slDist = Math.abs(entry_price - stop_loss);
  const tpDist = Math.abs(target - entry_price);
  const planned_rr = slDist > 0 ? +(tpDist / slDist).toFixed(2) : 0;
  const { data, error } = await sb.from('trade_log').insert({
    symbol, direction, entry_price, stop_loss, target,
    risk_dollars: risk_dollars ?? 100, risk_pct: risk_pct ?? 1,
    setup_id, setup_type, timeframe, notes, mistakes,
    session, entry_time: eTime, planned_rr, result: 'open',
    created_at: new Date().toISOString()
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trade: data });
}
export async function PATCH(req: NextRequest) {
  const { id, exit_price, notes, mistakes } = await req.json();
  if (!id || !exit_price) return NextResponse.json({ error: 'id and exit_price required' }, { status: 400 });
  const { data: t } = await sb.from('trade_log').select('*').eq('id', id).single();
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const isBull = t.direction === 'bull' || t.direction === 'long';
  const pnl_pts = isBull ? exit_price - t.entry_price : t.entry_price - exit_price;
  const sl_dist = Math.abs(t.entry_price - t.stop_loss);
  const r_multiple = sl_dist > 0 ? +(pnl_pts / sl_dist).toFixed(2) : 0;
  const pnl_dollars = t.risk_dollars ? +(r_multiple * t.risk_dollars).toFixed(2) : 0;
  const result = r_multiple >= 1.8 ? 'win' : r_multiple <= -0.9 ? 'loss' : r_multiple > 0 ? 'be' : 'loss';
  const { data, error } = await sb.from('trade_log').update({
    exit_price, exit_time: new Date().toISOString(),
    r_multiple, pnl_dollars, result,
    notes: notes ?? t.notes, mistakes: mistakes ?? t.mistakes
  }).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trade: data });
}
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await sb.from('trade_log').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
