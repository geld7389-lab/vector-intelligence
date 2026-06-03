import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number; }

async function fetchCandlesDirect(symbol: string, tf: string): Promise<Candle[]> {
  try {
    const yahooMap: Record<string, string> = {
      'NQ': 'NQ=F', 'ES': 'ES=F', 'GC': 'GC=F', 'CL': 'CL=F',
      'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD',
      'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X',
      'SPY': 'SPY', 'QQQ': 'QQQ', 'AAPL': 'AAPL', 'NVDA': 'NVDA',
    };
    const ySym = yahooMap[symbol] ?? `${symbol}=F`;
    const intervalMap: Record<string,string> = { '15m':'15m', '1h':'60m', '4h':'1d', '1d':'1d' };
    const rangeMap: Record<string,string> = { '15m':'5d', '1h':'1mo', '4h':'3mo', '1d':'1y' };
    const interval = intervalMap[tf] ?? '60m';
    const range = rangeMap[tf] ?? '1mo';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    return ts.map((t, i) => ({ t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] }))
      .filter(c => c.o != null && c.h != null && c.l != null && c.c != null) as Candle[];
  } catch { return []; }
}

// Detect HTF bias from higher timeframe candles
function detectHTFBias(candles: Candle[]): 'bullish' | 'bearish' | 'neutral' {
  if (candles.length < 20) return 'neutral';
  const last20 = candles.slice(-20);
  const highs = last20.map(c => c.h);
  const lows = last20.map(c => c.l);
  // Check for higher highs and higher lows (bullish) or lower highs and lower lows (bearish)
  const hh = highs[highs.length-1] > highs[Math.floor(highs.length/2)];
  const hl = lows[lows.length-1] > lows[Math.floor(lows.length/2)];
  const lh = highs[highs.length-1] < highs[Math.floor(highs.length/2)];
  const ll = lows[lows.length-1] < lows[Math.floor(lows.length/2)];
  if (hh && hl) return 'bullish';
  if (lh && ll) return 'bearish';
  // EMA proxy: compare price to midpoint of range
  const range = Math.max(...highs) - Math.min(...lows);
  const mid = Math.min(...lows) + range / 2;
  const price = candles[candles.length-1].c;
  return price > mid ? 'bullish' : 'bearish';
}

function analyzeStructure(candles: Candle[], symbol: string, tf: string) {
  if (candles.length < 30) return null;
  const recent = candles.slice(-80);
  const price = recent[recent.length - 1].c;
  const highs = recent.map(c => c.h);
  const lows = recent.map(c => c.l);
  const range = Math.max(...highs) - Math.min(...lows);
  const mid = Math.min(...lows) + range / 2;
  const inDiscount = price < mid;

  // Fair Value Gaps
  const fvgs: { type: 'bull'|'bear'; high: number; low: number; idx: number }[] = [];
  for (let i = 1; i < recent.length - 1; i++) {
    const prev = recent[i-1], curr = recent[i], next = recent[i+1];
    // Bullish FVG: gap between prev candle high and next candle low
    if (next.l > prev.h && curr.c > curr.o) {
      fvgs.push({ type: 'bull', high: next.l, low: prev.h, idx: i });
    }
    // Bearish FVG: gap between next candle high and prev candle low
    if (next.h < prev.l && curr.c < curr.o) {
      fvgs.push({ type: 'bear', high: prev.l, low: next.h, idx: i });
    }
  }
  // Only unfilled FVGs (price hasn't crossed back through)
  const unfilledFVGs = fvgs.filter(f => {
    const laterCandles = recent.slice(f.idx + 2);
    if (f.type === 'bull') return !laterCandles.some(c => c.l < f.low);
    return !laterCandles.some(c => c.h > f.high);
  });

  // Order Blocks (last bearish candle before bullish impulse, vice versa)
  const obs: { type: 'bull'|'bear'; high: number; low: number; idx: number }[] = [];
  for (let i = 2; i < recent.length - 3; i++) {
    const c = recent[i];
    // Bullish OB: bearish candle followed by 3+ bullish candles that displace price up
    if (c.c < c.o) {
      const next3 = recent.slice(i+1, i+4);
      const displacement = next3.filter(x => x.c > x.o).length >= 2 && next3[next3.length-1].c > c.h;
      if (displacement) obs.push({ type: 'bull', high: c.h, low: c.l, idx: i });
    }
    // Bearish OB: bullish candle followed by 3+ bearish candles
    if (c.c > c.o) {
      const next3 = recent.slice(i+1, i+4);
      const displacement = next3.filter(x => x.c < x.o).length >= 2 && next3[next3.length-1].c < c.l;
      if (displacement) obs.push({ type: 'bear', high: c.h, low: c.l, idx: i });
    }
  }

  // Swing highs/lows (liquidity pools)
  const swingHighs: number[] = [], swingLows: number[] = [];
  for (let i = 3; i < recent.length - 3; i++) {
    const isHigh = recent.slice(i-3,i).every(c=>c.h<recent[i].h) && recent.slice(i+1,i+4).every(c=>c.h<recent[i].h);
    const isLow = recent.slice(i-3,i).every(c=>c.l>recent[i].l) && recent.slice(i+1,i+4).every(c=>c.l>recent[i].l);
    if (isHigh) swingHighs.push(recent[i].h);
    if (isLow) swingLows.push(recent[i].l);
  }
  const bslLevel = swingHighs.length ? Math.max(...swingHighs.slice(-3)) : price * 1.005;
  const sslLevel = swingLows.length ? Math.min(...swingLows.slice(-3)) : price * 0.995;

  // SSL/BSL sweeps in last 8 bars
  const last8 = recent.slice(-8);
  const sslSwept = last8.some(c => c.l < sslLevel) && recent[recent.length-1].c > sslLevel;
  const bslSwept = last8.some(c => c.h > bslLevel) && recent[recent.length-1].c < bslLevel;

  // CISD (Change in State of Delivery)
  const last5 = recent.slice(-5);
  const cisdBull = last5.some(c => c.c < c.o) && recent[recent.length-1].c > recent[recent.length-1].o &&
    recent[recent.length-1].c > last5[0].h;
  const cisdBear = last5.some(c => c.c > c.o) && recent[recent.length-1].c < recent[recent.length-1].o &&
    recent[recent.length-1].c < last5[0].l;

  // Volume context
  const avgVol = (recent.slice(-20).reduce((a,c) => a + (c.v??0), 0) / 20) || 1;
  const lastVol = recent[recent.length-1].v ?? 0;
  const volumeCtx = lastVol > avgVol * 1.5 ? 'high' : lastVol < avgVol * 0.7 ? 'low' : 'normal';

  // HTF bias from 1h candles (using price structure)
  const htfBias = detectHTFBias(recent);

  return { price, inDiscount, fvgs: unfilledFVGs, obs, sslSwept, bslSwept, sslLevel, bslLevel, cisdBull, cisdBear, volumeCtx, range, swingHighs, swingLows, htfBias };
}

