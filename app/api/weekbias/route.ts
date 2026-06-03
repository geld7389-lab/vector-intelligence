import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);
function getWeekStart() {
  const d = new Date(); d.setUTCHours(0,0,0,0);
  const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0,10);
}
export async function GET() {
  const { data } = await sb.from('weekly_bias').select('*').eq('week_start', getWeekStart()).order('symbol');
  return NextResponse.json({ biases: data ?? [] });
}
export async function POST(req: NextRequest) {
  const { symbol, bias, reasoning, key_levels } = await req.json();
  const week_start = getWeekStart();
  const { data, error } = await sb.from('weekly_bias').upsert({ symbol, bias, reasoning, key_levels, week_start, updated_at: new Date().toISOString() }, { onConflict: 'symbol,week_start' }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bias: data });
}
