import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';

const MT5_BASE = 'https://mt5.mtapi.io';

// Server-side-only reconnect: reads credentials from Supabase itself (never
// sent to or from the browser), calls the broker, and returns ONLY the fresh
// token. This replaces the old flow where the browser had to fetch the real
// password from /api/agents/status and POST it to /api/mt5/connect itself —
// which is also why that status endpoint could never safely redact it before.
export async function GET() {
  const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
  const sessionData = typeof mt5Session?.data === 'string' ? JSON.parse(mt5Session.data) : mt5Session?.data;
  if (!sessionData?.login || !sessionData?.password || !sessionData?.server) {
    return NextResponse.json({ connected: false, error: 'no stored credentials' });
  }
  try {
    const url = `${MT5_BASE}/ConnectEx?user=${sessionData.login}&password=${encodeURIComponent(sessionData.password)}&server=${encodeURIComponent(sessionData.server)}&connectTimeoutSeconds=20&connectTimeoutClusterMemberSeconds=10&errorReplyStatusCode=201`;
    const r = await fetch(url, { headers: { accept: 'text/json' }, signal: AbortSignal.timeout(25000) });
    const text = await r.text();
    let token: string | null = null;
    try { const parsed = JSON.parse(text); token = typeof parsed === 'string' ? parsed : (parsed?.token ?? null); }
    catch { token = text.replace(/"/g, '').trim() || null; }
    if (!token || token.length < 10) {
      return NextResponse.json({ connected: false, error: 'reconnect failed' });
    }
    await sb.from('agent_status').upsert({
      agent: 'mt5_session', status: 'connected',
      last_action: `Auto-reconnected to ${sessionData.broker ?? 'MT5'} (browser)`,
      data: JSON.stringify({ ...sessionData, token, connected_at: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent' });
    return NextResponse.json({ connected: true, token, broker: sessionData.broker });
  } catch (e: any) {
    return NextResponse.json({ connected: false, error: e.message });
  }
}