function buildSetups(analysis: NonNullable<ReturnType<typeof analyzeStructure>>, symbol: string, tf: string, htfBias: 'bullish'|'bearish'|'neutral') {
  const { price, inDiscount, fvgs, obs, sslSwept, bslSwept, sslLevel, bslLevel, cisdBull, cisdBear, volumeCtx, range, htfBias: localBias } = analysis;
  const setups = [];
  const dec = symbol === 'NQ' || symbol === 'ES' ? 1 : symbol === 'BTC' ? 0 : 2;
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // MULTI-TF CONFIRMATION: only generate bull setups if HTF confirms bullish, etc.
  const htfAllowsBull = htfBias === 'bullish' || htfBias === 'neutral';
  const htfAllowsBear = htfBias === 'bearish' || htfBias === 'neutral';

  // SETUP 1: Bullish FVG Retest (must be in discount zone AND HTF allows)
  if (htfAllowsBull && inDiscount) {
    const bullFVGs = fvgs.filter(f => f.type === 'bull' && f.high < price && price - f.high < range * 0.25);
    for (const fvg of bullFVGs.slice(0, 1)) {
      const entry_low = fvg.low, entry_high = fvg.high;
      const stop_loss = +(entry_low - range * 0.04).toFixed(dec);
      const target = +bslLevel.toFixed(dec);
      const rr = Math.abs(target - entry_high) / Math.abs(entry_low - stop_loss);
      if (rr < 2.0) continue;
      setups.push({
        symbol, timeframe: tf, direction: 'bull', setup_type: 'FVG Retest',
        entry_low: +entry_low.toFixed(dec), entry_high: +entry_high.toFixed(dec),
        stop_loss, target, rr_ratio: +rr.toFixed(2),
        dol_target: `BSL at ${bslLevel.toFixed(dec)}`,
        htf_bias: htfBias === 'neutral' ? localBias : htfBias,
        cisd_confirmed: cisdBull, volume_context: volumeCtx,
        killzone_valid: 'NY,London,SB', status: 'watching',
        confluence_score: Math.min(92, Math.round(58 + rr * 5 + (cisdBull?18:0) + (sslSwept?12:0) + (htfBias==='bullish'?8:0) + (volumeCtx==='high'?4:0))),
        market_section: 'futures', correlated_align: htfBias === 'bullish',
        expires_at: expiry, ai_analysis: ''
      });
    }
  }

  // SETUP 2: Bearish FVG Retest (must be in premium AND HTF allows)
  if (htfAllowsBear && !inDiscount) {
    const bearFVGs = fvgs.filter(f => f.type === 'bear' && f.low > price && f.low - price < range * 0.25);
    for (const fvg of bearFVGs.slice(0, 1)) {
      const entry_low = fvg.low, entry_high = fvg.high;
      const stop_loss = +(entry_high + range * 0.04).toFixed(dec);
      const target = +sslLevel.toFixed(dec);
      const rr = Math.abs(entry_low - target) / Math.abs(stop_loss - entry_high);
      if (rr < 2.0) continue;
      setups.push({
        symbol, timeframe: tf, direction: 'bear', setup_type: 'FVG Retest',
        entry_low: +entry_low.toFixed(dec), entry_high: +entry_high.toFixed(dec),
        stop_loss, target, rr_ratio: +rr.toFixed(2),
        dol_target: `SSL at ${sslLevel.toFixed(dec)}`,
        htf_bias: htfBias === 'neutral' ? localBias : htfBias,
        cisd_confirmed: cisdBear, volume_context: volumeCtx,
        killzone_valid: 'NY,London', status: 'watching',
        confluence_score: Math.min(92, Math.round(58 + rr * 5 + (cisdBear?18:0) + (bslSwept?12:0) + (htfBias==='bearish'?8:0) + (volumeCtx==='high'?4:0))),
        market_section: 'futures', correlated_align: htfBias === 'bearish',
        expires_at: expiry, ai_analysis: ''
      });
    }
  }

  // SETUP 3: OB + Liquidity Sweep (strong, high confluence)
  if (sslSwept && htfAllowsBull) {
    const bullOBs = obs.filter(o => o.type === 'bull' && o.high < price && price - o.high < range * 0.18);
    for (const ob of bullOBs.slice(0, 1)) {
      const stop_loss = +(ob.low - range * 0.025).toFixed(dec);
      const target = +bslLevel.toFixed(dec);
      const rr = Math.abs(target - ob.high) / Math.abs(ob.low - stop_loss);
      if (rr < 2.0) continue;
      setups.push({
        symbol, timeframe: tf, direction: 'bull', setup_type: 'OB + SSL Sweep',
        entry_low: +ob.low.toFixed(dec), entry_high: +ob.high.toFixed(dec),
        stop_loss, target, rr_ratio: +rr.toFixed(2),
        dol_target: `BSL at ${bslLevel.toFixed(dec)}`,
        htf_bias: htfBias === 'neutral' ? localBias : htfBias,
        cisd_confirmed: cisdBull, volume_context: volumeCtx,
        killzone_valid: 'NY,London,SB', status: 'watching',
        confluence_score: Math.min(96, Math.round(70 + rr * 4 + (cisdBull?14:0) + (htfBias==='bullish'?8:0) + (volumeCtx==='high'?4:0))),
        market_section: 'futures', correlated_align: htfBias === 'bullish',
        expires_at: expiry, ai_analysis: ''
      });
    }
  }
  if (bslSwept && htfAllowsBear) {
    const bearOBs = obs.filter(o => o.type === 'bear' && o.low > price && o.low - price < range * 0.18);
    for (const ob of bearOBs.slice(0, 1)) {
      const stop_loss = +(ob.high + range * 0.025).toFixed(dec);
      const target = +sslLevel.toFixed(dec);
      const rr = Math.abs(ob.low - target) / Math.abs(stop_loss - ob.high);
      if (rr < 2.0) continue;
      setups.push({
        symbol, timeframe: tf, direction: 'bear', setup_type: 'OB + BSL Sweep',
        entry_low: +ob.low.toFixed(dec), entry_high: +ob.high.toFixed(dec),
        stop_loss, target, rr_ratio: +rr.toFixed(2),
        dol_target: `SSL at ${sslLevel.toFixed(dec)}`,
        htf_bias: htfBias === 'neutral' ? localBias : htfBias,
        cisd_confirmed: cisdBear, volume_context: volumeCtx,
        killzone_valid: 'NY,London', status: 'watching',
        confluence_score: Math.min(96, Math.round(70 + rr * 4 + (cisdBear?14:0) + (htfBias==='bearish'?8:0) + (volumeCtx==='high'?4:0))),
        market_section: 'futures', correlated_align: htfBias === 'bearish',
        expires_at: expiry, ai_analysis: ''
      });
    }
  }

  // SETUP 4: CISD Confirmed Entry (highest confidence, any zone)
  const swingH = analysis.swingHighs.slice(-1)[0] ?? price * 1.01;
  const swingL = analysis.swingLows.slice(-1)[0] ?? price * 0.99;
  if (cisdBull && htfAllowsBull) {
    const stop_loss = +(swingL - range * 0.02).toFixed(dec);
    const target = +bslLevel.toFixed(dec);
    const entryH = +(price + range * 0.01).toFixed(dec);
    const rr = Math.abs(target - entryH) / Math.abs(price - stop_loss);
    if (rr >= 2.0) {
      setups.push({
        symbol, timeframe: tf, direction: 'bull', setup_type: 'CISD Entry',
        entry_low: +price.toFixed(dec), entry_high: entryH,
        stop_loss, target, rr_ratio: +rr.toFixed(2),
        dol_target: `BSL at ${bslLevel.toFixed(dec)}`,
        htf_bias: htfBias === 'neutral' ? localBias : htfBias,
        cisd_confirmed: true, volume_context: volumeCtx,
        killzone_valid: 'NY,London,SB', status: 'watching',
        confluence_score: Math.min(97, Math.round(76 + rr * 4 + (sslSwept?12:0) + (htfBias==='bullish'?8:0))),
        market_section: 'futures', correlated_align: true,
        expires_at: expiry, ai_analysis: ''
      });
    }
  }
  if (cisdBear && htfAllowsBear) {
    const stop_loss = +(swingH + range * 0.02).toFixed(dec);
    const target = +sslLevel.toFixed(dec);
    const entryL = +(price - range * 0.01).toFixed(dec);
    const rr = Math.abs(entryL - target) / Math.abs(stop_loss - price);
    if (rr >= 2.0) {
      setups.push({
        symbol, timeframe: tf, direction: 'bear', setup_type: 'CISD Entry',
        entry_low: entryL, entry_high: +price.toFixed(dec),
        stop_loss, target, rr_ratio: +rr.toFixed(2),
        dol_target: `SSL at ${sslLevel.toFixed(dec)}`,
        htf_bias: htfBias === 'neutral' ? localBias : htfBias,
        cisd_confirmed: true, volume_context: volumeCtx,
        killzone_valid: 'NY,London', status: 'watching',
        confluence_score: Math.min(97, Math.round(76 + rr * 4 + (bslSwept?12:0) + (htfBias==='bearish'?8:0))),
        market_section: 'futures', correlated_align: true,
        expires_at: expiry, ai_analysis: ''
      });
    }
  }

  return setups;
}

