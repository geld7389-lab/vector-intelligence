import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

export async function GET() {
  const { data } = await sb.from('trade_log').select('*').order('created_at', { ascending: false }).limit(200);
  
  // Compute analytics
  const trades = data ?? [];
  const closed = trades.filter(t => ['win','loss','be'].includes(t.outcome ?? ''));
  const wins = closed.filter(t => t.outcome === 'win');
  const losses = closed.filter(t => t.outcome === 'loss');
  const totalPnl = closed.reduce((a, t) => a + (t.pnl_dollars ?? 0), 0);
  const totalR = closed.reduce((a, t) => a + (t.pnl_r ?? 0), 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a,t)=>a+(t.pnl_r??0),0)/wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a,t)=>a+(t.pnl_r??0),0)/losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

  // By session
  const bySession: Record<string, { wins: number; losses: number; pnl: number }> = {};
  closed.forEach(t => {
    const s = t.session ?? 'Unknown';
    if (!bySession[s]) bySession[s] = { wins: 0, losses: 0, pnl: 0 };
    if (t.outcome === 'win') bySession[s].wins++;
    else if (t.outcome === 'loss') bySession[s].losses++;
    bySession[s].pnl += t.pnl_dollars ?? 0;
  });

  // By symbol
  const bySymbol: Record<string, { wins: number; losses: number; pnl: number }> = {};
  closed.forEach(t => {
    const s = t.symbol;
    if (!bySymbol[s]) bySymbol[s] = { wins: 0, losses: 0, pnl: 0 };
    if (t.outcome === 'win') bySymbol[s].wins++;
    else if (t.outcome === 'loss') bySymbol[s].losses++;
    bySymbol[s].pnl += t.pnl_dollars ?? 0;
  });

  // Equity curve
  let equity = trades[0]?.account_size ?? 100000;
  const equityCurve = closed.map(t => { equity += (t.pnl_dollars ?? 0); return { date: t.exit_time ?? t.created_at, equity: +equity.toFixed(2) }; });

  return NextResponse.json({ trades, stats: { total: closed.length, wins: wins.length, losses: losses.length, winRate: +winRate.toFixed(1), totalPnl: +totalPnl.toFixed(2), totalR: +totalR.toFixed(2), avgWin: +avgWin.toFixed(2), avgLoss: +avgLoss.toFixed(2), profitFactor: +profitFactor.toFixed(2) }, bySession, bySymbol, equityCurve });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  
  // Auto-calculate P&L if exit provided
  if (body.exit_price && body.entry_price && body.stop_loss) {
    const risk = Math.abs(body.entry_price - body.stop_loss);
    const result = body.direction === 'bull' ? body.exit_price - body.entry_price : body.entry_price - body.exit_price;
    body.pnl_r = risk > 0 ? +(result / risk).toFixed(2) : 0;
    const riskDollars = (body.account_size ?? 100000) * ((body.risk_percent ?? 1) / 100);
    body.pnl_dollars = +(body.pnl_r * riskDollars).toFixed(2);
    body.outcome = body.pnl_r >= 0.1 ? 'win' : body.pnl_r <= -0.9 ? 'loss' : 'be';
  } else {
    body.outcome = body.outcome ?? 'running';
  }

  // Detect session from entry time
  const hour = new Date(body.entry_time ?? Date.now()).getUTCHours();
  body.session = hour >= 20 || hour < 2 ? 'Asia' : hour >= 2 && hour < 8 ? 'London' : hour >= 13 && hour < 17 ? 'NY AM' : 'NY PM';

  const { data, error } = await sb.from('trade_log').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mark setup as won/lost if linked
  if (body.setup_id && body.outcome !== 'running') {
    await sb.from('setups').update({ status: body.outcome === 'win' ? 'won' : body.outcome === 'loss' ? 'lost' : 'expired' }).eq('id', body.setup_id);
  }

  return NextResponse.json({ trade: data });
}

export async function PATCH(req: NextRequest) {
  const { id, exit_price, notes, outcome } = await req.json();
  const existing = await sb.from('trade_log').select('*').eq('id', id).single();
  if (!existing.data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  
  const t = existing.data;
  const updates: Record<string, unknown> = { exit_price, notes, exit_time: new Date().toISOString() };
  if (exit_price && t.entry_price && t.stop_loss) {
    const risk = Math.abs(t.entry_price - t.stop_loss);
    const result = t.direction === 'bull' ? exit_price - t.entry_price : t.entry_price - exit_price;
    updates.pnl_r = risk > 0 ? +(result / risk).toFixed(2) : 0;
    const riskDollars = (t.account_size ?? 100000) * ((t.risk_percent ?? 1) / 100);
    updates.pnl_dollars = +((updates.pnl_r as number) * riskDollars).toFixed(2);
    updates.outcome = outcome ?? ((updates.pnl_r as number) >= 0.1 ? 'win' : (updates.pnl_r as number) <= -0.9 ? 'loss' : 'be');
  }

  const { data, error } = await sb.from('trade_log').update(updates).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trade: data });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await sb.from('trade_log').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
