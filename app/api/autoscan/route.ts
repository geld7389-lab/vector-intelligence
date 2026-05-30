import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number; }

// ── Fetch candles directly from Yahoo Finance (no internal HTTP calls) ──
async function fetchCandlesDirect(symbol: string, tf: string): Promise<Candle[]> {
  try {
    const yahooMap: Record<string, string> = {
      'NQ': 'NQ=F', 'ES': 'ES=F', 'GC': 'GC=F', 'CL': 'CL=F',
      'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD',
      'BNB': 'BNB-USD', 'XRP': 'XRP-USD',
      'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X',
      'SPY': 'SPY', 'QQQ': 'QQQ', 'AAPL': 'AAPL', 'NVDA': 'NVDA',
    };
    const ySym = yahooMap[symbol] ?? `${symbol}=F`;
    const interval = tf === '15m' ? '15m' : tf === '1h' ? '60m' : tf === '4h' ? '60m' : '1d';
    const range = tf === '15m' ? '5d' : tf === '1h' ? '1mo' : tf === '4h' ? '3mo' : '1y';

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    let candles: Candle[] = ts.map((t, i) => ({
      t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i]
    })).filter(c => c.o != null && c.h != null && c.l != null && c.c != null);

    // Aggregate to 4h if needed
    if (tf === '4h') {
      const g: Candle[] = [];
      for (let i = 0; i < candles.length; i += 4) {
        const ch = candles.slice(i, i + 4);
        if (!ch.length) continue;
        g.push({ t: ch[0].t, o: ch[0].o, h: Math.max(...ch.map(c => c.h)), l: Math.min(...ch.map(c => c.l)), c: ch[ch.length-1].c, v: ch.reduce((a,c)=>a+(c.v??0),0) });
      }
      candles = g;
    }
    return candles.slice(-150);
  } catch { return []; }
}

