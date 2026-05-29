import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number; }

async function fetchCandles(symbol: string, tf: string): Promise<Candle[]> {
  try {
    const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    const res = await fetch(`${base}/api/candles?symbol=${symbol}&tf=${tf}`, { cache: 'no-store' });
    const data = await res.json();
    return data.candles ?? [];
  } catch { return []; }
}

function analyzeStructure(candles: Candle[], symbol: string, tf: string) {
  if (candles.length < 50) return null;

  const recent = candles.slice(-50);
  const last = candles[candles.length - 1];
  const price = last.c;

  // 1. Determine swing highs/lows (last 20 bars)
  const w20 = candles.slice(-20);
  const swingH = Math.max(...w20.map(c => c.h));
  const swingL = Math.min(...w20.map(c => c.l));
  const midpoint = (swingH + swingL) / 2;
  const range = swingH - swingL;

  // 2. Determine premium/discount zones
  const inDiscount = price < midpoint;
  const inPremium = price > midpoint;
  const discountLevel = swingL + range * 0.382;
  const premiumLevel = swingH - range * 0.382;

  // 3. Detect Fair Value Gaps (FVG)
  const fvgs: { type: 'bull' | 'bear'; low: number; high: number; idx: number; filled: boolean }[] = [];
  for (let i = 2; i < recent.length; i++) {
    const c1 = recent[i-2], c3 = recent[i];
    // Bullish FVG: c1 high < c3 low
    if (c1.h < c3.l && (c3.l - c1.h) > range * 0.01) {
      const filled = recent.slice(i+1).some(c => c.l <= c1.h + (c3.l - c1.h) * 0.5);
      fvgs.push({ type: 'bull', low: c1.h, high: c3.l, idx: i, filled });
    }
    // Bearish FVG: c1 low > c3 high
    if (c1.l > c3.h && (c1.l - c3.h) > range * 0.01) {
      const filled = recent.slice(i+1).some(c => c.h >= c3.h + (c1.l - c3.h) * 0.5);
      fvgs.push({ type: 'bear', low: c3.h, high: c1.l, idx: i, filled });
    }
  }

  // 4. Detect Order Blocks (last significant opposing candle before a move)
  const obs: { type: 'bull' | 'bear'; low: number; high: number; body_low: number; body_high: number; strength: number }[] = [];
  for (let i = 5; i < recent.length - 3; i++) {
    const c = recent[i];
    const bodySize = Math.abs(c.c - c.o);
    if (bodySize < range * 0.003) continue; // too small

    // Bullish OB: bearish candle followed by bullish displacement
    const nextThree = recent.slice(i+1, i+4);
    const bullMove = nextThree.reduce((acc, nc) => acc + (nc.c - nc.o), 0);
    if (c.c < c.o && bullMove > bodySize * 2) {
      obs.push({ type: 'bull', low: c.l, high: c.h, body_low: Math.min(c.o, c.c), body_high: Math.max(c.o, c.c), strength: bullMove / bodySize });
    }
    // Bearish OB: bullish candle followed by bearish displacement
    const bearMove = nextThree.reduce((acc, nc) => acc + (nc.o - nc.c), 0);
    if (c.c > c.o && bearMove > bodySize * 2) {
      obs.push({ type: 'bear', low: c.l, high: c.h, body_low: Math.min(c.o, c.c), body_high: Math.max(c.o, c.c), strength: bearMove / bodySize });
    }
  }

  // 5. Detect SSL/BSL (equal lows/highs = liquidity pools)
  const eqLows: number[] = [];
  const eqHighs: number[] = [];
  for (let i = 0; i < recent.length - 2; i++) {
    for (let j = i + 2; j < recent.length; j++) {
      if (Math.abs(recent[i].l - recent[j].l) < range * 0.002) eqLows.push((recent[i].l + recent[j].l) / 2);
      if (Math.abs(recent[i].h - recent[j].h) < range * 0.002) eqHighs.push((recent[i].h + recent[j].h) / 2);
    }
  }
  const sslLevel = eqLows.length > 0 ? Math.min(...eqLows) : swingL;
  const bslLevel = eqHighs.length > 0 ? Math.max(...eqHighs) : swingH;

  // 6. Check if price recently swept a liquidity level (last 5 bars)
  const last5 = candles.slice(-5);
  const sslSwept = last5.some(c => c.l < sslLevel) && price > sslLevel;
  const bslSwept = last5.some(c => c.h > bslLevel) && price < bslLevel;

  // 7. Detect CISD (Change in State of Delivery)
  // Look for a big displacement candle then a pullback into its body
  let cisdBull = false, cisdBear = false;
  for (let i = 5; i < recent.length - 2; i++) {
    const disp = recent[i];
    const dispSize = Math.abs(disp.c - disp.o);
    if (dispSize < range * 0.008) continue;

    if (disp.c > disp.o) { // bullish displacement
      const bodyMid = (disp.o + disp.c) / 2;
      const retrace = recent.slice(i+1).some(c => c.l <= bodyMid && c.c > disp.o);
      if (retrace && inDiscount) cisdBull = true;
    } else { // bearish displacement
      const bodyMid = (disp.o + disp.c) / 2;
      const retrace = recent.slice(i+1).some(c => c.h >= bodyMid && c.c < disp.o);
      if (retrace && inPremium) cisdBear = true;
    }
  }

  // 8. Volume analysis
  const avgVol = recent.slice(-20).reduce((a, c) => a + (c.v ?? 0), 0) / 20;
  const lastVol = last.v ?? 0;
  const volumeCtx = lastVol > avgVol * 1.5 ? 'high' : lastVol > avgVol * 0.8 ? 'medium' : 'low';

  return {
    price, swingH, swingL, midpoint, range,
    inDiscount, inPremium, discountLevel, premiumLevel,
    fvgs: fvgs.filter(f => !f.filled).slice(-5),
    obs: obs.slice(-3),
    sslLevel, bslLevel, sslSwept, bslSwept,
    cisdBull, cisdBear, volumeCtx, avgVol,
    eqLowsCount: eqLows.length, eqHighsCount: eqHighs.length
  };
}

