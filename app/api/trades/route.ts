import { NextRequest, NextResponse } from 'next/server';
import { sb as supabase } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';



function detectSession(): string {
  const h = new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'})).getHours();
  if (h >= 2 && h < 5) return 'London';
  if (h >= 9 && h < 12) return 'New York AM';
  if (h >= 14 && h < 16) return 'New York PM';
  if (h >= 20 || h < 1) return 'Asia';
  return 'Off-session';
}

export async function GET() {
  const { data, error } = await sb
    .from('trades')
    .select('*')
    .order('opened_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Map DB columns to frontend expected format
  const trades = (data ?? []).map(t => {
    let extra: any = {};
    try { extra = t.notes ? JSON.parse(t.notes.split('__META__')[1] ?? '{}') : {}; } catch {}
    return {
      id: t.id,
      symbol: t.symbol,
      direction: t.direction === 'long' ? 'bull' : t.direction === 'short' ? 'bear' : t.direction,
      entry_price: t.entry_price,
      stop_loss: t.stop_loss,
      target: t.take_profit,
      exit_price: t.rr_achieved != null ? t.entry_price : null, // approximation
      result: t.result === 'open' ? 'open' : t.result === 'win' ? 'win' : t.result === 'loss' ? 'loss' : 'be',
      r_multiple: t.rr_achieved,
      pnl_dollars: extra.pnl_dollars ?? null,
      risk_dollars: extra.risk_dollars ?? 100,
      setup_type: extra.setup_type ?? null,
      timeframe: extra.timeframe ?? null,
      session: extra.session ?? null,
      notes: t.notes ? t.notes.split('__META__')[0] : '',
      mistakes: extra.mistakes ?? [],
      created_at: t.opened_at,
      closed_at: t.closed_at,
    };
  });

  return NextResponse.json({ trades });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, direction, entry_price, stop_loss, target, risk_dollars = 100,
    setup_id, setup_type, timeframe, notes = '', mistakes = [] } = body;

  const session = detectSession();
  const dbDir = direction === 'bull' || direction === 'long' ? 'long' : 'short';
  const rr = Math.abs(target - entry_price) / Math.abs(entry_price - stop_loss);
  const meta = JSON.stringify({ risk_dollars, setup_type, timeframe, session, mistakes, pnl_dollars: null });
  const fullNotes = notes ? `${notes}__META__${meta}` : `__META__${meta}`;

  const { data, error } = await sb.from('trades').insert({
    symbol,
    direction: dbDir,
    entry_price,
    stop_loss,
    take_profit: target,
    result: 'open',
    notes: fullNotes,
    opened_at: new Date().toISOString(),
    setup_id: setup_id ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trade: data });
}

export async function PATCH(req: NextRequest) {
  const { id, exit_price, notes: newNotes = '', mistakes = [] } = await req.json();

  const { data: existing } = await sb.from('trades').select('*').eq('id', id).single();
  if (!existing) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

  let existingMeta: any = {};
  try { existingMeta = JSON.parse(existing.notes?.split('__META__')[1] ?? '{}'); } catch {}

  const isBull = existing.direction === 'long';
  const rr = +((( isBull ? exit_price - existing.entry_price : existing.entry_price - exit_price) /
    Math.abs(existing.entry_price - existing.stop_loss)).toFixed(2));
  const result = rr > 0.1 ? 'win' : rr < -0.1 ? 'loss' : 'breakeven';
  const pnl_dollars = +((rr * (existingMeta.risk_dollars ?? 100)).toFixed(2));

  const newMistakes = [...new Set([...(existingMeta.mistakes ?? []), ...mistakes])];
  const meta = JSON.stringify({ ...existingMeta, mistakes: newMistakes, pnl_dollars, exit_price });
  const existingNoteText = existing.notes?.split('__META__')[0] ?? '';
  const combinedNotes = newNotes ? `${newNotes}__META__${meta}` : existingNoteText ? `${existingNoteText}__META__${meta}` : `__META__${meta}`;

  const { data, error } = await sb.from('trades').update({
    result,
    rr_achieved: rr,
    notes: combinedNotes,
    closed_at: new Date().toISOString(),
  }).eq('id', id).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let extra: any = {};
  try { extra = JSON.parse(data.notes?.split('__META__')[1] ?? '{}'); } catch {}

  return NextResponse.json({
    trade: {
      id: data.id, symbol: data.symbol,
      direction: data.direction === 'long' ? 'bull' : 'bear',
      entry_price: data.entry_price, stop_loss: data.stop_loss, target: data.take_profit,
      result, r_multiple: rr, pnl_dollars, risk_dollars: extra.risk_dollars ?? 100,
      setup_type: extra.setup_type, session: extra.session, notes: data.notes?.split('__META__')[0] ?? '',
      mistakes: extra.mistakes ?? [], created_at: data.opened_at, closed_at: data.closed_at,
    }
  });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const { error } = await sb.from('trades').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
