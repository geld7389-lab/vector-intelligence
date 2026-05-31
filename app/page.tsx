'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const SB_URL = 'https://xavkbjbgmuasfkliptsh.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M';
const sb = createClient(SB_URL, SB_KEY);

type Tab = 'Markets'|'Trades'|'Analytics'|'Journal'|'Knowledge';
type MkTab = 'Futures'|'Crypto'|'Forex'|'Stocks'|'Institutional';

interface Setup {
  id:string;symbol:string;timeframe:string;direction:string;setup_type:string;
  entry_low:number;entry_high:number;stop_loss:number;target:number;rr_ratio:number;
  confluence_score:number;status:string;dol_target:string;ai_analysis:string;
  htf_bias:string;cisd_confirmed:boolean;volume_context:string;killzone_valid:string;
  correlated_align:boolean;expires_at:string;market_section:string;
}
interface Prices { NQ:number|null;ES:number|null;GC:number|null;DXY:number|null;VIX:number|null; }
interface Trade {
  id:string;symbol:string;direction:string;setup_type:string;entry_price:number;
  exit_price:number|null;stop_loss:number;target:number;pnl_dollars:number|null;
  pnl_r:number|null;outcome:string|null;session:string|null;notes:string|null;
  entry_time:string;setup_id:string|null;account_size:number;risk_percent:number;
}

const cx = (...c: (string|boolean|undefined|null)[]) => c.filter(Boolean).join(' ');
const fmt = (n:number|null, d=1) => n==null ? '—' : n.toFixed(d);

