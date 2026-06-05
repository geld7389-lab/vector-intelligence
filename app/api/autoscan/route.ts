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
    const yahooMap: Record<string,string> = {
      NQ:'NQ=F', ES:'ES=F', GC:'GC=F', CL:'CL=F',
      BTC:'BTC-USD', ETH:'ETH-USD', SOL:'SOL-USD',
      EURUSD:'EURUSD=X', GBPUSD:'GBPUSD=X',
      SPY:'SPY', QQQ:'QQQ', AAPL:'AAPL', NVDA:'NVDA',
    };
    const ySym = yahooMap[symbol] ?? `${symbol}=F`;
    const intervalMap: Record<string,string> = { '15m':'15m','1h':'60m','4h':'1d','1d':'1d' };
    const rangeMap: Record<string,string> = { '15m':'5d','1h':'1mo','4h':'3mo','1d':'1y' };
    const interval = intervalMap[tf] ?? '60m';
    const range = rangeMap[tf] ?? '1mo';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0' }, cache:'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    return ts.map((t,i) => ({ t:t*1000, o:q.open?.[i], h:q.high?.[i], l:q.low?.[i], c:q.close?.[i], v:q.volume?.[i] }))
      .filter(c => c.o != null && c.h != null && c.l != null && c.c != null) as Candle[];
  } catch { return []; }
}

function detectHTFBias(candles: Candle[]): 'bullish'|'bearish'|'neutral' {
  if (candles.length < 20) return 'neutral';
  const last = candles.slice(-20);
  const highs = last.map(c => c.h), lows = last.map(c => c.l);
  const mid = candles.length / 2;
  const hh = highs[highs.length-1] > highs[Math.floor(mid)];
  const hl = lows[lows.length-1] > lows[Math.floor(mid)];
  const lh = highs[highs.length-1] < highs[Math.floor(mid)];
  const ll = lows[lows.length-1] < lows[Math.floor(mid)];
  if (hh && hl) return 'bullish';
  if (lh && ll) return 'bearish';
  const range = Math.max(...highs) - Math.min(...lows);
  const midP = Math.min(...lows) + range / 2;
  return candles[candles.length-1].c > midP ? 'bullish' : 'bearish';
}

// ── BOS / CHoCH Detection ──────────────────────
function detectBOSCHoCH(candles: Candle[], lookback = 5): {
  bos: { level: number; direction: 'bull'|'bear'; idx: number }[];
  choch: { level: number; direction: 'bull'|'bear'; idx: number }[];
} {
  const bos: { level:number; direction:'bull'|'bear'; idx:number }[] = [];
  const choch: { level:number; direction:'bull'|'bear'; idx:number }[] = [];
  
  let lastSwingHigh = 0, lastSwingLow = Infinity;
  let trend: 'bull'|'bear'|null = null;

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    const prevHigh = Math.max(...candles.slice(i-lookback,i).map(x=>x.h));
    const prevLow = Math.min(...candles.slice(i-lookback,i).map(x=>x.l));

    // BOS Bull: close above previous swing high (continuation)
    if (c.c > prevHigh && trend === 'bull') {
      bos.push({ level: prevHigh, direction: 'bull', idx: i });
      lastSwingHigh = prevHigh;
    }
    // BOS Bear: close below previous swing low (continuation)
    if (c.c < prevLow && trend === 'bear') {
      bos.push({ level: prevLow, direction: 'bear', idx: i });
      lastSwingLow = prevLow;
    }
    // CHoCH Bull→Bear: close below swing low when trend was bull
    if (c.c < prevLow && trend === 'bull') {
      choch.push({ level: prevLow, direction: 'bear', idx: i });
      trend = 'bear';
    }
    // CHoCH Bear→Bull: close above swing high when trend was bear
    if (c.c > prevHigh && trend === 'bear') {
      choch.push({ level: prevHigh, direction: 'bull', idx: i });
      trend = 'bull';
    }
    // Init trend
    if (trend === null) {
      if (c.c > prevHigh) trend = 'bull';
      else if (c.c < prevLow) trend = 'bear';
    }
  }
  return { bos: bos.slice(-3), choch: choch.slice(-3) };
}

