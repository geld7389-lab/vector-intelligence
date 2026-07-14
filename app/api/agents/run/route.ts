import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://vector-intelligence-five.vercel.app';

// This endpoint can trigger real trade-executing cycles. It was previously
// reachable by anyone who found the URL — no auth at all. The secret lives in
// a dedicated agent_status row ('run_secret') that /api/agents/status
// explicitly excludes from its output, so it never gets exposed the way the
// MT5 password was.
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const provided = req.nextUrl.searchParams.get('token');
  if (!provided) return false;
  const { data } = await sb.from('agent_status').select('data').eq('agent', 'run_secret').single();
  const parsed = typeof data?.data === 'string' ? JSON.parse(data.data) : data?.data;
  const real = parsed?.token;
  return typeof real === 'string' && real.length > 0 && provided === real;
}

async function runCycle() {
  try {
    const res = await fetch(`${BASE}/api/agents/orchestrator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: ['NQ','ES','GC','EURUSD','GBPUSD','USDJPY','BTC','ETH','CL'] }),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ ok: false, error: 'unauthorized — missing or invalid ?token=' }, { status: 401 });
  }
  return runCycle();
}

// GET alias so an external cron (e.g. cron-job.org) can trigger full cycles
// automatically. Safe on a schedule now that the orchestrator has a run-lock.
// Requires the same ?token= as POST — the cron job URL just needs it appended.
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ ok: false, error: 'unauthorized — missing or invalid ?token=' }, { status: 401 });
  }
  return runCycle();
}