// ── SCAN MODAL ──
function ScanModal({ prices, onClose, onDone }: { prices:Prices; onClose:()=>void; onDone:()=>void }) {
  const [syms, setSyms] = useState<string[]>(['NQ','ES']);
  const [tfs, setTfs] = useState<string[]>(['15m','1h']);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{message?:string;error?:string;count?:number;debug?:string[]}|null>(null);
  const tog = (arr:string[], set:(a:string[])=>void, v:string) => set(arr.includes(v)?arr.filter(x=>x!==v):[...arr,v]);
  const scan = async () => {
    setScanning(true); setResult(null);
    try {
      const r = await fetch('/api/autoscan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols:syms,timeframes:tfs,currentPrices:prices})});
      const d = await r.json();
      setResult(d);
      if ((d.count??0) > 0) setTimeout(onDone, 1500);
    } catch(e){ setResult({error:String(e)}); }
    setScanning(false);
  };
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex justify-between items-center">
          <span className="text-sm font-mono text-zinc-300">Auto Scan · Live Market</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">x</button>
        </div>
        <div className="bg-zinc-800/50 rounded-xl p-3 grid grid-cols-2 gap-1">
          {([['NQ',fmt(prices.NQ)],['ES',fmt(prices.ES)],['GC',fmt(prices.GC)],['DXY',fmt(prices.DXY,3)]] as [string,string][]).map(([l,v])=>(
            <div key={l} className="flex justify-between text-xs"><span className="text-zinc-500">{l}</span><span className="text-zinc-200 font-mono">{v}</span></div>
          ))}
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-2">Symbols</p>
          <div className="flex gap-2 flex-wrap">
            {['NQ','ES','BTC','ETH','SOL'].map(s=>(
              <button key={s} onClick={()=>tog(syms,setSyms,s)} className={cx('px-3 py-1.5 rounded-lg text-xs font-mono border transition-all',syms.includes(s)?'bg-zinc-700 border-zinc-500 text-white':'border-zinc-700 text-zinc-500 hover:border-zinc-500')}>{s}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-zinc-500 mb-2">Timeframes</p>
          <div className="flex gap-2">
            {['15m','1h','4h'].map(t=>(
              <button key={t} onClick={()=>tog(tfs,setTfs,t)} className={cx('px-3 py-1.5 rounded-lg text-xs font-mono border transition-all',tfs.includes(t)?'bg-zinc-700 border-zinc-500 text-white':'border-zinc-700 text-zinc-500 hover:border-zinc-500')}>{t}</button>
            ))}
          </div>
        </div>
        <button onClick={scan} disabled={scanning||syms.length===0} className="w-full py-3 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white font-medium disabled:opacity-40 transition-all">
          {scanning ? 'Scanning market...' : 'Scan Now'}
        </button>
        {result && (
          <div className={cx('text-xs p-3 rounded-lg border font-mono',result.error?'border-red-800 bg-red-900/20 text-red-400':'border-zinc-700 bg-zinc-800/50 text-zinc-300')}>
            {result.error ?? result.message}
          </div>
        )}
        {result?.debug && (
          <details className="text-xs text-zinc-600">
            <summary className="cursor-pointer">Debug log</summary>
            <pre className="mt-1 text-xs whitespace-pre-wrap">{result.debug.join('\n')}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

// ── TRADE MODAL ──
function TradeModal({ setup, onClose, onSaved }: { setup?:Setup|null; onClose:()=>void; onSaved:()=>void }) {
  const [form, setForm] = useState({
    symbol: setup?.symbol??'NQ', direction: setup?.direction??'bull',
    setup_type: setup?.setup_type??'FVG Retest',
    entry_price: setup ? String(((setup.entry_low+setup.entry_high)/2).toFixed(2)) : '',
    exit_price: '', stop_loss: setup?.stop_loss?.toString()??'',
    target: setup?.target?.toString()??'', contracts: '1',
    account_size: '100000', risk_percent: '1', notes: '', setup_id: setup?.id??''
  });
  const [saving, setSaving] = useState(false);
  const ep=parseFloat(form.entry_price)||0, sl=parseFloat(form.stop_loss)||0, tp=parseFloat(form.target)||0;
  const risk=Math.abs(ep-sl);
  const rr=risk>0?(Math.abs(tp-ep)/risk).toFixed(2):'--';
  const riskUsd=((parseFloat(form.account_size)||100000)*((parseFloat(form.risk_percent)||1)/100)).toFixed(0);
  const inp = "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500";
  const set = (k:string) => (e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>) => setForm(p=>({...p,[k]:e.target.value}));
  const save = async () => {
    setSaving(true);
    await fetch('/api/trades',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      ...form, entry_price:parseFloat(form.entry_price), exit_price:form.exit_price?parseFloat(form.exit_price):null,
      stop_loss:parseFloat(form.stop_loss), target:parseFloat(form.target),
      contracts:parseFloat(form.contracts), account_size:parseFloat(form.account_size), risk_percent:parseFloat(form.risk_percent)
    })});
    setSaving(false); onSaved(); onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <span className="text-sm font-mono text-zinc-300">Log Trade</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">x</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-xs text-zinc-500 mb-1">Symbol</p><select className={inp} value={form.symbol} onChange={set('symbol')}>{['NQ','ES','GC','BTC','ETH','SOL','EURUSD','GBPUSD'].map(s=><option key={s}>{s}</option>)}</select></div>
          <div><p className="text-xs text-zinc-500 mb-1">Direction</p><select className={inp} value={form.direction} onChange={set('direction')}><option value="bull">Long</option><option value="bear">Short</option></select></div>
          {[['entry_price','Entry Price'],['stop_loss','Stop Loss'],['target','Target'],['exit_price','Exit Price (if closed)'],['account_size','Account Size ($)'],['risk_percent','Risk %']].map(([k,l])=>(
            <div key={k}><p className="text-xs text-zinc-500 mb-1">{l}</p><input className={inp} value={form[k as keyof typeof form]} onChange={set(k)}/></div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 p-3 bg-zinc-800/50 rounded-xl text-xs text-center">
          <div><div className="text-zinc-500">R:R</div><div className="text-white font-mono">{rr}</div></div>
          <div><div className="text-zinc-500">Risk $</div><div className="text-white font-mono">${riskUsd}</div></div>
          <div><div className="text-zinc-500">Contracts</div><input className="w-14 text-center bg-transparent border-b border-zinc-600 text-white font-mono text-xs" value={form.contracts} onChange={set('contracts')}/></div>
        </div>
        <div><p className="text-xs text-zinc-500 mb-1">Notes</p><textarea className={cx(inp,'h-16 resize-none')} value={form.notes} onChange={set('notes')}/></div>
        <button onClick={save} disabled={saving||!form.entry_price||!form.stop_loss} className="w-full py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white disabled:opacity-40">{saving?'Saving...':'Log Trade'}</button>
      </div>
    </div>
  );
}

// ── ANALYSIS PANEL ──
function AnalysisPanel({ setup, prices, onClose }: { setup:Setup; prices:Prices; onClose:()=>void }) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(setup.ai_analysis||'');
  const run = async () => {
    setLoading(true);
    const r = await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setup,prices})});
    const d = await r.json();
    const text = d.analysis??d.error??'No response';
    setAnalysis(text);
    await sb.from('setups').update({ai_analysis:text}).eq('id',setup.id);
    setLoading(false);
  };
  useEffect(()=>{ if(!analysis) run(); },[]);
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3 mt-2">
      <div className="flex justify-between items-center">
        <span className="text-xs text-zinc-500 font-mono">AI · {setup.symbol} {setup.timeframe} {setup.setup_type}</span>
        <div className="flex gap-3">
          <button onClick={run} className="text-xs text-zinc-600 hover:text-zinc-300">refresh</button>
          <button onClick={onClose} className="text-xs text-zinc-600 hover:text-zinc-300">close</button>
        </div>
      </div>
      {loading
        ? <div className="text-xs text-zinc-600 animate-pulse">Analyzing with ICT methodology...</div>
        : <pre className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{analysis||'Click refresh to analyze'}</pre>}
    </div>
  );
}

// ── SETUP CARD ──
function SetupCard({ s, prices, onDelete, onAnalyze, onTrade, selected, onSelect }:{s:Setup;prices:Prices;onDelete:(id:string)=>void;onAnalyze:(s:Setup)=>void;onTrade:(s:Setup)=>void;selected:boolean;onSelect:(s:Setup)=>void}) {
  const p = prices[s.symbol as keyof Prices];
  const bull = s.direction==='bull'||s.direction==='long';
  const slHit = p!=null&&(bull?p<s.stop_loss:p>s.stop_loss);
  const tpHit = p!=null&&(bull?p>=s.target:p<=s.target);
  const inEntry = p!=null&&p>=s.entry_low&&p<=s.entry_high;
  const exp = s.expires_at&&new Date(s.expires_at)<new Date();
  return (
    <div className={cx('rounded-xl border p-3 cursor-pointer transition-all hover:border-zinc-600 group',
      slHit||exp?'border-red-900/60 bg-red-900/10':tpHit?'border-emerald-900/60 bg-emerald-900/10':
      inEntry?'border-yellow-800/60 bg-yellow-900/10':selected?'border-zinc-600 bg-zinc-800/60':'border-zinc-800 bg-zinc-900/40'
    )} onClick={()=>onSelect(s)}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-white">{s.symbol}</span>
          <span className={cx('text-xs px-1.5 py-0.5 rounded font-mono',bull?'bg-emerald-900/50 text-emerald-400':'bg-red-900/50 text-red-400')}>{bull?'+ LONG':'- SHORT'}</span>
          <span className="text-xs text-zinc-600">{s.timeframe}</span>
          <span className="text-xs text-zinc-700">{s.setup_type}</span>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={e=>{e.stopPropagation();onTrade(s);}} title="Log trade" className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400">log</button>
          <button onClick={e=>{e.stopPropagation();onAnalyze(s);}} title="AI analyze" className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400">ai</button>
          <button onClick={e=>{e.stopPropagation();onDelete(s.id);}} className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-red-900/40 text-zinc-600 hover:text-red-400">x</button>
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-1 text-xs">
        <div><span className="text-zinc-600">Entry </span><span className="font-mono text-zinc-400">{s.entry_low}-{s.entry_high}</span></div>
        <div><span className="text-zinc-600">SL </span><span className="font-mono text-red-400">{s.stop_loss}</span></div>
        <div><span className="text-zinc-600">TP </span><span className="font-mono text-emerald-400">{s.target}</span></div>
        <div><span className="text-zinc-600">R:R </span><span className={cx('font-mono',s.rr_ratio>=3?'text-emerald-400':s.rr_ratio>=2?'text-yellow-400':'text-zinc-500')}>{s.rr_ratio}R</span></div>
        <div><span className="text-zinc-600">Score </span><span className="font-mono text-zinc-400">{s.confluence_score}</span></div>
        <div><span className="text-zinc-600">CISD </span><span className={s.cisd_confirmed?'text-emerald-400 font-mono':'text-zinc-700'}>{s.cisd_confirmed?'yes':'—'}</span></div>
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        {(slHit||tpHit||inEntry||exp) && (
          <span className={cx('text-xs px-2 py-0.5 rounded font-mono',slHit||exp?'bg-red-900/40 text-red-400':tpHit?'bg-emerald-900/40 text-emerald-400':'bg-yellow-900/40 text-yellow-400')}>
            {exp?'EXPIRED':slHit?'SL HIT':tpHit?'TARGET HIT':'IN ENTRY'}
          </span>
        )}
        {p && <span className="text-xs text-zinc-700 font-mono">{p.toFixed(1)}</span>}
        {s.dol_target && <span className="text-xs text-zinc-700">{s.dol_target}</span>}
      </div>
    </div>
  );
}

// ── CRYPTO TAB ──
function CryptoTab() {
  const [prices, setPrices] = useState<{symbol:string;name:string;price:number|null;change24h:number|null}[]>([]);
  useEffect(()=>{ const load=()=>fetch('/api/crypto').then(r=>r.json()).then(d=>{if(d.prices)setPrices(d.prices);}); load(); const i=setInterval(load,30000); return()=>clearInterval(i); },[]);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {prices.map(p=>(
        <div key={p.symbol} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <div className="flex justify-between items-start mb-1">
            <span className="text-xs text-zinc-500">{p.name}</span>
            <span className={cx('text-xs font-mono',(p.change24h??0)>=0?'text-emerald-400':'text-red-400')}>{p.change24h!=null?`${p.change24h>=0?'+':''}${p.change24h.toFixed(2)}%`:'—'}</span>
          </div>
          <div className="font-mono text-white text-sm">{p.price!=null?(p.price>100?`$${p.price.toLocaleString('en-US',{maximumFractionDigits:0})}`:`$${p.price.toFixed(4)}`):'—'}</div>
        </div>
      ))}
    </div>
  );
}

