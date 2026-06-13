import { NextRequest, NextResponse } from 'next/server';
import { sb as supabase } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data, error } = await sb.from('weekly_bias').select('*').order('created_at',{ascending:false}).limit(20);
    if (error) return NextResponse.json({ biases:[], note: error.message });
    const latest: Record<string,any> = {};
    (data??[]).forEach((b:any) => { if(!latest[b.symbol]) latest[b.symbol]=b; });
    return NextResponse.json({ biases: Object.values(latest) });
  } catch (e) { return NextResponse.json({ biases:[], note: String(e) }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { data, error } = await sb.from('weekly_bias').insert(body).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status:500 });
    return NextResponse.json({ bias: data });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status:500 }); }
}