function buildSetups(analysis: ReturnType<typeof analyzeStructure>, symbol: string, tf: string) {
  if (!analysis) return [];
  const setups: object[] = [];
  const { price, swingH, swingL, range, inDiscount, inPremium,
          fvgs, obs, sslSwept, bslSwept, bslLevel, sslLevel,
          cisdBull, cisdBear, volumeCtx } = analysis;

  const isHigherTF = tf === '4h' || tf === 'd';
  const minRR = isHigherTF ? 2.5 : 2.0;

  // === SETUP 1: Bullish FVG Retest (price in discount + unfilled bull FVG) ===
  const bullFVGs = fvgs.filter(f => f.type === 'bull' && f.high < price && price - f.high < range * 0.15);
  for (const fvg of bullFVGs.slice(0, 1)) {
    if (!inDiscount) continue;
    const sl = fvg.low - range * 0.01;
    const tp = bslLevel > fvg.high ? bslLevel : swingH;
    const rr = Math.abs(tp - fvg.high) / Math.abs(fvg.high - sl);
    if (rr < minRR) continue;
    setups.push({
      symbol, timeframe: tf, direction: 'bull', setup_type: 'FVG Retest',
      entry_low: +fvg.low.toFixed(2), entry_high: +fvg.high.toFixed(2),
      stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
      dol_target: `BSL at ${bslLevel.toFixed(0)}`,
      htf_bias: 'bullish', cisd_confirmed: cisdBull,
      volume_context: volumeCtx, killzone_valid: 'NY,London',
      status: 'watching', confluence_score: Math.min(92, Math.round(60 + rr * 6 + (cisdBull ? 15 : 0) + (sslSwept ? 10 : 0))),
      correlated_align: true,
    });
  }

  // === SETUP 2: Bearish FVG Retest (price in premium + unfilled bear FVG) ===
  const bearFVGs = fvgs.filter(f => f.type === 'bear' && f.low > price && f.low - price < range * 0.15);
  for (const fvg of bearFVGs.slice(0, 1)) {
    if (!inPremium) continue;
    const sl = fvg.high + range * 0.01;
    const tp = sslLevel < fvg.low ? sslLevel : swingL;
    const rr = Math.abs(fvg.low - tp) / Math.abs(sl - fvg.low);
    if (rr < minRR) continue;
    setups.push({
      symbol, timeframe: tf, direction: 'bear', setup_type: 'FVG Retest',
      entry_low: +fvg.low.toFixed(2), entry_high: +fvg.high.toFixed(2),
      stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
      dol_target: `SSL at ${sslLevel.toFixed(0)}`,
      htf_bias: 'bearish', cisd_confirmed: cisdBear,
      volume_context: volumeCtx, killzone_valid: 'NY,London',
      status: 'watching', confluence_score: Math.min(92, Math.round(60 + rr * 6 + (cisdBear ? 15 : 0) + (bslSwept ? 10 : 0))),
      correlated_align: true,
    });
  }

  // === SETUP 3: OB + SSL/BSL Sweep ===
  if (sslSwept) {
    const bullOBs = obs.filter(o => o.type === 'bull' && o.high < price && price - o.high < range * 0.12);
    for (const ob of bullOBs.slice(0, 1)) {
      const sl = ob.low - range * 0.008;
      const tp = bslLevel;
      const rr = Math.abs(tp - ob.body_high) / Math.abs(ob.body_high - sl);
      if (rr < minRR) continue;
      setups.push({
        symbol, timeframe: tf, direction: 'bull', setup_type: 'OB + SSL Sweep',
        entry_low: +ob.body_low.toFixed(2), entry_high: +ob.body_high.toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `BSL at ${bslLevel.toFixed(0)}`,
        htf_bias: 'bullish', cisd_confirmed: cisdBull,
        volume_context: volumeCtx, killzone_valid: 'NY,London,SB',
        status: 'watching', confluence_score: Math.min(95, Math.round(72 + rr * 5 + (cisdBull ? 12 : 0))),
        correlated_align: true,
      });
    }
  }

  if (bslSwept) {
    const bearOBs = obs.filter(o => o.type === 'bear' && o.low > price && o.low - price < range * 0.12);
    for (const ob of bearOBs.slice(0, 1)) {
      const sl = ob.high + range * 0.008;
      const tp = sslLevel;
      const rr = Math.abs(ob.body_low - tp) / Math.abs(sl - ob.body_low);
      if (rr < minRR) continue;
      setups.push({
        symbol, timeframe: tf, direction: 'bear', setup_type: 'OB + BSL Sweep',
        entry_low: +ob.body_low.toFixed(2), entry_high: +ob.body_high.toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `SSL at ${sslLevel.toFixed(0)}`,
        htf_bias: 'bearish', cisd_confirmed: cisdBear,
        volume_context: volumeCtx, killzone_valid: 'NY,London,SB',
        status: 'watching', confluence_score: Math.min(95, Math.round(72 + rr * 5 + (cisdBear ? 12 : 0))),
        correlated_align: true,
      });
    }
  }

  // === SETUP 4: CISD Entry (confirmed change of delivery) ===
  if (cisdBull && inDiscount) {
    const sl = swingL - range * 0.01;
    const tp = swingH;
    const entry = analysis.discountLevel;
    const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
    if (rr >= minRR) {
      setups.push({
        symbol, timeframe: tf, direction: 'bull', setup_type: 'CISD Entry',
        entry_low: +(entry - range * 0.01).toFixed(2), entry_high: +(entry + range * 0.01).toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `BSL at ${swingH.toFixed(0)}`,
        htf_bias: 'bullish', cisd_confirmed: true,
        volume_context: volumeCtx, killzone_valid: 'NY,London',
        status: 'watching', confluence_score: Math.min(96, Math.round(78 + rr * 5)),
        correlated_align: true,
      });
    }
  }

  if (cisdBear && inPremium) {
    const sl = swingH + range * 0.01;
    const tp = swingL;
    const entry = analysis.premiumLevel;
    const rr = Math.abs(entry - tp) / Math.abs(sl - entry);
    if (rr >= minRR) {
      setups.push({
        symbol, timeframe: tf, direction: 'bear', setup_type: 'CISD Entry',
        entry_low: +(entry - range * 0.01).toFixed(2), entry_high: +(entry + range * 0.01).toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `SSL at ${swingL.toFixed(0)}`,
        htf_bias: 'bearish', cisd_confirmed: true,
        volume_context: volumeCtx, killzone_valid: 'NY,London',
        status: 'watching', confluence_score: Math.min(96, Math.round(78 + rr * 5)),
        correlated_align: true,
      });
    }
  }

  return setups.slice(0, 3); // max 3 per symbol/tf combo
}