// ── FOREX TAB ──
function ForexTab() {
  const [data, setData] = useState<{forex:{symbol:string;name:string;price:number|null;change:number|null}[];commodities:{symbol:string;name:string;price:number|null;change:number|null}[]}>({forex:[],commodities:[]});
  useEffect(()=>{ const load=()=>fetch('/api/forex').then(r=>r.json()).then(d=>setData({forex:d.forex??[],commodities:d.commodities??[]})); load(); const i=setInterval(load,30000); return()=>clearInterval(i); },[]);
  const Row=({q}:{q:{name:string;price:number|null;change:number|null}})=>(
    <div className="flex justify-between items-center py-2 border-b border-zinc-800/50 last:border-0">
      <span className="text-xs text-zinc-400">{q.name}</span>
      <div className="flex gap-3 items-center">
        <span className={cx('text-xs font-mono',(q.change??0)>=0?'text-emerald-400':'text-red-400')}>{q.change!=null?`${q.change>=0?'+':''}${q.change.toFixed(2)}%`:'—'}</span>
        <span className="text-xs font-mono text-white w-20 text-right">{q.price!=null?q.price.toFixed(q.price>10?2:4):'—'}</span>
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Forex Majors</p>{data.forex.map((q,i)=><Row key={i} q={q}/>)}</div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Commodities</p>{data.commodities.map((q,i)=><Row key={i} q={q}/>)}</div>
    </div>
  );
}

// ── STOCKS TAB ──
function StocksTab() {
  const [data, setData] = useState<{indices:{name:string;price:number|null;change:number|null}[];etfs:{symbol:string;name:string;price:number|null;change:number|null}[];stocks:{symbol:string;name:string;price:number|null;change:number|null}[]}>({indices:[],etfs:[],stocks:[]});
  useEffect(()=>{ const load=()=>fetch('/api/stocks').then(r=>r.json()).then(d=>setData({indices:d.indices??[],etfs:d.etfs??[],stocks:d.stocks??[]})); load(); const i=setInterval(load,30000); return()=>clearInterval(i); },[]);
  const Q=({q}:{q:{name:string;symbol?:string;price:number|null;change:number|null}})=>(
    <div className="flex justify-between items-center py-1.5 border-b border-zinc-800/40 last:border-0">
      <span className="text-xs text-zinc-400">{q.symbol??q.name}</span>
      <div className="flex gap-3 items-center">
        <span className={cx('text-xs font-mono',(q.change??0)>=0?'text-emerald-400':'text-red-400')}>{q.change!=null?`${q.change>=0?'+':''}${q.change.toFixed(2)}%`:'—'}</span>
        <span className="text-xs font-mono text-white w-16 text-right">{q.price!=null?`$${q.price.toFixed(q.price>100?0:2)}`:'—'}</span>
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Indices</p>{data.indices.map((q,i)=><Q key={i} q={q}/>)}</div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">ETFs</p>{data.etfs.map((q,i)=><Q key={i} q={q}/>)}</div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Stocks</p>{data.stocks.map((q,i)=><Q key={i} q={q}/>)}</div>
    </div>
  );
}

