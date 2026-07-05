import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';

export async function POST() {
  const { data: trades } = await sb.from('trades').select('*').in('result', ['win', 'loss', 'breakeven']);
  const all = trades ?? [];

  if (all.length === 0) {
    return NextResponse.json({
      overall_win_rate: 0, total_trades: 0,
      asset_win_rates: {}, setup_win_rates: {}, session_win_rates: {},
      paused_assets: [], best_asset: null, worst_asset: null,
    });
  }

  const wins   = all.filter((t:any) => t.result === 'win');
  const overall = wins.length / all.length * 100;

  // By asset
  const assetMap: Record<string,{w:number;t:number}> = {};
  for (const t of all) {
    const s = t.symbol ?? 'UNKNOWN';
    if (!assetMap[s]) assetMap[s] = {w:0,t:0};
    assetMap[s].t++;
    if (t.result==='win') assetMap[s].w++;
  }
  const assetWinRates: Record<string,number> = {};
  const pausedAssets: string[] = [];
  for (const [sym,{w,t}] of Object.entries(assetMap)) {
    const wr = w/t*100;
    assetWinRates[sym] = Math.round(wr*10)/10;
    if (t >= 20 && wr < 40) pausedAssets.push(sym);
  }

  // By setup type
  const setupMap: Record<string,{w:number;t:number}> = {};
  for (const t of all) {
    const s = t.setup_type ?? 'Unknown';
    if (!setupMap[s]) setupMap[s] = {w:0,t:0};
    setupMap[s].t++;
    if (t.result==='win') setupMap[s].w++;
  }
  const setupWinRates: Record<string,number> = {};
  for (const [setup,{w,t}] of Object.entries(setupMap)) {
    setupWinRates[setup] = Math.round(w/t*100*10)/10;
  }

  // By session
  const sessionMap: Record<string,{w:number;t:number}> = {};
  for (const t of all) {
    const s = t.session ?? 'unknown';
    if (!sessionMap[s]) sessionMap[s] = {w:0,t:0};
    sessionMap[s].t++;
    if (t.result==='win') sessionMap[s].w++;
  }
  const sessionWinRates: Record<string,number> = {};
  for (const [sess,{w,t}] of Object.entries(sessionMap)) {
    sessionWinRates[sess] = Math.round(w/t*100*10)/10;
  }

  // Best/worst
  const sorted = Object.entries(assetWinRates).sort((a,b)=>b[1]-a[1]);
  const bestAsset  = sorted[0]?.[0] ?? null;
  const worstAsset = sorted[sorted.length-1]?.[0] ?? null;

  // Avg RR
  const rrs = all.map((t:any)=>t.rr_achieved).filter(Boolean);
  const avgRr = rrs.length ? rrs.reduce((a:number,b:number)=>a+b,0)/rrs.length : 0;

  // Profit factor
  const grossProfit = all.filter((t:any)=>t.result==='win').reduce((s:number,t:any)=>s+(t.pnl??0),0);
  const grossLoss   = Math.abs(all.filter((t:any)=>t.result==='loss').reduce((s:number,t:any)=>s+(t.pnl??0),0)) || 1;
  const profitFactor = grossProfit / grossLoss;

  return NextResponse.json({
    overall_win_rate: Math.round(overall*10)/10,
    total_trades:     all.length,
    wins:             wins.length,
    losses:           all.length - wins.length,
    avg_rr:           Math.round(avgRr*100)/100,
    profit_factor:    Math.round(profitFactor*100)/100,
    asset_win_rates:  assetWinRates,
    setup_win_rates:  setupWinRates,
    session_win_rates:sessionWinRates,
    paused_assets:    pausedAssets,
    best_asset:       bestAsset,
    worst_asset:      worstAsset,
  });
}
