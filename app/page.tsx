'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

interface Setup { id:string; symbol:string; timeframe:string; direction:string; setup_type:string; entry_low:number; entry_high:number; stop_loss:number; target:number; rr_ratio:number; confluence_score:number; status:string; dol_target:string; ai_analysis:string; htf_bias:string; cisd_confirmed:boolean; volume_context:string; killzone_valid:string; correlated_align:boolean; expires_at:string; }
interface Trade { id:string; symbol:string; direction:string; entry_price:number; stop_loss:number; take_profit:number; result:string; rr_achieved:number; notes:string; opened_at:string; pnl:number; session:string; }
interface KBArticle { id:string; title:string; content:string; category:string; source_episode:string; tags:string[]; is_user_note:boolean; user_reviewed:boolean; }
interface Candle { t:number; o:number; h:number; l:number; c:number; v?:number; }
interface Prices { NQ:number|null; ES:number|null; GC:number|null; DXY:number|null; VIX:number|null; }
interface KZ { nyTime:string; active:{name:string;short:string;color:string}|null; upcoming:{name:string;short:string;minsAway:number}[]; probability:string; isLunch:boolean; }
interface News { date:string; name:string; impact:string; isToday:boolean; minutesAway:number|null; isDangerZone:boolean; }
interface WeekBias { id:string; week_start:string; symbol:string; bias:string; amd_phase:string; htf_draw:string; notes:string; }
interface BtRun { id:string; name:string; symbol:string; timeframe:string; total_trades:number; win_rate:number; total_pnl:number; max_drawdown:number; sharpe_ratio:number; profit_factor:number; avg_rr:number; max_consecutive_losses:number; created_at:string; }
interface Live extends Setup { rs:number; expired:boolean; slBreach:boolean; inZone:boolean; alert:string|null; }

const TABS = ['Setups','Chart','MMXM','Analytics','Journal','Knowledge'] as const;
type Tab = typeof TABS[number];

const f = (n:number|string|null|undefined, d=2) => { const x=Number(n); return isNaN(x)?'—':x.toFixed(d); };
const dc = (d:string) => d==='bull'||d==='long'?'#22c55e':d==='bear'||d==='short'?'#ef4444':'#f59e0b';

function score(s:Setup, kz:KZ|null, news:News[]): number {
  let sc = s.confluence_score;
  if (news.some(e=>e.isDangerZone)) return Math.max(0,sc-40);
  const kzV = (s.killzone_valid||'any').split(',');
  if (!kzV.includes('any') && !kzV.includes(kz?.active?.short??'')) sc -= 25;
  if (kz?.isLunch) sc -= 20;
  if ((s.htf_bias==='bearish'&&(s.direction==='bull'||s.direction==='long'))||(s.htf_bias==='bullish'&&(s.direction==='bear'||s.direction==='short'))) sc -= 20;
  if (!s.cisd_confirmed) sc -= 10;
  if (s.volume_context==='low') sc -= 10;
  if (!s.correlated_align) sc -= 15;
  if (s.expires_at && new Date(s.expires_at)<new Date()) sc = 0;
  return Math.max(0,Math.min(100,sc));
}

// ── CHART ──────────────────────────────────────────────────────────────
function Chart({ sym, tf, setup }: { sym:string; tf:string; setup:Setup|null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [hov, setHov] = useState<number|null>(null);
  const load = useCallback(async () => {
    try { const r=await fetch(`/api/candles?symbol=${sym}&tf=${tf}`,{cache:'no-store'}); const d=await r.json(); setCandles(d.candles??[]); } catch {}
  }, [sym,tf]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{ const i=setInterval(load,30000); return ()=>clearInterval(i); },[load]);

  useEffect(()=>{
    if (!candles.length||!ref.current) return;
    const cv=ref.current, ctx=cv.getContext('2d')!;
    const W=cv.width, H=cv.height, PL=60, PR=6, PT=16, volH=36;
    const chartH = H-PT-volH-24;
    ctx.clearRect(0,0,W,H);
    const px=candles.map(c=>[c.l,c.h]).flat();
    let mn=Math.min(...px), mx=Math.max(...px);
    if(setup){ [setup.entry_low,setup.entry_high,setup.stop_loss,setup.target].forEach(l=>{if(l<mn)mn=l;if(l>mx)mx=l;}); }
    const p=(maxP:number)=>mn===mx?PT:PT+chartH-(((maxP-mn)/(mx-mn))*chartH);
    const pad=(mx-mn)*0.07; mn-=pad; mx+=pad;
    const pY=(v:number)=>PT+chartH-(((v-mn)/(mx-mn))*chartH);
    const chartW=W-PL-PR, gap=chartW/candles.length, cw=Math.max(1.5,Math.min(10,gap-1));
    const maxV=Math.max(...candles.map(c=>c.v??0));
    // grid
    ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=0.5;
    for(let i=0;i<=5;i++){
      const y=PT+(chartH/5)*i;
      ctx.beginPath();ctx.moveTo(PL,y);ctx.lineTo(W-PR,y);ctx.stroke();
      const pv=mx-((mx-mn)/5)*i;
      ctx.fillStyle='rgba(255,255,255,0.25)';ctx.font='9px monospace';ctx.textAlign='right';
      ctx.fillText(pv.toFixed(0),PL-3,y+3);
    }
    // setup overlay
    if(setup){
      const ey1=pY(setup.entry_high),ey2=pY(setup.entry_low);
      ctx.fillStyle='rgba(34,197,94,0.06)';ctx.fillRect(PL,ey1,chartW,ey2-ey1);
      ctx.strokeStyle='rgba(34,197,94,0.4)';ctx.lineWidth=0.8;ctx.setLineDash([3,3]);ctx.strokeRect(PL,ey1,chartW,ey2-ey1);ctx.setLineDash([]);
      ctx.fillStyle='rgba(34,197,94,0.7)';ctx.font='9px monospace';ctx.textAlign='left';ctx.fillText(`${f(setup.entry_low)}–${f(setup.entry_high)}`,PL+3,ey1-2);
      const sly=pY(setup.stop_loss);
      ctx.strokeStyle='rgba(239,68,68,0.6)';ctx.lineWidth=0.8;ctx.setLineDash([4,2]);ctx.beginPath();ctx.moveTo(PL,sly);ctx.lineTo(W-PR,sly);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='rgba(239,68,68,0.7)';ctx.textAlign='right';ctx.fillText(`SL ${f(setup.stop_loss)}`,W-PR-2,sly-2);
      const tpy=pY(setup.target);
      ctx.strokeStyle='rgba(59,130,246,0.6)';ctx.lineWidth=0.8;ctx.setLineDash([4,2]);ctx.beginPath();ctx.moveTo(PL,tpy);ctx.lineTo(W-PR,tpy);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='rgba(59,130,246,0.7)';ctx.textAlign='right';ctx.fillText(`TP ${f(setup.target)}`,W-PR-2,tpy-2);
    }
    // candles
    candles.forEach((c,i)=>{
      const x=PL+i*gap+gap/2, bull=c.c>=c.o, col=bull?'#22c55e':'#ef4444';
      ctx.strokeStyle=hov===i?'#fff':col; ctx.lineWidth=0.8;
      ctx.beginPath();ctx.moveTo(x,pY(c.h));ctx.lineTo(x,pY(c.l));ctx.stroke();
      const oy=pY(Math.max(c.o,c.c)), cy2=pY(Math.min(c.o,c.c)), bh=Math.max(1,cy2-oy);
      ctx.fillStyle=hov===i?'#fff':col; ctx.fillRect(x-cw/2,oy,cw,bh);
      if(c.v&&maxV>0){ const vh=(c.v/maxV)*volH; ctx.fillStyle=bull?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)'; ctx.fillRect(x-cw/2,PT+chartH+4+volH-vh,cw,vh); }
    });
    // hover tooltip
    if(hov!==null&&candles[hov]){
      const c=candles[hov],x=Math.min(PL+hov*gap+gap/2,W-90);
      ctx.fillStyle='rgba(10,12,16,0.95)';ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=0.5;
      ctx.beginPath();ctx.roundRect(x,PT+2,86,52,3);ctx.fill();ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.5)';ctx.font='9px monospace';ctx.textAlign='left';
      ctx.fillText(new Date(c.t).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}),x+4,PT+12);
      ctx.fillStyle='rgba(255,255,255,0.85)';
      ctx.fillText(`O:${c.o.toFixed(0)} H:${c.h.toFixed(0)}`,x+4,PT+24);
      ctx.fillText(`L:${c.l.toFixed(0)} C:${c.c.toFixed(0)}`,x+4,PT+36);
      if(c.v)ctx.fillText(`V:${(c.v/1000).toFixed(0)}K`,x+4,PT+48);
    }
    // last price line
    const last=candles[candles.length-1];
    if(last){ const ly=pY(last.c); ctx.strokeStyle='rgba(251,191,36,0.5)';ctx.lineWidth=0.5;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(PL,ly);ctx.lineTo(W-PR,ly);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#fbbf24';ctx.textAlign='right';ctx.font='9px monospace';ctx.fillText(last.c.toFixed(1),W-PR-2,ly-2); }
  },[candles,hov,setup]);

  const mm=(e:React.MouseEvent<HTMLCanvasElement>)=>{ if(!ref.current||!candles.length)return; const rect=ref.current.getBoundingClientRect(),x=e.clientX-rect.left,gap=(ref.current.width-66)/candles.length,idx=Math.floor((x-60)/gap); setHov(idx>=0&&idx<candles.length?idx:null); };
  return <canvas ref={ref} width={900} height={400} className="w-full h-full cursor-crosshair" onMouseMove={mm} onMouseLeave={()=>setHov(null)}/>;
}