// ── Breaker Block Detection ────────────────────
function detectBreakerBlocks(candles: Candle[]): {
  type:'bull'|'bear'; high:number; low:number; idx:number; isBreaker:boolean
}[] {
  const breakers: { type:'bull'|'bear'; high:number; low:number; idx:number; isBreaker:boolean }[] = [];

  for (let i = 2; i < candles.length - 5; i++) {
    const c = candles[i];
    // Bullish breaker: was bearish OB, price broke through it (bearish→bullish flip)
    if (c.c < c.o) { // bearish candle
      const next3 = candles.slice(i+1,i+4);
      const brokeThrough = next3.some(x => x.c > c.h); // price broke above = OB mitigated
      if (brokeThrough) {
        // Now this broken OB becomes a breaker (support on retest)
        breakers.push({ type:'bull', high:c.h, low:c.l, idx:i, isBreaker:true });
      }
    }
    // Bearish breaker: was bullish OB, price broke through it
    if (c.c > c.o) { // bullish candle
      const next3 = candles.slice(i+1,i+4);
      const brokeThrough = next3.some(x => x.c < c.l);
      if (brokeThrough) {
        breakers.push({ type:'bear', high:c.h, low:c.l, idx:i, isBreaker:true });
      }
    }
  }
  return breakers.slice(-4);
}

function analyzeStructure(candles: Candle[], symbol: string, tf: string) {
  if (candles.length < 30) return null;
  const recent = candles.slice(-100);
  const price = recent[recent.length-1].c;
  const highs = recent.map(c=>c.h), lows = recent.map(c=>c.l);
  const range = Math.max(...highs) - Math.min(...lows);
  const mid = Math.min(...lows) + range/2;
  const inDiscount = price < mid;

  // FVGs
  const fvgs: {type:'bull'|'bear';high:number;low:number;idx:number}[] = [];
  for (let i=1;i<recent.length-1;i++) {
    const prev=recent[i-1],curr=recent[i],next=recent[i+1];
    if (next.l>prev.h && curr.c>curr.o) fvgs.push({type:'bull',high:next.l,low:prev.h,idx:i});
    if (next.h<prev.l && curr.c<curr.o) fvgs.push({type:'bear',high:prev.l,low:next.h,idx:i});
  }
  const unfilledFVGs = fvgs.filter(f => {
    const later = recent.slice(f.idx+2);
    return f.type==='bull' ? !later.some(c=>c.l<f.low) : !later.some(c=>c.h>f.high);
  });

  // OBs
  const obs: {type:'bull'|'bear';high:number;low:number;idx:number}[] = [];
  for (let i=2;i<recent.length-3;i++) {
    const c=recent[i];
    if (c.c<c.o) {
      const next3=recent.slice(i+1,i+4);
      if (next3.filter(x=>x.c>x.o).length>=2 && next3[next3.length-1].c>c.h)
        obs.push({type:'bull',high:c.h,low:c.l,idx:i});
    }
    if (c.c>c.o) {
      const next3=recent.slice(i+1,i+4);
      if (next3.filter(x=>x.c<x.o).length>=2 && next3[next3.length-1].c<c.l)
        obs.push({type:'bear',high:c.h,low:c.l,idx:i});
    }
  }

  // Swing highs/lows
  const swingHighs: number[]=[], swingLows: number[]=[];
  for (let i=3;i<recent.length-3;i++) {
    if (recent.slice(i-3,i).every(c=>c.h<recent[i].h) && recent.slice(i+1,i+4).every(c=>c.h<recent[i].h)) swingHighs.push(recent[i].h);
    if (recent.slice(i-3,i).every(c=>c.l>recent[i].l) && recent.slice(i+1,i+4).every(c=>c.l>recent[i].l)) swingLows.push(recent[i].l);
  }
  const bslLevel = swingHighs.length ? Math.max(...swingHighs.slice(-3)) : price*1.005;
  const sslLevel = swingLows.length ? Math.min(...swingLows.slice(-3)) : price*0.995;

  const last8=recent.slice(-8);
  const sslSwept = last8.some(c=>c.l<sslLevel) && recent[recent.length-1].c>sslLevel;
  const bslSwept = last8.some(c=>c.h>bslLevel) && recent[recent.length-1].c<bslLevel;

  const last5=recent.slice(-5);
  const cisdBull = last5.some(c=>c.c<c.o) && recent[recent.length-1].c>recent[recent.length-1].o && recent[recent.length-1].c>last5[0].h;
  const cisdBear = last5.some(c=>c.c>c.o) && recent[recent.length-1].c<recent[recent.length-1].o && recent[recent.length-1].c<last5[0].l;

  const avgVol = (recent.slice(-20).reduce((a,c)=>a+(c.v??0),0)/20)||1;
  const lastVol = recent[recent.length-1].v??0;
  const volumeCtx = lastVol>avgVol*1.5?'high':lastVol<avgVol*0.7?'low':'normal';
  const htfBias = detectHTFBias(recent);

  // BOS / CHoCH
  const { bos, choch } = detectBOSCHoCH(recent);
  const breakers = detectBreakerBlocks(recent);

  return { price, inDiscount, fvgs:unfilledFVGs, obs, sslSwept, bslSwept, sslLevel, bslLevel,
    cisdBull, cisdBear, volumeCtx, range, swingHighs, swingLows, htfBias,
    bos, choch, breakers };
}

