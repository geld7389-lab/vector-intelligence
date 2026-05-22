import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export async function GET() {
  // Get current week start (Monday)
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(now.setDate(diff));
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const { data } = await supabase.from('weekly_bias').select('*')
    .gte('week_start', new Date(Date.now() - 4 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
    .order('week_start', { ascending: false }).limit(10);
  return NextResponse.json({ biases: data ?? [], currentWeek: weekStartStr });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { data, error } = await supabase.from('weekly_bias').upsert(body, { onConflict: 'week_start,symbol' }).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bias: data[0] });
}