// ── MODALS ─────────────────────────────────────────────────────────────
function RiskModal({s,onClose}:{s:Setup;onClose:()=>void}){
  const [acc,setAcc]=useState('25000');
  const [rp,setRp]=useState('1');
  const a=parseFloat(acc)||0, ra=a*(parseFloat(rp)/100), pv=s.symbol==='NQ'?20:50;
  const slPts=Math.abs((s.entry_low+s.entry_high)/2-s.stop_loss), slD=slPts*pv;
  const cts=slD>0?Math.floor(ra/slD):0, aRisk=cts*slD;
  const tpPts=Math.abs(s.target-(s.entry_low+s.entry_high)/2), profit=cts*tpPts*pv;
  const inp="w-full bg-[#0d0f14] border border-white/8 rounded px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-white/20";
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#0a0c10] border border-white/8 rounded-xl p-5 w-80" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4"><span className="text-white/90 text-sm font-medium">Risk — {s.symbol} {s.setup_type}</span><button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg leading-none">×</button></div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div><label className="text-white/30 text-xs block mb-1">Account ($)</label><input value={acc} onChange={e=>setAcc(e.target.value)} className={inp}/></div>
          <div><label className="text-white/30 text-xs block mb-1">Risk %</label><input value={rp} onChange={e=>setRp(e.target.value)} className={inp}/></div>
        </div>
        <div className="space-y-2 text-xs border border-white/5 rounded-lg p-3 mb-4">
          <div className="flex justify-between"><span className="text-white/30">Entry</span><span className="text-white/70">{f(s.entry_low)} – {f(s.entry_high)}</span></div>
          <div className="flex justify-between"><span className="text-white/30">SL / TP</span><span><span className="text-red-400">{f(s.stop_loss)}</span><span className="text-white/20 mx-1">/</span><span className="text-green-400">{f(s.target)}</span></span></div>
          <div className="flex justify-between"><span className="text-white/30">SL distance</span><span className="text-white/60">{slPts.toFixed(1)} pts · ${slD.toFixed(0)}/ct</span></div>
          <div className="flex justify-between pt-2 border-t border-white/5">
            <span className="text-blue-400/80 font-medium">Contracts</span>
            <span className="text-white font-bold text-base">{cts}</span>
          </div>
          <div className="flex justify-between"><span className="text-white/30">At risk</span><span className="text-red-400/80">${aRisk.toFixed(0)}</span></div>
          <div className="flex justify-between"><span className="text-white/30">Target profit</span><span className="text-green-400/80">${profit.toFixed(0)}</span></div>
          <div className="flex justify-between"><span className="text-white/30">R:R</span><span className="text-blue-400/80">{f(s.rr_ratio,1)}R</span></div>
        </div>
        <div className={`text-xs text-center rounded-lg p-2 font-medium ${cts>0?'bg-green-500/10 text-green-400':'bg-yellow-500/10 text-yellow-400'}`}>
          {cts>0?`${cts} contract${cts>1?'s':''} · risk $${aRisk.toFixed(0)} · target $${profit.toFixed(0)}`:'Account too small or SL too wide'}
        </div>
      </div>
    </div>
  );
}

function NewSetupModal({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}){
  const [f2,setF2]=useState({symbol:'NQ',timeframe:'15m',direction:'bull',setup_type:'',entry_low:'',entry_high:'',stop_loss:'',target:'',dol_target:'',htf_bias:'bullish',cisd_confirmed:false,volume_context:'medium',killzone_valid:'NY,SB',status:'watching',confluence_score:'70',correlated_align:true});
  const [saving,setSaving]=useState(false),[err,setErr]=useState('');
  const upd=(k:string,v:string|boolean)=>setF2(p=>({...p,[k]:v}));
  const rr=()=>{ const el=parseFloat(f2.entry_low),eh=parseFloat(f2.entry_high),sl=parseFloat(f2.stop_loss),tp=parseFloat(f2.target); if(!el||!sl||!tp)return null; const entry=(el+(eh||el))/2; return Math.abs(el-sl)>0?(Math.abs(tp-entry)/Math.abs(entry-sl)).toFixed(1):null; };
  const save=async()=>{
    if(!f2.entry_low||!f2.stop_loss||!f2.target){setErr('Entry, SL, Target required');return;}
    setSaving(true);setErr('');
    const exp=new Date(Date.now()+(f2.status==='active'?1:3)*86400000).toISOString();
    try{
      const r=await fetch('/api/setups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...f2,entry_low:parseFloat(f2.entry_low),entry_high:parseFloat(f2.entry_high||f2.entry_low),stop_loss:parseFloat(f2.stop_loss),target:parseFloat(f2.target),confluence_score:parseInt(f2.confluence_score),rr_ratio:parseFloat(rr()??'0'),expires_at:exp,ai_analysis:'',invalidated_reason:''})});
      const d=await r.json(); if(d.error)throw new Error(JSON.stringify(d.error));
      onSaved();onClose();
    }catch(e){setErr(String(e));}
    setSaving(false);
  };
  const inp="w-full bg-[#0d0f14] border border-white/8 rounded px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-white/20";
  const sel=inp;
  const lbl="text-white/30 text-xs block mb-1";
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#0a0c10] border border-white/8 rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4"><span className="text-white/90 text-sm font-medium">New Setup</span><button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg leading-none">×</button></div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div><label className={lbl}>Symbol</label><select className={sel} value={f2.symbol} onChange={e=>upd('symbol',e.target.value)}><option>NQ</option><option>ES</option></select></div>
          <div><label className={lbl}>TF</label><select className={sel} value={f2.timeframe} onChange={e=>upd('timeframe',e.target.value)}><option>15m</option><option>1H</option><option>4H</option><option>D</option></select></div>
          <div><label className={lbl}>Direction</label><select className={sel} value={f2.direction} onChange={e=>upd('direction',e.target.value)}><option value="bull">Bull</option><option value="bear">Bear</option></select></div>
        </div>
        <div className="mb-3"><label className={lbl}>Setup type</label><input className={inp} value={f2.setup_type} onChange={e=>upd('setup_type',e.target.value)} placeholder="e.g. OB + FVG"/></div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div><label className={lbl}>Entry low</label><input className={inp} type="number" value={f2.entry_low} onChange={e=>upd('entry_low',e.target.value)}/></div>
          <div><label className={lbl}>Entry high</label><input className={inp} type="number" value={f2.entry_high} onChange={e=>upd('entry_high',e.target.value)}/></div>
          <div><label className={lbl}>Stop loss</label><input className={inp} type="number" value={f2.stop_loss} onChange={e=>upd('stop_loss',e.target.value)}/></div>
          <div><label className={lbl}>Target</label><input className={inp} type="number" value={f2.target} onChange={e=>upd('target',e.target.value)}/></div>
        </div>
        <div className="mb-3"><label className={lbl}>DOL</label><input className={inp} value={f2.dol_target} onChange={e=>upd('dol_target',e.target.value)} placeholder="BSL at 29800"/></div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div><label className={lbl}>HTF bias</label><select className={sel} value={f2.htf_bias} onChange={e=>upd('htf_bias',e.target.value)}><option value="bullish">Bullish</option><option value="bearish">Bearish</option><option value="neutral">Neutral</option></select></div>
          <div><label className={lbl}>Volume</label><select className={sel} value={f2.volume_context} onChange={e=>upd('volume_context',e.target.value)}><option value="high">High</option><option value="medium">Med</option><option value="low">Low</option></select></div>
          <div><label className={lbl}>Score</label><input className={inp} type="number" value={f2.confluence_score} onChange={e=>upd('confluence_score',e.target.value)}/></div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div><label className={lbl}>Killzones</label><input className={inp} value={f2.killzone_valid} onChange={e=>upd('killzone_valid',e.target.value)}/></div>
          <div><label className={lbl}>Status</label><select className={sel} value={f2.status} onChange={e=>upd('status',e.target.value)}><option value="watching">Watching</option><option value="active">Active</option></select></div>
        </div>
        <div className="flex gap-4 mb-4 text-xs">
          <label className="flex items-center gap-1.5 text-white/40 cursor-pointer"><input type="checkbox" checked={f2.cisd_confirmed} onChange={e=>upd('cisd_confirmed',e.target.checked)} className="accent-blue-500"/>CISD confirmed</label>
          <label className="flex items-center gap-1.5 text-white/40 cursor-pointer"><input type="checkbox" checked={f2.correlated_align} onChange={e=>upd('correlated_align',e.target.checked)} className="accent-blue-500"/>Correlated align</label>
        </div>
        {rr()&&<div className="text-blue-400/70 text-xs text-center mb-3">R:R = {rr()}</div>}
        {err&&<div className="text-red-400/80 text-xs mb-3 bg-red-500/5 rounded p-2">{err}</div>}
        <button onClick={save} disabled={saving} className="w-full bg-white/8 hover:bg-white/12 disabled:opacity-40 text-white/80 text-xs py-2 rounded-lg font-medium transition-colors">{saving?'Saving...':'Save Setup'}</button>
      </div>
    </div>
  );
}

