import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  // Try to reach the local MT5 dashboard (running on port 8000)
  // This works when both the Next.js app and the mt5-agent are on the same machine
  try {
    const res = await fetch('http://localhost:8000/api/snapshot', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // MT5 dashboard not running — return offline state
  }

  return NextResponse.json({
    agents: {},
    account: { balance: 0, equity: 0, margin: 0, free_margin: 0 },
    daily_pnl: 0,
    portfolio_heat: 0,
    positions: [],
    closed_trades: [],
    biases: {},
    news: [],
    fvgs: [],
    order_blocks: [],
    learning: { paused_assets: [] },
    weekly_report: '',
    offline: true,
  });
}
