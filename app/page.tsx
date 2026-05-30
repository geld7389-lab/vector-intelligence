'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M';
const sb = createClient(SB_URL, SB_KEY);

interface Setup { id:string;symbol:string;timeframe:string;direction:string;setup_type:string;entry_low:number;entry_high:number;stop_loss:number;target:number;rr_ratio:number;confluence_score:number;status:string;dol_target:string;ai_analysis:string;htf_bias:string;cisd_confirmed:boolean;volume_context:string;killzone_valid:string;correlated_align:boolean;expires_at:string;market_section:string; }
interface Prices { NQ:number|null;ES:number|null;GC:number|null;DXY:number|null;VIX:number|null; }
interface KZ { nyTime:string;active:{name:string;short:string;color:string}|null;upcoming:{name:string;short:string;minsAway:number}[];probability:string;isLunch:boolean; }
interface CalEvent { name:string;impact:string;isToday:boolean;minutesAway:number|null;isDangerZone:boolean;date:string; }
interface CryptoPrice { symbol:string;name:string;price:number|null;change24h:number|null;high24h:number|null;low24h:number|null; }
interface Quote { symbol:string;name:string;price:number|null;change:number|null;high:number|null;low:number|null;mktCap?:number|null; }
interface BtRun { id:string;symbol:string;market_section:string;setup_type:string;from_date:string;to_date:string;total_signals:number;wins:number;losses:number;win_rate:number;avg_rr:number;total_pnl:number;profit_factor:number;best_year:string;worst_year:string;yearly_breakdown:Record<string,{wins:number;losses:number;total:number}>; }
interface Candle { t:number;o:number;h:number;l:number;c:number;v?:number; }

const MKTABS = ['Futures','Crypto','Forex','Stocks','Institutional'] as const;
const TABS = ['Markets','Chart','MMXM','Analytics','Journal','Knowledge'] as const;
type MkTab = typeof MKTABS[number];
type Tab = typeof TABS[number];

const f=(n:number|string|null|undefined,d=2)=>{const x=Number(n);return isNaN(x)||n===null||n===undefined?'—':x.toFixed(d);};
const chgColor=(n:number|null)=>n===null?'text-zinc-400':n>0?'text-emerald-400':'text-red-400';
const dc=(d:string)=>d==='bull'||d==='long'?'#10b981':d==='bear'||d==='short'?'#f87171':'#f59e0b';
// fmt$ removed - inline formatting used

