import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ 
    ok: true, build: 'd3e6f80', version: '3.0',
    features: ['multi-tf-autoscan','weekly-bias-ui','smt-panel','live-calendar','cot-in-ai','backtest-ui','analytics-by-type','mistake-tagging'],
    timestamp: new Date().toISOString()
  });
}