export async function POST(req: NextRequest) {
  try {
    const { symbols = ['NQ', 'ES'], timeframes = ['15m', '1h'], currentPrices } = await req.json();
    const debugLog: string[] = [];
    let totalSaved = 0;

    for (const sym of symbols) {
      for (const tf of timeframes) {
        debugLog.push(`Scanning ${sym} ${tf}...`);
        
        // Fetch LTF candles
        const candles = await fetchCandlesDirect(sym, tf);
        if (candles.length < 30) { debugLog.push(`  → insufficient data (${candles.length} candles)`); continue; }

        // Fetch HTF candles for bias confirmation
        const htfTf = tf === '15m' ? '1h' : tf === '1h' ? '4h' : '1d';
        const htfCandles = await fetchCandlesDirect(sym, htfTf);
        const htfBias = htfCandles.length > 20 ? detectHTFBias(htfCandles) : 'neutral';
        debugLog.push(`  → HTF (${htfTf}) bias: ${htfBias}`);

        const analysis = analyzeStructure(candles, sym, tf);
        if (!analysis) { debugLog.push(`  → analysis failed`); continue; }

        debugLog.push(`  → price=${analysis.price.toFixed(2)} ${analysis.inDiscount?'DISCOUNT':'PREMIUM'} | FVGs=${analysis.fvgs.length} OBs=${analysis.obs.length} ssl=${analysis.sslSwept} bsl=${analysis.bslSwept} cisd↑=${analysis.cisdBull} cisd↓=${analysis.cisdBear} htf=${htfBias}`);

        const newSetups = buildSetups(analysis, sym, tf, htfBias);
        debugLog.push(`  → ${newSetups.length} setups generated`);

        for (const setup of newSetups) {
          // Check for duplicate (same symbol+tf+direction+type in last 6h)
          const { data: existing } = await supabase.from('setups')
            .select('id').eq('symbol', sym).eq('timeframe', tf)
            .eq('direction', setup.direction).eq('setup_type', setup.setup_type)
            .gte('created_at', new Date(Date.now() - 6*60*60*1000).toISOString())
            .limit(1);
          if (existing && existing.length > 0) {
            debugLog.push(`  → duplicate skipped: ${setup.direction} ${setup.setup_type}`);
            continue;
          }
          const { error } = await supabase.from('setups').insert(setup);
          if (!error) { totalSaved++; debugLog.push(`  → SAVED: ${setup.direction} ${setup.setup_type} RR=${setup.rr_ratio} score=${setup.confluence_score}`); }
          else debugLog.push(`  → DB error: ${error.message}`);
        }
      }
    }

    return NextResponse.json({ message: totalSaved > 0 ? `${totalSaved} setup${totalSaved>1?'s':''} found and saved` : 'No qualifying setups this scan', count: totalSaved, debug: debugLog });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
