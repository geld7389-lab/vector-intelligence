import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
const supabase = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co'),
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M')
);

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number; }

async function fetchCandles(symbol: string, tf: string): Promise<Candle[]> {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://vector-intelligence-alpha.vercel.app';
    const res = await fetch(`${base}/api/candles?symbol=${symbol}&tf=${tf}`, { cache: 'no-store' });
    const data = await res.json();
    return data.candles ?? [];
  } catch { return []; }
}

function detectSetups(candles: Candle[], symbol: string, tf: string, currentPrice: number) {
  if (candles.length < 30) return [];
  const setups: object[] = [];
  const w20 = candles.slice(-20);
  const swingH = Math.max(...w20.map(c => c.h));
  const swingL = Math.min(...w20.map(c => c.l));
  const midpoint = (swingH + swingL) / 2;
  const range = swingH - swingL;
  const bslLevel = swingH;
  const sslLevel = swingL;

  // Detect FVG (Fair Value Gap)
  for (let i = candles.length - 5; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];
    if (!prev || !curr || !next) continue;
    // Bullish FVG: gap between prev high and next low
    if (prev.h < next.l && curr.c > curr.o) {
      const fvgLow = prev.h, fvgHigh = next.l;
      if (currentPrice > fvgHigh) {
        const sl = fvgLow - range * 0.02;
        const tp = bslLevel + range * 0.05;
        const entry = (fvgLow + fvgHigh) / 2;
        const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
        if (rr >= 2) setups.push({
          symbol, timeframe: tf, direction: 'bull', setup_type: 'Bullish FVG Retest',
          entry_low: +fvgLow.toFixed(2), entry_high: +fvgHigh.toFixed(2),
          stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
          dol_target: `BSL at ${bslLevel.toFixed(0)}`, htf_bias: 'bullish',
          cisd_confirmed: false, volume_context: 'medium', killzone_valid: 'NY,SB',
          status: 'watching', confluence_score: Math.min(82, Math.round(55 + rr * 4)),
          correlated_align: true,
        });
      }
    }
    // Bearish FVG
    if (prev.l > next.h && curr.c < curr.o) {
      const fvgHigh2 = prev.l, fvgLow2 = next.h;
      if (currentPrice < fvgHigh2) {
        const sl = fvgHigh2 + range * 0.02;
        const tp = sslLevel - range * 0.05;
        const entry = (fvgLow2 + fvgHigh2) / 2;
        const rr = Math.abs(tp - entry) / Math.abs(sl - entry);
        if (rr >= 2) setups.push({
          symbol, timeframe: tf, direction: 'bear', setup_type: 'Bearish FVG Retest',
          entry_low: +fvgLow2.toFixed(2), entry_high: +fvgHigh2.toFixed(2),
          stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
          dol_target: `SSL at ${sslLevel.toFixed(0)}`, htf_bias: 'bearish',
          cisd_confirmed: false, volume_context: 'medium', killzone_valid: 'NY,SB',
          status: 'watching', confluence_score: Math.min(82, Math.round(55 + rr * 4)),
          correlated_align: true,
        });
      }
    }
  }

  // OB setup — last opposing candle before move
  let bullOB: Candle | null = null, bearOB: Candle | null = null;
  for (let i = candles.length - 2; i >= candles.length - 15; i--) {
    if (!bullOB && candles[i].c < candles[i].o) bullOB = candles[i];
    if (!bearOB && candles[i].c > candles[i].o) bearOB = candles[i];
    if (bullOB && bearOB) break;
  }

  if (bullOB && currentPrice < midpoint) {
    const obLow = Math.min(bullOB.o, bullOB.c);
    const obHigh = Math.max(bullOB.o, bullOB.c);
    const sl = obLow - range * 0.02;
    const tp = bslLevel + range * 0.03;
    const entry = (obLow + obHigh) / 2;
    const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
    if (rr >= 1.8) setups.push({
      symbol, timeframe: tf, direction: 'bull', setup_type: 'OB + SSL Sweep',
      entry_low: +obLow.toFixed(2), entry_high: +obHigh.toFixed(2),
      stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
      dol_target: `BSL at ${bslLevel.toFixed(0)}`, htf_bias: 'bullish',
      cisd_confirmed: false, volume_context: 'medium', killzone_valid: 'NY,LON',
      status: 'watching', confluence_score: Math.min(85, Math.round(58 + rr * 5)),
      correlated_align: true,
    });
  }

  if (bearOB && currentPrice > midpoint) {
    const obLow = Math.min(bearOB.o, bearOB.c);
    const obHigh = Math.max(bearOB.o, bearOB.c);
    const sl = obHigh + range * 0.02;
    const tp = sslLevel - range * 0.03;
    const entry = (obLow + obHigh) / 2;
    const rr = Math.abs(tp - entry) / Math.abs(sl - entry);
    if (rr >= 1.8) setups.push({
      symbol, timeframe: tf, direction: 'bear', setup_type: 'OB + BSL Sweep',
      entry_low: +obLow.toFixed(2), entry_high: +obHigh.toFixed(2),
      stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
      dol_target: `SSL at ${sslLevel.toFixed(0)}`, htf_bias: 'bearish',
      cisd_confirmed: false, volume_context: 'medium', killzone_valid: 'NY,LON',
      status: 'watching', confluence_score: Math.min(85, Math.round(58 + rr * 5)),
      correlated_align: true,
    });
  }

  // CISD — big displacement candle, price retracing into body
  const recent10 = candles.slice(-10);
  const bigCandle = recent10.find(c => Math.abs(c.c - c.o) > range * 0.08);
  if (bigCandle) {
    const isBull = bigCandle.c > bigCandle.o;
    const [bodyLow, bodyHigh] = [Math.min(bigCandle.o, bigCandle.c), Math.max(bigCandle.o, bigCandle.c)];
    if (isBull && currentPrice > bodyLow && currentPrice < bodyHigh) {
      const sl = bodyLow - range * 0.015;
      const tp = swingH + (bodyHigh - bodyLow) * 0.5;
      const rr = Math.abs(tp - bodyHigh) / Math.abs(bodyHigh - sl);
      if (rr >= 2) setups.push({
        symbol, timeframe: tf, direction: 'bull', setup_type: 'CISD Displacement Long',
        entry_low: +bodyLow.toFixed(2), entry_high: +bodyHigh.toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `BSL extension ${tp.toFixed(0)}`, htf_bias: 'bullish',
        cisd_confirmed: true, volume_context: (bigCandle.v && bigCandle.v > 1000) ? 'high' : 'medium',
        killzone_valid: 'NY,SB', status: 'watching',
        confluence_score: Math.min(88, Math.round(62 + rr * 5)), correlated_align: true,
      });
    }
    if (!isBull && currentPrice > bodyLow && currentPrice < bodyHigh) {
      const sl = bodyHigh + range * 0.015;
      const tp = swingL - (bodyHigh - bodyLow) * 0.5;
      const rr = Math.abs(tp - bodyLow) / Math.abs(sl - bodyLow);
      if (rr >= 2) setups.push({
        symbol, timeframe: tf, direction: 'bear', setup_type: 'CISD Displacement Short',
        entry_low: +bodyLow.toFixed(2), entry_high: +bodyHigh.toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `SSL extension ${tp.toFixed(0)}`, htf_bias: 'bearish',
        cisd_confirmed: true, volume_context: (bigCandle.v && bigCandle.v > 1000) ? 'high' : 'medium',
        killzone_valid: 'NY,SB', status: 'watching',
        confluence_score: Math.min(88, Math.round(62 + rr * 5)), correlated_align: true,
      });
    }
  }

  return setups.slice(0, 3);
}

export async function POST(req: NextRequest) {
  try {
    const { symbols = ['NQ', 'ES'], timeframes = ['15m', '1h'], currentPrices = {} } = await req.json();
    const allDetected: object[] = [];
    for (const sym of symbols) {
      for (const tf of timeframes) {
        const candles = await fetchCandles(sym, tf);
        const price = (currentPrices as Record<string,number>)[sym] ?? candles[candles.length - 1]?.c ?? 0;
        allDetected.push(...detectSetups(candles, sym, tf, price));
      }
    }
    if (allDetected.length === 0) {
      return NextResponse.json({ setups: [], count: 0, message: 'No high-quality setups detected right now. Price may be in a consolidation / no-trade zone.' });
    }
    const expires = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const toInsert = allDetected.map(s => ({ ...(s as object), ai_analysis: '', invalidated_reason: '', expires_at: expires }));
    const { data, error } = await supabase.from('setups').insert(toInsert).select();
    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: error.message ?? JSON.stringify(error), setups: [] }, { status: 500 });
    }
    return NextResponse.json({ setups: data, count: data!.length, message: `${data!.length} new setup${data!.length !== 1 ? 's' : ''} detected from live market structure.` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), setups: [] }, { status: 500 });
  }
}
