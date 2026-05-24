import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const FMP = 'https://financialmodelingprep.com/api/v3';

interface DayData { date: string; open: number; high: number; low: number; close: number; volume: number; }

async function getHistory(symbol: string, isCrypto: boolean): Promise<DayData[]> {
  const key = process.env.FMP_API_KEY ?? '';
  const endpoint = isCrypto
    ? `${FMP}/digital_currency_historical_price/${symbol}?from=2016-01-01&apikey=${key}`
    : `${FMP}/historical-price-full/${symbol}?from=2016-01-01&apikey=${key}`;
  const r = await fetch(endpoint, { cache: 'no-store' });
  const data = await r.json();
  const hist = isCrypto ? (Array.isArray(data) ? data : []) : (data?.historical ?? []);
  return hist.map((d: {date?: string; open?: number; high?: number; low?: number; close?: number; volume?: number; adjClose?: number}) => ({
    date: d.date ?? '',
    open: d.open ?? 0,
    high: d.high ?? 0,
    low: d.low ?? 0,
    close: d.close ?? d.adjClose ?? 0,
    volume: d.volume ?? 0,
  })).filter((d: DayData) => d.date && d.close > 0).reverse(); // oldest first
}

function detectICTPatterns(data: DayData[], lookback = 5): {idx: number; type: string; direction: string; entryPrice: number; slPrice: number; tpPrice: number}[] {
  const signals = [];
  for (let i = lookback + 2; i < data.length - 3; i++) {
    const window = data.slice(i - lookback, i);
    const swingH = Math.max(...window.map(d => d.high));
    const swingL = Math.min(...window.map(d => d.low));
    const midpoint = (swingH + swingL) / 2;
    const range = swingH - swingL;
    const curr = data[i];
    const prev1 = data[i - 1];
    const prev2 = data[i - 2];

    // Bullish FVG: gap between prev2 high and curr low
    if (prev2.high < curr.low && prev1.close > prev1.open && curr.close < midpoint) {
      const fvgMid = (prev2.high + curr.low) / 2;
      signals.push({
        idx: i, type: 'Bullish FVG', direction: 'bull',
        entryPrice: fvgMid,
        slPrice: fvgMid - range * 0.02,
        tpPrice: swingH + range * 0.03,
      });
    }
    // Bearish FVG
    if (prev2.low > curr.high && prev1.close < prev1.open && curr.close > midpoint) {
      const fvgMid = (prev2.low + curr.high) / 2;
      signals.push({
        idx: i, type: 'Bearish FVG', direction: 'bear',
        entryPrice: fvgMid,
        slPrice: fvgMid + range * 0.02,
        tpPrice: swingL - range * 0.03,
      });
    }
    // Bullish OB: last bearish candle before bullish impulse in discount
    if (prev1.close < prev1.open && curr.close > prev1.high && curr.close < midpoint) {
      signals.push({
        idx: i, type: 'Bullish OB', direction: 'bull',
        entryPrice: (prev1.open + prev1.close) / 2,
        slPrice: prev1.low - range * 0.01,
        tpPrice: swingH,
      });
    }
    // Bearish OB
    if (prev1.close > prev1.open && curr.close < prev1.low && curr.close > midpoint) {
      signals.push({
        idx: i, type: 'Bearish OB', direction: 'bear',
        entryPrice: (prev1.open + prev1.close) / 2,
        slPrice: prev1.high + range * 0.01,
        tpPrice: swingL,
      });
    }
  }
  return signals;
}

function simulateTrade(data: DayData[], signal: {idx: number; direction: string; entryPrice: number; slPrice: number; tpPrice: number}, maxBars = 20): 'win' | 'loss' | 'timeout' {
  for (let i = signal.idx + 1; i < Math.min(signal.idx + maxBars, data.length); i++) {
    const bar = data[i];
    if (signal.direction === 'bull') {
      if (bar.low <= signal.slPrice) return 'loss';
      if (bar.high >= signal.tpPrice) return 'win';
    } else {
      if (bar.high >= signal.slPrice) return 'loss';
      if (bar.low <= signal.tpPrice) return 'win';
    }
  }
  return 'timeout';
}

export async function POST(req: NextRequest) {
  try {
    const { symbol, marketSection = 'crypto', setupTypes = ['Bullish FVG', 'Bearish FVG', 'Bullish OB', 'Bearish OB'] } = await req.json();
    if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });

    const isCrypto = marketSection === 'crypto' || symbol.endsWith('USD');
    const data = await getHistory(symbol, isCrypto);
    if (data.length < 100) return NextResponse.json({ error: `Only ${data.length} bars available` }, { status: 400 });

    const signals = detectICTPatterns(data);
    const filtered = signals.filter(s => setupTypes.includes(s.type));

    const trades: {date: string; type: string; direction: string; result: string; rr: number; year: string}[] = [];
    const yearlyStats: Record<string, {wins: number; losses: number; total: number}> = {};

    for (const sig of filtered) {
      const result = simulateTrade(data, sig);
      if (result === 'timeout') continue;
      const date = data[sig.idx].date;
      const year = date.slice(0, 4);
      const rr = result === 'win'
        ? Math.abs(sig.tpPrice - sig.entryPrice) / Math.abs(sig.entryPrice - sig.slPrice)
        : 1;
      trades.push({ date, type: sig.type, direction: sig.direction, result, rr: parseFloat(rr.toFixed(2)), year });
      if (!yearlyStats[year]) yearlyStats[year] = { wins: 0, losses: 0, total: 0 };
      yearlyStats[year].total++;
      if (result === 'win') yearlyStats[year].wins++; else yearlyStats[year].losses++;
    }

    const wins = trades.filter(t => t.result === 'win').length;
    const losses = trades.filter(t => t.result === 'loss').length;
    const winRate = trades.length > 0 ? parseFloat(((wins / trades.length) * 100).toFixed(1)) : 0;
    const avgRR = trades.length > 0 ? parseFloat((trades.reduce((a, t) => a + t.rr, 0) / trades.length).toFixed(2)) : 0;
    const grossW = trades.filter(t => t.result === 'win').reduce((a, t) => a + t.rr, 0);
    const grossL = trades.filter(t => t.result === 'loss').length;
    const pf = grossL > 0 ? parseFloat((grossW / grossL).toFixed(2)) : grossW;

    // Best/worst year
    const yearWR = Object.entries(yearlyStats).map(([y, s]) => ({ year: y, wr: s.total > 0 ? s.wins / s.total : 0 }));
    const bestYear = yearWR.sort((a, b) => b.wr - a.wr)[0]?.year ?? '—';
    const worstYear = yearWR.sort((a, b) => a.wr - b.wr)[0]?.year ?? '—';

    const run = {
      symbol, timeframe: 'D', market_section: marketSection,
      setup_type: setupTypes.join(', '),
      from_date: data[0]?.date ?? '2016-01-01',
      to_date: data[data.length - 1]?.date ?? '2026-01-01',
      total_signals: filtered.length,
      wins, losses, win_rate: winRate, avg_rr: avgRR,
      total_pnl: parseFloat((wins * avgRR - losses).toFixed(2)),
      max_drawdown: 0, profit_factor: pf,
      best_year: bestYear, worst_year: worstYear,
      yearly_breakdown: yearlyStats,
    };

    await sb.from('backtest_results').insert(run);
    return NextResponse.json({ run, trades: trades.slice(-50), totalBars: data.length, dateRange: `${data[0]?.date} to ${data[data.length-1]?.date}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  const { data } = await sb.from('backtest_results').select('*').order('created_at', { ascending: false }).limit(20);
  return NextResponse.json({ results: data ?? [] });
}