function analyzeStructure(candles: Candle[], symbol: string, tf: string) {
  if (candles.length < 50) return null;

  const last = candles[candles.length - 1];
  const price = last.c;

  // Swing highs/lows over last 20 bars
  const w20 = candles.slice(-20);
  const swingH = Math.max(...w20.map(c => c.h));
  const swingL = Math.min(...w20.map(c => c.l));
  const midpoint = (swingH + swingL) / 2;
  const range = swingH - swingL;
  if (range === 0) return null;

  const inDiscount = price < midpoint;
  const inPremium = price > midpoint;
  const discountLevel = swingL + range * 0.382;
  const premiumLevel = swingH - range * 0.382;

  // Fair Value Gaps
  const recent = candles.slice(-50);
  const fvgs: { type: 'bull' | 'bear'; low: number; high: number; filled: boolean }[] = [];
  for (let i = 2; i < recent.length; i++) {
    const c1 = recent[i-2], c3 = recent[i];
    if (c1.h < c3.l && (c3.l - c1.h) > range * 0.008) {
      const filled = recent.slice(i+1).some(c => c.l <= c1.h + (c3.l - c1.h) * 0.5);
      fvgs.push({ type: 'bull', low: c1.h, high: c3.l, filled });
    }
    if (c1.l > c3.h && (c1.l - c3.h) > range * 0.008) {
      const filled = recent.slice(i+1).some(c => c.h >= c3.h + (c1.l - c3.h) * 0.5);
      fvgs.push({ type: 'bear', low: c3.h, high: c1.l, filled });
    }
  }

  // Order Blocks
  const obs: { type: 'bull' | 'bear'; low: number; high: number; body_low: number; body_high: number }[] = [];
  for (let i = 5; i < recent.length - 3; i++) {
    const c = recent[i];
    const bodySize = Math.abs(c.c - c.o);
    if (bodySize < range * 0.003) continue;
    const next3 = recent.slice(i+1, i+4);
    const bullMove = next3.reduce((a, nc) => a + (nc.c - nc.o), 0);
    const bearMove = next3.reduce((a, nc) => a + (nc.o - nc.c), 0);
    if (c.c < c.o && bullMove > bodySize * 1.5) {
      obs.push({ type: 'bull', low: c.l, high: c.h, body_low: Math.min(c.o, c.c), body_high: Math.max(c.o, c.c) });
    }
    if (c.c > c.o && bearMove > bodySize * 1.5) {
      obs.push({ type: 'bear', low: c.l, high: c.h, body_low: Math.min(c.o, c.c), body_high: Math.max(c.o, c.c) });
    }
  }

  // Equal highs/lows (liquidity pools)
  const eqLows: number[] = [], eqHighs: number[] = [];
  for (let i = 0; i < recent.length - 2; i++) {
    for (let j = i + 2; j < recent.length; j++) {
      if (Math.abs(recent[i].l - recent[j].l) < range * 0.002) eqLows.push((recent[i].l + recent[j].l) / 2);
      if (Math.abs(recent[i].h - recent[j].h) < range * 0.002) eqHighs.push((recent[i].h + recent[j].h) / 2);
    }
  }
  const sslLevel = eqLows.length > 0 ? Math.min(...eqLows) : swingL;
  const bslLevel = eqHighs.length > 0 ? Math.max(...eqHighs) : swingH;

  // Liquidity sweeps in last 5 bars
  const last5 = candles.slice(-5);
  const sslSwept = last5.some(c => c.l < sslLevel) && price > sslLevel;
  const bslSwept = last5.some(c => c.h > bslLevel) && price < bslLevel;

  // CISD detection
  let cisdBull = false, cisdBear = false;
  for (let i = 5; i < recent.length - 2; i++) {
    const disp = recent[i];
    const dispSize = Math.abs(disp.c - disp.o);
    if (dispSize < range * 0.006) continue;
    if (disp.c > disp.o) {
      const bodyMid = (disp.o + disp.c) / 2;
      if (recent.slice(i+1).some(c => c.l <= bodyMid && c.c > disp.o) && inDiscount) cisdBull = true;
    } else {
      const bodyMid = (disp.o + disp.c) / 2;
      if (recent.slice(i+1).some(c => c.h >= bodyMid && c.c < disp.o) && inPremium) cisdBear = true;
    }
  }

  const avgVol = recent.slice(-20).reduce((a, c) => a + (c.v ?? 0), 0) / 20;
  const lastVol = last.v ?? 0;
  const volumeCtx = lastVol > avgVol * 1.5 ? 'high' : lastVol > avgVol * 0.8 ? 'medium' : 'low';

  return {
    price, swingH, swingL, midpoint, range,
    inDiscount, inPremium, discountLevel, premiumLevel,
    fvgs: fvgs.filter(f => !f.filled).slice(-5),
    obs: obs.slice(-3),
    sslLevel, bslLevel, sslSwept, bslSwept,
    cisdBull, cisdBear, volumeCtx,
  };
}