function ScanModal({prices,kz,onClose,onSaved}:{prices:Prices;kz:KZ|null;onClose:()=>void;onSaved:()=>void}){
  const [syms,setSyms]=useState<string[]>(['NQ','ES']),tfs=useState<string[]>(['15m','1h'])[0];
  const [tfsS,setTfsS]=useState<string[]>(['15m','1h']);
  const [loading,setLoading]=useState(false),[result,setResult]=useState<{message:string;count:number;setups:{symbol:string;timeframe:string;direction:string;setup_type:string;entry_low:number;entry_high:number;stop_loss:number;target:number;rr_ratio:number;confluence_score:number}[]}>|null>(null),[err,setErr]=useState('');
  const togS=(s:string)=>setSyms(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);
  const togT=(t:string)=>setTfsS(p=>p.includes(t)?p.filter(x=>x!==t):[...p,t]);
  const scan=async()=>{ setLoading(true);setResult(null);setErr(''); try{ const r=await fetch('/api/autoscan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols:syms,timeframes:tfsS,currentPrices:prices})}); const d=await r.json(); if(d.error)setErr(typeof d.error==='string'?d.error:JSON.stringify(d.error)); else setResult(d); }catch(e){setErr(String(e));} setLoading(false); };
  const btn=(active:boolean)=>`text-xs px-3 py-1.5 rounded-lg border transition-colors ${active?'border-white/20 bg-white/8 text-white/80':'border-white/5 text-white/30 hover:border-white/10'}`;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#0a0c10] border border-white/8 rounded-xl p-5 w-96 max-h-[85vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4"><span className="text-white/90 text-sm font-medium">Market Scan</span><button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg">×</button></div>
        <div className="grid grid-cols-2 gap-2 bg-white/3 rounded-lg p-3 text-xs mb-4">
          {(['NQ','ES','GC','DXY'] as const).map(s=><div key={s} className="flex justify-between"><span className="text-white/30">{s}</span><span className="text-white/70">{prices[s]?.toFixed(s==='DXY'?3:1)??'—'}</span></div>)}
        </div>
        <div className="mb-3"><div className="text-white/30 text-xs mb-2">Symbols</div><div className="flex gap-2">{['NQ','ES'].map(s=><button key={s} onClick={()=>togS(s)} className={btn(syms.includes(s))}>{s}</button>)}</div></div>
        <div className="mb-4"><div className="text-white/30 text-xs mb-2">Timeframes</div><div className="flex gap-2">{['15m','1h','4h'].map(t=><button key={t} onClick={()=>togT(t)} className={btn(tfsS.includes(t))}>{t}</button>)}</div></div>
        <button onClick={scan} disabled={loading||!syms.length||!tfsS.length} className="w-full bg-white/8 hover:bg-white/12 disabled:opacity-40 text-white/80 text-sm py-2.5 rounded-lg font-medium mb-4 transition-colors">
          {loading?'Scanning live candles...':'Scan Now'}
        </button>
        {err&&<div className="text-red-400/70 text-xs bg-red-500/5 rounded-lg p-3 mb-3">{err}</div>}
        {result&&(
          <div className={`rounded-lg p-3 text-xs ${result.count>0?'bg-green-500/5 border border-green-500/15':'bg-yellow-500/5 border border-yellow-500/15'}`}>
            <div className={`font-medium mb-2 ${result.count>0?'text-green-400/80':'text-yellow-400/80'}`}>{result.message}</div>
            {result.setups?.map((s,i)=>(
              <div key={i} className="border-t border-white/5 pt-2 mt-2 first:border-0 first:pt-0 first:mt-0">
                <div className="flex justify-between mb-0.5">
                  <span className="text-white/70 font-medium">{s.symbol} {s.timeframe}</span>
                  <span style={{color:dc(s.direction)}} className="text-xs">{s.direction.toUpperCase()}</span>
                </div>
                <div className="text-white/40">{s.setup_type}</div>
                <div className="flex gap-3 mt-1 text-white/40">
                  <span>E:{f(s.entry_low)}–{f(s.entry_high)}</span>
                  <span className="text-red-400/60">SL:{f(s.stop_loss)}</span>
                  <span className="text-green-400/60">TP:{f(s.target)}</span>
                  <span className="text-blue-400/60">{f(s.rr_ratio,1)}R</span>
                </div>
              </div>
            ))}
            {result.count>0&&<button onClick={()=>{onSaved();onClose();}} className="w-full mt-3 bg-white/5 hover:bg-white/8 text-white/60 text-xs py-1.5 rounded-lg">View setups</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MMXM TAB ───────────────────────────────────────────────────────────
function MMXMTab({prices,kz}:{prices:Prices;kz:KZ|null}){
  const [biases,setBiases]=useState<WeekBias[]>([]);
  const [cw,setCw]=useState('');
  const [smtSignals,setSmt]=useState<{type:string;description:string;nq_price:number;es_price:number;nq_swing:string;es_swing:string}[]>([]);
  const [smtRecent,setSmtR]=useState<{divergence_type:string;detected_at:string}[]>([]);
  const [scanning,setScanning]=useState(false);
  const [form,setForm]=useState({symbol:'NQ',bias:'bullish',amd_phase:'accumulation',htf_draw:'',pd_array_in_play:'',notes:''});
  const [saving,setSaving]=useState(false);
  const inp="w-full bg-[#0d0f14] border border-white/8 rounded px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-white/20";
  useEffect(()=>{ fetch('/api/weekbias').then(r=>r.json()).then(d=>{setBiases(d.biases??[]);setCw(d.currentWeek??'');}); fetch('/api/smt').then(r=>r.json()).then(d=>{setSmt(d.signals??[]);setSmtR(d.recent??[]);}); },[]);
  const scanSMT=async()=>{ setScanning(true); const r=await fetch('/api/smt'); const d=await r.json(); setSmt(d.signals??[]); setSmtR(d.recent??[]); setScanning(false); };
  const saveBias=async()=>{ setSaving(true); await fetch('/api/weekbias',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,week_start:cw})}); const r=await fetch('/api/weekbias'); const d=await r.json(); setBiases(d.biases??[]); setSaving(false); };
  const phases=['accumulation','manipulation','distribution','reaccumulation','redistribution'];
  const pbtn=(active:boolean)=>`text-xs px-2 py-1 rounded-lg border transition-colors ${active?'border-white/20 bg-white/8 text-white/70':'border-white/5 text-white/20 hover:border-white/10 hover:text-white/40'}`;
  return (
    <div className="flex flex-col gap-4 overflow-y-auto h-full pb-4">
      <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-white/50 text-xs uppercase tracking-wider">SMT Divergence · NQ vs ES</span>
          <button onClick={scanSMT} disabled={scanning} className="text-xs px-3 py-1.5 bg-white/5 hover:bg-white/8 text-white/60 rounded-lg transition-colors">{scanning?'Scanning...':'Scan'}</button>
        </div>
        {smtSignals.length>0?smtSignals.map((s,i)=>(
          <div key={i} className={`rounded-lg p-3 text-xs border ${s.type==='bullish_smt'?'bg-green-500/5 border-green-500/15':'bg-red-500/5 border-red-500/15'}`}>
            <div className={`font-medium mb-1 ${s.type==='bullish_smt'?'text-green-400/80':'text-red-400/80'}`}>{s.type==='bullish_smt'?'Bullish SMT':'Bearish SMT'}</div>
            <div className="text-white/50">{s.description}</div>
            <div className="flex gap-4 mt-1.5 text-white/30">
              <span>NQ {s.nq_price?.toFixed(1)} ({s.nq_swing})</span>
              <span>ES {s.es_price?.toFixed(1)} ({s.es_swing})</span>
            </div>
          </div>
        )):<div className="text-white/20 text-xs">No divergence on current 15m data.</div>}
        {smtRecent.length>0&&<div className="mt-3 border-t border-white/5 pt-3">{smtRecent.slice(0,4).map((s,i)=><div key={i} className="flex justify-between text-xs py-1"><span className={s.divergence_type==='bullish_smt'?'text-green-400/50':'text-red-400/50'}>{s.divergence_type?.replace('_smt','').toUpperCase()} SMT</span><span className="text-white/20">{new Date(s.detected_at).toLocaleDateString()}</span></div>)}</div>}
      </div>
      <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
        <div className="text-white/50 text-xs uppercase tracking-wider mb-3">Weekly Bias · {cw}</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(['NQ','ES'] as const).map(sym=><button key={sym} onClick={()=>setForm(p=>({...p,symbol:sym}))} className={pbtn(form.symbol===sym)}>{sym}</button>)}
          {(['bullish','bearish','consolidation']).map(b=><button key={b} onClick={()=>setForm(p=>({...p,bias:b}))} className={`text-xs px-2 py-1 rounded-lg border transition-colors ${form.bias===b?(b==='bullish'?'border-green-500/30 bg-green-500/8 text-green-400/70':b==='bearish'?'border-red-500/30 bg-red-500/8 text-red-400/70':'border-yellow-500/30 bg-yellow-500/8 text-yellow-400/70'):'border-white/5 text-white/20 hover:border-white/10'}`}>{b}</button>)}
        </div>
        <div className="text-white/30 text-xs mb-2">AMD Phase</div>
        <div className="flex flex-wrap gap-1.5 mb-3">{phases.map(ph=><button key={ph} onClick={()=>setForm(p=>({...p,amd_phase:ph}))} className={pbtn(form.amd_phase===ph)}>{ph}</button>)}</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div><label className="text-white/30 text-xs block mb-1">HTF Draw</label><input className={inp} value={form.htf_draw} onChange={e=>setForm(p=>({...p,htf_draw:e.target.value}))} placeholder="BSL at 29800"/></div>
          <div><label className="text-white/30 text-xs block mb-1">PD Array</label><input className={inp} value={form.pd_array_in_play} onChange={e=>setForm(p=>({...p,pd_array_in_play:e.target.value}))} placeholder="OB at 29450"/></div>
        </div>
        <textarea className={inp+' resize-none mb-3'} rows={2} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} placeholder="Why bullish/bearish this week?"/>
        <button onClick={saveBias} disabled={saving} className="w-full bg-white/5 hover:bg-white/8 text-white/60 text-xs py-1.5 rounded-lg transition-colors">{saving?'Saving...':'Save Bias'}</button>
      </div>
      {biases.length>0&&(
        <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
          <div className="text-white/50 text-xs uppercase tracking-wider mb-3">Bias History</div>
          {biases.map(b=>(
            <div key={b.id} className="border-b border-white/5 py-2 last:border-0">
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-white/30">{b.week_start} · {b.symbol}</span>
                <span className={b.bias==='bullish'?'text-green-400/70':b.bias==='bearish'?'text-red-400/70':'text-yellow-400/70'}>{b.bias?.toUpperCase()}</span>
              </div>
              <div className="text-xs text-white/30">{b.amd_phase}{b.htf_draw?` · ${b.htf_draw}`:''}</div>
              {b.notes&&<div className="text-xs text-white/20 mt-0.5">{b.notes}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
        <div className="text-white/50 text-xs uppercase tracking-wider mb-3">AMD Model</div>
        <div className="grid grid-cols-3 gap-3">
          {[['Accumulation','Asia. Range. Liquidity builds above and below. No direction.','rgba(99,102,241,0.1)','rgba(99,102,241,0.4)'],['Manipulation','London. Judas swing. Price sweeps one side, traps retail.','rgba(245,158,11,0.1)','rgba(245,158,11,0.4)'],['Distribution','NY. True move. Delivers to the opposite DOL from manipulation.','rgba(34,197,94,0.1)','rgba(34,197,94,0.4)']].map(([ph,desc,bg,border])=>(
            <div key={ph} className="rounded-lg p-3 text-xs" style={{background:bg,border:`0.5px solid ${border}`}}>
              <div className="font-medium mb-1.5" style={{color:border}}>{ph}</div>
              <div className="text-white/30 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── ANALYTICS TAB ──────────────────────────────────────────────────────
function AnalyticsTab(){
  const [stats,setStats]=useState<{totalTrades:number;wins:number;winRate:number;totalPnl:number;profitFactor:number;expectancy:number;maxDrawdown:number;maxConsecLoss:number}|null>(null);
  const [eq,setEq]=useState<{date:string;equity:number}[]>([]);
  const [byDay,setByDay]=useState<{day:string;trades:number;winRate:number;pnl:number}[]>([]);
  const [runs,setRuns]=useState<BtRun[]>([]);
  const [btf,setBtf]=useState({symbol:'NQ',timeframe:'15m',direction:'bull',entryPct:'0.2',slPct:'0.15',tpPct:'0.5',name:'NQ 15m Bull'});
  const [btRunning,setBtR]=useState(false),[btRes,setBtRes]=useState<BtRun|null>(null),[btErr,setBtErr]=useState('');
  useEffect(()=>{ fetch('/api/analytics').then(r=>r.json()).then(d=>{if(d.stats){setStats(d.stats);setEq(d.equityCurve??[]);setByDay(d.byDay??[]);}}); fetch('/api/backtest').then(r=>r.json()).then(d=>setRuns(d.runs??[])); },[]);
  const runBt=async()=>{ setBtR(true);setBtRes(null);setBtErr(''); try{ const r=await fetch('/api/backtest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...btf,entryPct:parseFloat(btf.entryPct),slPct:parseFloat(btf.slPct),tpPct:parseFloat(btf.tpPct)})}); const d=await r.json(); if(d.error)setBtErr(d.error); else if(d.run){setBtRes(d.run);setRuns(p=>[d.run,...p]);} }catch(e){setBtErr(String(e));} setBtR(false); };
  const inp="bg-[#0d0f14] border border-white/8 rounded px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-white/20";
  return (
    <div className="flex flex-col gap-4 overflow-y-auto h-full pb-4">
      {!stats&&<div className="bg-[#0a0c10] border border-white/5 rounded-xl p-8 text-center"><div className="text-white/20 text-sm">No trade data yet.</div><div className="text-white/15 text-xs mt-1">Log real trades in the Journal tab to see performance analytics.</div></div>}
      {stats&&stats.totalTrades>0&&(
        <>
          <div className="grid grid-cols-4 gap-2">
            {[['Trades',stats.totalTrades,'text-white/70'],['Win rate',stats.winRate+'%',stats.winRate>=55?'text-green-400/70':'text-red-400/70'],['Net P&L','$'+stats.totalPnl.toLocaleString(),stats.totalPnl>=0?'text-green-400/70':'text-red-400/70'],['Profit factor',stats.profitFactor.toFixed(2),'text-blue-400/70'],['Expectancy','$'+stats.expectancy,'text-yellow-400/70'],['Max drawdown','$'+stats.maxDrawdown.toLocaleString(),'text-red-400/70'],['Max consec L',stats.maxConsecLoss,'text-red-400/70'],['Trades logged',stats.totalTrades,'text-white/40']].slice(0,8).map(([l,v,c])=>(
              <div key={l as string} className="bg-[#0a0c10] border border-white/5 rounded-xl p-3">
                <div className="text-white/25 text-xs mb-1">{l}</div>
                <div className={`text-base font-medium ${c}`}>{v}</div>
              </div>
            ))}
          </div>
          {eq.length>1&&(
            <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
              <div className="text-white/30 text-xs uppercase tracking-wider mb-3">Equity curve</div>
              <div className="h-16">
                <svg width="100%" height="64" viewBox={`0 0 ${eq.length} 64`} preserveAspectRatio="none">
                  <polyline fill="none" stroke="rgba(34,197,94,0.5)" strokeWidth="1.5"
                    points={eq.map((p,i)=>{const mn2=Math.min(...eq.map(x=>x.equity)),mx2=Math.max(...eq.map(x=>x.equity)),range=mx2-mn2||1;return `${i},${64-((p.equity-mn2)/range)*56}`;}).join(' ')}/>
                </svg>
              </div>
            </div>
          )}
          {byDay.length>0&&(
            <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
              <div className="text-white/30 text-xs uppercase tracking-wider mb-3">By day of week</div>
              {byDay.map(d=>(
                <div key={d.day} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0 text-xs">
                  <span className="text-white/40 w-20">{d.day.slice(0,3)}</span>
                  <span className="text-white/20 w-8">{d.trades}T</span>
                  <div className="flex-1 h-1 bg-white/5 rounded"><div className="h-full rounded" style={{width:`${d.winRate}%`,background:d.winRate>=60?'rgba(34,197,94,0.5)':d.winRate>=45?'rgba(245,158,11,0.5)':'rgba(239,68,68,0.5)'}}/></div>
                  <span className={`w-10 text-right ${d.winRate>=60?'text-green-400/60':d.winRate>=45?'text-yellow-400/60':'text-red-400/60'}`}>{d.winRate}%</span>
                  <span className={`w-16 text-right ${d.pnl>=0?'text-green-400/60':'text-red-400/60'}`}>${d.pnl.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
        <div className="text-white/30 text-xs uppercase tracking-wider mb-3">Backtest Engine · runs on live candle data</div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div><label className="text-white/20 text-xs block mb-1">Name</label><input className={inp+' w-full'} value={btf.name} onChange={e=>setBtf(p=>({...p,name:e.target.value}))}/></div>
          <div><label className="text-white/20 text-xs block mb-1">Symbol</label><select className={inp+' w-full'} value={btf.symbol} onChange={e=>setBtf(p=>({...p,symbol:e.target.value}))}><option>NQ</option><option>ES</option></select></div>
          <div><label className="text-white/20 text-xs block mb-1">TF</label><select className={inp+' w-full'} value={btf.timeframe} onChange={e=>setBtf(p=>({...p,timeframe:e.target.value}))}><option>15m</option><option>1h</option><option>4h</option></select></div>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div><label className="text-white/20 text-xs block mb-1">Dir</label><select className={inp+' w-full'} value={btf.direction} onChange={e=>setBtf(p=>({...p,direction:e.target.value}))}><option value="bull">Bull</option><option value="bear">Bear</option></select></div>
          <div><label className="text-white/20 text-xs block mb-1">Entry %</label><input className={inp+' w-full'} type="number" value={btf.entryPct} onChange={e=>setBtf(p=>({...p,entryPct:e.target.value}))}/></div>
          <div><label className="text-white/20 text-xs block mb-1">SL %</label><input className={inp+' w-full'} type="number" value={btf.slPct} onChange={e=>setBtf(p=>({...p,slPct:e.target.value}))}/></div>
          <div><label className="text-white/20 text-xs block mb-1">TP %</label><input className={inp+' w-full'} type="number" value={btf.tpPct} onChange={e=>setBtf(p=>({...p,tpPct:e.target.value}))}/></div>
        </div>
        <button onClick={runBt} disabled={btRunning} className="w-full bg-white/5 hover:bg-white/8 disabled:opacity-40 text-white/60 text-xs py-2 rounded-lg mb-3 transition-colors">{btRunning?'Running on live candles...':'Run Backtest'}</button>
        {btErr&&<div className="text-red-400/60 text-xs bg-red-500/5 rounded-lg p-2 mb-3">{btErr}</div>}
        {btRes&&(
          <div className="grid grid-cols-4 gap-2 text-xs border border-white/5 rounded-lg p-3 mb-3">
            {[['Trades',btRes.total_trades],['Win %',btRes.win_rate+'%'],['P&L','$'+btRes.total_pnl?.toLocaleString()],['PF',btRes.profit_factor],['Sharpe',btRes.sharpe_ratio],['Max DD','$'+btRes.max_drawdown?.toLocaleString()],['Avg R:R',btRes.avg_rr],['Max CL',btRes.max_consecutive_losses]].map(([l,v])=>(
              <div key={l as string}><div className="text-white/20 mb-0.5">{l}</div><div className="text-white/60">{v}</div></div>
            ))}
          </div>
        )}
        {runs.length>0&&(
          <table className="w-full text-xs">
            <thead><tr className="text-white/20 border-b border-white/5"><th className="text-left py-1">Name</th><th className="text-right">T</th><th className="text-right">WR%</th><th className="text-right">P&L</th><th className="text-right">PF</th></tr></thead>
            <tbody>{runs.slice(0,6).map(r=><tr key={r.id} className="border-t border-white/5"><td className="py-1 text-white/40">{r.name}</td><td className="text-right text-white/25">{r.total_trades}</td><td className={`text-right ${r.win_rate>=55?'text-green-400/60':'text-red-400/60'}`}>{r.win_rate}%</td><td className={`text-right ${r.total_pnl>=0?'text-green-400/60':'text-red-400/60'}`}>${r.total_pnl?.toLocaleString()}</td><td className="text-right text-blue-400/60">{r.profit_factor}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── JOURNAL TAB ────────────────────────────────────────────────────────
function JournalTab(){
  const [entries,setEntries]=useState<{id:string;date:string;title:string;content:string;emotion:string;result:string}[]>([]);
  const [form,setForm]=useState({date:new Date().toISOString().slice(0,10),title:'',content:'',emotion:'neutral',result:'no trade'});
  const [adding,setAdding]=useState(false),[saving,setSaving]=useState(false);
  const inp="w-full bg-[#0d0f14] border border-white/8 rounded px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-white/20";
  useEffect(()=>{ sb.from('journal').select('*').order('date',{ascending:false}).limit(50).then(({data})=>{if(data)setEntries(data as typeof entries);}); },[]);
  const save=async()=>{ if(!form.title||!form.content)return; setSaving(true); const {data}=await sb.from('journal').insert(form).select(); if(data){setEntries(p=>[data[0] as typeof entries[0],...p]);setAdding(false);setForm({date:new Date().toISOString().slice(0,10),title:'',content:'',emotion:'neutral',result:'no trade'});} setSaving(false); };
  const eColor=(e:string)=>e==='confident'?'text-green-400/60':e==='patient'?'text-blue-400/60':e==='fomo'||e==='revenge'||e==='anxious'?'text-red-400/60':'text-white/30';
  const rColor=(r:string)=>r==='win'?'text-green-400/60':r==='loss'?'text-red-400/60':r==='be'?'text-yellow-400/60':'text-white/20';
  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-white/30 text-xs uppercase tracking-wider">Journal</span>
        <button onClick={()=>setAdding(true)} className="text-xs px-3 py-1.5 bg-white/5 hover:bg-white/8 text-white/50 rounded-lg transition-colors">+ Entry</button>
      </div>
      {adding&&(
        <div className="bg-[#0a0c10] border border-white/8 rounded-xl p-4 shrink-0">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div><label className="text-white/30 text-xs block mb-1">Date</label><input type="date" className={inp} value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
            <div><label className="text-white/30 text-xs block mb-1">Emotion</label><select className={inp} value={form.emotion} onChange={e=>setForm(p=>({...p,emotion:e.target.value}))}><option value="confident">Confident</option><option value="patient">Patient</option><option value="neutral">Neutral</option><option value="anxious">Anxious</option><option value="fomo">FOMO</option><option value="revenge">Revenge</option></select></div>
            <div><label className="text-white/30 text-xs block mb-1">Result</label><select className={inp} value={form.result} onChange={e=>setForm(p=>({...p,result:e.target.value}))}><option value="win">Win</option><option value="loss">Loss</option><option value="be">Break Even</option><option value="no trade">No Trade</option></select></div>
          </div>
          <div className="mb-3"><label className="text-white/30 text-xs block mb-1">Setup taken / title</label><input className={inp} value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/></div>
          <div className="mb-3"><label className="text-white/30 text-xs block mb-1">Notes</label><textarea className={inp+' resize-none'} rows={3} value={form.content} onChange={e=>setForm(p=>({...p,content:e.target.value}))}/></div>
          <div className="flex gap-2"><button onClick={save} disabled={saving} className="flex-1 bg-white/8 hover:bg-white/12 disabled:opacity-40 text-white/70 text-xs py-1.5 rounded-lg">{saving?'Saving...':'Save'}</button><button onClick={()=>setAdding(false)} className="px-4 bg-white/3 text-white/30 text-xs rounded-lg">Cancel</button></div>
        </div>
      )}
      <div className="overflow-y-auto flex-1 space-y-2 pb-4">
        {entries.map(e=>(
          <div key={e.id} className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
            <div className="flex items-start justify-between mb-2">
              <div><span className="text-white/70 text-xs font-medium">{e.title}</span><span className="text-white/20 text-xs ml-2">{e.date}</span></div>
              <div className="flex gap-2 text-xs"><span className={eColor(e.emotion)}>{e.emotion}</span><span className={rColor(e.result)}>{e.result?.toUpperCase()}</span></div>
            </div>
            <p className="text-white/35 text-xs leading-relaxed whitespace-pre-wrap">{e.content}</p>
          </div>
        ))}
        {!entries.length&&!adding&&(
          <div className="text-center py-16">
            <div className="text-white/15 text-sm">No entries yet</div>
            <div className="text-white/10 text-xs mt-1">Log every session. Even no-trade days.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── KNOWLEDGE TAB ──────────────────────────────────────────────────────
function KnowledgeTab(){
  const [articles,setArticles]=useState<KBArticle[]>([]);
  const [search,setSearch]=useState('');
  const [adding,setAdding]=useState(false);
  const [form,setForm]=useState({title:'',content:'',category:'concept',tags:''});
  const [saving,setSaving]=useState(false);
  const inp="w-full bg-[#0d0f14] border border-white/8 rounded px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-white/20";
  useEffect(()=>{ sb.from('knowledge_base').select('*').order('source_episode').limit(100).then(({data})=>{if(data)setArticles(data as KBArticle[]);}); },[]);
  const save=async()=>{ if(!form.title||!form.content)return; setSaving(true); const {data}=await sb.from('knowledge_base').insert({...form,tags:form.tags.split(',').map(t=>t.trim()).filter(Boolean),is_user_note:true,source_episode:'My Notes'}).select(); if(data){setArticles(p=>[data[0] as KBArticle,...p]);setAdding(false);setForm({title:'',content:'',category:'concept',tags:''}); } setSaving(false); };
  const markR=async(id:string)=>{ await sb.from('knowledge_base').update({user_reviewed:true,last_reviewed_at:new Date().toISOString()}).eq('id',id); setArticles(p=>p.map(a=>a.id===id?{...a,user_reviewed:true}:a)); };
  const filtered=articles.filter(a=>!search||a.title?.toLowerCase().includes(search.toLowerCase())||a.content?.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex gap-2 shrink-0">
        <input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="flex-1 bg-[#0a0c10] border border-white/8 rounded-lg px-3 py-1.5 text-xs text-white/60 placeholder-white/20 focus:outline-none focus:border-white/20"/>
        <button onClick={()=>setAdding(!adding)} className="text-xs px-3 py-1.5 bg-white/5 hover:bg-white/8 text-white/50 rounded-lg transition-colors">+ Note</button>
      </div>
      {adding&&(
        <div className="bg-[#0a0c10] border border-white/8 rounded-xl p-4 shrink-0">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="col-span-2"><label className="text-white/30 text-xs block mb-1">Title</label><input className={inp} value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/></div>
            <div><label className="text-white/30 text-xs block mb-1">Category</label><select className={inp} value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))}><option value="concept">Concept</option><option value="setup">Setup</option><option value="rule">Rule</option><option value="mistake">Mistake</option></select></div>
          </div>
          <div className="mb-3"><textarea className={inp+' resize-none'} rows={3} value={form.content} onChange={e=>setForm(p=>({...p,content:e.target.value}))} placeholder="Describe the concept, rule, or observation..."/></div>
          <div className="mb-3"><label className="text-white/30 text-xs block mb-1">Tags (comma separated)</label><input className={inp} value={form.tags} onChange={e=>setForm(p=>({...p,tags:e.target.value}))}/></div>
          <div className="flex gap-2"><button onClick={save} disabled={saving} className="flex-1 bg-white/8 hover:bg-white/12 disabled:opacity-40 text-white/70 text-xs py-1.5 rounded-lg">{saving?'Saving...':'Save'}</button><button onClick={()=>setAdding(false)} className="px-4 bg-white/3 text-white/30 text-xs rounded-lg">Cancel</button></div>
        </div>
      )}
      <div className="text-white/20 text-xs shrink-0">{filtered.length} of {articles.length} · {articles.filter(a=>a.user_reviewed).length} reviewed</div>
      <div className="overflow-y-auto flex-1">
        <div className="grid grid-cols-2 gap-2 pb-4">
          {filtered.map(a=>(
            <div key={a.id} className={`bg-[#0a0c10] border rounded-xl p-3 ${a.is_user_note?'border-blue-500/10':'border-white/5'}`}>
              <div className="flex justify-between items-start mb-1.5">
                <span className="text-white/70 text-xs font-medium">{a.title}</span>
                <div className="flex items-center gap-1.5"><span className="text-white/20 text-xs">{a.source_episode}</span>{a.user_reviewed&&<span className="text-green-400/40 text-xs">✓</span>}</div>
              </div>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.25)'}}>{a.category}</span>
              <p className="text-white/30 text-xs mt-2 leading-relaxed">{a.content}</p>
              {a.tags?.length>0&&<div className="flex gap-1 flex-wrap mt-2">{a.tags.map((t:string)=><span key={t} className="text-xs text-white/15 bg-white/3 px-1.5 py-0.5 rounded">{t}</span>)}</div>}
              {!a.user_reviewed&&<button onClick={()=>markR(a.id)} className="mt-2 text-xs text-white/15 hover:text-white/30 transition-colors">Mark reviewed</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MAIN ───────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState<Tab>('Setups');
  const [setups,setSetups]=useState<Setup[]>([]);
  const [prices,setPrices]=useState<Prices>({NQ:null,ES:null,GC:null,DXY:null,VIX:null});
  const [prev,setPrev]=useState<Prices>({NQ:null,ES:null,GC:null,DXY:null,VIX:null});
  const [kz,setKz]=useState<KZ|null>(null);
  const [news,setNews]=useState<News[]>([]);
  const [sel,setSel]=useState<Setup|null>(null);
  const [ai,setAi]=useState('');
  const [aiLoad,setAiLoad]=useState(false);
  const [chartSym,setChartSym]=useState('NQ');
  const [chartTf,setChartTf]=useState('15m');
  const [chartSetup,setChartSetup]=useState<Setup|null>(null);
  const [sfilt,setSfilt]=useState('all');
  const [dfilt,setDfilt]=useState('all');
  const [showRisk,setShowRisk]=useState(false);
  const [showNew,setShowNew]=useState(false);
  const [showScan,setShowScan]=useState(false);
  const firedAlerts=useRef<Set<string>>(new Set());
  const [alerts,setAlerts]=useState<{id:string;msg:string;type:string}[]>([]);

  const addAlert=useCallback((msg:string,type='y')=>{ const id=Date.now().toString(); setAlerts(p=>[...p.slice(-2),{id,msg,type}]); setTimeout(()=>setAlerts(p=>p.filter(a=>a.id!==id)),7000); },[]);
  const loadSetups=useCallback(async()=>{ const {data}=await sb.from('setups').select('*').in('status',['active','watching','triggered']).order('confluence_score',{ascending:false}).limit(60); if(data)setSetups(data as Setup[]); },[]);

  useEffect(()=>{loadSetups();},[loadSetups]);

  const loadPrices=useCallback(async()=>{ try{ const r=await fetch('/api/prices',{cache:'no-store'}); const d=await r.json(); if(d.prices){setPrev(prices);setPrices(d.prices);} }catch{} },[prices]);
  const loadKz=useCallback(async()=>{ try{ const r=await fetch('/api/killzone',{cache:'no-store'}); const d=await r.json(); setKz(d); }catch{} },[]);
  const loadNews=useCallback(async()=>{ try{ const r=await fetch('/api/calendar',{cache:'no-store'}); const d=await r.json(); setNews(d.events??[]); }catch{} },[]);

  useEffect(()=>{ loadPrices();loadKz();loadNews(); const pi=setInterval(loadPrices,15000),ki=setInterval(loadKz,60000),ni=setInterval(loadNews,300000); return()=>{clearInterval(pi);clearInterval(ki);clearInterval(ni);}; },[loadPrices,loadKz,loadNews]);

  useEffect(()=>{
    if(!prices.NQ&&!prices.ES)return;
    setups.forEach(s=>{
      if(!['active','watching'].includes(s.status))return;
      if(s.expires_at&&new Date(s.expires_at)<new Date())return;
      const p=prices[s.symbol as keyof Prices]; if(!p)return;
      const bull=s.direction==='bull'||s.direction==='long';
      const slK=`sl-${s.id}`; if(!firedAlerts.current.has(slK)&&((bull&&p<s.stop_loss)||(!bull&&p>s.stop_loss))){firedAlerts.current.add(slK);addAlert(`SL hit — ${s.symbol} ${s.setup_type}`,'r');}
      const eK=`e-${s.id}`; if(!firedAlerts.current.has(eK)&&p>=s.entry_low&&p<=s.entry_high){firedAlerts.current.add(eK);addAlert(`In entry zone — ${s.symbol} ${s.setup_type}`,'g');}
      const tK=`tp-${s.id}`; if(!firedAlerts.current.has(tK)&&((bull&&p>=s.target)||(!bull&&p<=s.target))){firedAlerts.current.add(tK);addAlert(`Target hit — ${s.symbol} ${s.setup_type}`,'b');}
    });
  },[prices,setups,addAlert]);

  const live:Live[]=setups.map(s=>{
    const rs=score(s,kz,news);
    const expired=s.expires_at?new Date(s.expires_at)<new Date():false;
    const p=prices[s.symbol as keyof Prices];
    const bull=s.direction==='bull'||s.direction==='long';
    const slBreach=p!==null&&(bull?p<s.stop_loss:p>s.stop_loss);
    const inZone=p!==null&&p>=s.entry_low&&p<=s.entry_high;
    let alert:string|null=null;
    if(slBreach)alert='SL HIT';
    else if(inZone)alert='ENTRY';
    else if(p&&bull&&p>=s.target)alert='TARGET';
    else if(p&&!bull&&p<=s.target)alert='TARGET';
    return{...s,rs,expired,slBreach,inZone,alert};
  });

  const filtered=live.filter(s=>{
    if(sfilt!=='all'&&s.timeframe!==sfilt)return false;
    if(dfilt!=='all'&&s.direction!==dfilt)return false;
    return true;
  });

  const dangerNews=news.some(e=>e.isDangerZone);

  const runAI=async()=>{
    if(!sel)return;
    const lv=live.find(s=>s.id===sel.id);
    if(lv?.expired||lv?.slBreach){ setAi(`INVALIDATED — ${lv.slBreach?`SL at ${f(sel.stop_loss)} breached`:'expired'}.\n\nDo not trade this.`); return; }
    setAiLoad(true);setAi('');
    try{ const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setup:sel,prices})}); const d=await r.json(); setAi(d.analysis||d.error||'No response'); }catch(e){setAi(String(e));}
    setAiLoad(false);
  };

  const dolQ=sel?[
    {q:'Price location',a:(()=>{const p=prices[sel.symbol as keyof Prices];return p?(p<sel.entry_low?`Below zone — ${(sel.entry_low-p).toFixed(0)}pts away`:p>sel.entry_high?`Above zone — ${(p-sel.entry_high).toFixed(0)}pts away`:`INSIDE ZONE (${p.toFixed(1)})`):'—';})()},
    {q:'Draw on Liquidity',a:sel.dol_target||'—'},
    {q:'PD Array',a:`${sel.setup_type} · ${f(sel.entry_low)}–${f(sel.entry_high)}`},
    {q:'Correlated',a:sel.correlated_align?`Aligned (${sel.symbol==='NQ'?'ES':'NQ'} confirms)`:'Not confirmed'},
    {q:'CISD',a:sel.cisd_confirmed?'Confirmed':'Pending — await full body close'},
    {q:'Killzone',a:kz?.active?`${kz.active.name} · ${kz.probability}`:`No active KZ · next: ${kz?.upcoming[0]?.name??'—'} in ${kz?.upcoming[0]?.minsAway??'?'}m`},
  ]:[];

  const alertStyle=(t:string)=>t==='r'?'border-red-500/20 bg-red-500/8 text-red-300/70':t==='g'?'border-green-500/20 bg-green-500/8 text-green-300/70':t==='b'?'border-blue-500/20 bg-blue-500/8 text-blue-300/70':'border-white/10 bg-white/5 text-white/50';

  return (
    <div className="h-screen bg-[#060810] text-white font-mono text-sm flex flex-col overflow-hidden">
      {/* Alert toasts */}
      <div className="fixed top-12 right-3 z-50 flex flex-col gap-1.5 pointer-events-none">
        {alerts.map(a=><div key={a.id} className={`text-xs px-3 py-1.5 rounded-lg border ${alertStyle(a.type)}`}>{a.msg}</div>)}
      </div>

      {/* HEADER */}
      <header className="border-b border-white/5 px-5 h-11 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white/90 font-bold tracking-widest text-sm">VECTOR</span>
          <span className="w-1.5 h-1.5 rounded-full bg-green-400/60 animate-pulse"></span>
        </div>
        <div className="flex items-center gap-5 text-xs">
          {dangerNews&&<span className="text-red-400/70 animate-pulse">⚠ news</span>}
          {kz?.active?<span className="text-xs px-2 py-0.5 rounded" style={{color:kz.active.color,background:kz.active.color+'15'}}>{kz.active.short}</span>:<span className="text-white/15 text-xs">{kz?.upcoming[0]?`${kz.upcoming[0].short} ${kz.upcoming[0].minsAway}m`:'off hours'}</span>}
          <div className="flex items-center gap-4">
            {(['NQ','ES','GC','DXY','VIX'] as const).map(sym=>{
              const p=prices[sym],pp=prev[sym],up=p!==null&&pp!==null&&p>pp,dn=p!==null&&pp!==null&&p<pp;
              return <span key={sym} className={up?'text-green-400/70':dn?'text-red-400/70':'text-white/30'}>{sym} {p!==null?p.toFixed(sym==='VIX'?2:1):'—'}</span>;
            })}
          </div>
          <span className="text-white/15">NY {kz?.nyTime??''}</span>
        </div>
      </header>

      {/* NAV */}
      <nav className="border-b border-white/5 px-5 flex items-center h-9 shrink-0">
        {TABS.map(t=><button key={t} onClick={()=>setTab(t)} className={`px-3 h-full text-xs transition-colors border-b ${tab===t?'border-white/40 text-white/80':'border-transparent text-white/25 hover:text-white/50'}`}>{t}</button>)}
        <div className="ml-auto flex gap-2">
          <button onClick={()=>setShowNew(true)} className="text-xs px-3 py-1 rounded-lg border border-white/8 text-white/40 hover:text-white/60 hover:border-white/15 transition-colors">+ Setup</button>
          <button onClick={()=>setShowScan(true)} className="text-xs px-3 py-1 rounded-lg border border-white/8 text-white/40 hover:text-white/60 hover:border-white/15 transition-colors">Scan</button>
        </div>
      </nav>

      {/* MODALS */}
      {showRisk&&sel&&<RiskModal s={sel} onClose={()=>setShowRisk(false)}/>}
      {showNew&&<NewSetupModal onClose={()=>setShowNew(false)} onSaved={loadSetups}/>}
      {showScan&&<ScanModal prices={prices} kz={kz} onClose={()=>setShowScan(false)} onSaved={loadSetups}/>}

      {/* MAIN */}
      <main className="flex-1 overflow-hidden p-4 min-h-0">

        {/* SETUPS */}
        {tab==='Setups'&&(
          <div className="h-full grid grid-cols-12 gap-4">
            {/* Setup list */}
            <div className="col-span-7 flex flex-col gap-3 h-full overflow-hidden">
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex gap-1">
                  {['all','15m','1H','4H'].map(f2=><button key={f2} onClick={()=>setSfilt(f2)} className={`text-xs px-2 py-1 rounded-lg border transition-colors ${sfilt===f2?'border-white/15 bg-white/5 text-white/60':'border-white/5 text-white/20 hover:border-white/10'}`}>{f2}</button>)}
                </div>
                <div className="flex gap-1 ml-2">
                  {['all','bull','bear'].map(d=><button key={d} onClick={()=>setDfilt(d)} className={`text-xs px-2 py-1 rounded-lg border transition-colors ${dfilt===d?'border-white/15 bg-white/5 text-white/60':'border-white/5 text-white/20 hover:border-white/10'}`}>{d}</button>)}
                </div>
                <span className="text-white/20 text-xs ml-auto">{filtered.length} setups</span>
              </div>
              <div className="overflow-y-auto flex-1">
                {filtered.length===0&&(
                  <div className="flex flex-col items-center justify-center h-full">
                    <div className="text-white/15 text-sm mb-1">No setups</div>
                    <div className="text-white/10 text-xs">Scan the market or add one manually</div>
                  </div>
                )}
                <div className="space-y-1.5 pb-4">
                  {filtered.map(s=>(
                    <button key={s.id} onClick={()=>{setSel(s as Setup);setAi(s.ai_analysis||'');}}
                      className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${sel?.id===s.id?'border-white/15 bg-white/4':'border-white/5 hover:border-white/10 bg-transparent'} ${s.expired||s.slBreach?'opacity-25':''}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="text-white/80 font-medium text-xs">{s.symbol}</span>
                          <span className="text-white/25 text-xs">{s.timeframe}</span>
                          <span className="text-xs font-medium" style={{color:dc(s.direction)}}>{s.direction}</span>
                          <span className="text-white/40 text-xs">{s.setup_type}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {s.alert&&<span className={`text-xs px-1.5 py-0.5 rounded text-xs ${s.alert==='SL HIT'?'bg-red-500/10 text-red-400/70 border border-red-500/15':s.alert==='ENTRY'?'bg-green-500/10 text-green-400/70 border border-green-500/15 animate-pulse':'bg-blue-500/10 text-blue-400/70 border border-blue-500/15'}`}>{s.alert}</span>}
                          <div className="relative w-8 h-8">
                            <svg width="32" height="32" className="-rotate-90"><circle cx="16" cy="16" r="12" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2"/><circle cx="16" cy="16" r="12" fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(s.rs/100)*75.4} 75.4`} stroke={s.rs>=70?'rgba(34,197,94,0.7)':s.rs>=50?'rgba(245,158,11,0.7)':'rgba(239,68,68,0.7)'}/></svg>
                            <div className="absolute inset-0 flex items-center justify-center text-xs" style={{color:s.rs>=70?'rgba(34,197,94,0.8)':s.rs>=50?'rgba(245,158,11,0.8)':'rgba(239,68,68,0.8)'}}>{s.rs}</div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-white/25">
                        <span>E <span className="text-white/45">{f(s.entry_low)}–{f(s.entry_high)}</span></span>
                        <span>SL <span className="text-red-400/50">{f(s.stop_loss)}</span></span>
                        <span>TP <span className="text-green-400/50">{f(s.target)}</span></span>
                        <span>{f(s.rr_ratio,1)}R</span>
                        <span className="ml-auto">{s.htf_bias?.slice(0,4)} · {s.cisd_confirmed?'cisd✓':'cisd○'}</span>
                        <button onClick={e=>{e.stopPropagation();setChartSym(s.symbol);setChartSetup(s as Setup);setTab('Chart');}} className="text-white/20 hover:text-white/50 transition-colors">chart</button>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right panel — AI + DOL */}
            <div className="col-span-5 flex flex-col gap-3 h-full overflow-hidden">
              {/* DOL Framework */}
              <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4 shrink-0">
                <div className="text-white/25 text-xs uppercase tracking-wider mb-3">DOL Framework</div>
                {dolQ.length>0?(
                  <div className="space-y-2">
                    {dolQ.map((q,i)=>(
                      <div key={i} className="flex gap-3 text-xs">
                        <span className="text-white/20 shrink-0 w-4">{i+1}</span>
                        <span className="text-white/25 w-24 shrink-0">{q.q}</span>
                        <span className={`text-white/55 ${i===4&&!sel?.cisd_confirmed?'text-yellow-400/60':i===4?'text-green-400/60':''}`}>{q.a}</span>
                      </div>
                    ))}
                  </div>
                ):(
                  <div className="text-white/15 text-xs">Select a setup</div>
                )}
              </div>
              {/* AI Analyst */}
              <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4 flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <span className="text-white/25 text-xs uppercase tracking-wider">AI Analysis</span>
                  <div className="flex gap-2">
                    {sel&&<button onClick={()=>setShowRisk(true)} className="text-xs px-2 py-1 bg-white/3 hover:bg-white/6 text-white/30 rounded-lg transition-colors">Risk</button>}
                    <button onClick={runAI} disabled={!sel||aiLoad} className="text-xs px-3 py-1 bg-white/5 hover:bg-white/8 disabled:opacity-30 text-white/50 rounded-lg transition-colors">{aiLoad?'Analysing...':'Analyse'}</button>
                  </div>
                </div>
                {sel&&(
                  <div className="text-xs text-white/30 mb-3 shrink-0">
                    {sel.symbol} · {sel.setup_type}
                    {(()=>{const lv=live.find(s=>s.id===sel.id);return lv?.slBreach?<span className="ml-2 text-red-400/60">SL breached</span>:lv?.expired?<span className="ml-2 text-white/20">expired</span>:null;})()}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto">
                  {ai?(
                    <pre className={`text-xs leading-relaxed whitespace-pre-wrap ${ai.startsWith('INVALIDATED')?'text-red-400/60':'text-white/55'}`}>{ai}</pre>
                  ):(
                    <div className="text-white/12 text-xs">{sel?'Hit Analyse for ICT breakdown':'Select a setup first'}</div>
                  )}
                </div>
              </div>
              {/* Killzone + Calendar */}
              <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-3 shrink-0">
                <div className="grid grid-cols-6 gap-1.5 mb-3">
                  {[{s:'ASIA',t:'7–10PM',c:'#6366f1'},{s:'LON',t:'2–5AM',c:'#f59e0b'},{s:'NY',t:'8:30–11AM',c:'#22c55e'},{s:'SB',t:'10–11AM',c:'#3b82f6'},{s:'LCL',t:'11:30–1:30',c:'#ef4444'},{s:'NYA',t:'1:30–4PM',c:'#a855f7'}].map(z=>{
                    const isA=kz?.active?.short===z.s;
                    return(
                      <div key={z.s} className="rounded-lg p-1.5 text-center transition-all" style={{background:isA?z.c+'15':'rgba(255,255,255,0.02)',border:`0.5px solid ${isA?z.c+'40':'rgba(255,255,255,0.05)'}`}}>
                        <div className="text-xs font-medium" style={{color:isA?z.c:'rgba(255,255,255,0.25)'}}>{z.s}</div>
                        <div className="text-white/15 text-xs">{z.t}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-0.5">
                  {news.filter((_,i)=>i<4).map((e,i)=>(
                    <div key={i} className={`flex justify-between text-xs ${e.isDangerZone?'text-red-400/70 animate-pulse':e.isToday?'text-yellow-400/50':'text-white/20'}`}>
                      <span>{e.name}</span>
                      <span>{e.isToday?(e.minutesAway!==null?(e.minutesAway>0?`${e.minutesAway}m`:`${Math.abs(e.minutesAway)}m ago`):'today'):e.date}</span>
                    </div>
                  ))}
                  {!news.some(e=>e.isToday)&&<div className="text-white/15 text-xs">No events today</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CHART */}
        {tab==='Chart'&&(
          <div className="flex flex-col gap-3 h-full">
            <div className="flex gap-2 items-center shrink-0">
              <div className="flex gap-1">{['NQ','ES'].map(s=><button key={s} onClick={()=>{setChartSym(s);setChartSetup(null);}} className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${chartSym===s?'border-white/20 bg-white/5 text-white/70':'border-white/5 text-white/25 hover:border-white/10'}`}>{s}</button>)}</div>
              <div className="flex gap-1">{['15m','1h','4h','D'].map(t=><button key={t} onClick={()=>setChartTf(t)} className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${chartTf===t?'border-white/20 bg-white/5 text-white/70':'border-white/5 text-white/25 hover:border-white/10'}`}>{t}</button>)}</div>
              {chartSetup&&<div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-white/8 text-xs ml-2"><span style={{color:dc(chartSetup.direction)}} className="text-xs">●</span><span className="text-white/50">{chartSetup.symbol} {chartSetup.setup_type}</span><button onClick={()=>setChartSetup(null)} className="text-white/20 hover:text-white/50 ml-1">×</button></div>}
              <button onClick={()=>setShowScan(true)} className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-white/8 text-white/30 hover:text-white/50 transition-colors">Scan</button>
            </div>
            {chartSetup&&<div className="flex gap-5 text-xs shrink-0 text-white/30">
              <span>Entry <span className="text-green-400/60">{f(chartSetup.entry_low)}–{f(chartSetup.entry_high)}</span></span>
              <span>SL <span className="text-red-400/60">{f(chartSetup.stop_loss)}</span></span>
              <span>TP <span className="text-blue-400/60">{f(chartSetup.target)}</span></span>
              <span>{f(chartSetup.rr_ratio,1)}R · {chartSetup.cisd_confirmed?'CISD confirmed':'CISD pending'}</span>
            </div>}
            <div className="flex-1 bg-[#0a0c10] border border-white/5 rounded-xl overflow-hidden min-h-0"><Chart sym={chartSym} tf={chartTf} setup={chartSetup}/></div>
            <div className="flex gap-2 flex-wrap shrink-0">
              {live.filter(s=>s.symbol===chartSym).map(s=>(
                <button key={s.id} onClick={()=>setChartSetup(s as Setup)} className={`text-xs px-2 py-1 rounded-lg border transition-colors ${chartSetup?.id===s.id?'border-white/20 bg-white/5 text-white/60':'border-white/5 text-white/20 hover:border-white/10'}`}>
                  <span style={{color:dc(s.direction)}}>{s.direction}</span> {s.timeframe} · <span className={s.rs>=70?'text-green-400/60':s.rs>=50?'text-yellow-400/60':'text-red-400/60'}>{s.rs}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab==='MMXM'&&<MMXMTab prices={prices} kz={kz}/>}
        {tab==='Analytics'&&<AnalyticsTab/>}
        {tab==='Journal'&&<JournalTab/>}
        {tab==='Knowledge'&&<KnowledgeTab/>}
      </main>
    </div>
  );
}
