import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://vector-intelligence-five.vercel.app';

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

export async function POST() {
  return runCycle();
}

// GET alias so an external cron (e.g. cron-job.org) can trigger full cycles
// automatically instead of requiring a manual click every time. Safe to run
// on a schedule now that the orchestrator has a run-lock — an overlapping
// call while a cycle is still in-flight gets rejected with
// "orchestrator already running" instead of racing against it.
export async function GET() {
  return runCycle();
}