function buildSetups(analysis: NonNullable<ReturnType<typeof analyzeStructure>>, symbol: string, tf: string) {
  const setups: object[] = [];
  const { price, swingH, swingL, range, inDiscount, inPremium,
          discountLevel, premiumLevel, fvgs, obs,
          sslSwept, bslSwept, bslLevel, sslLevel,
          cisdBull, cisdBear, volumeCtx } = analysis;
  const minRR = (tf === '4h' || tf === 'd') ? 2.5 : 2.0;

  // SETUP 1: Bullish FVG Retest
  const bullFVGs = fvgs.filter(f => f.type === 'bull' && f.high < price && price - f.high < range * 0.2);
  for (const fvg of bullFVGs.slice(0, 1)) {
    if (!inDiscount) continue;
    const sl = fvg.low - range * 0.015;
    const tp = bslLevel;
    const rr = Math.abs(tp - fvg.high) / Math.abs(fvg.high - sl);
    if (rr < minRR) continue;
    setups.push({
      symbol, timeframe: tf, direction: 'bull', setup_type: 'FVG Retest',
      entry_low: +fvg.low.toFixed(2), entry_high: +fvg.high.toFixed(2),
      stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
      dol_target: `BSL at ${bslLevel.toFixed(symbol==='NQ'||symbol==='ES'?1:2)}`,
      htf_bias: 'bullish', cisd_confirmed: cisdBull,
      volume_context: volumeCtx, killzone_valid: 'NY,London', status: 'watching',
      confluence_score: Math.min(92, Math.round(60 + rr * 6 + (cisdBull?15:0) + (sslSwept?10:0))),
      correlated_align: true, market_section: ['BTC','ETH','SOL','BNB','XRP'].includes(symbol)?'crypto':['EURUSD','GBPUSD'].includes(symbol)?'forex':'futures',
    });
  }

  // SETUP 2: Bearish FVG Retest
  const bearFVGs = fvgs.filter(f => f.type === 'bear' && f.low > price && f.low - price < range * 0.2);
  for (const fvg of bearFVGs.slice(0, 1)) {
    if (!inPremium) continue;
    const sl = fvg.high + range * 0.015;
    const tp = sslLevel;
    const rr = Math.abs(fvg.low - tp) / Math.abs(sl - fvg.low);
    if (rr < minRR) continue;
    setups.push({
      symbol, timeframe: tf, direction: 'bear', setup_type: 'FVG Retest',
      entry_low: +fvg.low.toFixed(2), entry_high: +fvg.high.toFixed(2),
      stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
      dol_target: `SSL at ${sslLevel.toFixed(symbol==='NQ'||symbol==='ES'?1:2)}`,
      htf_bias: 'bearish', cisd_confirmed: cisdBear,
      volume_context: volumeCtx, killzone_valid: 'NY,London', status: 'watching',
      confluence_score: Math.min(92, Math.round(60 + rr * 6 + (cisdBear?15:0) + (bslSwept?10:0))),
      correlated_align: true, market_section: ['BTC','ETH','SOL','BNB','XRP'].includes(symbol)?'crypto':['EURUSD','GBPUSD'].includes(symbol)?'forex':'futures',
    });
  }

  // SETUP 3: OB + Liquidity Sweep
  if (sslSwept) {
    const bullOBs = obs.filter(o => o.type === 'bull' && o.high < price && price - o.high < range * 0.15);
    for (const ob of bullOBs.slice(0, 1)) {
      const sl = ob.low - range * 0.01;
      const tp = bslLevel;
      const rr = Math.abs(tp - ob.body_high) / Math.abs(ob.body_high - sl);
      if (rr < minRR) continue;
      setups.push({
        symbol, timeframe: tf, direction: 'bull', setup_type: 'OB + SSL Sweep',
        entry_low: +ob.body_low.toFixed(2), entry_high: +ob.body_high.toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `BSL at ${bslLevel.toFixed(symbol==='NQ'||symbol==='ES'?1:2)}`,
        htf_bias: 'bullish', cisd_confirmed: cisdBull,
        volume_context: volumeCtx, killzone_valid: 'NY,London,SB', status: 'watching',
        confluence_score: Math.min(95, Math.round(72 + rr * 5 + (cisdBull?12:0))),
        correlated_align: true, market_section: 'futures',
      });
    }
  }
  if (bslSwept) {
    const bearOBs = obs.filter(o => o.type === 'bear' && o.low > price && o.low - price < range * 0.15);
    for (const ob of bearOBs.slice(0, 1)) {
      const sl = ob.high + range * 0.01;
      const tp = sslLevel;
      const rr = Math.abs(ob.body_low - tp) / Math.abs(sl - ob.body_low);
      if (rr < minRR) continue;
      setups.push({
        symbol, timeframe: tf, direction: 'bear', setup_type: 'OB + BSL Sweep',
        entry_low: +ob.body_low.toFixed(2), entry_high: +ob.body_high.toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `SSL at ${sslLevel.toFixed(symbol==='NQ'||symbol==='ES'?1:2)}`,
        htf_bias: 'bearish', cisd_confirmed: cisdBear,
        volume_context: volumeCtx, killzone_valid: 'NY,London,SB', status: 'watching',
        confluence_score: Math.min(95, Math.round(72 + rr * 5 + (cisdBear?12:0))),
        correlated_align: true, market_section: 'futures',
      });
    }
  }

  // SETUP 4: CISD Confirmed Entry
  if (cisdBull && inDiscount) {
    const sl = swingL - range * 0.015;
    const tp = swingH;
    const entry = discountLevel;
    const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
    if (rr >= minRR) {
      setups.push({
        symbol, timeframe: tf, direction: 'bull', setup_type: 'CISD Entry',
        entry_low: +(entry - range*0.012).toFixed(2), entry_high: +(entry + range*0.012).toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `BSL at ${swingH.toFixed(symbol==='NQ'||symbol==='ES'?1:2)}`,
        htf_bias: 'bullish', cisd_confirmed: true,
        volume_context: volumeCtx, killzone_valid: 'NY,London', status: 'watching',
        confluence_score: Math.min(96, Math.round(78 + rr * 5)),
        correlated_align: true, market_section: ['BTC','ETH','SOL'].includes(symbol)?'crypto':'futures',
      });
    }
  }
  if (cisdBear && inPremium) {
    const sl = swingH + range * 0.015;
    const tp = swingL;
    const entry = premiumLevel;
    const rr = Math.abs(entry - tp) / Math.abs(sl - entry);
    if (rr >= minRR) {
      setups.push({
        symbol, timeframe: tf, direction: 'bear', setup_type: 'CISD Entry',
        entry_low: +(entry - range*0.012).toFixed(2), entry_high: +(entry + range*0.012).toFixed(2),
        stop_loss: +sl.toFixed(2), target: +tp.toFixed(2), rr_ratio: +rr.toFixed(2),
        dol_target: `SSL at ${swingL.toFixed(symbol==='NQ'||symbol==='ES'?1:2)}`,
        htf_bias: 'bearish', cisd_confirmed: true,
        volume_context: volumeCtx, killzone_valid: 'NY,London', status: 'watching',
        confluence_score: Math.min(96, Math.round(78 + rr * 5)),
        correlated_align: true, market_section: ['BTC','ETH','SOL'].includes(symbol)?'crypto':'futures',
      });
    }
  }

  return setups.slice(0, 3);
}

