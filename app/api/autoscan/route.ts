import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';

interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number; }

const YAHOO_MAP: Record<string,string> = {
  NQ:'NQ=F', ES:'ES=F', GC:'GC=F', CL:'CL=F', SI:'SI=F',
  BTC:'BTC-USD', ETH:'ETH-USD', SOL:'SOL-USD', XRP:'XRP-USD',
  EURUSD:'EURUSD=X', GBPUSD:'GBPUSD=X', USDJPY:'USDJPY=X',
  AUDUSD:'AUDUSD=X', USDCAD:'USDCAD=X', USDCHF:'USDCHF=X',
  GBPJPY:'GBPJPY=X', EURJPY:'EURJPY=X', EURGBP:'EURGBP=X',
  XAUUSD:'GC=F', XAGUSD:'SI=F', USOIL:'CL=F',
  SPY:'SPY', QQQ:'QQQ', NVDA:'NVDA', AAPL:'AAPL', MSFT:'MSFT',
  US30:'YM=F', SPX500:'ES=F', DXY:'DX-Y.NYB',
};

const INTERVAL_MAP: Record<string,string> = { '15m':'15m','1h':'60m','4h':'1d','1d':'1d' };
const RANGE_MAP:    Record<string,string> = { '15m':'5d', '1h':'1mo','4h':'3mo','1d':'6mo' };

