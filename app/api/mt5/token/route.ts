import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';

// The browser was caching its own token in localStorage and reusing it
// indefinitely as long as mtapi.io kept saying connected:true for it — but
// mtapi.io can serve stale/frozen account data for an old token even while it
// still "validates". The monitor cron refreshes mt5_session.data.token every
// 60s with a real reconnect; this endpoint just hands back whatever that
// current value is, so the browser is always aligned with the same session
// the rest of the system is actually using, instead of drifting on its own.
export async function GET() {
  const { data } = await sb.from('agent_status').select('data, updated_at').eq('agent', 'mt5_session').single();
  const parsed = typeof data?.data === 'string' ? JSON.parse(data.data) : data?.data;
  if (!parsed?.token) return NextResponse.json({ token: null });
  return NextResponse.json({ token: parsed.token, refreshed_at: data?.updated_at });
}