export async function POST(req: NextRequest) {
  try {
    const { symbols = ['NQ', 'ES'], timeframes = ['15m', '1h'] } = await req.json();
    const allDetected: object[] = [];
    const debugLog: string[] = [];

    for (const sym of symbols) {
      for (const tf of timeframes) {
        const candles = await fetchCandlesDirect(sym, tf);
        debugLog.push(`${sym}/${tf}: ${candles.length} candles`);
        if (candles.length < 30) { debugLog.push(`  → skipped (not enough candles)`); continue; }

        const analysis = analyzeStructure(candles, sym, tf);
        if (!analysis) { debugLog.push(`  → skipped (analysis failed)`); continue; }

        debugLog.push(`  → price=${analysis.price.toFixed(2)} ${analysis.inDiscount?'DISCOUNT':'PREMIUM'} | FVGs=${analysis.fvgs.length} OBs=${analysis.obs.length} sslSwept=${analysis.sslSwept} bslSwept=${analysis.bslSwept} cisdBull=${analysis.cisdBull} cisdBear=${analysis.cisdBear}`);

        const symSetups = buildSetups(analysis, sym, tf);
        debugLog.push(`  → ${symSetups.length} setups generated`);
        allDetected.push(...symSetups);
      }
    }

    if (allDetected.length === 0) {
      return NextResponse.json({
        setups: [], count: 0, debug: debugLog,
        message: 'No qualifying setups (R:R < 2.0 or price at midpoint). Try 4h timeframe or different symbols.',
      });
    }

    const expires = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const toInsert = allDetected.map(s => ({ ...(s as object), ai_analysis: '', invalidated_reason: '', expires_at: expires }));

    const { data, error } = await supabase.from('setups').insert(toInsert).select();
    if (error) {
      return NextResponse.json({ error: error.message, debug: debugLog, setups: [] }, { status: 500 });
    }

    return NextResponse.json({
      setups: data, count: data!.length, debug: debugLog,
      message: `${data!.length} ICT setup${data!.length !== 1 ? 's' : ''} detected (FVG retests, OB sweeps, CISD entries — all R:R ≥ 2.0)`
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), setups: [] }, { status: 500 });
  }
}
// build trigger Sat May 30 10:36:13 UTC 2026