async function fetchCandles(symbol: string, tf: string): Promise<Candle[]> {
  const ySym = YAHOO_MAP[symbol] ?? `${symbol}=X`;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${INTERVAL_MAP[tf]??'60m'}&range=${RANGE_MAP[tf]??'1mo'}`,
      { headers:{'User-Agent':'Mozilla/5.0'}, cache:'no-store' }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    return ts.map((t,i) => ({ t:t*1000, o:q.open?.[i], h:q.high?.[i], l:q.low?.[i], c:q.close?.[i], v:q.volume?.[i] }))
      .filter(c => c.o!=null && c.h!=null && c.l!=null && c.c!=null && c.o>0) as Candle[];
  } catch { return []; }
}

function detectHTFBias(candles: Candle[]): 'bullish'|'bearish'|'neutral' {
  if (candles.length < 10) return 'neutral';
  const last = candles.slice(-20);
  const mid = Math.floor(last.length/2);
  const hh = last[last.length-1].h > last[mid].h;
  const hl = last[last.length-1].l > last[mid].l;
  const lh = last[last.length-1].h < last[mid].h;
  const ll = last[last.length-1].l < last[mid].l;
  if (hh && hl) return 'bullish';
  if (lh && ll) return 'bearish';
  const closes = last.map(c=>c.c);
  const ema9 = closes.reduce((a,b,i,arr) => { if (i===0) return [b]; const k=2/10; return [...a, b*k+a[i-1]*(1-k)]; }, [] as number[]);
  return ema9[ema9.length-1] > ema9[Math.floor(ema9.length/2)] ? 'bullish' : 'bearish';
}

function analyzeStructure(candles: Candle[]) {
  if (candles.length < 20) return null;
  const recent = candles.slice(-80);
  const price = recent[recent.length-1].c;
  const highs = recent.map(c=>c.h), lows = recent.map(c=>c.l);
  const rangeHigh = Math.max(...highs), rangeLow = Math.min(...lows);
  const range = rangeHigh - rangeLow;
  if (range === 0) return null;
  const mid = rangeLow + range/2;
  const inDiscount = price < mid;

  // FVGs — unfilled gaps
  const fvgs: {type:'bull'|'bear';high:number;low:number;idx:number}[] = [];
  for (let i=1; i<recent.length-1; i++) {
    const [prev,,next] = [recent[i-1],recent[i],recent[i+1]];
    if (next.l > prev.h) fvgs.push({type:'bull', high:next.l, low:prev.h, idx:i});
    if (next.h < prev.l) fvgs.push({type:'bear', high:prev.l, low:next.h, idx:i});
  }
  const unfilledFVGs = fvgs.filter(f => {
    const later = recent.slice(f.idx+2);
    return f.type==='bull' ? !later.some(c=>c.l<f.low) : !later.some(c=>c.h>f.high);
  }).slice(-6);

  // Order Blocks
  const obs: {type:'bull'|'bear';high:number;low:number}[] = [];
  for (let i=2; i<recent.length-3; i++) {
    const c=recent[i], nxt=recent.slice(i+1,i+4);
    if (c.c<c.o && nxt.filter(x=>x.c>x.o).length>=2 && nxt[2]?.c>c.h)
      obs.push({type:'bull',high:c.h,low:c.l});
    if (c.c>c.o && nxt.filter(x=>x.c<x.o).length>=2 && nxt[2]?.c<c.l)
      obs.push({type:'bear',high:c.h,low:c.l});
  }

  // Swing highs/lows for liquidity
  const swingHighs: number[] = [], swingLows: number[] = [];
  for (let i=3; i<recent.length-3; i++) {
    const win = 3;
    if (recent.slice(i-win,i).every(c=>c.h<=recent[i].h) && recent.slice(i+1,i+win+1).every(c=>c.h<=recent[i].h))
      swingHighs.push(recent[i].h);
    if (recent.slice(i-win,i).every(c=>c.l>=recent[i].l) && recent.slice(i+1,i+win+1).every(c=>c.l>=recent[i].l))
      swingLows.push(recent[i].l);
  }
  const bslLevel = swingHighs.length ? Math.max(...swingHighs.slice(-3)) : rangeHigh;
  const sslLevel = swingLows.length  ? Math.min(...swingLows.slice(-3))  : rangeLow;

  // Liquidity sweeps (last 10 candles)
  const last10 = recent.slice(-10);
  const sslSwept = last10.some(c=>c.l<sslLevel) && price>sslLevel;
  const bslSwept = last10.some(c=>c.h>bslLevel) && price<bslLevel;

  // CISD
  const last5 = recent.slice(-5);
  const cisdBull = last5.some(c=>c.c<c.o) && recent[recent.length-1].c>last5[0].h;
  const cisdBear = last5.some(c=>c.c>c.o) && recent[recent.length-1].c<last5[0].l;

  // Volume context
  const avgVol = recent.slice(-20).reduce((a,c)=>a+(c.v??0),0)/20 || 1;
  const volumeCtx = (recent[recent.length-1].v??0)>avgVol*1.4?'high':(recent[recent.length-1].v??0)<avgVol*0.7?'low':'normal';

  // BOS/CHoCH
  let trend: 'bull'|'bear'|null = null;
  const bos: {level:number;dir:'bull'|'bear'}[] = [];
  const choch: {level:number;dir:'bull'|'bear'}[] = [];
  for (let i=5; i<recent.length; i++) {
    const ph = Math.max(...recent.slice(i-5,i).map(c=>c.h));
    const pl = Math.min(...recent.slice(i-5,i).map(c=>c.l));
    const c = recent[i];
    if (!trend) { if (c.c>ph) trend='bull'; else if (c.c<pl) trend='bear'; }
    else if (trend==='bull' && c.c<pl) { choch.push({level:pl,dir:'bear'}); trend='bear'; }
    else if (trend==='bear' && c.c>ph) { choch.push({level:ph,dir:'bull'}); trend='bull'; }
    else if (trend==='bull' && c.c>ph) bos.push({level:ph,dir:'bull'});
    else if (trend==='bear' && c.c<pl) bos.push({level:pl,dir:'bear'});
  }

  return { price, inDiscount, fvgs:unfilledFVGs, obs, sslSwept, bslSwept,
    sslLevel, bslLevel, cisdBull, cisdBear, volumeCtx, range,
    bos:bos.slice(-2), choch:choch.slice(-2), rangeHigh, rangeLow };
}

function buildSetups(analysis: NonNullable<ReturnType<typeof analyzeStructure>>, symbol: string, tf: string, htfBias: string) {
  const { price, inDiscount, fvgs, obs, sslSwept, bslSwept, sslLevel, bslLevel,
    cisdBull, cisdBear, volumeCtx, range, bos, choch } = analysis;

  // Decimal precision per asset
  const dec = (symbol==='NQ'||symbol==='ES'||symbol==='US30') ? 0
    : ['BTC','ETH'].includes(symbol) ? 0
    : ['EURUSD','GBPUSD','AUDUSD','USDCAD','USDCHF','EURGBP'].includes(symbol) ? 5
    : ['USDJPY','GBPJPY','EURJPY'].includes(symbol) ? 3
    : 2;

  // Expiry based on timeframe — setups are only valid for a few candles
  const expHours = tf==='15m'?4 : tf==='1h'?12 : tf==='4h'?48 : 120;
  const exp = new Date(Date.now()+expHours*60*60*1000).toISOString();
  const bullOK = htfBias==='bullish' || htfBias==='neutral';
  const bearOK = htfBias==='bearish' || htfBias==='neutral';
  const lastChoch = choch.slice(-1)[0];
  const lastBos   = bos.slice(-1)[0];
  const structTag = lastChoch ? ` [CHoCH@${lastChoch.level?.toFixed(dec)}]` : lastBos ? ` [BOS@${lastBos.level?.toFixed(dec)}]` : '';

  const minRR = 1.5; // lowered from 2.0 — more setups found
  const sl_buffer = range * 0.025; // tighter SL buffer

  const confScore = (rr: number, cisd: boolean, swept: boolean, biasMatch: boolean, vol: string) =>
    Math.min(97, Math.round(52 + rr*7 + (cisd?15:0) + (swept?12:0) + (biasMatch?8:0) + (vol==='high'?4:0)));

  const setups: any[] = [];

  // ── BULL FVG near price ──
  if (bullOK) {
    for (const fvg of fvgs.filter(f=>f.type==='bull' && f.high<price && price-f.high < range*0.3).slice(0,2)) {
      const sl = +(fvg.low - sl_buffer).toFixed(dec);
      const tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp - fvg.high) / Math.abs(fvg.low - sl);
      if (rr < minRR || tp <= fvg.high) continue;
      setups.push({
        symbol, timeframe:tf, direction:'bull', setup_type:`FVG Retest${structTag}`,
        entry_low:+fvg.low.toFixed(dec), entry_high:+fvg.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score: confScore(rr,cisdBull,sslSwept,htfBias==='bullish',volumeCtx),
        dol_target:`BSL@${bslLevel.toFixed(dec)} | HTF:${htfBias} | CISD:${cisdBull?'Y':'N'} | Vol:${volumeCtx}`,
        htf_bias:htfBias, cisd_confirmed:cisdBull, volume_context:volumeCtx,
        status:'watching', expires_at:exp, ai_analysis:'', updated_at:new Date().toISOString()
      });
    }
  }

  // ── BEAR FVG near price ──
  if (bearOK) {
    for (const fvg of fvgs.filter(f=>f.type==='bear' && f.low>price && f.low-price < range*0.3).slice(0,2)) {
      const sl = +(fvg.high + sl_buffer).toFixed(dec);
      const tp = +sslLevel.toFixed(dec);
      const rr = Math.abs(fvg.low - tp) / Math.abs(sl - fvg.high);
      if (rr < minRR || tp >= fvg.low) continue;
      setups.push({
        symbol, timeframe:tf, direction:'bear', setup_type:`FVG Retest${structTag}`,
        entry_low:+fvg.low.toFixed(dec), entry_high:+fvg.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score: confScore(rr,cisdBear,bslSwept,htfBias==='bearish',volumeCtx),
        dol_target:`SSL@${sslLevel.toFixed(dec)} | HTF:${htfBias} | CISD:${cisdBear?'Y':'N'} | Vol:${volumeCtx}`,
        htf_bias:htfBias, cisd_confirmed:cisdBear, volume_context:volumeCtx,
        status:'watching', expires_at:exp, ai_analysis:'', updated_at:new Date().toISOString()
      });
    }
  }

  // ── BULL OB + SSL Sweep ──
  if (bullOK && sslSwept) {
    for (const ob of obs.filter(o=>o.type==='bull' && o.high<price && price-o.high < range*0.2).slice(0,1)) {
      const sl = +(ob.low - sl_buffer).toFixed(dec);
      const tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp - ob.high) / Math.abs(ob.low - sl);
      if (rr < minRR || tp <= ob.high) continue;
      setups.push({
        symbol, timeframe:tf, direction:'bull', setup_type:`OB+SSL Sweep${structTag}`,
        entry_low:+ob.low.toFixed(dec), entry_high:+ob.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score: Math.min(96,Math.round(66+rr*5+(cisdBull?14:0)+(htfBias==='bullish'?8:0))),
        dol_target:`BSL@${bslLevel.toFixed(dec)} | SSL swept | HTF:${htfBias}`,
        htf_bias:htfBias, cisd_confirmed:cisdBull, volume_context:volumeCtx,
        status:'watching', expires_at:exp, ai_analysis:'', updated_at:new Date().toISOString()
      });
    }
  }

  // ── BEAR OB + BSL Sweep ──
  if (bearOK && bslSwept) {
    for (const ob of obs.filter(o=>o.type==='bear' && o.low>price && o.low-price < range*0.2).slice(0,1)) {
      const sl = +(ob.high + sl_buffer).toFixed(dec);
      const tp = +sslLevel.toFixed(dec);
      const rr = Math.abs(ob.low - tp) / Math.abs(sl - ob.high);
      if (rr < minRR || tp >= ob.low) continue;
      setups.push({
        symbol, timeframe:tf, direction:'bear', setup_type:`OB+BSL Sweep${structTag}`,
        entry_low:+ob.low.toFixed(dec), entry_high:+ob.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score: Math.min(96,Math.round(66+rr*5+(cisdBear?14:0)+(htfBias==='bearish'?8:0))),
        dol_target:`SSL@${sslLevel.toFixed(dec)} | BSL swept | HTF:${htfBias}`,
        htf_bias:htfBias, cisd_confirmed:cisdBear, volume_context:volumeCtx,
        status:'watching', expires_at:exp, ai_analysis:'', updated_at:new Date().toISOString()
      });
    }
  }

  // ── CISD Bull ──
  if (bullOK && cisdBull) {
    const sl = +(sslLevel - sl_buffer).toFixed(dec);
    const tp = +bslLevel.toFixed(dec);
    const eH = +(price + range*0.008).toFixed(dec);
    const rr = Math.abs(tp - eH) / Math.abs(price - sl);
    if (rr >= minRR && tp > eH) setups.push({
      symbol, timeframe:tf, direction:'bull', setup_type:`CISD Entry${structTag}`,
      entry_low:+price.toFixed(dec), entry_high:eH, stop_loss:sl, target:tp,
      rr_ratio:+rr.toFixed(2), confluence_score: Math.min(97,Math.round(70+rr*4+(sslSwept?12:0)+(htfBias==='bullish'?8:0))),
      dol_target:`BSL@${bslLevel.toFixed(dec)} | CISD confirmed | HTF:${htfBias}`,
      htf_bias:htfBias, cisd_confirmed:true, volume_context:volumeCtx,
      status:'watching', expires_at:exp, ai_analysis:'', updated_at:new Date().toISOString()
    });
  }

  // ── CISD Bear ──
  if (bearOK && cisdBear) {
    const sl = +(bslLevel + sl_buffer).toFixed(dec);
    const tp = +sslLevel.toFixed(dec);
    const eL = +(price - range*0.008).toFixed(dec);
    const rr = Math.abs(eL - tp) / Math.abs(sl - price);
    if (rr >= minRR && tp < eL) setups.push({
      symbol, timeframe:tf, direction:'bear', setup_type:`CISD Entry${structTag}`,
      entry_low:eL, entry_high:+price.toFixed(dec), stop_loss:sl, target:tp,
      rr_ratio:+rr.toFixed(2), confluence_score: Math.min(97,Math.round(70+rr*4+(bslSwept?12:0)+(htfBias==='bearish'?8:0))),
      dol_target:`SSL@${sslLevel.toFixed(dec)} | CISD confirmed | HTF:${htfBias}`,
      htf_bias:htfBias, cisd_confirmed:true, volume_context:volumeCtx,
      status:'watching', expires_at:exp, ai_analysis:'', updated_at:new Date().toISOString()
    });
  }

  // ── CHoCH + OB (highest conviction) ──
  if (lastChoch?.dir==='bull' && bullOK) {
    const nearOB = obs.find(o=>o.type==='bull' && o.high<price && price-o.high<range*0.15);
    if (nearOB) {
      const sl = +(nearOB.low - sl_buffer).toFixed(dec);
      const tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp - nearOB.high) / Math.abs(nearOB.low - sl);
      if (rr >= minRR && tp > nearOB.high) setups.push({
        symbol, timeframe:tf, direction:'bull', setup_type:`CHoCH+OB [CHoCH@${lastChoch.level?.toFixed(dec)}]`,
        entry_low:+nearOB.low.toFixed(dec), entry_high:+nearOB.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score: Math.min(97,Math.round(76+rr*3+(sslSwept?10:0)+(htfBias==='bullish'?7:0))),
        dol_target:`BSL@${bslLevel.toFixed(dec)} | CHoCH+OB confluence`,
        htf_bias:htfBias, cisd_confirmed:cisdBull, volume_context:volumeCtx,
        status:'watching', expires_at:exp, ai_analysis:'', updated_at:new Date().toISOString()
      });
    }
  }
  if (lastChoch?.dir==='bear' && bearOK) {
    const nearOB = obs.find(o=>o.type==='bear' && o.low>price && o.low-price<range*0.15);
    if (nearOB) {
      const sl = +(nearOB.high + sl_buffer).toFixed(dec);
      const tp = +sslLevel.toFixed(dec);
      const rr = Math.abs(nearOB.low - tp) / Math.abs(sl - nearOB.high);
      if (rr >= minRR && tp < nearOB.low) setups.push({
        symbol, timeframe:tf, direction:'bear', setup_type:`CHoCH+OB [CHoCH@${lastChoch.level?.toFixed(dec)}]`,
        entry_low:+nearOB.low.toFixed(dec), entry_high:+nearOB.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score: Math.min(97,Math.round(76+rr*3+(bslSwept?10:0)+(htfBias==='bearish'?7:0))),
        dol_target:`SSL@${sslLevel.toFixed(dec)} | CHoCH+OB confluence`,
        htf_bias:htfBias, cisd_confirmed:cisdBear, volume_context:volumeCtx,
        status:'watching', expires_at:exp, ai_analysis:'', updated_at:new Date().toISOString()
      });
    }
  }

  return setups;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(()=>({}));
    const symbols: string[]   = body.symbols   ?? ['NQ','ES','GC','EURUSD','GBPUSD','BTC','ETH'];
    const timeframes: string[] = body.timeframes ?? ['1h','4h'];
    const debugLog: string[] = [];
    let totalSaved = 0;

    // Load user weekly biases
    const userBiases: Record<string,string> = {};
    try {
      const { data: biasRows } = await sb.from('weekly_bias').select('symbol,bias').order('created_at',{ascending:false});
      (biasRows ?? []).forEach((b:any) => { if (!userBiases[b.symbol]) userBiases[b.symbol] = b.bias; });
    } catch {}

    for (const sym of symbols) {
      for (const tf of timeframes) {
        debugLog.push(`→ ${sym} ${tf}...`);
        const candles = await fetchCandles(sym, tf);
        if (candles.length < 20) {
          debugLog.push(`  ✗ only ${candles.length} candles (need 20+)`);
          continue;
        }

        // HTF bias
        const htfTf = tf==='15m'?'1h' : tf==='1h'?'4h' : '1d';
        const htfCandles = htfTf !== tf ? await fetchCandles(sym, htfTf) : candles;
        const htfBias = userBiases[sym] ?? detectHTFBias(htfCandles);
        debugLog.push(`  candles=${candles.length} htf_bias=${htfBias}${userBiases[sym]?' (user)':''}`);

        const analysis = analyzeStructure(candles);
        if (!analysis) { debugLog.push(`  ✗ analysis failed`); continue; }
        debugLog.push(`  price=${analysis.price.toFixed(4)} ${analysis.inDiscount?'DISCOUNT':'PREMIUM'} fvgs=${analysis.fvgs.length} obs=${analysis.obs.length} choch=${analysis.choch.length} ssl_swept=${analysis.sslSwept} bsl_swept=${analysis.bslSwept}`);

        const newSetups = buildSetups(analysis, sym, tf, htfBias);
        debugLog.push(`  → ${newSetups.length} setup(s) generated`);

        for (const setup of newSetups) {
          // Reject setup if price already violated SL or hit TP (stale setup)
          const currentPrice = analysis.price;
          const isBull = setup.direction === 'bull';
          if (isBull && currentPrice < setup.stop_loss) {
            debugLog.push(`  → ${setup.direction} ${setup.setup_type} skipped: price ${currentPrice.toFixed(4)} already below SL ${setup.stop_loss}`);
            continue;
          }
          if (!isBull && currentPrice > setup.stop_loss) {
            debugLog.push(`  → ${setup.direction} ${setup.setup_type} skipped: price ${currentPrice.toFixed(4)} already above SL ${setup.stop_loss}`);
            continue;
          }
          if (isBull && currentPrice >= setup.target) {
            debugLog.push(`  → ${setup.direction} ${setup.setup_type} skipped: price already hit target`);
            continue;
          }
          if (!isBull && currentPrice <= setup.target) {
            debugLog.push(`  → ${setup.direction} ${setup.setup_type} skipped: price already hit target`);
            continue;
          }

          // Skip duplicates in last 8h
          const { data: existing } = await sb.from('setups').select('id')
            .eq('symbol', sym).eq('timeframe', tf).eq('direction', setup.direction)
            .eq('setup_type', setup.setup_type)
            .gte('created_at', new Date(Date.now()-8*60*60*1000).toISOString()).limit(1);
          if (existing?.length) { debugLog.push(`  → dup skipped`); continue; }

          const { error } = await sb.from('setups').insert(setup);
          if (!error) {
            totalSaved++;
            debugLog.push(`  ✓ SAVED: ${setup.direction} ${setup.setup_type} RR=${setup.rr_ratio} score=${setup.confluence_score}`);
          } else {
            debugLog.push(`  ✗ DB: ${error.message}`);
          }
        }
      }
    }

    return NextResponse.json({
      message: totalSaved > 0 ? `${totalSaved} setup${totalSaved>1?'s':''} saved` : 'No qualifying setups found — try more symbols or check debug log',
      count: totalSaved,
      debug: debugLog
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status:500 });
  }
}