// ── INSTITUTIONAL TAB ──
function InstitutionalTab() {
  const [sym,setSym] = useState('NQ');
  const [cot,setCot] = useState<{date:string;comm_net:number;large_net:number;oi:number}[]>([]);
  const [loading,setLoading] = useState(false);
  const load = useCallback(async(s:string)=>{ setLoading(true); const r=await fetch(`/api/cot?symbol=${s}`); const d=await r.json(); setCot(d.data??[]); setLoading(false); },[]);
  useEffect(()=>{ load(sym); },[sym]);
  const latest=cot[0], prev=cot[1];
  const weekChange=latest&&prev?latest.comm_net-prev.comm_net:null;
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {['NQ','ES','GC','CL','EUR','GBP'].map(s=>(
          <button key={s} onClick={()=>{setSym(s);load(s);}} className={cx('px-3 py-1.5 rounded-lg text-xs font-mono border transition-all',sym===s?'bg-zinc-700 border-zinc-500 text-white':'border-zinc-700 text-zinc-500 hover:border-zinc-500')}>{s}</button>
        ))}
      </div>
      {loading?<div className="text-xs text-zinc-600 animate-pulse">Loading COT from CFTC...</div>:!latest?(
        <div className="text-center py-12 text-zinc-600 text-sm">Fetching COT data from CFTC.gov...</div>
      ):(
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {l:'Commercials',v:latest.comm_net>0?'NET LONG':'NET SHORT',sub:`Net: ${latest.comm_net?.toLocaleString()}`,c:latest.comm_net>0?'text-emerald-400':'text-red-400'},
              {l:'Large Specs',v:latest.large_net>0?'NET LONG':'NET SHORT',sub:`Net: ${latest.large_net?.toLocaleString()}`,c:latest.large_net>0?'text-emerald-400':'text-red-400'},
              {l:'Week Change',v:weekChange!=null?(weekChange>0?'+':'')+weekChange.toLocaleString():'—',sub:'Commercial net delta',c:weekChange!=null&&weekChange>0?'text-emerald-400':'text-red-400'},
              {l:'Open Interest',v:latest.oi?.toLocaleString()??'—',sub:`As of ${latest.date}`,c:'text-zinc-300'},
            ].map(c=>(
              <div key={c.l} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <p className="text-xs text-zinc-500 mb-1">{c.l}</p>
                <p className={cx('font-mono text-sm font-medium',c.c)}>{c.v}</p>
                <p className="text-xs text-zinc-600 mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">COT History — {sym}</p>
            <div className="space-y-1">
              {cot.slice(0,12).map((r,i)=>(
                <div key={i} className="flex justify-between text-xs py-1.5 border-b border-zinc-800/40 last:border-0">
                  <span className="text-zinc-600 font-mono">{r.date}</span>
                  <span className={cx('font-mono',r.comm_net>0?'text-emerald-400':'text-red-400')}>Comm {r.comm_net>0?'+':''}{r.comm_net?.toLocaleString()}</span>
                  <span className={cx('font-mono',r.large_net>0?'text-emerald-400':'text-red-400')}>Large {r.large_net>0?'+':''}{r.large_net?.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TRADES TAB ──
function TradesTab() {
  const [trades,setTrades] = useState<Trade[]>([]);
  const [stats,setStats] = useState<{total:number;wins:number;losses:number;winRate:number;totalPnl:number;totalR:number;profitFactor:number}|null>(null);
  const [showLog,setShowLog] = useState(false);
  const [closing,setClosing] = useState<Trade|null>(null);
  const [exitPrice,setExitPrice] = useState('');
  const load = useCallback(async()=>{ const r=await fetch('/api/trades'); const d=await r.json(); setTrades(d.trades??[]); setStats(d.stats??null); },[]);
  useEffect(()=>{ load(); },[load]);
  const closeOut = async(t:Trade)=>{ await fetch('/api/trades',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:t.id,exit_price:parseFloat(exitPrice)})}); setClosing(null); setExitPrice(''); load(); };
  const del = async(id:string)=>{ await fetch('/api/trades',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); load(); };
  return (
    <div className="space-y-4">
      {stats&&stats.total>0&&(
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {l:'Win Rate',v:`${stats.winRate}%`,c:stats.winRate>=50?'text-emerald-400':'text-red-400'},
            {l:'Total R',v:`${stats.totalR>=0?'+':''}${stats.totalR}R`,c:stats.totalR>=0?'text-emerald-400':'text-red-400'},
            {l:'Total P&L',v:`${stats.totalPnl>=0?'+':''}$${Math.abs(stats.totalPnl).toFixed(0)}`,c:stats.totalPnl>=0?'text-emerald-400':'text-red-400'},
            {l:'Profit Factor',v:stats.profitFactor.toFixed(2),c:stats.profitFactor>=1.5?'text-emerald-400':'text-zinc-400'},
          ].map(s=>(
            <div key={s.l} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-500">{s.l}</p>
              <p className={cx('font-mono text-sm font-medium mt-1',s.c)}>{s.v}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between items-center">
        <span className="text-xs text-zinc-600">{trades.length} trades</span>
        <button onClick={()=>setShowLog(true)} className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500">+ Log Trade</button>
      </div>
      {trades.length===0?(
        <div className="text-center py-16 space-y-2">
          <div className="text-zinc-700 text-4xl">📋</div>
          <p className="text-zinc-500 text-sm">No trades logged yet</p>
          <p className="text-zinc-700 text-xs">Log trades manually or via the log button on any setup.</p>
          <button onClick={()=>setShowLog(true)} className="mt-2 px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500">Log your first trade</button>
        </div>
      ):(
        <div className="space-y-2">
          {trades.map(t=>(
            <div key={t.id} className={cx('bg-zinc-900 border rounded-xl p-3',t.outcome==='win'?'border-emerald-900/50':t.outcome==='loss'?'border-red-900/50':t.outcome==='running'?'border-yellow-900/50':'border-zinc-800')}>
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-white">{t.symbol}</span>
                  <span className={cx('text-xs px-1.5 rounded font-mono',t.direction==='bull'?'bg-emerald-900/40 text-emerald-400':'bg-red-900/40 text-red-400')}>{t.direction==='bull'?'L':'S'}</span>
                  <span className="text-xs text-zinc-600">{t.setup_type}</span>
                </div>
                <div className="flex items-center gap-2">
                  {t.outcome&&<span className={cx('text-xs px-2 py-0.5 rounded font-mono',t.outcome==='win'?'bg-emerald-900/40 text-emerald-400':t.outcome==='loss'?'bg-red-900/40 text-red-400':t.outcome==='running'?'bg-yellow-900/40 text-yellow-400':'bg-zinc-800 text-zinc-500')}>{t.outcome.toUpperCase()}</span>}
                  {t.outcome==='running'&&<button onClick={()=>setClosing(t)} className="text-xs text-zinc-600 hover:text-zinc-300">close</button>}
                  <button onClick={()=>del(t.id)} className="text-zinc-700 hover:text-red-400 text-xs">x</button>
                </div>
              </div>
              <div className="flex gap-4 mt-1.5 text-xs text-zinc-600 flex-wrap">
                <span>Entry <span className="font-mono text-zinc-300">{t.entry_price}</span></span>
                {t.exit_price&&<span>Exit <span className="font-mono text-zinc-300">{t.exit_price}</span></span>}
                {t.pnl_r!=null&&<span className={cx('font-mono font-medium',t.pnl_r>=0?'text-emerald-400':'text-red-400')}>{t.pnl_r>=0?'+':''}{t.pnl_r}R</span>}
                {t.pnl_dollars!=null&&<span className={cx('font-mono',t.pnl_dollars>=0?'text-emerald-400':'text-red-400')}>{t.pnl_dollars>=0?'+':''}{t.pnl_dollars.toFixed(0)}</span>}
                {t.session&&<span className="text-zinc-700">{t.session}</span>}
              </div>
              {t.notes&&<p className="text-xs text-zinc-700 mt-1 italic">{t.notes}</p>}
            </div>
          ))}
        </div>
      )}
      {showLog&&<TradeModal onClose={()=>setShowLog(false)} onSaved={load}/>}
      {closing&&(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 w-72 space-y-3">
            <p className="text-sm text-zinc-300">Close {closing.symbol} trade</p>
            <input autoFocus className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none" placeholder="Exit price" value={exitPrice} onChange={e=>setExitPrice(e.target.value)}/>
            <div className="flex gap-2">
              <button onClick={()=>closeOut(closing)} className="flex-1 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm text-white">Close Trade</button>
              <button onClick={()=>setClosing(null)} className="px-3 py-2 rounded-lg bg-zinc-800 text-sm text-zinc-500">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ANALYTICS TAB ──
function AnalyticsTab() {
  const [data,setData] = useState<{stats:Record<string,number>;bySession:Record<string,{wins:number;losses:number;pnl:number}>;bySymbol:Record<string,{wins:number;losses:number;pnl:number}>;equityCurve:{date:string;equity:number}[]}|null>(null);
  useEffect(()=>{ fetch('/api/trades').then(r=>r.json()).then(d=>setData(d)); },[]);
  if(!data||data.stats.total===0) return (
    <div className="text-center py-20">
      <p className="text-zinc-500 text-sm">No trade data yet</p>
      <p className="text-zinc-700 text-xs mt-2">Log trades in the Trades tab — analytics builds automatically.</p>
    </div>
  );
  const {stats,bySession,bySymbol,equityCurve} = data;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[{l:'Trades',v:`${stats.wins}W / ${stats.losses}L`},{l:'Win Rate',v:`${stats.winRate}%`},{l:'Profit Factor',v:stats.profitFactor?.toFixed(2)??'—'},{l:'Total R',v:`${stats.totalR>=0?'+':''}${stats.totalR}R`}].map(s=>(
          <div key={s.l} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-xs text-zinc-500">{s.l}</p><p className="font-mono text-sm text-white mt-1">{s.v}</p></div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">By Session</p>
          {Object.entries(bySession).map(([s,v])=>(
            <div key={s} className="flex justify-between py-1.5 border-b border-zinc-800/40 last:border-0 text-xs">
              <span className="text-zinc-400">{s}</span><span className="text-zinc-600">{v.wins}W {v.losses}L</span>
              <span className={cx('font-mono',v.pnl>=0?'text-emerald-400':'text-red-400')}>{v.pnl>=0?'+':''}{v.pnl.toFixed(0)}</span>
            </div>
          ))}
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">By Symbol</p>
          {Object.entries(bySymbol).map(([s,v])=>(
            <div key={s} className="flex justify-between py-1.5 border-b border-zinc-800/40 last:border-0 text-xs">
              <span className="font-mono text-zinc-400">{s}</span><span className="text-zinc-600">{v.wins}W {v.losses}L</span>
              <span className={cx('font-mono',v.pnl>=0?'text-emerald-400':'text-red-400')}>{v.pnl>=0?'+':''}{v.pnl.toFixed(0)}</span>
            </div>
          ))}
        </div>
      </div>
      {equityCurve.length>1&&(
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Equity Curve</p>
          <div className="h-20 flex items-end gap-px">
            {equityCurve.map((p,i)=>{
              const min=Math.min(...equityCurve.map(x=>x.equity)), max=Math.max(...equityCurve.map(x=>x.equity));
              const h=max===min?50:((p.equity-min)/(max-min))*100;
              return <div key={i} className={cx('flex-1 rounded-sm min-h-px',p.equity>=(equityCurve[0]?.equity??0)?'bg-emerald-500/60':'bg-red-500/60')} style={{height:`${h}%`}}/>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── JOURNAL TAB ──
function JournalTab() {
  const [entries,setEntries] = useState<{id:string;date:string;title:string;content:string;emotion:string;result:string}[]>([]);
  const [adding,setAdding] = useState(false);
  const [form,setForm] = useState({date:new Date().toISOString().slice(0,10),title:'',content:'',emotion:'neutral',result:'no_trade'});
  const [saving,setSaving] = useState(false);
  useEffect(()=>{ sb.from('journal').select('*').order('date',{ascending:false}).then(({data})=>{ if(data) setEntries(data as typeof entries); }); },[]);
  const save=async()=>{ setSaving(true); const {data}=await sb.from('journal').insert(form).select(); if(data) setEntries(p=>[data[0] as typeof entries[0],...p]); setAdding(false); setSaving(false); setForm({date:new Date().toISOString().slice(0,10),title:'',content:'',emotion:'neutral',result:'no_trade'}); };
  const inp="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none";
  const emojiMap:Record<string,string>={confident:'💪',patient:'🧘',neutral:'😐',anxious:'😰',fomo:'😤',revenge:'😡'};
  const resultMap:Record<string,string>={win:'🟢 Win',loss:'🔴 Loss',be:'⚪ BE',no_trade:'— No Trade'};
  const set=(k:string)=>(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>)=>setForm(p=>({...p,[k]:e.target.value}));
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-xs text-zinc-600">{entries.length} sessions logged</span>
        <button onClick={()=>setAdding(p=>!p)} className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500">+ New Entry</button>
      </div>
      {adding&&(
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-zinc-500 mb-1">Date</p><input type="date" className={inp} value={form.date} onChange={set('date')}/></div>
            <div><p className="text-xs text-zinc-500 mb-1">Result</p><select className={inp} value={form.result} onChange={set('result')}>{Object.entries(resultMap).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          <div><p className="text-xs text-zinc-500 mb-1">Title</p><input className={inp} placeholder="e.g. London session — NQ setup" value={form.title} onChange={set('title')}/></div>
          <div><p className="text-xs text-zinc-500 mb-1">Emotion</p>
            <div className="flex gap-2 flex-wrap">{Object.entries(emojiMap).map(([k,v])=>(
              <button key={k} onClick={()=>setForm(p=>({...p,emotion:k}))} className={cx('px-2 py-1 rounded-lg text-xs border transition-all',form.emotion===k?'bg-zinc-700 border-zinc-500 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-600')}>{v} {k}</button>
            ))}</div>
          </div>
          <div><p className="text-xs text-zinc-500 mb-1">Notes</p><textarea className={cx(inp,'h-24 resize-none')} placeholder="What happened? What did you see? What did you do?" value={form.content} onChange={set('content')}/></div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving||!form.title} className="flex-1 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white disabled:opacity-40">{saving?'Saving...':'Save Entry'}</button>
            <button onClick={()=>setAdding(false)} className="px-3 py-2 rounded-lg bg-zinc-800 text-xs text-zinc-500">Cancel</button>
          </div>
        </div>
      )}
      {entries.length===0&&!adding?(
        <div className="text-center py-16"><p className="text-zinc-500 text-sm">No journal entries yet</p><p className="text-zinc-700 text-xs mt-1">Document your sessions — what you saw, what you did, how you felt.</p></div>
      ):(
        <div className="space-y-2">
          {entries.map(e=>(
            <div key={e.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
              <div className="flex justify-between items-start mb-1">
                <div><span className="text-xs text-zinc-300 font-medium">{e.title}</span><span className="text-xs text-zinc-600 ml-2">{e.date}</span></div>
                <div className="flex items-center gap-2"><span className="text-xs">{emojiMap[e.emotion]??'😐'}</span><span className="text-xs text-zinc-600">{resultMap[e.result]??e.result}</span></div>
              </div>
              {e.content&&<p className="text-xs text-zinc-600 leading-relaxed">{e.content}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── KNOWLEDGE TAB ──
function KnowledgeTab() {
  const [articles,setArticles] = useState<{id:string;title:string;content:string;category:string;source_episode:string;tags:string[];is_user_note:boolean}[]>([]);
  const [search,setSearch] = useState('');
  const [adding,setAdding] = useState(false);
  const [form,setForm] = useState({title:'',content:'',tags:''});
  const [saving,setSaving] = useState(false);
  const [open,setOpen] = useState<string|null>(null);
  useEffect(()=>{ sb.from('knowledge_base').select('*').order('source_episode').limit(200).then(({data,error})=>{ if(error) console.error('KB:',error); if(data) setArticles(data as typeof articles); }); },[]);
  const save=async()=>{ setSaving(true); const {data}=await sb.from('knowledge_base').insert({...form,tags:form.tags.split(',').map(t=>t.trim()).filter(Boolean),is_user_note:true,source_episode:'My Notes',category:'note'}).select(); if(data) setArticles(p=>[data[0] as typeof articles[0],...p]); setAdding(false); setSaving(false); };
  const filtered=articles.filter(a=>!search||a.title?.toLowerCase().includes(search.toLowerCase())||a.content?.toLowerCase().includes(search.toLowerCase()));
  const inp="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none";
  const set=(k:string)=>(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>setForm(p=>({...p,[k]:e.target.value}));
  const epColor=(ep:string)=>{
    if(ep?.includes('2022')) return 'bg-blue-900/40 text-blue-400';
    if(ep?.includes('2017')) return 'bg-amber-900/40 text-amber-400';
    if(ep?.includes('Bonus')||ep?.includes('MMXM')) return 'bg-emerald-900/40 text-emerald-400';
    if(ep==='My Notes') return 'bg-zinc-700 text-zinc-300';
    return 'bg-zinc-800 text-zinc-500';
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <input className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-zinc-600 placeholder-zinc-700" placeholder="Search ICT concepts, episodes, setups..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <button onClick={()=>setAdding(p=>!p)} className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500 whitespace-nowrap">+ Note</button>
        <span className="text-xs text-zinc-700 whitespace-nowrap">{filtered.length}/{articles.length}</span>
      </div>
      {adding&&(
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3">
          <div><p className="text-xs text-zinc-500 mb-1">Title</p><input className={inp} value={form.title} onChange={set('title')}/></div>
          <div><p className="text-xs text-zinc-500 mb-1">Content</p><textarea className={cx(inp,'h-20 resize-none')} value={form.content} onChange={set('content')}/></div>
          <div><p className="text-xs text-zinc-500 mb-1">Tags (comma separated)</p><input className={inp} placeholder="e.g. FVG, discount, entry" value={form.tags} onChange={set('tags')}/></div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving||!form.title} className="flex-1 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white disabled:opacity-40">{saving?'Saving...':'Save Note'}</button>
            <button onClick={()=>setAdding(false)} className="px-3 rounded-lg bg-zinc-800 text-xs text-zinc-500">Cancel</button>
          </div>
        </div>
      )}
      {!articles.length?(
        <div className="text-center py-12 text-zinc-600 text-sm animate-pulse">Loading 40 ICT articles...</div>
      ):(
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map(a=>(
            <div key={a.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 cursor-pointer hover:border-zinc-700 transition-all" onClick={()=>setOpen(open===a.id?null:a.id)}>
              <div className="flex justify-between items-start gap-2 mb-1">
                <span className="text-xs text-zinc-300 font-medium leading-tight">{a.title}</span>
                <span className={cx('text-xs px-1.5 py-0.5 rounded shrink-0 font-mono',epColor(a.source_episode))}>{a.source_episode}</span>
              </div>
              {a.tags?.length>0&&<div className="flex gap-1 flex-wrap mt-1">{a.tags.slice(0,4).map((t,i)=><span key={i} className="text-xs text-zinc-700 bg-zinc-800/50 px-1.5 rounded">{t}</span>)}</div>}
              {open===a.id&&<p className="text-xs text-zinc-500 mt-2 leading-relaxed border-t border-zinc-800 pt-2">{a.content}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── TELEGRAM SETTINGS ──
function TelegramSettings({ onClose }:{ onClose:()=>void }) {
  const [cfg,setCfg] = useState({bot_token:'',chat_id:'',alert_sl:true,alert_entry:true,alert_tp:true,alert_scan:true});
  const [saving,setSaving] = useState(false);
  const [testing,setTesting] = useState(false);
  const [msg,setMsg] = useState('');
  useEffect(()=>{ fetch('/api/telegram').then(r=>r.json()).then(d=>{ if(d.config) setCfg(c=>({...c,...d.config})); }); },[]);
  const save=async()=>{ setSaving(true); const r=await fetch('/api/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',...cfg})}); const d=await r.json(); setMsg(d.ok?'Saved!':d.error??'Error'); setSaving(false); };
  const test=async()=>{ setTesting(true); const r=await fetch('/api/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test',bot_token:cfg.bot_token,chat_id:cfg.chat_id})}); const d=await r.json(); setMsg(d.result?.ok?'Message sent to Telegram!':'Failed — check bot token and chat ID'); setTesting(false); };
  const inp="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none";
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex justify-between items-center">
          <span className="text-sm font-mono text-zinc-300">Telegram Alerts</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">x</button>
        </div>
        <div className="text-xs text-zinc-600 leading-relaxed space-y-1 bg-zinc-800/40 rounded-lg p-3">
          <p>1. Open Telegram, search <span className="text-zinc-400 font-mono">@BotFather</span></p>
          <p>2. Send <span className="text-zinc-400 font-mono">/newbot</span> and get your token</p>
          <p>3. Message your bot, then find your chat ID at <span className="text-zinc-400 font-mono">@userinfobot</span></p>
        </div>
        <div className="space-y-2">
          <div><p className="text-xs text-zinc-500 mb-1">Bot Token</p><input className={inp} placeholder="110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" value={cfg.bot_token} onChange={e=>setCfg(p=>({...p,bot_token:e.target.value}))}/></div>
          <div><p className="text-xs text-zinc-500 mb-1">Chat ID</p><input className={inp} placeholder="123456789" value={cfg.chat_id} onChange={e=>setCfg(p=>({...p,chat_id:e.target.value}))}/></div>
        </div>
        <div className="space-y-1.5">
          {[['alert_sl','SL breached'],['alert_entry','Price in entry zone'],['alert_tp','Target hit'],['alert_scan','New setups found']].map(([k,l])=>(
            <label key={k} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-zinc-400" checked={cfg[k as keyof typeof cfg] as boolean} onChange={e=>setCfg(p=>({...p,[k]:e.target.checked}))}/>
              <span className="text-xs text-zinc-400">{l}</span>
            </label>
          ))}
        </div>
        {msg&&<p className="text-xs text-zinc-400">{msg}</p>}
        <div className="flex gap-2">
          <button onClick={test} disabled={testing||!cfg.bot_token||!cfg.chat_id} className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 disabled:opacity-40 hover:border-zinc-500">{testing?'Testing...':'Test'}</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white disabled:opacity-40">{saving?'Saving...':'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ──
export default function App() {
  const [tab,setTab] = useState<Tab>('Markets');
  const [mktTab,setMktTab] = useState<MkTab>('Futures');
  const [setups,setSetups] = useState<Setup[]>([]);
  const [prices,setPrices] = useState<Prices>({NQ:null,ES:null,GC:null,DXY:null,VIX:null});
  const [kz,setKz] = useState<{nyTime:string;active:{name:string;short:string;color:string}|null}|null>(null);
  const [calNews,setCalNews] = useState<{name:string;impact:string;isDangerZone:boolean}[]>([]);
  const [showScan,setShowScan] = useState(false);
  const [showTelegram,setShowTelegram] = useState(false);
  const [selected,setSelected] = useState<Setup|null>(null);
  const [showAnalysis,setShowAnalysis] = useState(false);
  const [showTrade,setShowTrade] = useState(false);
  const [tradingSetup,setTradingSetup] = useState<Setup|null>(null);
  const [alerts,setAlerts] = useState<{id:string;msg:string;type:string}[]>([]);
  const firedAlerts = useRef<Set<string>>(new Set());

  const addAlert = useCallback((msg:string,type='y')=>{
    const id = Date.now().toString();
    setAlerts(p=>[...p.slice(-2),{id,msg,type}]);
    setTimeout(()=>setAlerts(p=>p.filter(a=>a.id!==id)),6000);
  },[]);

  const loadSetups = useCallback(async()=>{
    const {data} = await sb.from('setups').select('*').in('status',['active','watching','triggered']).order('confluence_score',{ascending:false}).limit(60);
    if(data) setSetups(data as Setup[]);
  },[]);

  const deleteSetup = useCallback(async(id:string)=>{
    await sb.from('setups').delete().eq('id',id);
    setSetups(p=>p.filter(s=>s.id!==id));
    if(selected?.id===id){ setSelected(null); setShowAnalysis(false); }
  },[selected]);

  useEffect(()=>{ loadSetups(); },[loadSetups]);

  const loadPrices = useCallback(async()=>{
    try {
      const r = await fetch('/api/prices',{cache:'no-store'});
      const d = await r.json();
      if(d.prices) setPrices(d.prices);
    } catch {}
  },[]);

  const loadKz = useCallback(async()=>{
    try { const r=await fetch('/api/killzone',{cache:'no-store'}); const d=await r.json(); setKz(d); } catch {}
  },[]);

  const loadNews = useCallback(async()=>{
    try { const r=await fetch('/api/calendar',{cache:'no-store'}); const d=await r.json(); setCalNews(d.events??[]); } catch {}
  },[]);

  useEffect(()=>{
    loadPrices(); loadKz(); loadNews();
    const pi=setInterval(loadPrices,15000), ki=setInterval(loadKz,60000), ni=setInterval(loadNews,300000);
    return()=>{ clearInterval(pi); clearInterval(ki); clearInterval(ni); };
  },[loadPrices,loadKz,loadNews]);

  // SL/Entry alerts (browser tab)
  useEffect(()=>{
    setups.forEach(s=>{
      if(!['active','watching'].includes(s.status)) return;
      if(s.expires_at&&new Date(s.expires_at)<new Date()) return;
      const p = prices[s.symbol as keyof Prices];
      if(!p) return;
      const bull = s.direction==='bull'||s.direction==='long';
      const slK = `sl-${s.id}`;
      if(!firedAlerts.current.has(slK)&&((bull&&p<s.stop_loss)||(!bull&&p>s.stop_loss))){
        firedAlerts.current.add(slK);
        addAlert(`SL hit — ${s.symbol} ${s.setup_type}`,'r');
      }
      const eK = `e-${s.id}`;
      if(!firedAlerts.current.has(eK)&&p>=s.entry_low&&p<=s.entry_high){
        firedAlerts.current.add(eK);
        addAlert(`Entry zone — ${s.symbol} ${s.setup_type}`,'g');
      }
    });
  },[prices,setups,addAlert]);

  const dangerNews = calNews.some(e=>e.isDangerZone);
  const pFmt = (sym: keyof Prices, dec=1) => prices[sym]!=null ? prices[sym]!.toFixed(dec) : '—';

  const TABS: Tab[] = ['Markets','Trades','Analytics','Journal','Knowledge'];
  const MKT_TABS: MkTab[] = ['Futures','Crypto','Forex','Stocks','Institutional'];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200" style={{fontFamily:'ui-monospace,SFMono-Regular,monospace'}}>
      {/* TOAST ALERTS */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
        {alerts.map(a=>(
          <div key={a.id} className={cx('px-3 py-2 rounded-xl text-xs border shadow-lg',
            a.type==='r'?'bg-red-900/90 border-red-700 text-red-200':
            a.type==='g'?'bg-emerald-900/90 border-emerald-700 text-emerald-200':
            'bg-zinc-800/90 border-zinc-600 text-zinc-200')}>
            {a.msg}
          </div>
        ))}
      </div>

      {/* HEADER */}
      <header className="border-b border-zinc-800/60 px-4 py-2 flex items-center justify-between sticky top-0 bg-zinc-950/95 backdrop-blur-sm z-40">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-widest text-white">VECTOR</span>
          <div className={cx('w-1.5 h-1.5 rounded-full animate-pulse',prices.NQ?'bg-emerald-500':'bg-zinc-600')}/>
          {kz&&<span className="text-xs hidden sm:block">
            {kz.active
              ? <span className={cx('font-medium',kz.active.color==='yellow'?'text-yellow-400':kz.active.color==='green'?'text-emerald-400':'text-blue-400')}>{kz.active.short}</span>
              : <span className="text-zinc-600">OFF</span>}
            <span className="text-zinc-700"> · {kz.nyTime}</span>
          </span>}
          {dangerNews&&<span className="text-xs text-red-400 animate-pulse hidden sm:block">NEWS</span>}
        </div>
        <div className="flex items-center gap-4 overflow-x-auto">
          {(['NQ','ES','GC','DXY','VIX'] as const).map(s=>(
            <span key={s} className="text-xs shrink-0 font-mono">
              <span className="text-zinc-600">{s} </span>
              <span className="text-zinc-300">{s==='DXY'?pFmt(s,3):s==='VIX'?pFmt(s,2):pFmt(s,1)}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={()=>setShowTelegram(true)} title="Telegram alerts" className="text-zinc-600 hover:text-zinc-300 text-lg leading-none">🔔</button>
          <button onClick={()=>setShowScan(true)} className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500">Scan</button>
        </div>
      </header>

      {/* NAV */}
      <nav className="border-b border-zinc-800/60 px-4 flex gap-0 overflow-x-auto">
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} className={cx('px-4 py-2.5 text-xs border-b-2 transition-all whitespace-nowrap',
            tab===t?'border-zinc-400 text-zinc-200':'border-transparent text-zinc-600 hover:text-zinc-400')}>
            {t}
          </button>
        ))}
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-4">

        {/* MARKETS */}
        {tab==='Markets'&&(
          <div className="space-y-4">
            <div className="flex gap-1 overflow-x-auto pb-1">
              {MKT_TABS.map(t=>(
                <button key={t} onClick={()=>setMktTab(t)} className={cx('px-3 py-1.5 rounded-lg text-xs border transition-all whitespace-nowrap',
                  mktTab===t?'bg-zinc-800 border-zinc-600 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>
                  {t}
                </button>
              ))}
            </div>

            {mktTab==='Futures'&&(
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-600 uppercase tracking-wider">Active Setups · {setups.length}</span>
                  <button onClick={()=>setShowScan(true)} className="text-xs text-zinc-700 hover:text-zinc-400">+ scan</button>
                </div>
                {setups.length===0?(
                  <div className="text-center py-20 space-y-3">
                    <p className="text-zinc-600 text-sm">No setups — run a scan</p>
                    <button onClick={()=>setShowScan(true)} className="px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:border-zinc-500">Scan Market</button>
                  </div>
                ):(
                  <div className="space-y-2">
                    {setups.map(s=>(
                      <div key={s.id}>
                        <SetupCard
                          s={s} prices={prices}
                          onDelete={deleteSetup}
                          onAnalyze={s=>{ setSelected(s); setShowAnalysis(true); }}
                          onTrade={s=>{ setTradingSetup(s); setShowTrade(true); }}
                          selected={selected?.id===s.id}
                          onSelect={s=>{ setSelected(s); setShowAnalysis(false); }}
                        />
                        {showAnalysis&&selected?.id===s.id&&(
                          <AnalysisPanel setup={s} prices={prices} onClose={()=>setShowAnalysis(false)}/>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mktTab==='Crypto'&&<CryptoTab/>}
            {mktTab==='Forex'&&<ForexTab/>}
            {mktTab==='Stocks'&&<StocksTab/>}
            {mktTab==='Institutional'&&<InstitutionalTab/>}
          </div>
        )}

        {tab==='Trades'&&<TradesTab/>}
        {tab==='Analytics'&&<AnalyticsTab/>}
        {tab==='Journal'&&<JournalTab/>}
        {tab==='Knowledge'&&<KnowledgeTab/>}
      </main>

      {showScan&&<ScanModal prices={prices} onClose={()=>setShowScan(false)} onDone={()=>{ setShowScan(false); loadSetups(); }}/>}
      {showTelegram&&<TelegramSettings onClose={()=>setShowTelegram(false)}/>}
      {showTrade&&<TradeModal setup={tradingSetup} onClose={()=>{ setShowTrade(false); setTradingSetup(null); }} onSaved={()=>{}}/>}
    </div>
  );
}