export async function POST(req: NextRequest) {
  try {
    const { symbols = ['NQ', 'ES'], timeframes = ['15m', '1h'], currentPrices = {} } = await req.json();
    const allDetected: object[] = [];

    for (const sym of symbols) {
      for (const tf of timeframes) {
        const candles = await fetchCandles(sym, tf);
        if (candles.length < 30) continue;

        const analysis = analyzeStructure(candles, sym, tf);
        if (!analysis) continue;

        const symSetups = buildSetups(analysis, sym, tf);
        allDetected.push(...symSetups);
      }
    }

    if (allDetected.length === 0) {
      return NextResponse.json({
        setups: [], count: 0,
        message: 'No high-quality setups found. Price may be in consolidation, at midpoint (no discount/premium edge), or setups below R:R 2.0 threshold. Try different symbols or timeframes.'
      });
    }

    const expires = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const toInsert = allDetected.map(s => ({ ...(s as object), ai_analysis: '', invalidated_reason: '', expires_at: expires }));

    const { data, error } = await supabase.from('setups').insert(toInsert).select();
    if (error) {
      return NextResponse.json({ error: error.message ?? JSON.stringify(error), setups: [] }, { status: 500 });
    }

    return NextResponse.json({
      setups: data,
      count: data!.length,
      message: `${data!.length} ICT setup${data!.length !== 1 ? 's' : ''} detected — FVG retests, OB sweeps, CISD entries. All require R:R ≥ 2.0.`
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), setups: [] }, { status: 500 });
  }
}
