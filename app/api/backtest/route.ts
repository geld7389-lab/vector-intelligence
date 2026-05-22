import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number; }

async function fetchCandles(symbol: string, tf: string): Promise<Candle[]> {
  const base = 'https://vector-intelligence-seven.vercel.app';
  const r = await fetch(`${base}/api/candles?symbol=${symbol}&tf=${tf}`, { cache: 'no-store' });
  const d = await r.json();
  return d.candles ?? [];
}

function runBacktest(candles: Candle[], entryPct: number, slPct: number, tpPct: number, direction: 'bull'|'bear') {
  const results: {win:boolean, rr:number, pnl:number, entryIdx:number}[] = [];
  const ptValue = 20; // NQ default
  for (let i = 20; i < candles.length - 10; i++) {
    const price = candles[i].c;
    const entry = direction === 'bull' ? price * (1 - entryPct/100) : price * (1 + entryPct/100);
    const sl    = direction === 'bull' ? entry * (1 - slPct/100)    : entry * (1 + slPct/100);
    const tp    = direction === 'bull' ? entry * (1 + tpPct/100)    : entry * (1 - tpPct/100);
    // Simulate next 10 candles
    let hit: 'tp'|'sl'|null = null;
    for (let j = i+1; j < Math.min(i+11, candles.length); j++) {
      if (direction === 'bull') {
        if (candles[j].l <= sl) { hit = 'sl'; break; }
        if (candles[j].h >= tp) { hit = 'tp'; break; }
      } else {
        if (candles[j].h >= sl) { hit = 'sl'; break; }
        if (candles[j].l <= tp) { hit = 'tp'; break; }
      }
    }
    if (hit) {
      const pnl = hit === 'tp' ? Math.abs(tp-entry)*ptValue : -Math.abs(entry-sl)*ptValue;
      const rr = Math.abs(tp-entry)/Math.abs(entry-sl);
      results.push({ win: hit==='tp', rr, pnl, entryIdx: i });
    }
  }
  return results;
}

export async function POST(req: NextRequest) {
  try {
    const { symbol='NQ', timeframe='15m', direction='bull', entryPct=0.2, slPct=0.15, tpPct=0.5, name='Backtest' } = await req.json();
    const candles = await fetchCandles(symbol, timeframe);
    if (candles.length < 30) return NextResponse.json({ error: 'Not enough candle data' }, { status: 400 });

    const results = runBacktest(candles, entryPct, slPct, tpPct, direction);
    if (!results.length) return NextResponse.json({ error: 'No trades triggered' }, { status: 400 });

    const wins = results.filter(r => r.win).length;
    const losses = results.length - wins;
    const winRate = wins / results.length;
    const totalPnl = results.reduce((a, r) => a + r.pnl, 0);
    const avgRR = results.reduce((a, r) => a + r.rr, 0) / results.length;
    const grossWin = results.filter(r=>r.win).reduce((a,r)=>a+r.pnl,0);
    const grossLoss = Math.abs(results.filter(r=>!r.win).reduce((a,r)=>a+r.pnl,0));
    const profitFactor = grossLoss > 0 ? grossWin/grossLoss : grossWin > 0 ? 999 : 0;

    // Max drawdown
    let peak = 0, equity = 0, maxDD = 0;
    for (const r of results) {
      equity += r.pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    // Max consecutive losses
    let maxConsec = 0, consec = 0;
    for (const r of results) {
      if (!r.win) { consec++; maxConsec = Math.max(maxConsec, consec); } else consec = 0;
    }

    // Sharpe (simplified)
    const pnls = results.map(r => r.pnl);
    const mean = totalPnl / pnls.length;
    const std = Math.sqrt(pnls.reduce((a,p) => a + Math.pow(p-mean,2),0)/pnls.length);
    const sharpe = std > 0 ? mean/std : 0;

    const run = {
      name, symbol, timeframe,
      start_date: new Date(candles[0].t*1000).toISOString().slice(0,10),
      end_date: new Date(candles[candles.length-1].t*1000).toISOString().slice(0,10),
      total_trades: results.length, wins, losses,
      win_rate: parseFloat((winRate*100).toFixed(1)),
      total_pnl: parseFloat(totalPnl.toFixed(0)),
      max_drawdown: parseFloat(maxDD.toFixed(0)),
      sharpe_ratio: parseFloat(sharpe.toFixed(2)),
      profit_factor: parseFloat(profitFactor.toFixed(2)),
      expectancy: parseFloat((totalPnl/results.length).toFixed(0)),
      avg_rr: parseFloat(avgRR.toFixed(2)),
      max_consecutive_losses: maxConsec,
      parameters: { direction, entryPct, slPct, tpPct }
    };

    const { data, error } = await supabase.from('backtest_runs').insert(run).select();
    if (error) throw error;
    return NextResponse.json({ run: data[0], trades: results.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  const { data } = await supabase.from('backtest_runs').select('*').order('created_at', { ascending: false }).limit(20);
  return NextResponse.json({ runs: data ?? [] });
}