// ── SCORE RING ─────────────────────────────────────────────────────
function Ring({score}:{score:number}){
  const r=12,circ=2*Math.PI*r,fill=(score/100)*circ;
  const color=score>=70?'#10b981':score>=50?'#f59e0b':'#f87171';
  return(<div className="relative w-8 h-8 flex items-center justify-center shrink-0"><svg width="32" height="32" className="-rotate-90"><circle cx="16" cy="16" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5"/><circle cx="16" cy="16" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${fill} ${circ}`} stroke={color}/></svg><span className="absolute" style={{color,fontSize:'10px',fontWeight:600}}>{score}</span></div>);
}

// ── CANDLE CHART ───────────────────────────────────────────────────
function CandleChart({sym,tf,setup}:{sym:string;tf:string;setup:Setup|null}){
  const ref=useRef<HTMLCanvasElement>(null);
  const [candles,setCandles]=useState<Candle[]>([]);
  const [hov,setHov]=useState<number|null>(null);
  const load=useCallback(async()=>{try{const r=await fetch(`/api/candles?symbol=${sym}&tf=${tf}`,{cache:'no-store'});const d=await r.json();setCandles(d.candles??[]);}catch{}},[sym,tf]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{const i=setInterval(load,30000);return()=>clearInterval(i);},[load]);
  useEffect(()=>{
    if(!candles.length||!ref.current)return;
    const cv=ref.current,ctx=cv.getContext('2d')!,W=cv.width,H=cv.height;
    const PL=58,PR=6,PT=16,volH=32,chartH=H-PT-volH-20;
    ctx.clearRect(0,0,W,H);
    const px=candles.map(c=>[c.l,c.h]).flat();
    let mn=Math.min(...px),mx=Math.max(...px);
    if(setup){[setup.entry_low,setup.entry_high,setup.stop_loss,setup.target].forEach(l=>{if(l<mn)mn=l;if(l>mx)mx=l;});}
    const pad=(mx-mn)*0.06;mn-=pad;mx+=pad;
    const pY=(v:number)=>PT+chartH-(((v-mn)/(mx-mn))*chartH);
    const chartW=W-PL-PR,gap=chartW/candles.length,cw=Math.max(1.5,Math.min(12,gap-1));
    const maxV=Math.max(...candles.map(c=>c.v??0));
    ctx.strokeStyle='rgba(255,255,255,0.05)';ctx.lineWidth=0.5;
    for(let i=0;i<=5;i++){const y=PT+(chartH/5)*i;ctx.beginPath();ctx.moveTo(PL,y);ctx.lineTo(W-PR,y);ctx.stroke();const pv=mx-((mx-mn)/5)*i;ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='9px monospace';ctx.textAlign='right';ctx.fillText(pv.toFixed(0),PL-3,y+3);}
    if(setup){
      const ey1=pY(setup.entry_high),ey2=pY(setup.entry_low);
      ctx.fillStyle='rgba(16,185,129,0.07)';ctx.fillRect(PL,ey1,chartW,ey2-ey1);
      ctx.strokeStyle='rgba(16,185,129,0.4)';ctx.lineWidth=0.8;ctx.setLineDash([3,3]);ctx.strokeRect(PL,ey1,chartW,ey2-ey1);ctx.setLineDash([]);
      ctx.fillStyle='rgba(16,185,129,0.7)';ctx.font='9px monospace';ctx.textAlign='left';ctx.fillText(`${f(setup.entry_low)}-${f(setup.entry_high)}`,PL+3,ey1-3);
      const sly=pY(setup.stop_loss);ctx.strokeStyle='rgba(248,113,113,0.5)';ctx.lineWidth=0.8;ctx.setLineDash([4,2]);ctx.beginPath();ctx.moveTo(PL,sly);ctx.lineTo(W-PR,sly);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(248,113,113,0.7)';ctx.textAlign='right';ctx.fillText(`SL ${f(setup.stop_loss)}`,W-PR-2,sly-3);
      const tpy=pY(setup.target);ctx.strokeStyle='rgba(96,165,250,0.5)';ctx.lineWidth=0.8;ctx.setLineDash([4,2]);ctx.beginPath();ctx.moveTo(PL,tpy);ctx.lineTo(W-PR,tpy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(96,165,250,0.7)';ctx.textAlign='right';ctx.fillText(`TP ${f(setup.target)}`,W-PR-2,tpy-3);
    }
    candles.forEach((c,i)=>{const x=PL+i*gap+gap/2,bull=c.c>=c.o,col=bull?'#10b981':'#f87171';ctx.strokeStyle=hov===i?'#fff':col;ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(x,pY(c.h));ctx.lineTo(x,pY(c.l));ctx.stroke();const oy=pY(Math.max(c.o,c.c)),cy2=pY(Math.min(c.o,c.c)),bh=Math.max(1,cy2-oy);ctx.fillStyle=hov===i?'rgba(255,255,255,0.9)':col;ctx.fillRect(x-cw/2,oy,cw,bh);if(c.v&&maxV>0){const vh=(c.v/maxV)*volH;ctx.fillStyle=bull?'rgba(16,185,129,0.2)':'rgba(248,113,113,0.2)';ctx.fillRect(x-cw/2,PT+chartH+4+volH-vh,cw,vh);}});
    if(hov!==null&&candles[hov]){const c=candles[hov],x=Math.min(PL+hov*gap+gap/2,W-92);ctx.fillStyle='rgba(15,18,25,0.96)';ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=0.5;ctx.beginPath();(ctx as CanvasRenderingContext2D&{roundRect(x:number,y:number,w:number,h:number,r:number):void}).roundRect(x,PT+2,88,48,3);ctx.fill();ctx.stroke();ctx.fillStyle='rgba(255,255,255,0.45)';ctx.font='9px monospace';ctx.textAlign='left';ctx.fillText(new Date(c.t).toLocaleDateString('en-US',{month:'short',day:'numeric'}),x+4,PT+11);ctx.fillStyle='rgba(255,255,255,0.8)';ctx.fillText(`O:${c.o.toFixed(0)} H:${c.h.toFixed(0)}`,x+4,PT+23);ctx.fillText(`L:${c.l.toFixed(0)} C:${c.c.toFixed(0)}`,x+4,PT+35);}
    const last=candles[candles.length-1];if(last){const ly=pY(last.c);ctx.strokeStyle='rgba(251,191,36,0.45)';ctx.lineWidth=0.5;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(PL,ly);ctx.lineTo(W-PR,ly);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#fbbf24';ctx.textAlign='right';ctx.font='9px monospace';ctx.fillText(last.c.toFixed(1),W-PR-2,ly-2);}
  },[candles,hov,setup]);
  const onMM=(e:React.MouseEvent<HTMLCanvasElement>)=>{if(!ref.current||!candles.length)return;const rect=ref.current.getBoundingClientRect(),x=e.clientX-rect.left,gap=(ref.current.width-64)/candles.length,idx=Math.floor((x-58)/gap);setHov(idx>=0&&idx<candles.length?idx:null);};
  return <canvas ref={ref} width={900} height={400} className="w-full h-full cursor-crosshair" onMouseMove={onMM} onMouseLeave={()=>setHov(null)}/>;
}

// ── PRICE CARD ────────────────────────────────────────────────────
function PCard({name,price,change,sub}:{name:string;price:string;change:number|null;sub?:string}){
  return(
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-3 hover:border-zinc-600/60 transition-colors">
      <div className="text-zinc-400 text-xs mb-1">{name}</div>
      <div className="text-white text-sm font-semibold">{price}</div>
      <div className="flex items-center justify-between mt-1">
        <span className={`text-xs ${chgColor(change)}`}>{change!==null?(change>0?'+':'')+change.toFixed(2)+'%':'—'}</span>
        {sub&&<span className="text-zinc-600 text-xs">{sub}</span>}
      </div>
    </div>
  );
}

// ── CRYPTO TAB ────────────────────────────────────────────────────
function CryptoTab({setups,onChart,onDelete}:{setups:Setup[];onChart:(s:Setup)=>void;onDelete:(id:string)=>void}){
  const [prices,setPrices]=useState<CryptoPrice[]>([]);
  const [btForm,setBtForm]=useState({symbol:'BTC-USD'});
  const [btRunning,setBtR]=useState(false);
  const [btResult,setBtRes]=useState<BtRun|null>(null);
  const [btErr,setBtErr]=useState('');
  const [prevRuns,setPrevRuns]=useState<BtRun[]>([]);
  useEffect(()=>{
    fetch('/api/crypto').then(r=>r.json()).then(d=>{if(d.prices)setPrices(d.prices);});
    fetch('/api/deepbacktest').then(r=>r.json()).then(d=>setPrevRuns(d.results??[]));
    const i=setInterval(()=>fetch('/api/crypto').then(r=>r.json()).then(d=>{if(d.prices)setPrices(d.prices);}),30000);
    return()=>clearInterval(i);
  },[]);
  const runBt=async()=>{setBtR(true);setBtRes(null);setBtErr('');try{const r=await fetch('/api/deepbacktest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:btForm.symbol,marketSection:'crypto'})});const d=await r.json();if(d.error)setBtErr(d.error);else{setBtRes(d.run);setPrevRuns(p=>[d.run,...p]);}}catch(e){setBtErr(String(e));}setBtR(false);};
  const cryptoSetups=setups.filter(s=>s.market_section==='crypto'||['BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE'].some(c=>s.symbol?.toUpperCase().includes(c)));
  const inp="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500";
  return(
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Live Prices · Yahoo Finance</div>
        <div className="grid grid-cols-4 gap-2">
          {prices.length===0?<div className="col-span-4 text-zinc-600 text-xs">Loading...</div>:prices.map(p=><PCard key={p.symbol} name={p.name} price={p.price?`$${p.price>1000?p.price.toLocaleString('en-US',{maximumFractionDigits:0}):p.price.toFixed(4)}`:'—'} change={p.change24h}/>)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3"><span className="text-zinc-500 text-xs uppercase tracking-wider">ICT Setups · Crypto</span><span className="text-zinc-600 text-xs">{cryptoSetups.length}</span></div>
          {cryptoSetups.length===0?<div className="text-zinc-600 text-xs">No crypto setups — run Scan with BTC/ETH</div>:cryptoSetups.map(s=>(
            <div key={s.id} className="border border-zinc-800 hover:border-zinc-700 rounded-lg px-3 py-2.5 mb-2 transition-colors">
              <div className="flex justify-between items-center mb-1.5">
                <div className="flex items-center gap-2"><span className="text-white text-xs font-semibold">{s.symbol}</span><span className="text-xs font-medium" style={{color:dc(s.direction)}}>{s.direction}</span><span className="text-zinc-400 text-xs">{s.setup_type}</span></div>
                <div className="flex items-center gap-1.5"><Ring score={s.confluence_score}/><button onClick={()=>onChart(s)} className="text-zinc-600 hover:text-blue-400 text-xs transition-colors">chart</button><button onClick={()=>onDelete(s.id)} className="text-zinc-700 hover:text-red-400 text-xs transition-colors">✕</button></div>
              </div>
              <div className="flex gap-3 text-xs text-zinc-500"><span>E <span className="text-zinc-300">{f(s.entry_low)}–{f(s.entry_high)}</span></span><span className="text-red-400/70">SL {f(s.stop_loss)}</span><span className="text-emerald-400/70">TP {f(s.target)}</span></div>
            </div>
          ))}
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">10-Year ICT Backtest · Real Daily Data</div>
          <div className="flex gap-2 items-end mb-3">
            <div><label className="text-zinc-600 text-xs block mb-1">Symbol</label>
              <select className={inp} value={btForm.symbol} onChange={e=>setBtForm({symbol:e.target.value})}>
                {['BTC-USD','ETH-USD','SOL-USD','BNB-USD','XRP-USD'].map(s=><option key={s}>{s}</option>)}
              </select></div>
            <button onClick={runBt} disabled={btRunning} className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 text-xs px-4 py-1.5 rounded-lg transition-colors">{btRunning?'Running 10yrs...':'Run Backtest'}</button>
          </div>
          {btErr&&<div className="text-red-400/70 text-xs bg-red-500/5 rounded p-2 mb-2">{btErr}</div>}
          {btResult&&(
            <div>
              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                {[['Signals',btResult.total_signals],['Win Rate',btResult.win_rate+'%'],['Avg R:R',btResult.avg_rr+'R'],['Profit Factor',btResult.profit_factor],['Best Year',btResult.best_year],['Worst Year',btResult.worst_year]].map(([l,v])=>(
                  <div key={l as string} className="bg-zinc-800 rounded-lg p-2"><div className="text-zinc-500 mb-0.5 text-xs">{l}</div><div className="text-zinc-200">{v}</div></div>
                ))}
              </div>
              <div className="text-zinc-600 text-xs mb-1.5">Yearly win rates:</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(btResult.yearly_breakdown).sort(([a],[b])=>a.localeCompare(b)).map(([yr,s])=>{const wr=s.total>0?Math.round(s.wins/s.total*100):0;return(<span key={yr} className={`text-xs px-2 py-0.5 rounded ${wr>=55?'bg-emerald-500/10 text-emerald-400':'bg-red-500/10 text-red-400'}`}>{yr} {wr}%</span>);})}
              </div>
            </div>
          )}
          {!btResult&&prevRuns.length>0&&(
            <div>
              <div className="text-zinc-600 text-xs mb-2">Previous runs:</div>
              {prevRuns.slice(0,4).map(r=><div key={r.id} className="flex justify-between text-xs py-1 border-b border-zinc-800/50"><span className="text-zinc-400">{r.symbol}</span><span className={r.win_rate>=55?'text-emerald-400':'text-red-400'}>{r.win_rate}%</span><span className="text-zinc-500">{r.total_signals} signals</span><span className="text-blue-400">{r.profit_factor}PF</span></div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── FOREX TAB ─────────────────────────────────────────────────────
function ForexTab({setups,onChart,onDelete}:{setups:Setup[];onChart:(s:Setup)=>void;onDelete:(id:string)=>void}){
  const [data,setData]=useState<{forex:Quote[];commodities:Quote[]}>({forex:[],commodities:[]});
  useEffect(()=>{
    fetch('/api/forex').then(r=>r.json()).then(d=>setData({forex:d.forex??[],commodities:d.commodities??[]}));
    const i=setInterval(()=>fetch('/api/forex').then(r=>r.json()).then(d=>setData({forex:d.forex??[],commodities:d.commodities??[]})),30000);
    return()=>clearInterval(i);
  },[]);
  const fxSetups=setups.filter(s=>s.market_section==='forex'||['EUR','GBP','USD','JPY','AUD','CAD','CHF','XAU','CL','GC'].some(c=>s.symbol?.toUpperCase().includes(c)));
  return(
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Forex Pairs · Live</div>
        <div className="grid grid-cols-4 gap-2">
          {data.forex.length===0?<div className="col-span-4 text-zinc-600 text-xs">Loading...</div>:data.forex.map(p=><PCard key={p.symbol} name={p.name} price={p.price?.toFixed(4)??'—'} change={p.change}/>)}
        </div>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Commodities · Live</div>
        <div className="grid grid-cols-4 gap-2">
          {data.commodities.length===0?<div className="col-span-4 text-zinc-600 text-xs">Loading...</div>:data.commodities.map(p=><PCard key={p.symbol} name={p.name} price={p.price?`$${p.price.toFixed(2)}`:'—'} change={p.change}/>)}
        </div>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="flex justify-between items-center mb-3"><span className="text-zinc-500 text-xs uppercase tracking-wider">ICT Setups · Forex</span><span className="text-zinc-600 text-xs">{fxSetups.length}</span></div>
        {fxSetups.length===0?<div className="text-zinc-600 text-xs">No forex setups — run Scan with EUR/GBP/XAU symbols</div>:fxSetups.map(s=>(
          <div key={s.id} className="border border-zinc-800 hover:border-zinc-700 rounded-lg px-3 py-2.5 mb-2 transition-colors">
            <div className="flex justify-between items-center mb-1"><div className="flex items-center gap-2"><span className="text-white text-xs font-semibold">{s.symbol}</span><span style={{color:dc(s.direction)}} className="text-xs">{s.direction}</span><span className="text-zinc-400 text-xs">{s.setup_type}</span></div><div className="flex items-center gap-1.5"><Ring score={s.confluence_score}/><button onClick={()=>onChart(s)} className="text-zinc-600 hover:text-blue-400 text-xs">chart</button><button onClick={()=>onDelete(s.id)} className="text-zinc-700 hover:text-red-400 text-xs">✕</button></div></div>
            <div className="flex gap-3 text-xs text-zinc-500"><span>E <span className="text-zinc-300">{f(s.entry_low,4)}–{f(s.entry_high,4)}</span></span><span className="text-red-400/70">SL {f(s.stop_loss,4)}</span><span className="text-emerald-400/70">TP {f(s.target,4)}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── STOCKS TAB ────────────────────────────────────────────────────
function StocksTab({setups,onChart,onDelete}:{setups:Setup[];onChart:(s:Setup)=>void;onDelete:(id:string)=>void}){
  const [data,setData]=useState<{indices:Quote[];etfs:Quote[];stocks:Quote[]}>({indices:[],etfs:[],stocks:[]});
  useEffect(()=>{
    fetch('/api/stocks').then(r=>r.json()).then(d=>setData({indices:d.indices??[],etfs:d.etfs??[],stocks:d.stocks??[]}));
    const i=setInterval(()=>fetch('/api/stocks').then(r=>r.json()).then(d=>setData({indices:d.indices??[],etfs:d.etfs??[],stocks:d.stocks??[]})),30000);
    return()=>clearInterval(i);
  },[]);
  const stkSetups=setups.filter(s=>s.market_section==='stocks'||['SPY','QQQ','AAPL','NVDA','MSFT','AMZN','META','GOOGL','TSLA','IWM'].some(c=>s.symbol?.toUpperCase().includes(c)));
  return(
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Major Indices · Live</div>
        <div className="grid grid-cols-5 gap-2">
          {data.indices.map(p=><PCard key={p.symbol} name={p.name} price={p.price?p.price.toLocaleString('en-US',{maximumFractionDigits:1}):'—'} change={p.change}/>)}
        </div>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">ETFs · Live</div>
        <div className="grid grid-cols-5 gap-2">
          {data.etfs.map(p=><PCard key={p.symbol} name={p.name} price={p.price?`$${p.price.toFixed(2)}`:'—'} change={p.change} sub={p.symbol}/>)}
        </div>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Mega Cap Stocks · Live</div>
        <div className="grid grid-cols-4 gap-2">
          {data.stocks.map(p=><PCard key={p.symbol} name={p.name} price={p.price?`$${p.price.toFixed(2)}`:'—'} change={p.change} sub={p.symbol}/>)}
        </div>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="flex justify-between items-center mb-3"><span className="text-zinc-500 text-xs uppercase tracking-wider">ICT Setups · Stocks</span><span className="text-zinc-600 text-xs">{stkSetups.length}</span></div>
        {stkSetups.length===0?<div className="text-zinc-600 text-xs">No stock setups — run Scan with SPY/QQQ/AAPL symbols</div>:stkSetups.map(s=>(
          <div key={s.id} className="border border-zinc-800 hover:border-zinc-700 rounded-lg px-3 py-2.5 mb-2">
            <div className="flex justify-between items-center mb-1"><div className="flex items-center gap-2"><span className="text-white text-xs font-semibold">{s.symbol}</span><span style={{color:dc(s.direction)}} className="text-xs">{s.direction}</span><span className="text-zinc-400 text-xs">{s.setup_type}</span></div><div className="flex items-center gap-1.5"><Ring score={s.confluence_score}/><button onClick={()=>onChart(s)} className="text-zinc-600 hover:text-blue-400 text-xs">chart</button><button onClick={()=>onDelete(s.id)} className="text-zinc-700 hover:text-red-400 text-xs">✕</button></div></div>
            <div className="flex gap-3 text-xs text-zinc-500"><span>E <span className="text-zinc-300">{f(s.entry_low)}–{f(s.entry_high)}</span></span><span className="text-red-400/70">SL {f(s.stop_loss)}</span><span className="text-emerald-400/70">TP {f(s.target)}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── INSTITUTIONAL TAB ──────────────────────────────────────────────
function InstitutionalTab(){
  const [news,setNews]=useState<{headline:string;release_time:string;symbol:string}[]>([]);
  useEffect(()=>{sb.from('news_cache').select('*').order('release_time',{ascending:false}).limit(20).then(({data})=>{if(data)setNews(data as typeof news);});},[]);
  return(
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-6">
      <div className="grid grid-cols-3 gap-4">
        {[
          {title:'BlackRock (BLK)',desc:'Worlds largest asset manager. $10T AUM. Tracks institutional fund flows, ETF inflows, and systematic position changes.'},
          {title:'Bridgewater Associates',desc:'Ray Dalios All Weather fund. Macro-driven. Uses debt cycle, growth cycle, and inflationary analysis for long-term positioning.'},
          {title:'Citadel / Two Sigma',desc:'Quantitative HFT and systematic macro. These players drive intraday liquidity sweeps and algorithmic order flow.'},
        ].map(({title,desc})=>(
          <div key={title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-zinc-200 text-xs font-semibold mb-2">{title}</div>
            <div className="text-zinc-500 text-xs leading-relaxed">{desc}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">What to Watch</div>
          {[['Fed Balance Sheet','Total assets held. Expansion = risk on. Contraction = risk off.'],['COT Report','Commitments of Traders. Commercial hedgers (smart money) vs specs (retail).'],['13F Filings','Quarterly fund holdings. 45-day lag but shows macro positioning.'],['Treasury Yields','10Y minus 2Y spread. Inverted = risk off. Steepening = expansion.'],['DXY Correlation','Strong DXY = weak equities/crypto/commodities. Inverse always.']].map(([k,v])=>(
            <div key={k} className="border-b border-zinc-800/60 py-2 last:border-0">
              <div className="text-zinc-300 text-xs font-medium">{k}</div>
              <div className="text-zinc-500 text-xs mt-0.5">{v}</div>
            </div>
          ))}
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Market News Cache</div>
          {news.length===0?<div className="text-zinc-600 text-xs">News cache loading...</div>:news.slice(0,10).map((n,i)=>(
            <div key={i} className="border-b border-zinc-800/50 py-2 last:border-0">
              <div className="text-zinc-300 text-xs leading-snug">{n.headline}</div>
              <div className="text-zinc-600 text-xs mt-0.5">{n.release_time?new Date(n.release_time).toLocaleDateString():''} · {n.symbol}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── FUTURES TAB ────────────────────────────────────────────────────
function FuturesTab({setups,prices,kz,calNews,onChart,onDelete}:{setups:Setup[];prices:Prices;kz:KZ|null;calNews:CalEvent[];onChart:(s:Setup)=>void;onDelete:(id:string)=>void}){
  const [sel,setSel]=useState<Setup|null>(null);
  const [ai,setAi]=useState('');
  const [aiLoad,setAiLoad]=useState(false);
  const futSetups=setups.filter(s=>!s.market_section||s.market_section==='futures');
  const dangerNews=calNews.some(e=>e.isDangerZone);

  const runAI=async()=>{
    if(!sel)return;
    const p=prices[sel.symbol as keyof Prices];
    const isBull=sel.direction==='bull'||sel.direction==='long';
    const slB=p!==null&&(isBull?p<sel.stop_loss:p>sel.stop_loss);
    const exp=sel.expires_at&&new Date(sel.expires_at)<new Date();
    if(slB||exp){setAi(`INVALIDATED — ${slB?`SL at ${f(sel.stop_loss)} breached`:'expired'}.\n\nDo not trade this.`);return;}
    setAiLoad(true);setAi('');
    try{const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setup:sel,prices,market:'futures'})});const d=await r.json();setAi(d.analysis||d.error||'No response');}catch(e){setAi(String(e));}
    setAiLoad(false);
  };

  const dolQ=sel?[
    {q:'Price location',a:(()=>{const p=prices[sel.symbol as keyof Prices];return p?(p<sel.entry_low?`Below zone — ${(sel.entry_low-p).toFixed(0)}pts`:p>sel.entry_high?`Above zone — ${(p-sel.entry_high).toFixed(0)}pts`:`INSIDE ZONE (${p.toFixed(1)})`):'—';})()},
    {q:'Draw on Liquidity',a:sel.dol_target||'—'},
    {q:'PD Array',a:`${sel.setup_type} · ${f(sel.entry_low)}–${f(sel.entry_high)}`},
    {q:'Correlated',a:sel.correlated_align?`Aligned (${sel.symbol==='NQ'?'ES':'NQ'} confirms)`:'Not confirmed'},
    {q:'CISD',a:sel.cisd_confirmed?'Full body close confirmed':'Pending — await full body close'},
    {q:'Killzone',a:kz?.active?`${kz.active.name} ACTIVE · ${kz.probability}`:`No active KZ · Next: ${kz?.upcoming[0]?.name??'—'} in ${kz?.upcoming[0]?.minsAway??'?'}m`},
  ]:[];

  return(
    <div className="h-full grid grid-cols-12 gap-3">
      <div className="col-span-12 grid grid-cols-6 gap-2">
        {[
          {l:'NQ',v:prices.NQ?.toFixed(1)??'—',c:prices.NQ&&prices.NQ>29000?'text-emerald-400':'text-red-400'},
          {l:'ES',v:prices.ES?.toFixed(1)??'—',c:'text-zinc-300'},
          {l:'GC',v:prices.GC?.toFixed(1)??'—',c:'text-yellow-400'},
          {l:'DXY',v:prices.DXY?.toFixed(3)??'—',c:'text-zinc-400'},
          {l:'VIX',v:prices.VIX?.toFixed(2)??'—',c:prices.VIX&&prices.VIX>20?'text-red-400':'text-emerald-400'},
          {l:'Session',v:kz?.active?.short??'OFF HOURS',c:kz?.active?'text-emerald-400':'text-zinc-500'},
        ].map(s=><div key={s.l} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><div className="text-zinc-500 text-xs mb-1">{s.l}</div><div className={`text-base font-semibold ${s.c}`}>{s.v}</div></div>)}
      </div>
      <div className="col-span-7 flex flex-col gap-2 overflow-hidden">
        <div className="text-zinc-500 text-xs uppercase tracking-wider">{dangerNews&&<span className="text-red-400 mr-2">⚠ NEWS RISK</span>}Active Setups · {futSetups.length}</div>
        <div className="overflow-y-auto flex-1 space-y-1.5 pb-2">
          {futSetups.length===0&&<div className="text-center py-16 text-zinc-600 text-sm">No setups — run Scan</div>}
          {futSetups.map(s=>{
            const p=prices[s.symbol as keyof Prices];
            const inZone=p!==null&&p>=s.entry_low&&p<=s.entry_high;
            const slB=p!==null&&(s.direction==='bull'?p<s.stop_loss:p>s.stop_loss);
            return(
              <div key={s.id} onClick={()=>{setSel(s);setAi(s.ai_analysis||'');}}
                className={`rounded-xl border px-4 py-3 cursor-pointer transition-all ${sel?.id===s.id?'border-zinc-600 bg-zinc-800/60':'border-zinc-800 hover:border-zinc-700 bg-zinc-900/50'} ${slB?'opacity-30':''}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-white font-semibold text-xs">{s.symbol}</span>
                    <span className="text-zinc-400 text-xs">{s.timeframe}</span>
                    <span className="text-xs font-medium" style={{color:dc(s.direction)}}>{s.direction}</span>
                    <span className="text-zinc-400 text-xs">{s.setup_type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {inZone&&<span className="text-emerald-400 text-xs animate-pulse font-medium">ENTRY</span>}
                    {slB&&<span className="text-red-400 text-xs font-medium">SL HIT</span>}
                    <Ring score={s.confluence_score}/>
                    <button onClick={e=>{e.stopPropagation();onChart(s);}} className="text-zinc-600 hover:text-blue-400 text-xs transition-colors">chart</button>
                    <button onClick={e=>{e.stopPropagation();onDelete(s.id);}} className="text-zinc-700 hover:text-red-400 text-xs transition-colors">✕</button>
                  </div>
                </div>
                <div className="flex gap-4 text-xs text-zinc-500">
                  <span>E <span className="text-zinc-300">{f(s.entry_low)}–{f(s.entry_high)}</span></span>
                  <span>SL <span className="text-red-400/70">{f(s.stop_loss)}</span></span>
                  <span>TP <span className="text-emerald-400/70">{f(s.target)}</span></span>
                  <span>{f(s.rr_ratio,1)}R</span>
                  <span className="ml-auto text-zinc-600">{s.cisd_confirmed?'cisd✓':'cisd○'} · {s.htf_bias?.slice(0,4)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="col-span-5 flex flex-col gap-3 overflow-hidden">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 shrink-0">
          <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2.5">DOL Framework · 6 Questions</div>
          {dolQ.length>0?dolQ.map((q,i)=>(
            <div key={i} className="flex gap-2 text-xs py-0.5">
              <span className="text-zinc-700 w-4 shrink-0">{i+1}</span>
              <span className="text-zinc-500 w-24 shrink-0">{q.q}</span>
              <span className={`${i===4&&!sel?.cisd_confirmed?'text-yellow-400/80':'text-zinc-300'}`}>{q.a}</span>
            </div>
          )):<div className="text-zinc-700 text-xs">Select a setup</div>}
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2.5 shrink-0">
            <span className="text-zinc-500 text-xs uppercase tracking-wider">AI · ICT Methodology</span>
            <button onClick={runAI} disabled={!sel||aiLoad} className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 rounded-lg transition-colors">{aiLoad?'Analysing...':'Analyse'}</button>
          </div>
          {sel&&<div className="text-zinc-500 text-xs mb-2 shrink-0">{sel.symbol} · {sel.setup_type}</div>}
          <div className="flex-1 overflow-y-auto">
            {ai?<pre className={`text-xs leading-relaxed whitespace-pre-wrap ${ai.startsWith('INVALIDATED')?'text-red-400/70':'text-zinc-300'}`}>{ai}</pre>:<div className="text-zinc-700 text-xs">{sel?'Click Analyse':'Select a setup'}</div>}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 shrink-0">
          <div className="grid grid-cols-6 gap-1 mb-2.5">
            {[{s:'ASIA',c:'#6366f1'},{s:'LON',c:'#f59e0b'},{s:'NY',c:'#10b981'},{s:'SB',c:'#3b82f6'},{s:'LCL',c:'#f87171'},{s:'NYA',c:'#a855f7'}].map(z=>{
              const isA=kz?.active?.short===z.s;
              return <div key={z.s} className="rounded-lg py-1.5 text-center" style={{background:isA?z.c+'18':'rgba(255,255,255,0.03)',border:`0.5px solid ${isA?z.c+'50':'rgba(255,255,255,0.07)'}`}}>
                <div className="text-xs font-medium" style={{color:isA?z.c:'rgba(255,255,255,0.3)',fontSize:'10px'}}>{z.s}</div>
                {isA&&<div className="text-xs animate-pulse" style={{color:z.c,fontSize:'9px'}}>LIVE</div>}
              </div>;
            })}
          </div>
          {calNews.slice(0,4).map((e,i)=>(
            <div key={i} className={`flex justify-between text-xs py-0.5 ${e.isDangerZone?'text-red-400 animate-pulse':e.isToday?'text-yellow-400/80':'text-zinc-600'}`}>
              <span className="truncate mr-2">{e.name}</span>
              <span className="shrink-0">{e.isToday?(e.minutesAway!==null?(e.minutesAway>0?`${e.minutesAway}m`:`${Math.abs(e.minutesAway)}m ago`):'TODAY'):e.date}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── SCAN MODAL ────────────────────────────────────────────────────
function ScanModal({prices,kz,onClose,onSaved}:{prices:Prices;kz:KZ|null;onClose:()=>void;onSaved:()=>void}){
  const [syms,setSyms]=useState<string[]>(['NQ','ES']);
  const [tfs,setTfs]=useState<string[]>(['15m','1h']);
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<{message:string;count:number;setups:{symbol:string;timeframe:string;direction:string;setup_type:string;entry_low:number;entry_high:number;stop_loss:number;target:number;rr_ratio:number;confluence_score:number}[]}|null>(null);
  const [err,setErr]=useState('');
  const togS=(s:string)=>setSyms(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);
  const togT=(t:string)=>setTfs(p=>p.includes(t)?p.filter(x=>x!==t):[...p,t]);
  const scan=async()=>{setLoading(true);setResult(null);setErr('');try{const r=await fetch('/api/autoscan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols:syms,timeframes:tfs,currentPrices:prices})});const d=await r.json();if(d.error)setErr(typeof d.error==='string'?d.error:JSON.stringify(d.error));else setResult(d);}catch(e){setErr(String(e));}setLoading(false);};
  const btn=(a:boolean)=>`text-xs px-3 py-1.5 rounded-lg border transition-colors ${a?'border-zinc-500 bg-zinc-700 text-zinc-200':'border-zinc-700 text-zinc-500 hover:border-zinc-600'}`;
  return(
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-[420px] max-h-[85vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4"><span className="text-zinc-100 text-sm font-semibold">Auto Scan · Live Market</span><button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg">×</button></div>
        <div className="grid grid-cols-2 gap-2 bg-zinc-800/50 rounded-xl p-3 text-xs mb-4">
          {(['NQ','ES','GC','DXY'] as const).map(s=><div key={s} className="flex justify-between"><span className="text-zinc-500">{s}</span><span className="text-zinc-200">{prices[s]?.toFixed(s==='DXY'?3:1)??'—'}</span></div>)}
        </div>
        <div className="mb-3"><div className="text-zinc-500 text-xs mb-2">Symbols</div><div className="flex flex-wrap gap-2">{['NQ','ES','BTC','ETH','SOL'].map(s=><button key={s} onClick={()=>togS(s)} className={btn(syms.includes(s))}>{s}</button>)}</div></div>
        <div className="mb-4"><div className="text-zinc-500 text-xs mb-2">Timeframes</div><div className="flex gap-2">{['15m','1h','4h'].map(t=><button key={t} onClick={()=>togT(t)} className={btn(tfs.includes(t))}>{t}</button>)}</div></div>
        <button onClick={scan} disabled={loading||!syms.length||!tfs.length} className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-100 text-sm py-2.5 rounded-xl font-medium mb-4 transition-colors">{loading?'Scanning live candles...':'Scan Now'}</button>
        {err&&<div className="text-red-400/80 text-xs bg-red-500/5 border border-red-500/20 rounded-xl p-3 mb-3">{err}</div>}
        {result&&(
          <div className={`rounded-xl p-3 text-xs ${result.count>0?'bg-emerald-500/5 border border-emerald-500/20':'bg-yellow-500/5 border border-yellow-500/20'}`}>
            <div className={`font-semibold mb-2 ${result.count>0?'text-emerald-400':'text-yellow-400'}`}>{result.message}</div>
            {result.setups?.map((s,i)=>(
              <div key={i} className="border-t border-zinc-800 pt-2 mt-2 first:border-0 first:mt-0 first:pt-0">
                <div className="flex justify-between mb-0.5"><span className="text-zinc-200 font-medium">{s.symbol} {s.timeframe}</span><span style={{color:dc(s.direction)}}>{s.direction.toUpperCase()}</span></div>
                <div className="text-zinc-400">{s.setup_type}</div>
                <div className="flex gap-3 mt-1 text-zinc-500"><span>E:{f(s.entry_low)}–{f(s.entry_high)}</span><span className="text-red-400/60">SL:{f(s.stop_loss)}</span><span className="text-emerald-400/60">TP:{f(s.target)}</span><span className="text-blue-400/60">{f(s.rr_ratio,1)}R</span></div>
              </div>
            ))}
            {result.count>0&&<button onClick={()=>{onSaved();onClose();}} className="w-full mt-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs py-1.5 rounded-lg">View setups</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MMXM TAB ──────────────────────────────────────────────────────
function MMXMTab(){
  const [biases,setBiases]=useState<{id:string;week_start:string;symbol:string;bias:string;amd_phase:string;htf_draw:string;notes:string}[]>([]);
  const [cw,setCw]=useState('');
  const [form,setForm]=useState({symbol:'NQ',bias:'bullish',amd_phase:'accumulation',htf_draw:'',notes:''});
  const [saving,setSaving]=useState(false);
  const inp="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500";
  useEffect(()=>{fetch('/api/weekbias').then(r=>r.json()).then(d=>{setBiases(d.biases??[]);setCw(d.currentWeek??'');});},[]);
  const save=async()=>{setSaving(true);await fetch('/api/weekbias',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,week_start:cw})});const r=await fetch('/api/weekbias');const d=await r.json();setBiases(d.biases??[]);setSaving(false);};
  const phases=['accumulation','manipulation','distribution','reaccumulation','redistribution'];
  const pbtn=(a:boolean,color='')=>`text-xs px-2.5 py-1 rounded-lg border transition-colors ${a?color||'border-zinc-500 bg-zinc-700 text-zinc-200':'border-zinc-800 text-zinc-600 hover:border-zinc-700'}`;
  return(
    <div className="flex flex-col gap-4 overflow-y-auto h-full pb-6">
      <div className="grid grid-cols-3 gap-4">
        {[['Accumulation','Asia session. Range builds. Liquidity stacks above and below. Smart money positions silently. No direction.','rgba(99,102,241,0.12)','rgba(99,102,241,0.4)'],['Manipulation','London open. Judas swing. Engineered move to sweep SSL or BSL. Traps retail. CISD follows.','rgba(245,158,11,0.12)','rgba(245,158,11,0.4)'],['Distribution','NY session. True delivery. Price moves to the opposing DOL from the manipulation sweep.','rgba(16,185,129,0.12)','rgba(16,185,129,0.4)']].map(([ph,desc,bg,border])=>(
          <div key={ph} className="rounded-xl p-4" style={{background:bg,border:`0.5px solid ${border}`}}>
            <div className="font-semibold mb-2 text-sm" style={{color:border}}>{ph}</div>
            <div className="text-zinc-400 text-xs leading-relaxed">{desc}</div>
          </div>
        ))}
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Weekly Bias Builder · {cw}</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['NQ','ES'] as const).map(s=><button key={s} onClick={()=>setForm(p=>({...p,symbol:s}))} className={pbtn(form.symbol===s)}>{s}</button>)}
          {[{v:'bullish',c:'border-emerald-600/50 bg-emerald-500/10 text-emerald-400'},{v:'bearish',c:'border-red-600/50 bg-red-500/10 text-red-400'},{v:'consolidation',c:'border-yellow-600/50 bg-yellow-500/10 text-yellow-400'}].map(({v,c})=><button key={v} onClick={()=>setForm(p=>({...p,bias:v}))} className={pbtn(form.bias===v,c)}>{v}</button>)}
        </div>
        <div className="text-zinc-600 text-xs mb-1.5">AMD Phase</div>
        <div className="flex flex-wrap gap-1.5 mb-3">{phases.map(p=><button key={p} onClick={()=>setForm(f=>({...f,amd_phase:p}))} className={pbtn(form.amd_phase===p)}>{p}</button>)}</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div><label className="text-zinc-600 text-xs block mb-1">HTF Draw</label><input className={inp} value={form.htf_draw} onChange={e=>setForm(p=>({...p,htf_draw:e.target.value}))} placeholder="BSL at 30200"/></div>
          <div><label className="text-zinc-600 text-xs block mb-1">Notes</label><input className={inp} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Weekly narrative..."/></div>
        </div>
        <button onClick={save} disabled={saving} className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-xs px-4 py-1.5 rounded-lg transition-colors">{saving?'Saving...':'Save Bias'}</button>
      </div>
      {biases.length>0&&<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Bias History</div>
        {biases.map(b=><div key={b.id} className="border-b border-zinc-800/60 py-2 last:border-0"><div className="flex justify-between text-xs mb-0.5"><span className="text-zinc-500">{b.week_start} · {b.symbol}</span><span className={b.bias==='bullish'?'text-emerald-400':b.bias==='bearish'?'text-red-400':'text-yellow-400'}>{b.bias?.toUpperCase()}</span></div><div className="text-zinc-500 text-xs">{b.amd_phase}{b.htf_draw?` · ${b.htf_draw}`:''}</div>{b.notes&&<div className="text-zinc-600 text-xs">{b.notes}</div>}</div>)}
      </div>}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">ICT Key Rules · From Your Videos</div>
        <div className="grid grid-cols-2 gap-3">
          {[['CISD','Full candle BODY close through prior swing. Wick = NOT CISD. Most common entry error.'],['Liquidity Sequence','SSL must be swept BEFORE going long. BSL swept BEFORE going short. Never buy into BSL.'],['Premium/Discount','Below 50% equilibrium = discount (longs only). Above 50% = premium (shorts only).'],['DOL First','Always find the Draw on Liquidity before the setup. No DOL = no trade.'],['Killzone','8:30–11am NY is the model. Noon–1pm is dead. Outside these = low probability.'],['Confluence','HTF bias + liquidity swept + CISD + PD array in zone + DOL clear. All 5 required.']].map(([t,d])=>(
            <div key={t} className="border border-zinc-800 rounded-xl p-3">
              <div className="text-zinc-200 text-xs font-semibold mb-1.5">{t}</div>
              <div className="text-zinc-500 text-xs leading-relaxed">{d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── ANALYTICS TAB ─────────────────────────────────────────────────
function AnalyticsTab(){
  const [runs,setRuns]=useState<BtRun[]>([]);
  const [btf,setBtf]=useState({symbol:'BTC-USD',marketSection:'crypto'});
  const [btR,setBtR]=useState(false),[btRes,setBtRes]=useState<BtRun|null>(null),[btErr,setBtErr]=useState('');
  useEffect(()=>{fetch('/api/deepbacktest').then(r=>r.json()).then(d=>setRuns(d.results??[]));},[]);
  const run=async()=>{setBtR(true);setBtRes(null);setBtErr('');try{const r=await fetch('/api/deepbacktest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(btf)});const d=await r.json();if(d.error)setBtErr(d.error);else{setBtRes(d.run);setRuns(p=>[d.run,...p]);}}catch(e){setBtErr(String(e));}setBtR(false);};
  const inp="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none";
  return(
    <div className="flex flex-col gap-4 overflow-y-auto h-full pb-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Deep Backtest Engine · 10 Years · Real OHLCV Data</div>
        <div className="flex gap-3 items-end mb-4">
          <div><label className="text-zinc-600 text-xs block mb-1">Symbol (Yahoo format)</label><input className={inp+' w-32'} value={btf.symbol} onChange={e=>setBtf(p=>({...p,symbol:e.target.value}))} placeholder="BTC-USD"/></div>
          <div><label className="text-zinc-600 text-xs block mb-1">Section</label><select className={inp} value={btf.marketSection} onChange={e=>setBtf(p=>({...p,marketSection:e.target.value}))}><option value="crypto">Crypto</option><option value="forex">Forex</option><option value="stocks">Stocks</option><option value="futures">Futures</option></select></div>
          <button onClick={run} disabled={btR} className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 text-xs px-5 py-1.5 rounded-lg transition-colors">{btR?'Running 10 years...':'Run Backtest'}</button>
        </div>
        <div className="text-zinc-600 text-xs mb-3">Examples: BTC-USD · ETH-USD · EURUSD=X · GC=F (Gold) · ^GSPC (S&P 500) · SPY · AAPL</div>
        {btErr&&<div className="text-red-400/70 text-xs bg-red-500/5 border border-red-500/15 rounded-xl p-3 mb-3">{btErr}</div>}
        {btRes&&(
          <div className="border border-zinc-800 rounded-xl p-4">
            <div className="text-zinc-300 text-xs font-semibold mb-3">{btRes.symbol} · {btRes.from_date} → {btRes.to_date} · {btRes.total_signals} signals</div>
            <div className="grid grid-cols-4 gap-2 text-xs mb-3">
              {[['Win Rate',btRes.win_rate+'%',btRes.win_rate>=55?'text-emerald-400':'text-red-400'],['Avg R:R',btRes.avg_rr+'R','text-blue-400'],['Profit Factor',btRes.profit_factor,'text-yellow-400'],['Total P&L',btRes.total_pnl+'R',btRes.total_pnl>0?'text-emerald-400':'text-red-400']].map(([l,v,c])=>(
                <div key={l as string} className="bg-zinc-800 rounded-lg p-2"><div className="text-zinc-500 mb-0.5">{l}</div><div className={c as string}>{v}</div></div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(btRes.yearly_breakdown).sort(([a],[b])=>a.localeCompare(b)).map(([yr,s])=>{const wr=s.total>0?Math.round(s.wins/s.total*100):0;return <span key={yr} className={`text-xs px-2 py-0.5 rounded-lg ${wr>=55?'bg-emerald-500/10 text-emerald-400':'bg-red-500/10 text-red-400'}`}>{yr} {wr}% ({s.total})</span>;})}
            </div>
          </div>
        )}
      </div>
      {runs.length>0&&<div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="text-zinc-500 text-xs uppercase tracking-wider mb-3">Previous Runs</div>
        <table className="w-full text-xs"><thead><tr className="text-zinc-600 border-b border-zinc-800"><th className="text-left py-1">Symbol</th><th className="text-right">Signals</th><th className="text-right">Win%</th><th className="text-right">PF</th><th className="text-right">Best Yr</th><th className="text-right">Date</th></tr></thead><tbody>
          {runs.slice(0,10).map(r=><tr key={r.id} className="border-t border-zinc-800/50"><td className="py-1 text-zinc-300">{r.symbol}</td><td className="text-right text-zinc-500">{r.total_signals}</td><td className={`text-right ${r.win_rate>=55?'text-emerald-400':'text-red-400'}`}>{r.win_rate}%</td><td className="text-right text-blue-400">{r.profit_factor}</td><td className="text-right text-yellow-400">{r.best_year}</td><td className="text-right text-zinc-600">{r.from_date?.slice(0,4)+'–'+r.to_date?.slice(0,4)}</td></tr>)}
        </tbody></table>
      </div>}
    </div>
  );
}

// ── JOURNAL TAB ───────────────────────────────────────────────────
function JournalTab(){
  const [entries,setEntries]=useState<{id:string;date:string;title:string;content:string;emotion:string;result:string}[]>([]);
  const [form,setForm]=useState({date:new Date().toISOString().slice(0,10),title:'',content:'',emotion:'neutral',result:'no trade'});
  const [adding,setAdding]=useState(false),[saving,setSaving]=useState(false);
  const inp="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500";
  useEffect(()=>{sb.from('journal').select('*').order('date',{ascending:false}).limit(50).then(({data})=>{if(data)setEntries(data as typeof entries);});},[]);
  const save=async()=>{if(!form.title||!form.content)return;setSaving(true);const {data}=await sb.from('journal').insert(form).select();if(data){setEntries(p=>[data[0] as typeof entries[0],...p]);setAdding(false);setForm({date:new Date().toISOString().slice(0,10),title:'',content:'',emotion:'neutral',result:'no trade'});}setSaving(false);};
  const eC=(e:string)=>e==='confident'?'text-emerald-400':e==='patient'?'text-blue-400':(e==='fomo'||e==='revenge'||e==='anxious')?'text-red-400':'text-zinc-400';
  const rC=(r:string)=>r==='win'?'text-emerald-400':r==='loss'?'text-red-400':r==='be'?'text-yellow-400':'text-zinc-600';
  return(
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex justify-between items-center shrink-0"><span className="text-zinc-500 text-xs uppercase tracking-wider">Trading Journal</span><button onClick={()=>setAdding(true)} className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors">+ Entry</button></div>
      {adding&&<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 shrink-0">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div><label className="text-zinc-600 text-xs block mb-1">Date</label><input type="date" className={inp} value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
          <div><label className="text-zinc-600 text-xs block mb-1">Emotion</label><select className={inp} value={form.emotion} onChange={e=>setForm(p=>({...p,emotion:e.target.value}))}><option value="confident">Confident</option><option value="patient">Patient</option><option value="neutral">Neutral</option><option value="anxious">Anxious</option><option value="fomo">FOMO</option><option value="revenge">Revenge</option></select></div>
          <div><label className="text-zinc-600 text-xs block mb-1">Result</label><select className={inp} value={form.result} onChange={e=>setForm(p=>({...p,result:e.target.value}))}><option value="win">Win</option><option value="loss">Loss</option><option value="be">BE</option><option value="no trade">No Trade</option></select></div>
        </div>
        <div className="mb-2"><label className="text-zinc-600 text-xs block mb-1">Title / Setup taken</label><input className={inp} value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/></div>
        <div className="mb-3"><label className="text-zinc-600 text-xs block mb-1">Notes</label><textarea className={inp+' resize-none'} rows={3} value={form.content} onChange={e=>setForm(p=>({...p,content:e.target.value}))}/></div>
        <div className="flex gap-2"><button onClick={save} disabled={saving} className="flex-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 text-xs py-1.5 rounded-lg">{saving?'Saving...':'Save'}</button><button onClick={()=>setAdding(false)} className="px-4 bg-zinc-800 text-zinc-500 text-xs rounded-lg">Cancel</button></div>
      </div>}
      <div className="overflow-y-auto flex-1 space-y-2 pb-4">
        {entries.map(e=><div key={e.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><div className="flex justify-between mb-2"><div><span className="text-zinc-200 text-xs font-semibold">{e.title}</span><span className="text-zinc-600 text-xs ml-2">{e.date}</span></div><div className="flex gap-2 text-xs"><span className={eC(e.emotion)}>{e.emotion}</span><span className={rC(e.result)}>{e.result?.toUpperCase()}</span></div></div><p className="text-zinc-400 text-xs leading-relaxed whitespace-pre-wrap">{e.content}</p></div>)}
        {!entries.length&&!adding&&<div className="text-center py-16 text-zinc-700 text-sm">No entries yet</div>}
      </div>
    </div>
  );
}

// ── KNOWLEDGE TAB ──────────────────────────────────────────────────
function KnowledgeTab(){
  const [articles,setArticles]=useState<{id:string;title:string;content:string;category:string;source_episode:string;tags:string[];is_user_note:boolean}[]>([]);
  const [search,setSearch]=useState('');
  const [adding,setAdding]=useState(false);
  const [form,setForm]=useState({title:'',content:'',category:'concept',tags:''});
  const [saving,setSaving]=useState(false);
  const inp="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none";
  useEffect(()=>{
    const client = createClient(
      'https://xavkbjbgmuasfkliptsh.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
    );
    client.from('knowledge_base').select('*').order('source_episode').limit(100).then(({data,error})=>{
      if(error) console.error('KB error:', error);
      if(data) setArticles(data as typeof articles);
    });
  },[]);
  const saveNote=async()=>{if(!form.title||!form.content)return;setSaving(true);const {data}=await sb.from('knowledge_base').insert({...form,tags:form.tags.split(',').map(t=>t.trim()).filter(Boolean),is_user_note:true,source_episode:'My Notes'}).select();if(data){setArticles(p=>[data[0] as typeof articles[0],...p]);setAdding(false);setForm({title:'',content:'',category:'concept',tags:''});}setSaving(false);};
  const filtered=articles.filter(a=>!search||a.title?.toLowerCase().includes(search.toLowerCase())||a.content?.toLowerCase().includes(search.toLowerCase()));
  return(
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex gap-2 shrink-0">
        <input placeholder="Search ICT concepts, rules, setups..." value={search} onChange={e=>setSearch(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"/>
        <button onClick={()=>setAdding(!adding)} className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-colors">+ Note</button>
      </div>
      {adding&&<div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 shrink-0">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="col-span-2"><label className="text-zinc-600 text-xs block mb-1">Title</label><input className={inp} value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/></div>
          <div><label className="text-zinc-600 text-xs block mb-1">Category</label><select className={inp} value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))}><option value="concept">Concept</option><option value="setup">Setup</option><option value="rule">Rule</option><option value="mistake">Mistake</option></select></div>
        </div>
        <div className="mb-3"><textarea className={inp+' resize-none'} rows={3} value={form.content} onChange={e=>setForm(p=>({...p,content:e.target.value}))} placeholder="Describe the concept..."/></div>
        <div className="flex gap-2"><button onClick={saveNote} disabled={saving} className="flex-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 text-xs py-1.5 rounded-lg">{saving?'Saving...':'Save'}</button><button onClick={()=>setAdding(false)} className="px-4 bg-zinc-800 text-zinc-500 text-xs rounded-lg">Cancel</button></div>
      </div>}
      <div className="text-zinc-600 text-xs shrink-0">{filtered.length} of {articles.length} articles</div>
      <div className="overflow-y-auto flex-1">
        <div className="grid grid-cols-2 gap-2 pb-4">
          {filtered.map(a=><div key={a.id} className={`bg-zinc-900 border rounded-xl p-3 ${a.is_user_note?'border-blue-500/20':'border-zinc-800'}`}>
            <div className="flex justify-between items-start mb-1.5"><span className="text-zinc-200 text-xs font-semibold">{a.title}</span><span className="text-zinc-600 text-xs ml-2 shrink-0">{a.source_episode}</span></div>
            <span className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-500">{a.category}</span>
            <p className="text-zinc-400 text-xs mt-2 leading-relaxed">{a.content}</p>
            {a.tags?.length>0&&<div className="flex gap-1 flex-wrap mt-2">{a.tags.map((t:string)=><span key={t} className="text-xs text-zinc-600 bg-zinc-800/80 px-1.5 py-0.5 rounded">{t}</span>)}</div>}
          </div>)}
          {!articles.length&&<div className="col-span-2 text-center text-zinc-700 py-12">Loading knowledge base...</div>}
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState<Tab>('Markets');
  const [mktTab,setMktTab]=useState<MkTab>('Futures');
  const [setups,setSetups]=useState<Setup[]>([]);
  const [prices,setPrices]=useState<Prices>({NQ:null,ES:null,GC:null,DXY:null,VIX:null});
  const [prev,setPrev]=useState<Prices>({NQ:null,ES:null,GC:null,DXY:null,VIX:null});
  const [kz,setKz]=useState<KZ|null>(null);
  const [calNews,setCalNews]=useState<CalEvent[]>([]);
  const [chartSym,setChartSym]=useState('NQ');
  const [chartTf,setChartTf]=useState('15m');
  const [chartSetup,setChartSetup]=useState<Setup|null>(null);
  const [showScan,setShowScan]=useState(false);
  const [alerts,setAlerts]=useState<{id:string;msg:string;type:string}[]>([]);
  const firedAlerts=useRef<Set<string>>(new Set());

  const addAlert=useCallback((msg:string,type='y')=>{const id=Date.now().toString();setAlerts(p=>[...p.slice(-2),{id,msg,type}]);setTimeout(()=>setAlerts(p=>p.filter(a=>a.id!==id)),7000);},[]);
  const loadSetups=useCallback(async()=>{const {data}=await sb.from('setups').select('*').in('status',['active','watching','triggered']).order('confluence_score',{ascending:false}).limit(60);if(data)setSetups(data as Setup[]);},[]);
  const deleteSetup=useCallback(async(id:string)=>{await sb.from('setups').delete().eq('id',id);setSetups(p=>p.filter(s=>s.id!==id));},[]);

  useEffect(()=>{loadSetups();},[loadSetups]);

  const loadPrices=useCallback(async()=>{try{const r=await fetch('/api/prices',{cache:'no-store'});const d=await r.json();if(d.prices){setPrices(cur=>{setPrev(cur);return d.prices;});}}catch{}},[]);
  const loadKz=useCallback(async()=>{try{const r=await fetch('/api/killzone',{cache:'no-store'});const d=await r.json();setKz(d);}catch{}},[]);
  const loadNews=useCallback(async()=>{try{const r=await fetch('/api/calendar',{cache:'no-store'});const d=await r.json();setCalNews(d.events??[]);}catch{}},[]);

  useEffect(()=>{loadPrices();loadKz();loadNews();const pi=setInterval(loadPrices,15000),ki=setInterval(loadKz,60000),ni=setInterval(loadNews,300000);return()=>{clearInterval(pi);clearInterval(ki);clearInterval(ni);};},[loadPrices,loadKz,loadNews]);

  useEffect(()=>{
    if(!prices.NQ&&!prices.ES)return;
    setups.forEach(s=>{
      if(!['active','watching'].includes(s.status))return;
      if(s.expires_at&&new Date(s.expires_at)<new Date())return;
      const p=prices[s.symbol as keyof Prices];if(!p)return;
      const bull=s.direction==='bull'||s.direction==='long';
      const slK=`sl-${s.id}`;if(!firedAlerts.current.has(slK)&&((bull&&p<s.stop_loss)||(!bull&&p>s.stop_loss))){firedAlerts.current.add(slK);addAlert(`SL hit — ${s.symbol} ${s.setup_type}`,'r');}
      const eK=`e-${s.id}`;if(!firedAlerts.current.has(eK)&&p>=s.entry_low&&p<=s.entry_high){firedAlerts.current.add(eK);addAlert(`Entry zone — ${s.symbol} ${s.setup_type}`,'g');}
    });
  },[prices,setups,addAlert]);

  const dangerNews=calNews.some(e=>e.isDangerZone);
  const aStyle=(t:string)=>t==='r'?'border-red-500/30 bg-red-500/10 text-red-300':t==='g'?'border-emerald-500/30 bg-emerald-500/10 text-emerald-300':'border-zinc-600 bg-zinc-800 text-zinc-300';

  const handleChart=(s:Setup)=>{setChartSym(s.symbol.includes('BTC')||s.symbol.includes('ETH')?s.symbol.replace('-USD',''):s.symbol);setChartSetup(s);setTab('Chart');};

  return(
    <div className="h-screen bg-zinc-950 text-zinc-100 font-mono text-sm flex flex-col overflow-hidden">
      <div className="fixed top-11 right-3 z-50 flex flex-col gap-1.5 pointer-events-none">
        {alerts.map(a=><div key={a.id} className={`text-xs px-3 py-1.5 rounded-xl border ${aStyle(a.type)}`}>{a.msg}</div>)}
      </div>

      <header className="border-b border-zinc-800 px-5 h-11 flex items-center justify-between shrink-0 bg-zinc-950/90 backdrop-blur">
        <div className="flex items-center gap-3"><span className="text-white font-bold tracking-widest text-sm">VECTOR</span><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span></div>
        <div className="flex items-center gap-5 text-xs">
          {dangerNews&&<span className="text-red-400 animate-pulse font-medium">⚠ NEWS</span>}
          {kz?.active?<span className="px-2 py-0.5 rounded-lg font-medium text-xs" style={{color:kz.active.color,background:kz.active.color+'18'}}>{kz.active.short} · {kz.probability}</span>:<span className="text-zinc-600 text-xs">{kz?.upcoming[0]?`${kz.upcoming[0].short} ${kz.upcoming[0].minsAway}m`:'off hours'}</span>}
          <div className="flex items-center gap-4">
            {(['NQ','ES','GC','DXY','VIX'] as const).map(sym=>{const p=prices[sym],pp=prev[sym],up=p!==null&&pp!==null&&p>pp,dn=p!==null&&pp!==null&&p<pp;return <span key={sym} className={up?'text-emerald-400':dn?'text-red-400':'text-zinc-400'}>{sym} {p!==null?p.toFixed(sym==='VIX'?2:1):'—'}</span>;})}
          </div>
          <span className="text-zinc-600">NY {kz?.nyTime??''}</span>
        </div>
      </header>

      <nav className="border-b border-zinc-800 px-5 flex items-center h-9 shrink-0 bg-zinc-950/90">
        {TABS.map(t=><button key={t} onClick={()=>setTab(t)} className={`px-3 h-full text-xs border-b-2 transition-colors ${tab===t?'border-zinc-400 text-zinc-100':'border-transparent text-zinc-500 hover:text-zinc-300'}`}>{t}</button>)}
        <div className="ml-auto flex gap-2">
          <button onClick={()=>setShowScan(true)} className="text-xs px-3 py-1 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors">Scan</button>
        </div>
      </nav>

      {showScan&&<ScanModal prices={prices} kz={kz} onClose={()=>setShowScan(false)} onSaved={loadSetups}/>}

      <main className="flex-1 overflow-hidden p-4 min-h-0">
        {tab==='Markets'&&(
          <div className="flex flex-col h-full gap-0">
            <div className="flex gap-1 mb-3 shrink-0">
              {MKTABS.map(t=><button key={t} onClick={()=>setMktTab(t)} className={`px-4 py-1.5 text-xs rounded-lg mr-0.5 transition-colors ${mktTab===t?'bg-zinc-700 text-zinc-100':'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}>{t}</button>)}
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              {mktTab==='Futures'&&<FuturesTab setups={setups} prices={prices} kz={kz} calNews={calNews} onChart={handleChart} onDelete={deleteSetup}/>}
              {mktTab==='Crypto'&&<CryptoTab setups={setups} onChart={handleChart} onDelete={deleteSetup}/>}
              {mktTab==='Forex'&&<ForexTab setups={setups} onChart={handleChart} onDelete={deleteSetup}/>}
              {mktTab==='Stocks'&&<StocksTab setups={setups} onChart={handleChart} onDelete={deleteSetup}/>}
              {mktTab==='Institutional'&&<InstitutionalTab/>}
            </div>
          </div>
        )}

        {tab==='Chart'&&(
          <div className="flex flex-col gap-3 h-full">
            <div className="flex gap-2 items-center shrink-0">
              <div className="flex gap-1">{['NQ','ES','BTC','ETH','GC'].map(s=><button key={s} onClick={()=>{setChartSym(s);setChartSetup(null);}} className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${chartSym===s?'border-zinc-500 bg-zinc-700 text-zinc-100':'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>{s}</button>)}</div>
              <div className="flex gap-1">{['15m','1h','4h','D'].map(t=><button key={t} onClick={()=>setChartTf(t)} className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${chartTf===t?'border-zinc-500 bg-zinc-700 text-zinc-100':'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>{t}</button>)}</div>
              {chartSetup&&<div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-zinc-700 text-xs ml-2"><span style={{color:dc(chartSetup.direction)}}>●</span><span className="text-zinc-300">{chartSetup.symbol} {chartSetup.setup_type}</span><button onClick={()=>setChartSetup(null)} className="text-zinc-600 hover:text-zinc-300 ml-1">×</button></div>}
              <button onClick={()=>setShowScan(true)} className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">Scan</button>
            </div>
            {chartSetup&&<div className="flex gap-5 text-xs shrink-0 text-zinc-500"><span>Entry <span className="text-emerald-400/70">{chartSetup.entry_low?.toFixed(1)}–{chartSetup.entry_high?.toFixed(1)}</span></span><span>SL <span className="text-red-400/70">{chartSetup.stop_loss?.toFixed(1)}</span></span><span>TP <span className="text-blue-400/70">{chartSetup.target?.toFixed(1)}</span></span><span>{chartSetup.rr_ratio?.toFixed(1)}R · {chartSetup.cisd_confirmed?'CISD confirmed':'CISD pending'}</span></div>}
            <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden min-h-0"><CandleChart sym={chartSym} tf={chartTf} setup={chartSetup}/></div>
            <div className="flex gap-2 flex-wrap shrink-0">
              {setups.filter(s=>s.symbol===chartSym||s.symbol.includes(chartSym)).map(s=>(
                <button key={s.id} onClick={()=>setChartSetup(s)} className={`text-xs px-2 py-1 rounded-lg border transition-colors ${chartSetup?.id===s.id?'border-zinc-500 bg-zinc-700 text-zinc-100':'border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
                  <span style={{color:dc(s.direction)}}>{s.direction}</span> {s.timeframe} {s.setup_type.slice(0,14)}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab==='MMXM'&&<MMXMTab/>}
        {tab==='Analytics'&&<AnalyticsTab/>}
        {tab==='Journal'&&<JournalTab/>}
        {tab==='Knowledge'&&<KnowledgeTab/>}
      </main>
    </div>
  );
}
