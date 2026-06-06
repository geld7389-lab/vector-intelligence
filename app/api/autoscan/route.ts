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
      SPY:'SPY', QQQ:'QQQ', NVDA:'NVDA',
    };
    const ySym = yahooMap[symbol] ?? `${symbol}=F`;
    const intervalMap: Record<string,string> = { '15m':'15m','1h':'60m','4h':'1d','1d':'1d' };
    const rangeMap: Record<string,string> = { '15m':'5d','1h':'1mo','4h':'3mo','1d':'1y' };
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=${intervalMap[tf]??'60m'}&range=${rangeMap[tf]??'1mo'}`,
      { headers:{ 'User-Agent':'Mozilla/5.0' }, cache:'no-store' }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    return ts.map((t,i) => ({ t:t*1000, o:q.open?.[i], h:q.high?.[i], l:q.low?.[i], c:q.close?.[i], v:q.volume?.[i] }))
      .filter(c => c.o!=null && c.h!=null && c.l!=null && c.c!=null) as Candle[];
  } catch { return []; }
}

function detectHTFBias(candles: Candle[]): 'bullish'|'bearish'|'neutral' {
  if (candles.length < 20) return 'neutral';
  const last = candles.slice(-20);
  const highs = last.map(c=>c.h), lows = last.map(c=>c.l);
  const mid = Math.floor(last.length/2);
  const hh = highs[highs.length-1] > highs[mid], hl = lows[lows.length-1] > lows[mid];
  const lh = highs[highs.length-1] < highs[mid], ll = lows[lows.length-1] < lows[mid];
  if (hh && hl) return 'bullish';
  if (lh && ll) return 'bearish';
  const range = Math.max(...highs) - Math.min(...lows);
  return candles[candles.length-1].c > Math.min(...lows)+range/2 ? 'bullish' : 'bearish';
}

function detectBOSCHoCH(candles: Candle[], lookback=5) {
  const bos: {level:number;direction:'bull'|'bear'}[] = [];
  const choch: {level:number;direction:'bull'|'bear'}[] = [];
  let trend: 'bull'|'bear'|null = null;
  for (let i=lookback; i<candles.length-lookback; i++) {
    const c = candles[i];
    const prevHigh = Math.max(...candles.slice(i-lookback,i).map(x=>x.h));
    const prevLow = Math.min(...candles.slice(i-lookback,i).map(x=>x.l));
    if (trend === null) { if (c.c>prevHigh) trend='bull'; else if (c.c<prevLow) trend='bear'; }
    else if (trend==='bull' && c.c<prevLow) { choch.push({level:prevLow,direction:'bear'}); trend='bear'; }
    else if (trend==='bear' && c.c>prevHigh) { choch.push({level:prevHigh,direction:'bull'}); trend='bull'; }
    else if (trend==='bull' && c.c>prevHigh) bos.push({level:prevHigh,direction:'bull'});
    else if (trend==='bear' && c.c<prevLow) bos.push({level:prevLow,direction:'bear'});
  }
  return { bos:bos.slice(-2), choch:choch.slice(-2) };
}

function analyzeStructure(candles: Candle[]) {
  if (candles.length < 30) return null;
  const recent = candles.slice(-100);
  const price = recent[recent.length-1].c;
  const highs = recent.map(c=>c.h), lows = recent.map(c=>c.l);
  const range = Math.max(...highs) - Math.min(...lows);
  const mid = Math.min(...lows) + range/2;
  const inDiscount = price < mid;

  // FVGs
  const fvgs: {type:'bull'|'bear';high:number;low:number;idx:number}[] = [];
  for (let i=1; i<recent.length-1; i++) {
    const [prev,curr,next] = [recent[i-1],recent[i],recent[i+1]];
    if (next.l>prev.h && curr.c>curr.o) fvgs.push({type:'bull',high:next.l,low:prev.h,idx:i});
    if (next.h<prev.l && curr.c<curr.o) fvgs.push({type:'bear',high:prev.l,low:next.h,idx:i});
  }
  const unfilledFVGs = fvgs.filter(f => {
    const later = recent.slice(f.idx+2);
    return f.type==='bull' ? !later.some(c=>c.l<f.low) : !later.some(c=>c.h>f.high);
  });

  // OBs
  const obs: {type:'bull'|'bear';high:number;low:number}[] = [];
  for (let i=2; i<recent.length-3; i++) {
    const c=recent[i], next3=recent.slice(i+1,i+4);
    if (c.c<c.o && next3.filter(x=>x.c>x.o).length>=2 && next3[2]?.c>c.h)
      obs.push({type:'bull',high:c.h,low:c.l});
    if (c.c>c.o && next3.filter(x=>x.c<x.o).length>=2 && next3[2]?.c<c.l)
      obs.push({type:'bear',high:c.h,low:c.l});
  }

  // Swing highs/lows
  const swingHighs: number[] = [], swingLows: number[] = [];
  for (let i=3; i<recent.length-3; i++) {
    if (recent.slice(i-3,i).every(c=>c.h<recent[i].h) && recent.slice(i+1,i+4).every(c=>c.h<recent[i].h)) swingHighs.push(recent[i].h);
    if (recent.slice(i-3,i).every(c=>c.l>recent[i].l) && recent.slice(i+1,i+4).every(c=>c.l>recent[i].l)) swingLows.push(recent[i].l);
  }
  const bslLevel = swingHighs.length ? Math.max(...swingHighs.slice(-3)) : price*1.005;
  const sslLevel = swingLows.length ? Math.min(...swingLows.slice(-3)) : price*0.995;

  const last8 = recent.slice(-8);
  const sslSwept = last8.some(c=>c.l<sslLevel) && recent[recent.length-1].c>sslLevel;
  const bslSwept = last8.some(c=>c.h>bslLevel) && recent[recent.length-1].c<bslLevel;

  const last5 = recent.slice(-5);
  const cisdBull = last5.some(c=>c.c<c.o) && recent[recent.length-1].c>recent[recent.length-1].o && recent[recent.length-1].c>last5[0].h;
  const cisdBear = last5.some(c=>c.c>c.o) && recent[recent.length-1].c<recent[recent.length-1].o && recent[recent.length-1].c<last5[0].l;

  const avgVol = (recent.slice(-20).reduce((a,c)=>a+(c.v??0),0)/20)||1;
  const volumeCtx = (recent[recent.length-1].v??0)>avgVol*1.5?'high':(recent[recent.length-1].v??0)<avgVol*0.7?'low':'normal';
  const { bos, choch } = detectBOSCHoCH(recent);

  return { price, inDiscount, fvgs:unfilledFVGs, obs, sslSwept, bslSwept, sslLevel, bslLevel,
    cisdBull, cisdBear, volumeCtx, range, bos, choch };
}

function buildSetups(analysis: NonNullable<ReturnType<typeof analyzeStructure>>, symbol: string, tf: string, htfBias: string) {
  const { price, inDiscount, fvgs, obs, sslSwept, bslSwept, sslLevel, bslLevel,
    cisdBull, cisdBear, volumeCtx, range, bos, choch } = analysis;
  const dec = (symbol==='NQ'||symbol==='ES') ? 1 : symbol==='BTC' ? 0 : 2;
  const exp = new Date(Date.now()+24*60*60*1000).toISOString();
  const bullOK = htfBias==='bullish'||htfBias==='neutral';
  const bearOK = htfBias==='bearish'||htfBias==='neutral';
  const lastChoch = choch.slice(-1)[0];
  const lastBos = bos.slice(-1)[0];
  const bosCHoCHTag = lastChoch ? ` [CHoCH@${lastChoch.level?.toFixed(dec)}]` : lastBos ? ` [BOS@${lastBos.level?.toFixed(dec)}]` : '';

  const score = (rr: number, cisd: boolean, swept: boolean, biasMatch: boolean, vol: string) =>
    Math.min(97, Math.round(55 + rr*6 + (cisd?18:0) + (swept?12:0) + (biasMatch?8:0) + (vol==='high'?4:0)));

  const setups: any[] = [];

  // Bull FVG
  if (bullOK && inDiscount) {
    for (const fvg of fvgs.filter(f=>f.type==='bull'&&f.high<price&&price-f.high<range*0.25).slice(0,1)) {
      const sl = +(fvg.low-range*0.04).toFixed(dec), tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp-fvg.high)/Math.abs(fvg.low-sl);
      if (rr<2.0) continue;
      setups.push({
        symbol, timeframe:tf, direction:'bull', setup_type:`FVG Retest${bosCHoCHTag}`,
        entry_low:+fvg.low.toFixed(dec), entry_high:+fvg.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score:score(rr,cisdBull,sslSwept,htfBias==='bullish',volumeCtx),
        dol_target:`BSL@${bslLevel.toFixed(dec)} | HTF:${htfBias} | CISD:${cisdBull?'Y':'N'} | Vol:${volumeCtx} | ${bosCHoCHTag}`,
        status:'watching', ai_analysis: '', updated_at: new Date().toISOString()
      });
    }
  }

  // Bear FVG
  if (bearOK && !inDiscount) {
    for (const fvg of fvgs.filter(f=>f.type==='bear'&&f.low>price&&f.low-price<range*0.25).slice(0,1)) {
      const sl = +(fvg.high+range*0.04).toFixed(dec), tp = +sslLevel.toFixed(dec);
      const rr = Math.abs(fvg.low-tp)/Math.abs(sl-fvg.high);
      if (rr<2.0) continue;
      setups.push({
        symbol, timeframe:tf, direction:'bear', setup_type:`FVG Retest${bosCHoCHTag}`,
        entry_low:+fvg.low.toFixed(dec), entry_high:+fvg.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score:score(rr,cisdBear,bslSwept,htfBias==='bearish',volumeCtx),
        dol_target:`SSL@${sslLevel.toFixed(dec)} | HTF:${htfBias} | CISD:${cisdBear?'Y':'N'} | Vol:${volumeCtx}`,
        status:'watching', ai_analysis: '', updated_at: new Date().toISOString()
      });
    }
  }

  // Bull OB + SSL Sweep
  if (bullOK && sslSwept) {
    for (const ob of obs.filter(o=>o.type==='bull'&&o.high<price&&price-o.high<range*0.18).slice(0,1)) {
      const sl = +(ob.low-range*0.025).toFixed(dec), tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp-ob.high)/Math.abs(ob.low-sl);
      if (rr<2.0) continue;
      setups.push({
        symbol, timeframe:tf, direction:'bull', setup_type:`OB+SSL Sweep${bosCHoCHTag}`,
        entry_low:+ob.low.toFixed(dec), entry_high:+ob.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score:Math.min(96,Math.round(68+rr*5+(cisdBull?14:0)+(htfBias==='bullish'?8:0))),
        dol_target:`BSL@${bslLevel.toFixed(dec)} | SSL swept | HTF:${htfBias}`,
        status:'watching', ai_analysis: '', updated_at: new Date().toISOString()
      });
    }
  }

  // Bear OB + BSL Sweep
  if (bearOK && bslSwept) {
    for (const ob of obs.filter(o=>o.type==='bear'&&o.low>price&&o.low-price<range*0.18).slice(0,1)) {
      const sl = +(ob.high+range*0.025).toFixed(dec), tp = +sslLevel.toFixed(dec);
      const rr = Math.abs(ob.low-tp)/Math.abs(sl-ob.high);
      if (rr<2.0) continue;
      setups.push({
        symbol, timeframe:tf, direction:'bear', setup_type:`OB+BSL Sweep${bosCHoCHTag}`,
        entry_low:+ob.low.toFixed(dec), entry_high:+ob.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score:Math.min(96,Math.round(68+rr*5+(cisdBear?14:0)+(htfBias==='bearish'?8:0))),
        dol_target:`SSL@${sslLevel.toFixed(dec)} | BSL swept | HTF:${htfBias}`,
        status:'watching', ai_analysis: '', updated_at: new Date().toISOString()
      });
    }
  }

  // CISD Bull
  if (bullOK && cisdBull) {
    const swingL = analysis.sslLevel;
    const sl = +(swingL-range*0.02).toFixed(dec);
    const tp = +bslLevel.toFixed(dec);
    const eH = +(price+range*0.01).toFixed(dec);
    const rr = Math.abs(tp-eH)/Math.abs(price-sl);
    if (rr>=2.0) setups.push({
      symbol, timeframe:tf, direction:'bull', setup_type:`CISD Entry${bosCHoCHTag}`,
      entry_low:+price.toFixed(dec), entry_high:eH, stop_loss:sl, target:tp,
      rr_ratio:+rr.toFixed(2), confluence_score:Math.min(97,Math.round(74+rr*4+(sslSwept?12:0)+(htfBias==='bullish'?8:0))),
      dol_target:`BSL@${bslLevel.toFixed(dec)} | CISD confirmed | HTF:${htfBias}`,
      status:'watching', ai_analysis: '', updated_at: new Date().toISOString()
    });
  }

  // CHoCH + OB (highest conviction)
  if (lastChoch?.direction==='bull' && bullOK) {
    const nearOB = obs.find(o=>o.type==='bull'&&o.high<price&&price-o.high<range*0.15);
    if (nearOB) {
      const sl = +(nearOB.low-range*0.02).toFixed(dec), tp = +bslLevel.toFixed(dec);
      const rr = Math.abs(tp-nearOB.high)/Math.abs(nearOB.low-sl);
      if (rr>=2.0) setups.push({
        symbol, timeframe:tf, direction:'bull', setup_type:`CHoCH+OB [CHoCH@${lastChoch.level?.toFixed(dec)}]`,
        entry_low:+nearOB.low.toFixed(dec), entry_high:+nearOB.high.toFixed(dec), stop_loss:sl, target:tp,
        rr_ratio:+rr.toFixed(2), confluence_score:Math.min(97,Math.round(78+rr*3+(sslSwept?10:0)+(htfBias==='bullish'?7:0))),
        dol_target:`BSL@${bslLevel.toFixed(dec)} | CHoCH+OB confluence`,
        status:'watching', ai_analysis: '', updated_at: new Date().toISOString()
      });
    }
  }

  return setups;
}

export async function POST(req: NextRequest) {
  try {
    const { symbols=['NQ','ES'], timeframes=['15m','1h'], currentPrices } = await req.json();
    const debugLog: string[] = [];
    let totalSaved = 0;

    // Try to get user weekly biases (table may or may not exist)
    const userBiases: Record<string,string> = {};
    try {
      const { data: biasRows } = await supabase.from('weekly_bias').select('symbol,bias').order('created_at',{ascending:false});
      (biasRows ?? []).forEach((b:any) => { if (!userBiases[b.symbol]) userBiases[b.symbol] = b.bias; });
    } catch {}

    for (const sym of symbols) {
      for (const tf of timeframes) {
        debugLog.push(`Scanning ${sym} ${tf}...`);
        const candles = await fetchCandles(sym, tf);
        if (candles.length < 30) { debugLog.push(`  ✗ insufficient data (${candles.length})`); continue; }

        const htfTf = tf==='15m'?'1h':tf==='1h'?'4h':'1d';
        const htfCandles = await fetchCandles(sym, htfTf);
        const htfBias = userBiases[sym] ?? (htfCandles.length>20 ? detectHTFBias(htfCandles) : 'neutral');
        debugLog.push(`  → ${candles.length} candles | HTF bias: ${htfBias}${userBiases[sym] ? ' (user)' : ''}`);

        const analysis = analyzeStructure(candles);
        if (!analysis) { debugLog.push(`  ✗ analysis failed`); continue; }
        debugLog.push(`  → price=${analysis.price.toFixed(2)} ${analysis.inDiscount?'DISCOUNT':'PREMIUM'} FVGs=${analysis.fvgs.length} OBs=${analysis.obs.length} CHoCH=${analysis.choch.length}`);

        const newSetups = buildSetups(analysis, sym, tf, htfBias);
        debugLog.push(`  → ${newSetups.length} setup(s) generated`);

        for (const setup of newSetups) {
          // Check duplicate (last 6h)
          const { data: existing } = await supabase.from('setups').select('id')
            .eq('symbol', sym).eq('timeframe', tf).eq('direction', setup.direction)
            .gte('created_at', new Date(Date.now()-6*60*60*1000).toISOString()).limit(1);
          if (existing?.length) { debugLog.push(`  → dup skipped`); continue; }

          const { error } = await supabase.from('setups').insert(setup);
          if (!error) { totalSaved++; debugLog.push(`  ✓ SAVED: ${setup.direction} ${setup.setup_type} RR=${setup.rr_ratio} score=${setup.confluence_score}`); }
          else debugLog.push(`  ✗ DB error: ${error.message}`);
        }
      }
    }
    return NextResponse.json({ message: totalSaved > 0 ? `${totalSaved} setup${totalSaved>1?'s':''} saved` : 'No qualifying setups found', count: totalSaved, debug: debugLog });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