function buildSetups(
  analysis: NonNullable<ReturnType<typeof analyzeStructure>>,
  symbol: string, tf: string,
  htfBias: 'bullish'|'bearish'|'neutral',
  userBias?: string
) {
  const { price, inDiscount, fvgs, obs, sslSwept, bslSwept, sslLevel, bslLevel,
    cisdBull, cisdBear, volumeCtx, range, swingHighs, swingLows, htfBias:localBias,
    bos, choch, breakers } = analysis;

  const setups: any[] = [];
  const dec = (symbol==='NQ'||symbol==='ES') ? 1 : symbol==='BTC' ? 0 : 2;
  const expiry = new Date(Date.now()+24*60*60*1000).toISOString();

  // User bias overrides HTF detection
  const effectiveBias = userBias ? userBias : htfBias;
  const htfAllowsBull = effectiveBias==='bullish'||effectiveBias==='neutral';
  const htfAllowsBear = effectiveBias==='bearish'||effectiveBias==='neutral';

  // Latest BOS/CHoCH for tagging
  const lastBOS = bos.slice(-1)[0];
  const lastCHoCH = choch.slice(-1)[0];

  const scoreBase = (rr:number, cisd:boolean, swept:boolean, bias:boolean, vol:string, isBrk=false) =>
    Math.min(97, Math.round(58 + rr*5 + (cisd?18:0) + (swept?12:0) + (bias?8:0) + (vol==='high'?4:0) + (isBrk?6:0)));

  // SETUP 1: Bullish FVG Retest
  if (htfAllowsBull && inDiscount) {
    const bullFVGs = fvgs.filter(f=>f.type==='bull'&&f.high<price&&price-f.high<range*0.25);
    for (const fvg of bullFVGs.slice(0,1)) {
      const sl = +(fvg.low-range*0.04).toFixed(dec);
      const tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp-fvg.high)/Math.abs(fvg.low-sl);
      if (rr<2.0) continue;
      setups.push({ symbol,timeframe:tf,direction:'bull',setup_type:'FVG Retest',
        entry_low:+fvg.low.toFixed(dec),entry_high:+fvg.high.toFixed(dec),stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
        dol_target:`BSL at ${bslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:cisdBull,
        volume_context:volumeCtx,killzone_valid:'NY,London,SB',status:'watching',
        confluence_score:scoreBase(rr,cisdBull,sslSwept,effectiveBias==='bullish',volumeCtx),
        market_section:'futures',correlated_align:effectiveBias==='bullish',expires_at:expiry,ai_analysis:'',
        bos_level:lastBOS?.direction==='bull'?lastBOS.level:null,
        choch_level:lastCHoCH?.direction==='bull'?lastCHoCH.level:null });
    }
  }

  // SETUP 2: Bearish FVG Retest
  if (htfAllowsBear && !inDiscount) {
    const bearFVGs = fvgs.filter(f=>f.type==='bear'&&f.low>price&&f.low-price<range*0.25);
    for (const fvg of bearFVGs.slice(0,1)) {
      const sl = +(fvg.high+range*0.04).toFixed(dec);
      const tp = +sslLevel.toFixed(dec);
      const rr = Math.abs(fvg.low-tp)/Math.abs(sl-fvg.high);
      if (rr<2.0) continue;
      setups.push({ symbol,timeframe:tf,direction:'bear',setup_type:'FVG Retest',
        entry_low:+fvg.low.toFixed(dec),entry_high:+fvg.high.toFixed(dec),stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
        dol_target:`SSL at ${sslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:cisdBear,
        volume_context:volumeCtx,killzone_valid:'NY,London',status:'watching',
        confluence_score:scoreBase(rr,cisdBear,bslSwept,effectiveBias==='bearish',volumeCtx),
        market_section:'futures',correlated_align:effectiveBias==='bearish',expires_at:expiry,ai_analysis:'',
        bos_level:lastBOS?.direction==='bear'?lastBOS.level:null,
        choch_level:lastCHoCH?.direction==='bear'?lastCHoCH.level:null });
    }
  }

  // SETUP 3: OB + Liquidity Sweep
  if (sslSwept && htfAllowsBull) {
    const bullOBs = obs.filter(o=>o.type==='bull'&&o.high<price&&price-o.high<range*0.18);
    for (const ob of bullOBs.slice(0,1)) {
      const sl = +(ob.low-range*0.025).toFixed(dec);
      const tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp-ob.high)/Math.abs(ob.low-sl);
      if (rr<2.0) continue;
      setups.push({ symbol,timeframe:tf,direction:'bull',setup_type:'OB + SSL Sweep',
        entry_low:+ob.low.toFixed(dec),entry_high:+ob.high.toFixed(dec),stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
        dol_target:`BSL at ${bslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:cisdBull,
        volume_context:volumeCtx,killzone_valid:'NY,London,SB',status:'watching',
        confluence_score:Math.min(96,Math.round(70+rr*4+(cisdBull?14:0)+(effectiveBias==='bullish'?8:0)+(volumeCtx==='high'?4:0))),
        market_section:'futures',correlated_align:true,expires_at:expiry,ai_analysis:'',
        bos_level:lastBOS?.level??null,choch_level:lastCHoCH?.level??null });
    }
  }
  if (bslSwept && htfAllowsBear) {
    const bearOBs = obs.filter(o=>o.type==='bear'&&o.low>price&&o.low-price<range*0.18);
    for (const ob of bearOBs.slice(0,1)) {
      const sl = +(ob.high+range*0.025).toFixed(dec);
      const tp = +sslLevel.toFixed(dec);
      const rr = Math.abs(ob.low-tp)/Math.abs(sl-ob.high);
      if (rr<2.0) continue;
      setups.push({ symbol,timeframe:tf,direction:'bear',setup_type:'OB + BSL Sweep',
        entry_low:+ob.low.toFixed(dec),entry_high:+ob.high.toFixed(dec),stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
        dol_target:`SSL at ${sslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:cisdBear,
        volume_context:volumeCtx,killzone_valid:'NY,London',status:'watching',
        confluence_score:Math.min(96,Math.round(70+rr*4+(cisdBear?14:0)+(effectiveBias==='bearish'?8:0)+(volumeCtx==='high'?4:0))),
        market_section:'futures',correlated_align:true,expires_at:expiry,ai_analysis:'',
        bos_level:lastBOS?.level??null,choch_level:lastCHoCH?.level??null });
    }
  }

  // SETUP 4: CISD Entry
  const swingH = analysis.swingHighs.slice(-1)[0]??price*1.01;
  const swingL = analysis.swingLows.slice(-1)[0]??price*0.99;
  if (cisdBull && htfAllowsBull) {
    const sl = +(swingL-range*0.02).toFixed(dec);
    const tp = +bslLevel.toFixed(dec);
    const eH = +(price+range*0.01).toFixed(dec);
    const rr = Math.abs(tp-eH)/Math.abs(price-sl);
    if (rr>=2.0) setups.push({ symbol,timeframe:tf,direction:'bull',setup_type:'CISD Entry',
      entry_low:+price.toFixed(dec),entry_high:eH,stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
      dol_target:`BSL at ${bslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:true,
      volume_context:volumeCtx,killzone_valid:'NY,London,SB',status:'watching',
      confluence_score:Math.min(97,Math.round(76+rr*4+(sslSwept?12:0)+(effectiveBias==='bullish'?8:0))),
      market_section:'futures',correlated_align:true,expires_at:expiry,ai_analysis:'',
      bos_level:lastBOS?.level??null,choch_level:lastCHoCH?.level??null });
  }
  if (cisdBear && htfAllowsBear) {
    const sl = +(swingH+range*0.02).toFixed(dec);
    const tp = +sslLevel.toFixed(dec);
    const eL = +(price-range*0.01).toFixed(dec);
    const rr = Math.abs(eL-tp)/Math.abs(sl-price);
    if (rr>=2.0) setups.push({ symbol,timeframe:tf,direction:'bear',setup_type:'CISD Entry',
      entry_low:eL,entry_high:+price.toFixed(dec),stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
      dol_target:`SSL at ${sslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:true,
      volume_context:volumeCtx,killzone_valid:'NY,London',status:'watching',
      confluence_score:Math.min(97,Math.round(76+rr*4+(bslSwept?12:0)+(effectiveBias==='bearish'?8:0))),
      market_section:'futures',correlated_align:true,expires_at:expiry,ai_analysis:'',
      bos_level:lastBOS?.level??null,choch_level:lastCHoCH?.level??null });
  }

  // SETUP 5: Breaker Block Retest (new)
  for (const brk of breakers.slice(-2)) {
    if (brk.type==='bull' && htfAllowsBull && brk.high<price && price-brk.high<range*0.2) {
      const sl = +(brk.low-range*0.025).toFixed(dec);
      const tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp-brk.high)/Math.abs(brk.low-sl);
      if (rr<2.0) continue;
      setups.push({ symbol,timeframe:tf,direction:'bull',setup_type:'Breaker Block',
        entry_low:+brk.low.toFixed(dec),entry_high:+brk.high.toFixed(dec),stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
        dol_target:`BSL at ${bslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:cisdBull,
        volume_context:volumeCtx,killzone_valid:'NY,London,SB',status:'watching',
        confluence_score:scoreBase(rr,cisdBull,sslSwept,effectiveBias==='bullish',volumeCtx,true),
        market_section:'futures',correlated_align:effectiveBias==='bullish',expires_at:expiry,ai_analysis:'',
        bos_level:lastBOS?.level??null,choch_level:lastCHoCH?.level??null });
    }
    if (brk.type==='bear' && htfAllowsBear && brk.low>price && brk.low-price<range*0.2) {
      const sl = +(brk.high+range*0.025).toFixed(dec);
      const tp = +sslLevel.toFixed(dec);
      const rr = Math.abs(brk.low-tp)/Math.abs(sl-brk.high);
      if (rr<2.0) continue;
      setups.push({ symbol,timeframe:tf,direction:'bear',setup_type:'Breaker Block',
        entry_low:+brk.low.toFixed(dec),entry_high:+brk.high.toFixed(dec),stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
        dol_target:`SSL at ${sslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:cisdBear,
        volume_context:volumeCtx,killzone_valid:'NY,London',status:'watching',
        confluence_score:scoreBase(rr,cisdBear,bslSwept,effectiveBias==='bearish',volumeCtx,true),
        market_section:'futures',correlated_align:effectiveBias==='bearish',expires_at:expiry,ai_analysis:'',
        bos_level:lastBOS?.level??null,choch_level:lastCHoCH?.level??null });
    }
  }

  // SETUP 6: CHoCH + PD Array (highest conviction reversal)
  if (lastCHoCH?.direction==='bull' && htfAllowsBull) {
    const nearOB = obs.find(o=>o.type==='bull'&&o.high<price&&price-o.high<range*0.15);
    if (nearOB) {
      const sl = +(nearOB.low-range*0.02).toFixed(dec);
      const tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp-nearOB.high)/Math.abs(nearOB.low-sl);
      if (rr>=2.0) setups.push({ symbol,timeframe:tf,direction:'bull',setup_type:'CHoCH + OB',
        entry_low:+nearOB.low.toFixed(dec),entry_high:+nearOB.high.toFixed(dec),stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
        dol_target:`BSL at ${bslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:true,
        volume_context:volumeCtx,killzone_valid:'NY,London,SB',status:'watching',
        confluence_score:Math.min(97,Math.round(80+rr*3+(sslSwept?10:0)+(effectiveBias==='bullish'?7:0))),
        market_section:'futures',correlated_align:true,expires_at:expiry,ai_analysis:'',
        bos_level:null,choch_level:lastCHoCH.level });
    }
  }
  if (lastCHoCH?.direction==='bear' && htfAllowsBear) {
    const nearOB = obs.find(o=>o.type==='bear'&&o.low>price&&o.low-price<range*0.15);
    if (nearOB) {
      const sl = +(nearOB.high+range*0.02).toFixed(dec);
      const tp = +sslLevel.toFixed(dec);
      const rr = Math.abs(nearOB.low-tp)/Math.abs(sl-nearOB.high);
      if (rr>=2.0) setups.push({ symbol,timeframe:tf,direction:'bear',setup_type:'CHoCH + OB',
        entry_low:+nearOB.low.toFixed(dec),entry_high:+nearOB.high.toFixed(dec),stop_loss:sl,target:tp,rr_ratio:+rr.toFixed(2),
        dol_target:`SSL at ${sslLevel.toFixed(dec)}`,htf_bias:effectiveBias,cisd_confirmed:true,
        volume_context:volumeCtx,killzone_valid:'NY,London',status:'watching',
        confluence_score:Math.min(97,Math.round(80+rr*3+(bslSwept?10:0)+(effectiveBias==='bearish'?7:0))),
        market_section:'futures',correlated_align:true,expires_at:expiry,ai_analysis:'',
        bos_level:null,choch_level:lastCHoCH.level });
    }
  }

  return setups;
}

export async function POST(req: NextRequest) {
  try {
    const { symbols=['NQ','ES'], timeframes=['15m','1h'], currentPrices } = await req.json();
    const debugLog: string[] = [];
    let totalSaved = 0;

    // Fetch user weekly biases to override HTF detection
    const { data: biasRows } = await supabase.from('weekly_bias').select('symbol,bias').order('created_at',{ascending:false});
    const userBiases: Record<string,string> = {};
    (biasRows ?? []).forEach((b: any) => { if (!userBiases[b.symbol]) userBiases[b.symbol] = b.bias; });

    for (const sym of symbols) {
      for (const tf of timeframes) {
        debugLog.push(`Scanning ${sym} ${tf}...`);
        const candles = await fetchCandles(sym, tf);
        if (candles.length < 30) { debugLog.push(`  → insufficient data (${candles.length})`); continue; }

        const htfTf = tf==='15m'?'1h':tf==='1h'?'4h':'1d';
        const htfCandles = await fetchCandles(sym, htfTf);
        const htfBias = htfCandles.length>20 ? detectHTFBias(htfCandles) : 'neutral';
        const userBias = userBiases[sym];
        if (userBias) debugLog.push(`  → User bias override: ${userBias} (was ${htfBias})`);
        else debugLog.push(`  → HTF bias: ${htfBias}`);

        const analysis = analyzeStructure(candles, sym, tf);
        if (!analysis) { debugLog.push(`  → analysis failed`); continue; }

        const { bos, choch } = analysis;
        debugLog.push(`  → price=${analysis.price.toFixed(2)} ${analysis.inDiscount?'DISCOUNT':'PREMIUM'} FVGs=${analysis.fvgs.length} OBs=${analysis.obs.length} BOS=${bos.length} CHoCH=${choch.length} ssl=${analysis.sslSwept} cisd↑=${analysis.cisdBull} cisd↓=${analysis.cisdBear}`);

        const newSetups = buildSetups(analysis, sym, tf, htfBias as 'bullish'|'bearish'|'neutral', userBias);
        debugLog.push(`  → ${newSetups.length} setups generated`);

        for (const setup of newSetups) {
          const { data: existing } = await supabase.from('setups').select('id')
            .eq('symbol',sym).eq('timeframe',tf).eq('direction',setup.direction).eq('setup_type',setup.setup_type)
            .gte('created_at',new Date(Date.now()-6*60*60*1000).toISOString()).limit(1);
          if (existing && existing.length>0) { debugLog.push(`  → dup skipped: ${setup.direction} ${setup.setup_type}`); continue; }
          const { error } = await supabase.from('setups').insert(setup);
          if (!error) { totalSaved++; debugLog.push(`  → SAVED: ${setup.direction} ${setup.setup_type} RR=${setup.rr_ratio} score=${setup.confluence_score}`); }
          else debugLog.push(`  → DB error: ${error.message}`);
        }
      }
    }

    return NextResponse.json({ message: totalSaved>0?`${totalSaved} setup${totalSaved>1?'s':''} found and saved`:'No qualifying setups this scan', count:totalSaved, debug:debugLog });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status:500 });
  }
}
