'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import dynamic from 'next/dynamic';

const sb = createClient(
  'https://xavkbjbgmuasfkliptsh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamJnbXVhc2ZrbGlwdHNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNTAzOTIsImV4cCI6MjA5MzkyNjM5Mn0.GJgxNwP6LfphbHTijGhrHK5DMpDcarJin2bVmoxU4bo'
);

type Tab = 'Markets'|'Setups'|'Trades'|'Analytics'|'Journal'|'Knowledge'|'Backtest'|'Agents';
type MkTab = 'Futures'|'Crypto'|'Forex'|'Stocks'|'Institutional';
type Prices = { NQ:number|null; ES:number|null; GC:number|null; DXY:number|null; VIX:number|null };

interface Setup {
  id: string; symbol: string; timeframe: string; direction: string; setup_type: string;
  entry_low: number; entry_high: number; stop_loss: number; target: number; rr_ratio: number;
  htf_bias: string; cisd_confirmed: boolean; volume_context: string; dol_target: string;
  killzone_valid: string; confluence_score: number; status: string; ai_analysis: string;
  expires_at: string; created_at: string; correlated_align: boolean; market_section: string;
  bos_level?: number; bos_direction?: string; choch_level?: number;
}

const cx = (...a: (string|boolean|undefined|null)[]) => a.filter(Boolean).join(' ');

// ── SPARKLINE ─────────────────────────────────
function Sparkline({ data, color = '#22c55e', height = 32 }: { data: (number|null|undefined)[]; color?: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || data.length < 2) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.offsetWidth || 80; const h = height;
    canvas.width = w * 2; canvas.height = h * 2; ctx.scale(2, 2);
    ctx.clearRect(0, 0, w, h);
    const clean = data.filter((v): v is number => v != null);
    if (clean.length < 2) return;
    const min = Math.min(...clean), max = Math.max(...clean);
    const range = max - min || 1;
    const pts = data.map((v, i) => ({ x: (i / (data.length - 1)) * w, y: h - (((v ?? min) - min) / range) * (h - 4) - 2 }));
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  }, [data, color, height]);
  return <canvas ref={ref} style={{ width: '80px', height: `${height}px`, display: 'block' }} />;
}

// ── PRICE ROW ─────────────────────────────────
function PriceRow({ symbol, price, change, changePct, history, currency = '' }: {
  symbol: string; price: number|null; change?: number|null; changePct?: number|null;
  history?: (number|null|undefined)[]; currency?: string;
}) {
  const up = (changePct ?? change ?? 0) >= 0;
  const fmt = (v: number|null, d = 2) => v == null ? '—' : v >= 1000 ? v.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}) : v.toFixed(d);
  const pctFmt = (v: number|null) => v == null ? '' : `${v>=0?'+':''}${v.toFixed(2)}%`;
  return (
    <div className="price-row">
      <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
        <div style={{width:28,height:28,borderRadius:7,background:'var(--bg-3)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <span style={{fontSize:9,fontWeight:700,fontFamily:'JetBrains Mono',color:'var(--muted)',letterSpacing:'0.02em'}}>
            {symbol.slice(0,3)}
          </span>
        </div>
        <span style={{fontSize:12,fontWeight:600,fontFamily:'JetBrains Mono',color:'var(--text)',letterSpacing:'-0.01em'}}>{symbol}</span>
        {history && history.length > 2 && <Sparkline data={history} color={up ? '#22c55e' : '#ef4444'} />}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
        <span style={{fontSize:13,fontFamily:'JetBrains Mono',fontWeight:600,color:'var(--text)',letterSpacing:'-0.02em'}}>{currency}{fmt(price)}</span>
        {changePct != null && (
          <span style={{
            fontSize:11,fontFamily:'JetBrains Mono',fontWeight:600,
            padding:'2px 7px',borderRadius:4,
            background: up?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',
            color: up?'#4ade80':'#f87171',
            border: `1px solid ${up?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)'}`,
          }}>{pctFmt(changePct)}</span>
        )}
      </div>
    </div>
  );
}

// ── MINI CANDLE CHART ──────────────────────────
function CandleChart({ symbol, timeframe, entry_low, entry_high, stop_loss, target }: {
  symbol: string; timeframe: string; entry_low: number; entry_high: number; stop_loss: number; target: number;
}) {
  const [candles, setCandles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/candles?symbol=${symbol}&timeframe=${timeframe}`)
      .then(r => r.json())
      .then(d => { setCandles(d.candles ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!canvasRef.current || candles.length < 5) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.offsetWidth || 320, H = 140;
    canvas.width = W * 2; canvas.height = H * 2; ctx.scale(2, 2);
    ctx.clearRect(0, 0, W, H);

    const last = candles.slice(-60);
    const allPrices = last.flatMap(c => [c.h, c.l, entry_low, entry_high, stop_loss, target]);
    const minP = Math.min(...allPrices), maxP = Math.max(...allPrices);
    const range = maxP - minP || 1;
    const pad = 8;
    const toY = (p: number) => pad + ((maxP - p) / range) * (H - pad * 2);
    const cW = Math.max(3, (W / last.length) - 1);

    // Draw entry zone
    ctx.fillStyle = 'rgba(234,179,8,0.12)';
    ctx.fillRect(0, toY(entry_high), W, toY(entry_low) - toY(entry_high));
    // Draw SL line
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, toY(stop_loss)); ctx.lineTo(W, toY(stop_loss)); ctx.stroke();
    // Draw TP line
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, toY(target)); ctx.lineTo(W, toY(target)); ctx.stroke();
    ctx.setLineDash([]);

    // Draw candles
    last.forEach((c, i) => {
      const x = i * (W / last.length) + cW / 4;
      const isBull = c.c >= c.o;
      ctx.fillStyle = isBull ? '#22c55e' : '#ef4444';
      ctx.strokeStyle = isBull ? '#22c55e' : '#ef4444';
      ctx.lineWidth = 0.8;
      // Wick
      ctx.beginPath();
      ctx.moveTo(x + cW / 2, toY(c.h));
      ctx.lineTo(x + cW / 2, toY(c.l));
      ctx.stroke();
      // Body
      const bodyTop = toY(Math.max(c.o, c.c));
      const bodyBot = toY(Math.min(c.o, c.c));
      const bodyH = Math.max(1, bodyBot - bodyTop);
      ctx.fillRect(x, bodyTop, cW, bodyH);
    });
  }, [candles, entry_low, entry_high, stop_loss, target]);

  if (loading) return <div className="h-36 flex items-center justify-center text-xs text-zinc-700">Loading chart…</div>;
  if (!candles.length) return <div className="h-36 flex items-center justify-center text-xs text-zinc-700">No chart data</div>;

  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-zinc-800/60">
      <canvas ref={canvasRef} style={{ width: '100%', height: '140px', display: 'block' }} />
      <div className="flex justify-between px-2 py-1 text-xs font-mono text-zinc-700 bg-zinc-900/60">
        <span className="text-red-500">SL {stop_loss}</span>
        <span className="text-yellow-500">Entry {entry_low}–{entry_high}</span>
        <span className="text-emerald-500">TP {target}</span>
      </div>
    </div>
  );
}

// ── SETUP CARD ─────────────────────────────────
// ── MONITOR BUTTON ─────────────────────────────
function MonitorButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const run = async () => {
    setRunning(true); setResult(null);
    try {
      const r = await fetch('/api/setups/monitor', { method: 'POST' });
      const d = await r.json();
      setResult(d);
      onDone();
    } catch (e: any) { setResult({ error: e.message }); }
    setRunning(false);
  };
  return (
    <div style={{display:'flex',alignItems:'center',gap:6}}>
      <button onClick={run} disabled={running} className="btn btn-ghost" style={{fontSize:11,padding:'5px 12px',color:'var(--amber-3)'}}>
        {running ? '↻ Monitoring...' : '⟳ Monitor'}
      </button>
      {result && !result.error && (
        <span style={{fontSize:10,color:'var(--muted)'}}>
          {result.updated > 0 ? `${result.filled} filled • ${result.expired} expired` : 'All watching'}
        </span>
      )}
    </div>
  );
}

function SetupCard({ s, prices, onDelete, onAnalyze, onTrade, onSelect, selected }: {
  s: Setup; prices: Prices; onDelete: (id: string) => void;
  onAnalyze: (s: Setup) => void; onTrade: (s: Setup) => void;
  onSelect: (s: Setup) => void; selected: boolean;
}) {
  const [showChart, setShowChart] = useState(false);
  const price = prices[s.symbol as keyof Prices];
  const isBull = s.direction === 'bull' || s.direction === 'long';
  const inZone = price != null && price >= s.entry_low && price <= s.entry_high;
  const sc = s.confluence_score;
  const scoreClass = sc >= 80 ? 'score-high' : sc >= 65 ? 'score-mid' : 'score-low';

  // Expiry countdown
  const expiresAt = s.expires_at ? new Date(s.expires_at) : null;
  const now = new Date();
  const minsLeft = expiresAt ? Math.round((expiresAt.getTime() - now.getTime()) / 60000) : null;
  const expired = minsLeft !== null && minsLeft <= 0;
  const expiringSoon = minsLeft !== null && minsLeft > 0 && minsLeft <= 60;

  // Price distance to entry
  const distToEntry = price != null ? (isBull ? price - s.entry_high : s.entry_low - price) : null;
  const distPct = distToEntry != null && s.entry_high > 0 ? Math.abs(distToEntry / s.entry_high * 100) : null;

  return (
    <div
      onClick={() => onSelect(s)}
      className={cx('setup-card', isBull ? 'bull-card' : 'bear-card', selected ? 'selected' : '')}
    >
      {/* TOP ROW */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
          <span style={{fontSize:13,fontFamily:'JetBrains Mono',fontWeight:700,color:'var(--text)'}}>{s.symbol}</span>
          <span className={cx('badge', isBull ? 'badge-green' : 'badge-red')}>
            {isBull ? 'LONG' : 'SHORT'}
          </span>
          <span className="badge badge-gray">{s.timeframe}</span>
          <span className="badge badge-gray" style={{maxWidth:180,overflow:'hidden',textOverflow:'ellipsis'}}>{s.setup_type}</span>
          {s.cisd_confirmed && <span className="badge badge-blue">CISD</span>}
          {s.choch_level && <span className="badge badge-purple">CHoCH</span>}
          {s.bos_level && <span className="badge badge-purple">BOS</span>}
          {inZone && <span className="badge badge-amber" style={{animation:'pulse-dot 1.5s infinite'}}>IN ZONE</span>}
          {expired && <span className="badge badge-red">EXPIRED</span>}
          {expiringSoon && !expired && <span className="badge badge-amber">{minsLeft}m left</span>}
          {distPct != null && !inZone && !expired && distToEntry != null && distToEntry > 0 && (
            <span className="badge badge-gray">{distPct.toFixed(1)}% away</span>
          )}
        </div>
        <div className={cx('score-ring', scoreClass)}>{sc}</div>
      </div>

      {/* PRICE GRID */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'4px 12px',marginTop:10}}>
        {[
          {l:'Entry',v:`${s.entry_low}–${s.entry_high}`,c:'var(--text-2)'},
          {l:'Stop',v:String(s.stop_loss),c:'var(--red-3)'},
          {l:'Target',v:String(s.target),c:'var(--green-3)'},
          {l:'R:R',v:`${s.rr_ratio}R`,c:'var(--text)'},
          {l:'Vol',v:s.volume_context,c:s.volume_context==='high'?'var(--green-3)':s.volume_context==='low'?'var(--red-3)':'var(--text-2)'},
          {l:'Live',v:price?.toFixed(1)??'—',c:inZone?'var(--amber-3)':'var(--text-2)'},
          {l:'Expires',v:expiresAt?`${expiresAt.toLocaleDateString([],{month:'short',day:'numeric'})} ${expiresAt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'-',c:expired?'var(--red-3)':expiringSoon?'var(--amber-3)':'var(--muted)'},
        ].map(({l,v,c})=>(
          <div key={l} style={{display:'flex',gap:4,alignItems:'baseline'}}>
            <span style={{fontSize:10,color:'var(--muted)',fontWeight:600,letterSpacing:'0.05em',textTransform:'uppercase',flexShrink:0}}>{l}</span>
            <span style={{fontSize:11,fontFamily:'JetBrains Mono',fontWeight:600,color:c,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</span>
          </div>
        ))}
      </div>

      {/* DOL TARGET */}
      {s.dol_target && (
        <div style={{marginTop:8,padding:'5px 8px',borderRadius:5,background:'var(--bg-3)',border:'1px solid var(--border)'}}>
          <span style={{fontSize:10,color:'var(--muted)',fontFamily:'JetBrains Mono',lineHeight:1.5}}>{s.dol_target}</span>
        </div>
      )}

      {/* ACTIONS */}
      <div style={{marginTop:10,display:'flex',alignItems:'center',gap:6}} onClick={e=>e.stopPropagation()}>
        <button onClick={()=>onAnalyze(s)} className="btn btn-ghost btn-xs"><Icons.Brain/>AI</button>
        <button onClick={()=>onTrade(s)} className="btn btn-xs" style={{background:'rgba(34,197,94,0.1)',color:'var(--green-3)',border:'1px solid rgba(34,197,94,0.2)'}}>
          <Icons.Check/>Log Trade
        </button>
        <button onClick={()=>setShowChart(p=>!p)} className="btn btn-ghost btn-xs">
          <Icons.Chart/>{showChart?'Hide':'Chart'}
        </button>
        <button onClick={()=>onDelete(s.id)} className="btn btn-ghost btn-xs" style={{marginLeft:'auto',color:'var(--muted)'}}>
          <Icons.X/>
        </button>
      </div>

      {showChart && (
        <div onClick={e=>e.stopPropagation()} style={{marginTop:8}}>
          <CandleChart symbol={s.symbol} timeframe={s.timeframe} entry_low={s.entry_low} entry_high={s.entry_high} stop_loss={s.stop_loss} target={s.target}/>
        </div>
      )}
    </div>
  );
}

// ── ANALYSIS PANEL ─────────────────────────────
function AnalysisPanel({ setup, prices, onClose }: { setup: Setup; prices: Prices; onClose: () => void }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (setup.ai_analysis) { setText(setup.ai_analysis); return; }
    setLoading(true);
    fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setup, prices }) })
      .then(r => r.json()).then(d => { setText(d.analysis ?? d.error ?? 'No response'); setLoading(false); }).catch(() => setLoading(false));
  }, [setup.id]);
  return (
    <div className="mt-2 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">AI Analysis — {setup.symbol} {setup.setup_type}</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400 text-sm">✕</button>
      </div>
      {loading ? <div className="flex items-center gap-2 text-xs text-zinc-500"><span className="animate-spin inline-block">↻</span> Analyzing…</div>
        : <pre className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed font-mono">{text}</pre>}
    </div>
  );
}

// ── SCAN MODAL ─────────────────────────────────
function ScanModal({ prices, onClose, onDone }: { prices: Prices; onClose: () => void; onDone: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState('');
  const [syms, setSyms] = useState(['NQ','ES','GC','EURUSD','GBPUSD','BTC']);
  const [tfs, setTfs] = useState(['1h','4h']);
  const symOpts = ['NQ','ES','GC','CL','BTC','ETH','EURUSD','GBPUSD','USDJPY','AUDUSD','SPY','QQQ','NVDA'];
  const tfOpts = ['15m','1h','4h'];
  const toggle = (arr: string[], setArr: (a:string[])=>void, v: string) =>
    setArr(arr.includes(v) ? arr.filter(x=>x!==v) : [...arr, v]);
  const scan = async () => {
    setScanning(true); setLog([]); setResult('');
    try {
      const r = await fetch('/api/autoscan', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ symbols: syms, timeframes: tfs, currentPrices: prices }) });
      const d = await r.json();
      setResult(d.message ?? d.error ?? 'Done');
      setLog(d.debug ?? []);
      if (!d.error) setTimeout(onDone, 1000);
    } catch (e) { setResult('Error: ' + String(e)); }
    setScanning(false);
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-full max-w-md" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm font-bold text-white">ICT Market Scan</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">✕</button>
        </div>
        <div className="space-y-3 mb-4">
          <div>
            <p className="text-xs text-zinc-600 mb-2 uppercase tracking-wider">Symbols</p>
            <div className="flex flex-wrap gap-1.5">
              {symOpts.map(s => <button key={s} onClick={()=>toggle(syms,setSyms,s)} className={cx('px-2.5 py-1 rounded-lg text-xs border transition-all', syms.includes(s)?'border-zinc-500 bg-zinc-700 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>{s}</button>)}
            </div>
          </div>
          <div>
            <p className="text-xs text-zinc-600 mb-2 uppercase tracking-wider">Timeframes</p>
            <div className="flex gap-1.5">
              {tfOpts.map(t => <button key={t} onClick={()=>toggle(tfs,setTfs,t)} className={cx('px-2.5 py-1 rounded-lg text-xs border transition-all', tfs.includes(t)?'border-zinc-500 bg-zinc-700 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>{t}</button>)}
            </div>
          </div>
        </div>
        {result && <div className={cx('text-xs p-2 rounded-lg mb-3', result.includes('Error')?'text-red-400 bg-red-900/20':'text-emerald-400 bg-emerald-900/20')}>{result}</div>}
        {log.length > 0 && (
          <div className="bg-zinc-950 rounded-lg p-2 mb-3 max-h-40 overflow-y-auto">
            {log.map((l,i) => <div key={i} className={cx('text-xs font-mono', l.includes('SAVED')?'text-emerald-400':l.includes('error')?'text-red-400':'text-zinc-600')}>{l}</div>)}
          </div>
        )}
        <button onClick={scan} disabled={scanning||!syms.length} className="w-full py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white font-medium transition-colors disabled:opacity-50">
          {scanning ? 'Scanning…' : `Scan ${syms.length} symbols × ${tfs.length} timeframes`}
        </button>
      </div>
    </div>
  );
}

// ── TRADE MODAL ────────────────────────────────
const MISTAKES = ['Early entry','Late entry','Moved SL','Over-sized','FOMO','Revenge trade','Missed entry','Broke rules','Wrong direction','News ignored'];

function TradeModal({ setup, onClose, onSaved }: { setup: Setup|null; onClose: ()=>void; onSaved: ()=>void }) {
  const [entry, setEntry] = useState(setup ? ((setup.entry_low + setup.entry_high)/2).toFixed(2) : '');
  const [sl, setSl] = useState(setup?.stop_loss.toString() ?? '');
  const [tp, setTp] = useState(setup?.target.toString() ?? '');
  const [riskD, setRiskD] = useState('100');
  const [notes, setNotes] = useState('');
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({
      symbol: setup?.symbol ?? 'MANUAL', direction: setup?.direction ?? 'bull',
      entry_price: parseFloat(entry), stop_loss: parseFloat(sl), target: parseFloat(tp),
      risk_dollars: parseFloat(riskD), setup_id: setup?.id, setup_type: setup?.setup_type,
      timeframe: setup?.timeframe, notes, mistakes
    })});
    setSaving(false); onSaved(); onClose();
  };
  const toggle = (m: string) => setMistakes(p => p.includes(m) ? p.filter(x=>x!==m) : [...p, m]);
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm font-bold text-white">Log Trade {setup ? `— ${setup.symbol}` : ''}</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">✕</button>
        </div>
        <div className="space-y-3">
          {[['Entry',entry,setEntry],['Stop Loss',sl,setSl],['Target',tp,setTp],['Risk ($)',riskD,setRiskD]].map(([label,val,set])=>(
            <div key={label as string}>
              <label className="text-xs text-zinc-600 block mb-1">{label as string}</label>
              <input value={val as string} onChange={e=>(set as (v:string)=>void)(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono"/>
            </div>
          ))}
          <div>
            <label className="text-xs text-zinc-600 block mb-1.5">Tag mistakes</label>
            <div className="flex flex-wrap gap-1.5">
              {MISTAKES.map(m => <button key={m} onClick={()=>toggle(m)} className={cx('px-2 py-0.5 rounded text-xs border transition-all', mistakes.includes(m)?'border-red-700 bg-red-900/40 text-red-300':'border-zinc-800 text-zinc-600')}>{m}</button>)}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-600 block mb-1">Notes</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 resize-none"/>
          </div>
        </div>
        <button onClick={save} disabled={saving} className="mt-4 w-full py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-sm text-white font-medium transition-colors">{saving ? 'Saving…' : 'Save Trade'}</button>
      </div>
    </div>
  );
}

// ── CLOSE TRADE MODAL ──────────────────────────
function CloseTradeModal({ trade, onClose, onSaved, onJournal }: { trade: any; onClose: ()=>void; onSaved: ()=>void; onJournal?: (t: any)=>void }) {
  const [exit, setExit] = useState('');
  const [notes, setNotes] = useState(trade.notes ?? '');
  const [mistakes, setMistakes] = useState<string[]>(trade.mistakes ?? []);
  const [saving, setSaving] = useState(false);
  const toggle = (m: string) => setMistakes(p => p.includes(m) ? p.filter(x=>x!==m) : [...p, m]);
  const save = async () => {
    setSaving(true);
    const r = await fetch('/api/trades', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id: trade.id, exit_price: parseFloat(exit), notes, mistakes }) });
    const d = await r.json();
    setSaving(false); onSaved(); onClose();
    if (onJournal) onJournal(d.trade);
  };
  const isBull = trade.direction === 'bull' || trade.direction === 'long';
  const ep = parseFloat(exit);
  const pnlR = ep && trade.entry_price && trade.stop_loss ? +((( isBull ? ep - trade.entry_price : trade.entry_price - ep) / Math.abs(trade.entry_price - trade.stop_loss)).toFixed(2)) : null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm font-bold text-white">Close Trade — {trade.symbol}</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">✕</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-600 block mb-1">Exit Price</label>
            <input value={exit} onChange={e=>setExit(e.target.value)} placeholder={trade.target?.toString()} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono"/>
            {pnlR !== null && <p className={cx('text-xs mt-1 font-mono', pnlR > 0 ? 'text-emerald-400' : 'text-red-400')}>{pnlR > 0 ? '+' : ''}{pnlR}R {trade.risk_dollars ? `(${ (pnlR * trade.risk_dollars).toFixed(0) })` : ''}</p>}
          </div>
          <div>
            <label className="text-xs text-zinc-600 block mb-1.5">Tag mistakes</label>
            <div className="flex flex-wrap gap-1.5">
              {MISTAKES.map(m => <button key={m} onClick={()=>toggle(m)} className={cx('px-2 py-0.5 rounded text-xs border transition-all', mistakes.includes(m)?'border-red-700 bg-red-900/40 text-red-300':'border-zinc-800 text-zinc-600')}>{m}</button>)}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-600 block mb-1">Notes</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 resize-none"/>
          </div>
        </div>
        <button onClick={save} disabled={saving||!exit} className="mt-4 w-full py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Close Trade'}</button>
      </div>
    </div>
  );
}

// ── JOURNAL PROMPT after trade close ───────────
function JournalPromptModal({ trade, onClose }: { trade: any; onClose: ()=>void }) {
  const [body, setBody] = useState('');
  const [emotion, setEmotion] = useState('focused');
  const [saving, setSaving] = useState(false);
  const emotions = ['focused','confident','anxious','frustrated','FOMO','revenge','patient'];
  const result = trade?.result;
  const rStr = trade?.r_multiple != null ? `${trade.r_multiple > 0 ? '+' : ''}${trade.r_multiple}R` : '';
  const save = async () => {
    setSaving(true);
    await sb.from('journal').insert({
      date: new Date().toISOString().slice(0,10),
      title: `${trade.symbol} ${trade.setup_type ?? ''} — ${result} ${rStr}`,
      body, emotion, result: result === 'win' ? 'Profitable' : result === 'loss' ? 'Loss' : 'Break-even',
      trade_id: trade.id, created_at: new Date().toISOString()
    });
    setSaving(false); onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-bold text-white">Journal this trade?</span>
          <button onClick={onClose} className="text-zinc-600">✕</button>
        </div>
        <p className="text-xs text-zinc-500 mb-3">{trade.symbol} {rStr} — what happened?</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {emotions.map(e=><button key={e} onClick={()=>setEmotion(e)} className={cx('px-2 py-0.5 rounded text-xs border', emotion===e?'border-zinc-500 bg-zinc-700 text-white':'border-zinc-800 text-zinc-600')}>{e}</button>)}
        </div>
        <textarea value={body} onChange={e=>setBody(e.target.value)} rows={3} placeholder="What did you do well? What would you change?" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 resize-none mb-3"/>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-zinc-700 text-xs text-zinc-500">Skip</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white">{saving ? 'Saving…' : 'Save Entry'}</button>
        </div>
      </div>
    </div>
  );
}

// ── ICONS (SVG — no emojis) ───────────────────
const Icons = {
  TrendUp:    () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  TrendDown:  () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
  Dot:        ({c}:{c:string}) => <span style={{width:7,height:7,borderRadius:'50%',background:c,display:'inline-block',flexShrink:0}}/>,
  Lightning:  () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
  Brain:      () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2"/></svg>,
  Chart:      () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  Shield:     () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Globe:      () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  Bell:       () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  Gear:       () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  Target:     () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Ruler:      () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3h18v18H3z"/><path d="M3 9h4M3 15h4M9 3v4M15 3v4"/></svg>,
  Activity:   () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  BookOpen:   () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  Play:       () => <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  X:          () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Check:      () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
  Scan:       () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>,
  Zap:        () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Wifi:       () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
  WifiOff:    () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
  Plus:       () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  ChevronR:   () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>,
  Minus:      () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>,
};

// ── MARKET SUB-TABS ────────────────────────────
function CryptoTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/crypto').then(r=>r.json()).then(d=>{
      setData(d.prices ?? []);
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);
  if (loading) return <div className="py-12 text-center text-xs text-zinc-600">Loading crypto prices…</div>;
  if (!data.length) return <div className="py-12 text-center text-xs text-zinc-600">No data available</div>;
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 divide-y divide-zinc-800/40">
      {data.map((a:any) => <PriceRow key={a.symbol} symbol={a.symbol} price={a.price} change={a.change} changePct={a.changePct} />)}
    </div>
  );
}

function ForexTab() {
  const [fx, setFx] = useState<any[]>([]);
  const [comm, setComm] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/forex').then(r=>r.json()).then(d=>{
      // API returns {forex:[...], commodities:[...]}
      setFx(d.forex ?? d.prices ?? []);
      setComm(d.commodities ?? []);
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);
  if (loading) return <div className="py-12 text-center text-xs text-zinc-600">Loading forex prices…</div>;
  return (
    <div className="space-y-3">
      {fx.length > 0 && (
        <div>
          <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2 px-1">Forex Pairs</div>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 divide-y divide-zinc-800/40">
            {fx.map((a:any) => (
              <PriceRow key={a.symbol} symbol={a.pair ?? a.name ?? a.symbol}
                price={a.price} change={a.change != null ? a.price && a.change ? a.price * a.change / 100 : null : null}
                changePct={a.change} />
            ))}
          </div>
        </div>
      )}
      {comm.length > 0 && (
        <div>
          <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2 px-1">Commodities</div>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 divide-y divide-zinc-800/40">
            {comm.map((a:any) => (
              <PriceRow key={a.symbol} symbol={a.name ?? a.symbol}
                price={a.price}
                changePct={a.change} />
            ))}
          </div>
        </div>
      )}
      {!fx.length && !comm.length && <div className="py-12 text-center text-xs text-zinc-600">No forex data available</div>}
    </div>
  );
}

function StocksTab() {
  const [indices, setIndices] = useState<any[]>([]);
  const [stocks, setStocks] = useState<any[]>([]);
  const [etfs, setEtfs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/stocks').then(r=>r.json()).then(d=>{
      // API returns {indices:[...], stocks:[...], etfs:[...]}
      setIndices(d.indices ?? []);
      setStocks(d.stocks ?? d.prices ?? []);
      setEtfs(d.etfs ?? []);
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);
  if (loading) return <div className="py-12 text-center text-xs text-zinc-600">Loading stock prices…</div>;
  return (
    <div className="space-y-3">
      {indices.length > 0 && (
        <div>
          <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2 px-1">Indices</div>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 divide-y divide-zinc-800/40">
            {indices.map((a:any) => <PriceRow key={a.symbol} symbol={a.name ?? a.symbol} price={a.price} changePct={a.change} />)}
          </div>
        </div>
      )}
      {stocks.length > 0 && (
        <div>
          <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2 px-1">Mega-Cap Stocks</div>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 divide-y divide-zinc-800/40">
            {stocks.map((a:any) => <PriceRow key={a.symbol} symbol={a.name ?? a.symbol} price={a.price} changePct={a.change} />)}
          </div>
        </div>
      )}
      {etfs.length > 0 && (
        <div>
          <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2 px-1">ETFs</div>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 divide-y divide-zinc-800/40">
            {etfs.map((a:any) => <PriceRow key={a.symbol} symbol={a.name ?? a.symbol} price={a.price} changePct={a.change} />)}
          </div>
        </div>
      )}
      {!indices.length && !stocks.length && <div className="py-12 text-center text-xs text-zinc-600">No stock data available</div>}
    </div>
  );
}

// ── WEEKLY BIAS ────────────────────────────────
function WeeklyBiasPanel({ onBiasChange }: { onBiasChange?: (b: Record<string,string>) => void }) {
  const syms = ['NQ','ES','GC','DXY'];
  const [biases, setBiases] = useState<Record<string,any>>({});
  const [editing, setEditing] = useState<string|null>(null);
  const [form, setForm] = useState({ bias:'bullish', reasoning:'', key_levels:'' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch('/api/weekbias').then(r=>r.json()).then(d=>{
      const map: Record<string,any> = {};
      (d.biases??[]).forEach((b:any) => { map[b.symbol] = b; });
      setBiases(map);
      if (onBiasChange) onBiasChange(Object.fromEntries(Object.entries(map).map(([k,v])=>[k,(v as any).bias])));
    });
  }, []);
  const save = async (sym: string) => {
    setSaving(true);
    const r = await fetch('/api/weekbias', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbol: sym, ...form }) });
    const d = await r.json();
    setBiases(p => ({ ...p, [sym]: d.bias }));
    setSaving(false); setEditing(null);
    if (onBiasChange) onBiasChange({ ...Object.fromEntries(Object.entries(biases).map(([k,v])=>[k,(v as any).bias])), [sym]: form.bias });
  };
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">Weekly Bias</span>
        <span className="text-xs text-zinc-700">{new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'})} week</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {syms.map(sym => {
          const b = biases[sym];
          const isBull = b?.bias === 'bullish', isBear = b?.bias === 'bearish';
          return (
            <div key={sym} className="text-center">
              <button onClick={() => { setEditing(sym); setForm({ bias: b?.bias??'bullish', reasoning: b?.reasoning??'', key_levels: b?.key_levels??'' }); }}
                className={cx('w-full py-2 rounded-lg border text-xs font-mono font-semibold transition-all',
                  isBull ? 'border-emerald-700/60 bg-emerald-900/30 text-emerald-400' : isBear ? 'border-red-700/60 bg-red-900/30 text-red-400' : 'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>
                <div>{sym}</div>
                <div className="text-xs font-normal mt-0.5">{b ? (isBull?'↑ bull':isBear?'↓ bear':'–') : '+ set'}</div>
              </button>
            </div>
          );
        })}
      </div>
      {editing && (
        <div className="mt-3 p-3 bg-zinc-800/60 rounded-lg space-y-2">
          <div className="flex justify-between"><span className="text-xs text-zinc-400 font-medium">{editing} bias</span><button onClick={()=>setEditing(null)} className="text-zinc-600 text-xs">✕</button></div>
          <div className="flex gap-2">
            {['bullish','neutral','bearish'].map(v=>(
              <button key={v} onClick={()=>setForm(p=>({...p,bias:v}))} className={cx('flex-1 py-1.5 rounded-lg border text-xs transition-all',
                form.bias===v ? (v==='bullish'?'border-emerald-700 bg-emerald-900/40 text-emerald-400':v==='bearish'?'border-red-700 bg-red-900/40 text-red-400':'border-zinc-600 bg-zinc-700 text-zinc-300') : 'border-zinc-700 text-zinc-600'
              )}>{v}</button>
            ))}
          </div>
          <input value={form.key_levels} onChange={e=>setForm(p=>({...p,key_levels:e.target.value}))} placeholder="Key levels" className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 font-mono"/>
          <textarea value={form.reasoning} onChange={e=>setForm(p=>({...p,reasoning:e.target.value}))} placeholder="Reasoning…" rows={2} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 resize-none"/>
          <button onClick={()=>save(editing)} disabled={saving} className="w-full py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white disabled:opacity-50">{saving?'Saving…':'Save Bias'}</button>
        </div>
      )}
    </div>
  );
}

// ── SMT PANEL ──────────────────────────────────
function SMTPanel() {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/smt', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
      const d = await r.json();
      setSignals((d.signals ?? d.recent ?? []).slice(0, 8));
      setRan(true);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetch('/api/smt').then(r=>r.json()).then(d=>{
      const items = d.recent ?? d.signals ?? [];
      setSignals(items.slice(0,8));
      if (items.length>0) setRan(true);
    }).catch(()=>{});
  }, []);

  const isBull = (s:any) => (s.divergence_type??s.type??'').includes('bull');

  return (
    <div className="card card-sm">
      <div className="section-hdr">
        <span className="section-title" style={{marginBottom:0}}>SMT Divergence</span>
        <button onClick={run} disabled={loading} className="btn btn-ghost btn-xs"
          style={{gap:4}}>
          <span className={loading?'spin':''}><Icons.Scan/></span>
          {loading ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {signals.length === 0 ? (
        <div className="empty-state" style={{padding:'28px 16px'}}>
          <Icons.Activity/>
          <p style={{fontSize:11}}>{ran ? 'No SMT divergence detected on current data' : 'Click Scan to detect SMT divergence'}</p>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
          {signals.map((s,i) => (
            <div key={i} className={cx('smt-card', (s.divergence_type??s.type??'').includes('div')?'diverge':'')}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span className={cx('badge', isBull(s)?'badge-green':'badge-red')}>
                    {isBull(s)?'BULL':'BEAR'}
                  </span>
                  <span style={{fontSize:11,fontWeight:600,color:'var(--text-2)',fontFamily:'JetBrains Mono'}}>
                    {s.pair ?? `${s.nq_swing??''}/${s.es_swing??''}`}
                  </span>
                </div>
                <span style={{fontSize:10,color:'var(--muted)',fontFamily:'JetBrains Mono'}}>
                  {s.detected_at ? new Date(s.detected_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : 'live'}
                </span>
              </div>
              <p style={{fontSize:11,color:'var(--muted)',marginTop:4,lineHeight:1.5}}>
                {s.notes ?? s.description ?? `${s.nq_swing} vs ${s.es_swing} divergence`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CALENDAR ───────────────────────────────────
function CalendarWidget() {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => { fetch('/api/calendar').then(r=>r.json()).then(d=>setEvents(d.events??[])); }, []);
  if (events.length === 0) return null;
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
      <span className="text-xs text-zinc-500 uppercase tracking-wider block mb-2">Upcoming Events</span>
      <div className="space-y-1">
        {events.slice(0,6).map((e,i) => (
          <div key={i} className={cx('flex items-center justify-between py-1 px-2 rounded-lg text-xs', e.isDangerZone ? 'bg-red-900/30 border border-red-800/40' : 'border border-transparent')}>
            <div className="flex items-center gap-2">
              <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', e.impact==='critical'?'bg-red-500':e.impact==='high'?'bg-orange-400':'bg-zinc-600')}/>
              <span className={e.isDangerZone ? 'text-red-300' : 'text-zinc-400'}>{e.name}</span>
              {e.isDangerZone && <span className="text-red-400 text-xs animate-pulse">ACTIVE</span>}
            </div>
            <span className="text-zinc-600 font-mono">{e.isToday ? e.time : new Date(e.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── INSTITUTIONAL TAB ──────────────────────────
function InstitutionalTab() {
  const [data, setData] = useState<any>(null);
  const [sel, setSel] = useState('NQ');
  const syms = ['NQ','ES','GC','CL','EUR','GBP'];
  useEffect(() => { setData(null); fetch(`/api/cot?symbol=${sel}`).then(r=>r.json()).then(d=>setData(d)); }, [sel]);
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {syms.map(s => <button key={s} onClick={()=>setSel(s)} className={cx('px-3 py-1.5 rounded-lg text-xs border transition-all', sel===s?'border-zinc-500 bg-zinc-800 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>{s}</button>)}
      </div>
      {!data ? <div className="py-12 text-center text-xs text-zinc-600">Loading COT…</div> : (
        <div className="space-y-3">
          {data.error ? <div className="text-xs text-red-400 p-3 bg-red-900/20 rounded-xl">{data.error}</div> : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[{ label:'Commercials', val:data.latest?.comm_net, desc:'Smart money' },{ label:'Large Specs', val:data.latest?.large_net, desc:'Trend followers' },{ label:'Small Specs', val:data.latest?.small_net, desc:'Retail' }].map(item => (
                  <div key={item.label} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 text-center">
                    <div className="text-xs text-zinc-600 mb-1">{item.label}</div>
                    <div className={cx('text-base font-mono font-bold', (item.val??0)>0?'text-emerald-400':'text-red-400')}>{(item.val??0)>0?'+':''}{((item.val??0)/1000).toFixed(0)}k</div>
                    <div className="text-xs text-zinc-700 mt-0.5">{item.desc}</div>
                  </div>
                ))}
              </div>
              {data.interpretation && <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 p-3"><p className="text-xs text-zinc-300 leading-relaxed">{data.interpretation}</p></div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── TRADES TAB ─────────────────────────────────
function TradesTab({ onNew, onJournal }: { onNew?: () => void; onJournal?: (t:any)=>void }) {
  const [trades, setTrades] = useState<any[]>([]);
  const [closing, setClosing] = useState<any|null>(null);
  const load = useCallback(async () => {
    const r = await fetch('/api/trades'); const d = await r.json();
    setTrades(d.trades ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const del = async (id: string) => { await fetch('/api/trades', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) }); load(); };
  const open = trades.filter(t => t.result === 'open');
  const closed = trades.filter(t => t.result !== 'open');
  // Summary stats
  const totalR = closed.reduce((a,t)=>a+(t.r_multiple??0),0);
  const wins = closed.filter(t=>t.result==='win').length;
  const wr = closed.length ? ((wins/closed.length)*100).toFixed(0) : '0';
  return (
    <div className="space-y-4">
      {closed.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 text-center">
            <div className={cx('text-lg font-mono font-bold', Number(wr)>=50?'text-emerald-400':'text-red-400')}>{wr}%</div>
            <div className="text-xs text-zinc-600 mt-0.5">Win rate</div>
          </div>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 text-center">
            <div className={cx('text-lg font-mono font-bold', totalR>=0?'text-emerald-400':'text-red-400')}>{totalR>0?'+':''}{totalR.toFixed(1)}R</div>
            <div className="text-xs text-zinc-600 mt-0.5">Total R</div>
          </div>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 text-center">
            <div className="text-lg font-mono font-bold text-zinc-300">{closed.length}</div>
            <div className="text-xs text-zinc-600 mt-0.5">Trades</div>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">Open · {open.length}</span>
        {onNew && <button onClick={onNew} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:border-zinc-500">+ Manual</button>}
      </div>
      {open.map(t => (
        <div key={t.id} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold text-white">{t.symbol}</span>
              <span className={cx('text-xs', t.direction==='bull'||t.direction==='long'?'text-emerald-400':'text-red-400')}>{t.direction==='bull'||t.direction==='long'?'↑':'↓'}</span>
              <span className="text-xs text-zinc-600">{t.setup_type ?? 'Manual'} · {t.session}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>setClosing(t)} className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300">Close</button>
              <button onClick={()=>del(t.id)} className="text-xs text-zinc-700 hover:text-red-400">✕</button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-x-3 text-xs font-mono text-zinc-500">
            <div>Entry <span className="text-zinc-300">{t.entry_price}</span></div>
            <div>SL <span className="text-red-400">{t.stop_loss}</span></div>
            <div>TP <span className="text-emerald-400">{t.target}</span></div>
            <div>Risk <span className="text-zinc-400">${t.risk_dollars}</span></div>
          </div>
          {t.mistakes?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{t.mistakes.map((m:string)=><span key={m} className="text-xs bg-red-900/30 text-red-400 px-1.5 py-0.5 rounded">{m}</span>)}</div>}
        </div>
      ))}
      {closed.length > 0 && (
        <>
          <div className="text-xs text-zinc-600 uppercase tracking-wider pt-2">Closed · {closed.length}</div>
          <div className="space-y-2">
            {closed.slice(0,30).map(t => (
              <div key={t.id} className={cx('rounded-xl border p-3', t.result==='win'?'border-emerald-900/50 bg-emerald-950/20':t.result==='loss'?'border-red-900/50 bg-red-950/20':'border-zinc-800/40 bg-zinc-900/20')}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-bold text-white">{t.symbol}</span>
                    <span className="text-xs text-zinc-500">{t.setup_type ?? 'Manual'} · {t.session}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cx('text-sm font-mono font-bold', t.result==='win'?'text-emerald-400':t.result==='loss'?'text-red-400':'text-zinc-500')}>
                      {(t.r_multiple??0)>0?'+':''}{t.r_multiple ?? '—'}R
                    </span>
                    {t.pnl_dollars != null && <span className={cx('text-xs font-mono', t.pnl_dollars>0?'text-emerald-600':'text-red-600')}>${t.pnl_dollars?.toFixed(0)}</span>}
                    <button onClick={()=>del(t.id)} className="text-xs text-zinc-800 hover:text-red-400">✕</button>
                  </div>
                </div>
                {t.mistakes?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{t.mistakes.map((m:string)=><span key={m} className="text-xs bg-red-900/20 text-red-500/70 px-1.5 py-0.5 rounded">{m}</span>)}</div>}
                {t.notes && <p className="text-xs text-zinc-600 mt-1 truncate">{t.notes}</p>}
              </div>
            ))}
          </div>
        </>
      )}
      {trades.length === 0 && <div className="py-20 text-center text-xs text-zinc-700">No trades yet</div>}
      {closing && <CloseTradeModal trade={closing} onClose={()=>setClosing(null)} onSaved={load} onJournal={onJournal}/>}
    </div>
  );
}

// ── ANALYTICS TAB (with Chart.js) ─────────────
function AnalyticsTab() {
  const [stats, setStats] = useState<any>(null);
  const [view, setView] = useState<'overview'|'types'|'mistakes'|'sessions'|'symbols'>('overview');
  const [propMode, setPropMode] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(3);
  const [maxDD, setMaxDD] = useState(10);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<any>(null);

  useEffect(() => { fetch('/api/analytics').then(r=>r.json()).then(d=>setStats(d.stats)); }, []);

  useEffect(() => {
    if (!chartRef.current || !stats?.curve?.length || view !== 'overview') return;
    // Dynamic Chart.js loading
    const load = async () => {
      if (typeof window === 'undefined') return;
      // @ts-ignore
      if (!window.Chart) {
        await new Promise<void>((res) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
          s.onload = () => res();
          document.head.appendChild(s);
        });
      }
      // @ts-ignore
      const Chart = window.Chart;
      if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }
      const labels = stats.curve.map((p:any) => p.date.slice(5));
      const equityData = stats.curve.map((p:any) => p.equity);
      chartInst.current = new Chart(chartRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Equity (R)',
            data: equityData,
            borderColor: equityData[equityData.length-1] >= 0 ? '#22c55e' : '#ef4444',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#52525b', font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: '#27272a' } },
            y: { ticks: { color: '#52525b', font: { size: 10 } }, grid: { color: '#27272a' } }
          }
        }
      });
    };
    load();
    return () => { if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; } };
  }, [stats, view]);

  if (!stats) return <div className="py-20 text-center text-xs text-zinc-600">Loading…</div>;
  if (stats.total === 0) return <div className="py-20 text-center text-xs text-zinc-700">No closed trades yet</div>;

  // Prop firm current drawdown
  const currentDD = stats.curve?.length ? Math.min(0, stats.curve[stats.curve.length-1].equity - Math.max(...stats.curve.map((p:any)=>p.equity))) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {(['overview','types','mistakes','sessions','symbols'] as const).map(t => <button key={t} onClick={()=>setView(t)} className={cx('px-3 py-1.5 rounded-lg text-xs border transition-all capitalize', view===t?'border-zinc-500 bg-zinc-800 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>{t}</button>)}
        </div>
        <button onClick={()=>setPropMode(p=>!p)} className={cx('text-xs px-2.5 py-1 rounded-lg border transition-all', propMode?'border-orange-700 bg-orange-900/30 text-orange-400':'border-zinc-800 text-zinc-600')}>Prop Mode</button>
      </div>

      {propMode && (
        <div className="rounded-xl border border-orange-800/40 bg-orange-900/20 p-3 space-y-2">
          <span className="text-xs text-orange-400 font-semibold uppercase tracking-wider">Prop Firm Tracker</span>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-600 block mb-1">Daily loss limit (%)</label>
              <input type="number" value={dailyLimit} onChange={e=>setDailyLimit(+e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 font-mono"/>
            </div>
            <div>
              <label className="text-xs text-zinc-600 block mb-1">Max drawdown (%)</label>
              <input type="number" value={maxDD} onChange={e=>setMaxDD(+e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 font-mono"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2 text-center">
              <div className={cx('text-sm font-mono font-bold', Math.abs(currentDD) >= maxDD*0.8 ? 'text-red-400' : 'text-emerald-400')}>{currentDD.toFixed(1)}R</div>
              <div className="text-xs text-zinc-600">Current DD</div>
            </div>
            <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2 text-center">
              <div className={cx('text-sm font-mono font-bold', Math.abs(currentDD)/maxDD >= 0.8 ? 'text-red-400' : 'text-emerald-400')}>{((Math.abs(currentDD)/maxDD)*100).toFixed(0)}%</div>
              <div className="text-xs text-zinc-600">DD used</div>
            </div>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div className={cx('h-full rounded-full transition-all', Math.abs(currentDD)/maxDD >= 0.8 ? 'bg-red-500' : 'bg-emerald-500/60')} style={{width:`${Math.min(100,(Math.abs(currentDD)/maxDD)*100)}%`}}/>
          </div>
        </div>
      )}

      {view === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label:'Win Rate', val:`${stats.winRate}%`, color: Number(stats.winRate)>=50?'text-emerald-400':'text-red-400' },
              { label:'Total R', val:`${stats.totalR>0?'+':''}${stats.totalR}R`, color: stats.totalR>0?'text-emerald-400':'text-red-400' },
              { label:'Profit Factor', val:stats.profitFactor, color: Number(stats.profitFactor)>=1.5?'text-emerald-400':'text-yellow-400' },
              { label:'Trades', val:stats.total, color:'text-zinc-300' },
              { label:'Avg Win', val:`+${stats.avgWin}R`, color:'text-emerald-400' },
              { label:'Avg Loss', val:`-${stats.avgLoss}R`, color:'text-red-400' },
              { label:'Best Streak', val:`${stats.maxWinStreak}W`, color:'text-emerald-400' },
              { label:'Worst Streak', val:`${stats.maxLossStreak}L`, color:'text-red-400' },
            ].map(item => (
              <div key={item.label} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 text-center">
                <div className={cx('text-lg font-mono font-bold', item.color)}>{item.val}</div>
                <div className="text-xs text-zinc-600 mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>
          {stats.curve?.length > 1 && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
              <span className="text-xs text-zinc-600 block mb-2">Equity Curve (R)</span>
              <div style={{position:'relative',height:'100px'}}>
                <canvas ref={chartRef} style={{width:'100%',height:'100px'}}/>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'types' && (
        <div className="space-y-2">
          {Object.entries(stats.byType as Record<string,{wins:number;losses:number;totalR:number}>).sort((a,b)=>b[1].totalR-a[1].totalR).map(([type, s]) => {
            const total = s.wins + s.losses;
            const wr = total > 0 ? ((s.wins/total)*100).toFixed(0) : 0;
            return (
              <div key={type} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-300">{type}</span>
                  <div className="flex gap-3 text-xs font-mono">
                    <span className="text-zinc-500">{total}t</span>
                    <span className={Number(wr)>=50?'text-emerald-400':'text-red-400'}>{wr}% WR</span>
                    <span className={s.totalR>=0?'text-emerald-400':'text-red-400'}>{s.totalR>=0?'+':''}{s.totalR.toFixed(1)}R</span>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500/60 rounded-full" style={{width:`${wr}%`}}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'mistakes' && (
        <div className="space-y-2">
          {Object.entries(stats.mistakeCounts as Record<string,number>).sort((a,b)=>b[1]-a[1]).map(([m, count]) => {
            const max = Math.max(...Object.values(stats.mistakeCounts as Record<string,number>));
            return (
              <div key={m} className="rounded-xl border border-zinc-800/40 bg-zinc-900/30 p-3">
                <div className="flex justify-between mb-1.5"><span className="text-sm text-zinc-400">{m}</span><span className="text-xs font-mono text-red-400">{count}×</span></div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-red-500/50 rounded-full" style={{width:`${(count/max)*100}%`}}/></div>
              </div>
            );
          })}
          {Object.keys(stats.mistakeCounts).length === 0 && <p className="text-xs text-zinc-700 text-center py-8">No mistakes tagged yet</p>}
        </div>
      )}

      {view === 'sessions' && (
        <div className="space-y-2">
          {Object.entries(stats.bySess as Record<string,{wins:number;losses:number;totalR:number}>).sort((a,b)=>b[1].totalR-a[1].totalR).map(([sess, s]) => {
            const total = s.wins + s.losses;
            const wr = total > 0 ? ((s.wins/total)*100).toFixed(0) : 0;
            return (
              <div key={sess} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 flex justify-between items-center">
                <span className="text-sm text-zinc-300">{sess}</span>
                <div className="flex gap-3 text-xs font-mono">
                  <span className="text-zinc-500">{total}t</span>
                  <span className={Number(wr)>=50?'text-emerald-400':'text-red-400'}>{wr}% WR</span>
                  <span className={s.totalR>=0?'text-emerald-400':'text-red-400'}>{s.totalR>=0?'+':''}{s.totalR.toFixed(1)}R</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'symbols' && (
        <div className="space-y-2">
          {Object.entries(stats.bySym as Record<string,{wins:number;losses:number;totalR:number}>).sort((a,b)=>b[1].totalR-a[1].totalR).map(([sym, s]) => {
            const total = s.wins + s.losses;
            const wr = total > 0 ? ((s.wins/total)*100).toFixed(0) : 0;
            return (
              <div key={sym} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 flex justify-between items-center">
                <span className="text-sm font-mono font-bold text-zinc-300">{sym}</span>
                <div className="flex gap-3 text-xs font-mono">
                  <span className="text-zinc-500">{total}t</span>
                  <span className={Number(wr)>=50?'text-emerald-400':'text-red-400'}>{wr}% WR</span>
                  <span className={s.totalR>=0?'text-emerald-400':'text-red-400'}>{s.totalR>=0?'+':''}{s.totalR.toFixed(1)}R</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── JOURNAL TAB ────────────────────────────────
function JournalTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0,10), title:'', body:'', emotion:'focused', result:'', trade_id:'' });
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string|null>(null);
  const emotions = ['focused','confident','anxious','frustrated','FOMO','revenge','bored','patient'];
  const load = () => { sb.from('journal').select('*').order('date',{ascending:false}).limit(50).then(({data})=>setEntries(data??[])); };
  useEffect(() => { load(); }, []);
  const save = async () => {
    setSaving(true);
    await sb.from('journal').insert({ ...form, created_at: new Date().toISOString() });
    setForm({ date: new Date().toISOString().slice(0,10), title:'', body:'', emotion:'focused', result:'', trade_id:'' });
    setSaving(false); load();
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4 space-y-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">New Entry</span>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-zinc-600 block mb-1">Date</label><input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300"/></div>
          <div><label className="text-xs text-zinc-600 block mb-1">Result</label>
            <select value={form.result} onChange={e=>setForm(p=>({...p,result:e.target.value}))} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300">
              <option value="">-</option><option>Profitable</option><option>Break-even</option><option>Loss</option><option>No trade</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-zinc-600 block mb-1.5">Emotion</label>
          <div className="flex flex-wrap gap-1.5">{emotions.map(e=><button key={e} onClick={()=>setForm(p=>({...p,emotion:e}))} className={cx('px-2.5 py-1 rounded-lg text-xs border transition-all', form.emotion===e?'border-zinc-500 bg-zinc-700 text-white':'border-zinc-800 text-zinc-600')}>{e}</button>)}</div>
        </div>
        <div><label className="text-xs text-zinc-600 block mb-1">Title</label><input value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="What happened today?" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"/></div>
        <div><label className="text-xs text-zinc-600 block mb-1">Notes</label><textarea value={form.body} onChange={e=>setForm(p=>({...p,body:e.target.value}))} rows={4} placeholder="What did you see? What did you do? What should you do differently?" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 resize-none leading-relaxed"/></div>
        <button onClick={save} disabled={saving||!form.title} className="w-full py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white disabled:opacity-50">{saving?'Saving…':'Save Entry'}</button>
      </div>
      <div className="space-y-2">
        {entries.map(e=>(
          <div key={e.id} className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3 cursor-pointer" onClick={()=>setOpen(open===e.id?null:e.id)}>
            <div className="flex justify-between items-start">
              <div>
                <span className="text-sm text-zinc-300">{e.title}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-zinc-600">{e.date}</span>
                  <span className="text-xs text-zinc-700">{e.emotion}</span>
                  {e.result && <span className={cx('text-xs px-1.5 py-0.5 rounded', e.result==='Profitable'?'text-emerald-400 bg-emerald-900/30':e.result==='Loss'?'text-red-400 bg-red-900/30':'text-zinc-500 bg-zinc-800')}>{e.result}</span>}
                  {e.trade_id && <span className="text-xs text-blue-400 bg-blue-900/20 px-1.5 py-0.5 rounded">linked</span>}
                </div>
              </div>
              <span className="text-zinc-700 text-xs">{open===e.id?'▲':'▼'}</span>
            </div>
            {open===e.id && e.body && <p className="mt-2 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">{e.body}</p>}
          </div>
        ))}
        {entries.length===0 && <div className="py-12 text-center text-xs text-zinc-700">No entries yet</div>}
      </div>
    </div>
  );
}

// ── KNOWLEDGE TAB ──────────────────────────────
function KnowledgeTab() {
  const [articles, setArticles] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string|null>(null);
  useEffect(() => {
    sb.from('knowledge_base').select('*').order('source_episode').then(({data})=>setArticles(data??[]));
  }, []);
  const filtered = articles.filter(a => !q || a.title?.toLowerCase().includes(q.toLowerCase()) || a.content?.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search knowledge base…" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-zinc-600"/>
      <div className="text-xs text-zinc-700">{filtered.length} / {articles.length} articles</div>
      <div className="space-y-1.5">
        {filtered.map(a=>(
          <div key={a.id} className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3 cursor-pointer hover:border-zinc-700 transition-colors" onClick={()=>setOpen(open===a.id?null:a.id)}>
            <div className="flex justify-between items-start">
              <div>
                <span className="text-sm text-zinc-300">{a.title}</span>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {a.source_episode && <span className="text-xs text-zinc-700">{a.source_episode}</span>}
                  {a.tags?.slice(0,3).map((t:string)=><span key={t} className="text-xs text-zinc-700 bg-zinc-800 px-1.5 py-0.5 rounded">{t}</span>)}
                </div>
              </div>
              <span className="text-zinc-700 text-xs shrink-0 ml-2">{open===a.id?'▲':'▼'}</span>
            </div>
            {open===a.id && <p className="mt-2 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">{a.content}</p>}
          </div>
        ))}
        {filtered.length===0 && articles.length===0 && <div className="py-12 text-center text-xs text-zinc-700">Loading…</div>}
      </div>
    </div>
  );
}

// ── BACKTEST TAB (with history) ────────────────
// ─── AGENTS TAB ──────────────────────────────────────────────────────────────
function AgentsTab() {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [runResult, setRunResult] = React.useState<any>(null);
  const [lastRun, setLastRun] = React.useState<string>('Never');

  // MT5 Connection state — uses mtapi.io (no API key needed)
  const [mt5Tab, setMt5Tab] = React.useState<'status'|'connect'>('status');
  const [mt5Login, setMt5Login] = React.useState('');
  const [mt5Pass, setMt5Pass] = React.useState('');
  const [mt5Server, setMt5Server] = React.useState('');
  const [mt5Connecting, setMt5Connecting] = React.useState(false);
  const [mt5Result, setMt5Result] = React.useState<any>(null);
  const [mt5Token, setMt5Token] = React.useState<string|null>(null);
  const [mt5AccountInfo, setMt5AccountInfo] = React.useState<any>(null);
  const [mt5Loading, setMt5Loading] = React.useState(false);
  const [mt5Error, setMt5Error] = React.useState<string|null>(null);
  const [mt5BrokerName, setMt5BrokerName] = React.useState('');

  // Load saved token — try Supabase first (survives deploys), then localStorage
  React.useEffect(() => {
    const loadToken = async () => {
      // Try localStorage first (fast)
      const saved = localStorage.getItem('mt5_token');
      const broker = localStorage.getItem('mt5_broker');
      if (saved) { setMt5Token(saved); if (broker) setMt5BrokerName(broker); return; }
      // Fallback: load from Supabase (survives deploys/browser clears)
      try {
        const r = await fetch('/api/agents/status');
        const d = await r.json();
        const mt5 = d.agents?.mt5_session;
        if (mt5?.data?.token) {
          setMt5Token(mt5.data.token);
          setMt5BrokerName(mt5.data.broker ?? '');
          localStorage.setItem('mt5_token', mt5.data.token);
          localStorage.setItem('mt5_broker', mt5.data.broker ?? '');
        }
      } catch {}
    };
    loadToken();
  }, []);

  const loadMt5Accounts = React.useCallback(async (token?: string) => {
    const t = token ?? mt5Token;
    if (!t) return;
    setMt5Loading(true); setMt5Error(null);
    try {
      const r = await fetch(`/api/mt5/account?token=${t}`);
      const d = await r.json();
      if (d.account?.error || !d.connected) {
        setMt5Error('Session expired. Please reconnect.');
        setMt5Token(null);
        localStorage.removeItem('mt5_token');
      } else {
        setMt5AccountInfo(d);
      }
    } catch(e: any) { setMt5Error(e.message); }
    setMt5Loading(false);
  }, [mt5Token]);

  const connectMt5 = async () => {
    if (!mt5Login || !mt5Pass || !mt5Server) return;
    setMt5Connecting(true); setMt5Result(null);
    try {
      const r = await fetch('/api/mt5/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: mt5Login, password: mt5Pass, server: mt5Server }),
      });
      const d = await r.json();
      setMt5Result(d);
      if (d.success && d.token) {
        setMt5Token(d.token);
        setMt5BrokerName(d.brokerName ?? mt5Server);
        localStorage.setItem('mt5_token', d.token);
        localStorage.setItem('mt5_broker', d.brokerName ?? mt5Server);
        // Save token + credentials to Supabase so agents can auto-reconnect
        await fetch('/api/agents/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            agent: 'mt5_session', 
            token: d.token, 
            broker: d.brokerName ?? mt5Server,
            login: mt5Login,
            password: mt5Pass,
            server: mt5Server,
          }),
        });
        setMt5Tab('status');
        await loadMt5Accounts(d.token);
      }
    } catch (e: any) { setMt5Result({ error: e.message }); }
    setMt5Connecting(false);
  };

  const disconnectMt5 = () => {
    setMt5Token(null); setMt5AccountInfo(null); setMt5BrokerName('');
    localStorage.removeItem('mt5_token'); localStorage.removeItem('mt5_broker');
    setMt5Tab('connect');
  };

  const AGENT_DEFS = [
    { key:'orchestrator',     name:'Master Orchestrator', icon:'ORC', desc:'Coordinates all agents' },
    { key:'market_structure', name:'Market Structure',    icon:'STR', desc:'BOS, CHoCH, swing highs/lows' },
    { key:'smc',              name:'SMC / ICT',           icon:'SMC', desc:'FVGs, Order Blocks, Liquidity' },
    { key:'technical',        name:'Technical Confluence',icon:'TEC', desc:'RSI, EMA, VWAP' },
    { key:'macro',            name:'Macro & Sentiment',   icon:'MAC', desc:'News, DXY, Fear & Greed' },
    { key:'ai_brain',         name:'AI Brain',            icon:'AI', desc:'Groq LLM scores 1–10' },
    { key:'risk',             name:'Risk Manager',        icon:'RSK', desc:'Heat, drawdown, loss limits' },
    { key:'executor',         name:'Executor',            icon:'EXE', desc:'Signal & position management' },
    { key:'self_learning',    name:'Self-Learning',       icon:'LRN', desc:'Win rate & performance ML' },
    { key:'alerts',           name:'Alert System',        icon:'ALT', desc:'Telegram alerts & briefings' },
  ];

  const ASSETS = [
    { group:'Indices',    items:['NQ','ES','GC','CL'] },
    { group:'Forex',      items:['EURUSD','GBPUSD','USDJPY'] },
    { group:'Crypto',     items:['BTC','ETH'] },
  ];

  const loadStatus = React.useCallback(() => {
    fetch('/api/agents/status')
      .then(r=>r.json())
      .then(d=>{ setData(d); setLoading(false); })
      .catch(()=>setLoading(false));
  }, []);

  React.useEffect(() => { loadStatus(); }, [loadStatus]);
  React.useEffect(() => {
    const iv = setInterval(loadStatus, 8000);
    return () => clearInterval(iv);
  }, [loadStatus]);

  const runAgents = async () => {
    setRunning(true); setRunResult(null);
    try {
      const r = await fetch('/api/agents/run', { method:'POST' });
      const d = await r.json();
      setRunResult(d);
      setLastRun(new Date().toLocaleTimeString());
      loadStatus();
    } catch(e:any) {
      setRunResult({ error: e.message });
    }
    setRunning(false);
  };

  const getAgent = (key: string) => data?.agents?.[key] ?? { status:'idle', last_action:'Not run yet' };
  const dotColor = (s: string) => s==='running'?'bg-emerald-500 animate-pulse':s==='paused'?'bg-yellow-500 animate-pulse':s==='idle'?'bg-zinc-600':'bg-zinc-700';
  const textColor = (s: string) => s==='running'?'text-emerald-400':s==='paused'?'text-yellow-400':'text-zinc-600';

  return (
    <div className="space-y-4">

      {/* RUN BUTTON */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-200">AI Agent Cycle</div>
          <div className="text-xs text-zinc-600 mt-0.5">Runs all 10 agents: scans 9 markets, scores setups with Groq AI, checks risk</div>
          <div className="text-[10px] text-zinc-700 mt-1">Last run: {lastRun}</div>
        </div>
        <button
          onClick={runAgents}
          disabled={running}
          className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-sm transition-colors flex items-center gap-2 whitespace-nowrap"
        >
          {running ? <><span className="animate-spin inline-block">↻</span> Running agents...</> : '▶ Run All Agents'}
        </button>
      </div>

      {/* RUN RESULT */}
      {runResult && (
        <div className={cx('rounded-xl border p-4 text-xs', runResult.error ? 'border-red-800 bg-red-900/10' : 'border-emerald-800 bg-emerald-900/10')}>
          {runResult.error ? (
            <span className="text-red-400">Error: {runResult.error}</span>
          ) : (
            <div className="flex flex-wrap gap-4">
              <span className="text-emerald-400 font-bold">✓ Cycle complete in {runResult.elapsed_s}s</span>
              <span className="text-zinc-400">{runResult.symbols_scanned} symbols scanned</span>
              <span className={cx('font-bold', runResult.approved_trades>0?'text-emerald-400':'text-zinc-500')}>
                {runResult.approved_trades} trade{runResult.approved_trades!==1?'s':''} approved (score ≥7)
              </span>
            </div>
          )}
        </div>
      )}

      {/* AGENT STATUS GRID */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Agent Status</div>
        {loading ? (
          <div className="text-xs text-zinc-600 py-4">Loading...</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {AGENT_DEFS.map(a => {
              const s = getAgent(a.key);
              return (
                <div key={a.key} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-500 font-mono tracking-wider">{a.icon}</span>
                    <div className={cx('w-2 h-2 rounded-full', dotColor(s.status))}/>
                  </div>
                  <div className="text-[11px] font-semibold text-zinc-200">{a.name}</div>
                  <div className={cx('text-[10px]', textColor(s.status))}>{s.status}</div>
                  <div className="text-[10px] text-zinc-600 line-clamp-2">{s.last_action || a.desc}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* APPROVED TRADES */}
      {(data?.approved_trades?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-emerald-800/40 bg-emerald-900/10 p-4">
          <div className="text-[10px] text-emerald-600 uppercase tracking-wider mb-3">✓ AI-Approved Setups (Score ≥8)</div>
          <div className="space-y-3">
            {data.approved_trades.map((t: any, i: number) => (
              <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-zinc-100">{t.symbol}</span>
                  <span className={cx('px-2 py-0.5 rounded text-[10px] font-bold', t.direction==='buy'?'bg-emerald-900/60 text-emerald-400':'bg-red-900/60 text-red-400')}>
                    {t.direction?.toUpperCase()}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px] font-bold">{t.setup_score}/10</span>
                  <span className="text-zinc-500">{t.confidence}</span>
                </div>
                <div className="text-zinc-400">{t.primary_reason}</div>
                <div className="flex gap-4 text-zinc-600">
                  <span>Entry: {t.entry_zone}</span>
                  <span>Target: {t.target}</span>
                </div>
                <div className="text-zinc-700">Invalidation: {t.invalidation}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MARKET BIAS */}
      {Object.keys(data?.biases ?? {}).length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Live Market Bias</div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {Object.entries(data.biases).map(([sym, bias]: [string,any]) => (
              <div key={sym} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-mono font-bold">{sym}</span>
                <span className={cx('text-[10px] px-1.5 py-0.5 rounded font-bold',
                  bias==='bullish'?'bg-emerald-900/60 text-emerald-400':
                  bias==='bearish'?'bg-red-900/60 text-red-400':
                  'bg-zinc-800 text-zinc-500')}>
                  {bias==='bullish'?'BULL':bias==='bearish'?'BEAR':'—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FVGs */}
      {(data?.fvgs?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Active Fair Value Gaps</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-zinc-600 border-b border-zinc-800">
                <th className="pb-2 pr-3">Symbol</th><th className="pb-2 pr-3">TF</th>
                <th className="pb-2 pr-3">Type</th><th className="pb-2 pr-3">High</th>
                <th className="pb-2 pr-3">Low</th><th className="pb-2">Fill %</th>
              </tr></thead>
              <tbody>
                {data.fvgs.slice(0,10).map((f: any, i: number) => (
                  <tr key={i} className="border-b border-zinc-900">
                    <td className="py-1.5 pr-3 font-mono font-bold">{f.symbol}</td>
                    <td className="py-1.5 pr-3 text-zinc-500">{f.timeframe}</td>
                    <td className="py-1.5 pr-3">
                      <span className={cx('px-1.5 py-0.5 rounded text-[10px] font-bold', f.type==='bull'?'bg-emerald-900/60 text-emerald-400':'bg-red-900/60 text-red-400')}>
                        {f.type?.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{f.high?.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 font-mono">{f.low?.toFixed(2)}</td>
                    <td className="py-1.5 text-zinc-500">{f.fill_pct?.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* NEWS */}
      {(data?.news?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Economic Calendar</div>
            {data.blackout_active && (
              <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-400 text-[10px] font-bold animate-pulse">NEWS BLACKOUT ACTIVE</span>
            )}
            {data.dxy_trend && (
              <span className="text-[10px] text-zinc-500">DXY: <span className={data.dxy_trend==='rising'?'text-emerald-400':'text-red-400'}>{data.dxy_trend}</span></span>
            )}
          </div>
          <div className="space-y-2">
            {data.news.slice(0,8).map((n: any, i: number) => (
              <div key={i} className="flex items-start gap-3 text-xs py-1 border-b border-zinc-900">
                <span className={cx('text-[10px] font-bold w-8 text-center flex-shrink-0 mt-0.5',
                  n.impact==='HIGH'?'text-red-400':n.impact==='MEDIUM'?'text-yellow-400':'text-zinc-600')}>
                  {n.impact==='HIGH'?'HIGH':n.impact==='MEDIUM'?'MED':'LOW'}
                </span>
                <span className="text-zinc-500 w-12 flex-shrink-0">{n.time}</span>
                <span className="text-zinc-500 w-8 flex-shrink-0">{n.country}</span>
                <span className="text-zinc-300">{n.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LEARNING STATS */}
      {data?.learning?.overall_win_rate != null && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-3">Self-Learning Stats</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label:'Overall Win Rate', val:`${data.learning.overall_win_rate?.toFixed(1)}%`, good: data.learning.overall_win_rate>=50 },
              { label:'Total Trades', val: data.learning.total_trades ?? 0, good: true },
              { label:'Avg R:R', val: data.learning.avg_rr?.toFixed(2) ?? '—', good: data.learning.avg_rr>=1.5 },
              { label:'Profit Factor', val: data.learning.profit_factor?.toFixed(2) ?? '—', good: data.learning.profit_factor>=1.5 },
            ].map(s=>(
              <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                <div className="text-[10px] text-zinc-600 mb-1">{s.label}</div>
                <div className={cx('text-sm font-bold', s.good?'text-emerald-400':'text-red-400')}>{s.val}</div>
              </div>
            ))}
          </div>
          {Object.keys(data.learning.asset_win_rates ?? {}).length > 0 && (
            <div className="space-y-1.5">
              {Object.entries(data.learning.asset_win_rates).map(([sym, wr]: [string,any]) => (
                <div key={sym} className="flex items-center gap-2">
                  <span className="text-xs font-mono w-16 text-zinc-400">{sym}</span>
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width:`${wr}%`, background: wr>=50?'#22c55e':'#ef4444'}}/>
                  </div>
                  <span className="text-xs text-zinc-500 w-10 text-right">{wr.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
          {data.learning.paused_assets?.length > 0 && (
            <div className="mt-3 flex gap-2 flex-wrap">
              <span className="text-[10px] text-yellow-600">Paused:</span>
              {data.learning.paused_assets.map((a: string) => (
                <span key={a} className="px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-400 text-[10px] font-bold">{a}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MT5 CLOUD CONNECTION PANEL */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold text-zinc-200">MetaTrader 5 — Live Connection</div>
            <div className="text-xs text-zinc-600 mt-0.5">Direct broker connection — no API key or registration required</div>
          </div>
          <div className="flex gap-2">
            {(['status','connect'] as const).map(t=>(
              <button key={t} onClick={()=>setMt5Tab(t)}
                className={cx('px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors',
                  mt5Tab===t?'bg-zinc-700 text-zinc-100':'bg-zinc-800 text-zinc-500 hover:text-zinc-300')}>
                {t==='status'?'Account':'Connect'}
              </button>
            ))}
          </div>
        </div>

        {mt5Tab === 'status' && (
          <div>
            {mt5Loading && <div className="text-center py-4 text-xs text-zinc-600">↻ Loading...</div>}
            {mt5Error && (
              <div className="rounded-lg border border-red-800 bg-red-900/10 p-3 text-xs text-red-400 mb-3">{mt5Error}</div>
            )}
            {!mt5Token && !mt5Loading && (
              <div className="text-center py-8">
                <div className="text-xs text-zinc-600 mb-2">No MT5 account connected</div>
                <div className="text-[10px] text-zinc-700 mb-4">Enter your MT5 login, password, and broker server name to connect</div>
                <button onClick={()=>setMt5Tab('connect')} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold transition-colors">
                  + Connect MT5 Account
                </button>
              </div>
            )}
            {mt5Token && mt5AccountInfo && (
              <div className="space-y-3">
                <div className="rounded-lg border border-emerald-800/50 bg-zinc-950 p-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/>
                      <span className="text-xs font-semibold text-zinc-200">{mt5BrokerName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-900/60 text-emerald-400">● CONNECTED</span>
                      <button onClick={disconnectMt5} className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors">Disconnect</button>
                    </div>
                  </div>
                  {mt5AccountInfo.account && (
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { l:'Balance', v:`$${(mt5AccountInfo.account.Balance ?? mt5AccountInfo.account.balance ?? 0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}` },
                        { l:'Equity', v:`$${(mt5AccountInfo.account.Equity ?? mt5AccountInfo.account.equity ?? 0).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}` },
                        { l:'Margin', v:`$${(mt5AccountInfo.account.Margin ?? mt5AccountInfo.account.margin ?? 0).toFixed(2)}` },
                        { l:'Free Margin', v:`$${(mt5AccountInfo.account.FreeMargin ?? mt5AccountInfo.account.freeMargin ?? 0).toFixed(2)}` },
                      ].map(s=>(
                        <div key={s.l} className="rounded bg-zinc-900 px-2 py-1">
                          <div className="text-[10px] text-zinc-600">{s.l}</div>
                          <div className="text-xs font-bold text-zinc-200 font-mono">{s.v}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {mt5AccountInfo.positions?.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] text-zinc-600 mb-2">Open Positions ({mt5AccountInfo.positions.length})</div>
                      <div className="space-y-1">
                        {mt5AccountInfo.positions.slice(0,5).map((p: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-[11px] py-1 border-b border-zinc-900">
                            <div className="flex items-center gap-2">
                              <span className={cx('px-1.5 py-0.5 rounded text-[10px] font-bold',
                                (p.Type===0||p.type===0||p.action==='buy')?'bg-emerald-900/60 text-emerald-400':'bg-red-900/60 text-red-400')}>
                                {(p.Type===0||p.type===0||p.action==='buy')?'BUY':'SELL'}
                              </span>
                              <span className="font-mono text-zinc-200">{p.Symbol ?? p.symbol}</span>
                              <span className="text-zinc-600">{p.Volume ?? p.volume} lots</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-zinc-500">@ {(p.PriceOpen ?? p.openPrice)?.toFixed(5)}</span>
                              <span className={cx('font-bold', (p.Profit ?? p.profit ?? 0)>=0?'text-emerald-400':'text-red-400')}>
                                {(p.Profit ?? p.profit ?? 0)>=0?'+':''}{(p.Profit ?? p.profit ?? 0).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={()=>loadMt5Accounts()} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                  ↻ Refresh
                </button>
              </div>
            )}
          </div>
        )}

        {mt5Tab === 'connect' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-500 space-y-1">
              <div className="text-zinc-400 font-semibold mb-1">Direct connection — no third-party service needed</div>
              <div>• Connects directly to your broker using your MT5 login credentials</div>
              <div>• Session token saved in browser — reconnects automatically</div>
              <div>• Broker server name: open MT5 → File → Login → copy exact server name</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-zinc-600 mb-1 block">MT5 Login (Account Number)</label>
                <input value={mt5Login} onChange={e=>setMt5Login(e.target.value)} placeholder="8029341"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"/>
              </div>
              <div>
                <label className="text-[10px] text-zinc-600 mb-1 block">MT5 Password</label>
                <input type="password" value={mt5Pass} onChange={e=>setMt5Pass(e.target.value)} placeholder="••••••••"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"/>
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] text-zinc-600 mb-1 block">Broker Server Name</label>
                <input value={mt5Server} onChange={e=>setMt5Server(e.target.value)} placeholder="ExclusiveMarkets-Demo"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"/>
              </div>
            </div>
            <button onClick={connectMt5} disabled={mt5Connecting || !mt5Login || !mt5Pass || !mt5Server}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs transition-colors flex items-center justify-center gap-2">
              {mt5Connecting ? <><span className="animate-spin">↻</span> Connecting to broker...</> : '▶ Connect MT5 Account'}
            </button>
            {mt5Result && (
              <div className={cx('rounded-lg border p-3 text-xs', mt5Result.error?'border-red-800 bg-red-900/10 text-red-400':'border-emerald-800 bg-emerald-900/10 text-emerald-400')}>
                {mt5Result.error ? `✗ ${mt5Result.error}` : `✓ Connected to ${mt5Result.brokerName}`}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function BacktestTab() {
  const [sym, setSym] = useState('NQ');
  const [tf, setTf] = useState('1h');
  const [dir, setDir] = useState<'bull'|'bear'>('bull');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [view, setView] = useState<'run'|'history'>('run');
  const syms = ['NQ','ES','GC','BTC','ETH','EURUSD','SPY','QQQ'];
  const tfs = ['15m','1h','4h'];
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInst = useRef<any>(null);

  const loadHistory = useCallback(() => {
    fetch('/api/backtest').then(r=>r.json()).then(d=>setHistory(d.runs??[]));
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const run = async () => {
    setRunning(true); setResult(null);
    const r = await fetch('/api/backtest', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbol: sym, timeframe: tf, direction: dir }) });
    const d = await r.json();
    setResult(d.run ?? d); setRunning(false);
    loadHistory();
  };

  useEffect(() => {
    if (!chartRef.current || !result || !result.total_trades) return;
    const loadChart = async () => {
      // @ts-ignore
      if (!window.Chart) {
        await new Promise<void>((res) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
          s.onload = () => res();
          document.head.appendChild(s);
        });
      }
      // @ts-ignore
      const Chart = window.Chart;
      if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }
      const wins = result.wins, losses = result.losses;
      chartInst.current = new Chart(chartRef.current, {
        type: 'doughnut',
        data: {
          labels: ['Wins','Losses'],
          datasets: [{ data: [wins, losses], backgroundColor: ['#22c55e40','#ef444440'], borderColor: ['#22c55e','#ef4444'], borderWidth: 1.5 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    };
    loadChart();
    return () => { if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; } };
  }, [result]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        <button onClick={()=>setView('run')} className={cx('px-3 py-1.5 rounded-lg text-xs border', view==='run'?'border-zinc-500 bg-zinc-800 text-white':'border-zinc-800 text-zinc-600')}>Run</button>
        <button onClick={()=>setView('history')} className={cx('px-3 py-1.5 rounded-lg text-xs border', view==='history'?'border-zinc-500 bg-zinc-800 text-white':'border-zinc-800 text-zinc-600')}>History ({history.length})</button>
      </div>

      {view === 'run' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <label className="text-xs text-zinc-600 block mb-2">Symbol</label>
              <div className="flex flex-wrap gap-1.5">{syms.map(s=><button key={s} onClick={()=>setSym(s)} className={cx('px-2.5 py-1.5 rounded-lg text-xs border', sym===s?'border-zinc-500 bg-zinc-700 text-white':'border-zinc-800 text-zinc-600')}>{s}</button>)}</div>
            </div>
            <div>
              <label className="text-xs text-zinc-600 block mb-2">Timeframe</label>
              <div className="flex gap-1.5">{tfs.map(t=><button key={t} onClick={()=>setTf(t)} className={cx('px-2.5 py-1.5 rounded-lg text-xs border', tf===t?'border-zinc-500 bg-zinc-700 text-white':'border-zinc-800 text-zinc-600')}>{t}</button>)}</div>
            </div>
            <div>
              <label className="text-xs text-zinc-600 block mb-2">Direction</label>
              <div className="flex gap-1.5">
                <button onClick={()=>setDir('bull')} className={cx('px-3 py-1.5 rounded-lg text-xs border', dir==='bull'?'border-emerald-700 bg-emerald-900/30 text-emerald-400':'border-zinc-800 text-zinc-600')}>↑ Bull</button>
                <button onClick={()=>setDir('bear')} className={cx('px-3 py-1.5 rounded-lg text-xs border', dir==='bear'?'border-red-700 bg-red-900/30 text-red-400':'border-zinc-800 text-zinc-600')}>↓ Bear</button>
              </div>
            </div>
            <button onClick={run} disabled={running} className="w-full py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white disabled:opacity-50">{running?'Running…':'Run ICT Backtest'}</button>
          </div>

          {result && !result.error && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label:'Win Rate', val:`${result.win_rate??0}%`, color:(result.win_rate??0)>=50?'text-emerald-400':'text-red-400' },
                  { label:'Total R', val:`${(result.total_pnl??0)>0?'+':''}${((result.total_pnl??0)/20).toFixed(1)}R`, color:(result.total_pnl??0)>0?'text-emerald-400':'text-red-400' },
                  { label:'Trades', val:result.total_trades??0, color:'text-zinc-300' },
                  { label:'Profit Factor', val:result.profit_factor??0, color:(result.profit_factor??0)>=1.5?'text-emerald-400':'text-yellow-400' },
                  { label:'Max DD', val:`$${result.max_drawdown??0}`, color:'text-red-400' },
                  { label:'Sharpe', val:result.sharpe_ratio??0, color:(result.sharpe_ratio??0)>0?'text-emerald-400':'text-red-400' },
                ].map(item=>(
                  <div key={item.label} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 text-center">
                    <div className={cx('text-lg font-mono font-bold', item.color)}>{item.val}</div>
                    <div className="text-xs text-zinc-600 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
                <span className="text-xs text-zinc-600 block mb-2">Win/Loss ratio</span>
                <div style={{position:'relative',height:'80px'}}>
                  <canvas ref={chartRef} style={{width:'100%',height:'80px'}}/>
                </div>
              </div>
            </div>
          )}
          {result?.error && <div className="text-xs text-red-400 p-3 bg-red-900/20 rounded-xl">{result.error}</div>}
        </div>
      )}

      {view === 'history' && (
        <div className="space-y-2">
          {history.length === 0 && <div className="py-12 text-center text-xs text-zinc-700">No runs yet — run a backtest first</div>}
          {history.map((r,i) => (
            <div key={i} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-sm font-mono font-bold text-white">{r.symbol}</span>
                  <span className="text-xs text-zinc-500 ml-2">{r.timeframe} · {r.start_date?.slice(0,10)} → {r.end_date?.slice(0,10)}</span>
                </div>
                <span className={cx('text-sm font-mono font-bold', (r.total_pnl??0)>0?'text-emerald-400':'text-red-400')}>{r.win_rate}% WR</span>
              </div>
              <div className="mt-1.5 flex gap-4 text-xs font-mono text-zinc-500">
                <span>{r.total_trades} trades</span>
                <span className={cx((r.profit_factor??0)>=1.5?'text-emerald-400':'text-yellow-400')}>PF {r.profit_factor}</span>
                <span className={cx((r.sharpe_ratio??0)>0?'text-emerald-400':'text-zinc-500')}>Sharpe {r.sharpe_ratio}</span>
                <span className="text-red-400">DD ${r.max_drawdown}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── TELEGRAM SETTINGS ──────────────────────────
function TelegramSettings({ onClose }: { onClose: ()=>void }) {
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [alerts, setAlerts] = useState({ sl:true, entry:true, tp:true, scan:true });
  useEffect(()=>{
    sb.from('telegram_config').select('*').single().then(({data})=>{
      if(data){ setToken(data.bot_token??''); setChatId(data.chat_id??''); setAlerts({ sl:data.alert_sl??true, entry:data.alert_entry??true, tp:data.alert_tp??true, scan:true }); }
    });
  },[]);
  const save = async ()=>{
    await sb.from('telegram_config').upsert({ id:1, bot_token:token, chat_id:chatId, active:true, alert_sl:alerts.sl, alert_entry:alerts.entry, alert_tp:alerts.tp, updated_at:new Date().toISOString() },{ onConflict:'id' });
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };
  const test = async ()=>{
    setTesting(true);
    await fetch('/api/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'test',botToken:token,chatId})});
    setTesting(false);
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm font-bold text-white">Telegram Alerts</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">✕</button>
        </div>
        <div className="text-xs text-zinc-600 bg-zinc-800/60 rounded-lg p-3 mb-4 space-y-1">
          <p>1. Message @BotFather → /newbot → copy token</p>
          <p>2. Message @userinfobot → copy Chat ID</p>
          <p>3. Paste both → Save → Test</p>
        </div>
        <div className="space-y-3">
          <div><label className="text-xs text-zinc-600 block mb-1">Bot Token</label><input value={token} onChange={e=>setToken(e.target.value)} placeholder="123456:ABC..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono"/></div>
          <div><label className="text-xs text-zinc-600 block mb-1">Chat ID</label><input value={chatId} onChange={e=>setChatId(e.target.value)} placeholder="-100..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono"/></div>
          <div>
            <label className="text-xs text-zinc-600 block mb-2">Alert types</label>
            <div className="grid grid-cols-2 gap-1.5">
              {[['sl','SL Hit'],['entry','Entry Zone'],['tp','TP Hit'],['scan','New Setup']].map(([k,label])=>(
                <button key={k} onClick={()=>setAlerts(p=>({...p,[k]:!p[k as keyof typeof p]}))} className={cx('py-1.5 rounded-lg border text-xs transition-all', alerts[k as keyof typeof alerts]?'border-zinc-500 bg-zinc-700 text-zinc-200':'border-zinc-800 text-zinc-600')}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={test} disabled={testing||!token||!chatId} className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 disabled:opacity-50">{testing?'Sending…':'Test'}</button>
          <button onClick={save} className="flex-1 py-2 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white">{saved?'Saved ✓':'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>('Markets');
  const [mktTab, setMktTab] = useState<MkTab>('Futures');
  const [setups, setSetups] = useState<Setup[]>([]);
  const [prices, setPrices] = useState<Prices>({ NQ:null, ES:null, GC:null, DXY:null, VIX:null });
  const [kz, setKz] = useState<any>(null);
  const [calEvents, setCalEvents] = useState<any[]>([]);
  const [showScan, setShowScan] = useState(false);
  const [showTelegram, setShowTelegram] = useState(false);
  const [selected, setSelected] = useState<Setup|null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showTrade, setShowTrade] = useState(false);
  const [showManualTrade, setShowManualTrade] = useState(false);
  const [tradingSetup, setTradingSetup] = useState<Setup|null>(null);
  const [toasts, setToasts] = useState<{id:string;msg:string;type:string}[]>([]);
  const [smtBadge, setSmtBadge] = useState(0);
  const [journalTrade, setJournalTrade] = useState<any>(null);
  const firedAlerts = useRef<Set<string>>(new Set());
  const monitorRef = useRef<NodeJS.Timeout|null>(null);

  const addToast = useCallback((msg:string, type='y') => {
    const id = Date.now().toString();
    setToasts(p => [...p.slice(-2), {id, msg, type}]);
    setTimeout(() => setToasts(p => p.filter(a => a.id !== id)), 6000);
  }, []);

  const loadSetups = useCallback(async () => {
    const {data} = await sb.from('setups').select('*').in('status',['active','watching','triggered']).order('confluence_score',{ascending:false}).limit(60);
    if (data) setSetups(data as Setup[]);
  }, []);

  const deleteSetup = useCallback(async (id:string) => {
    await sb.from('setups').delete().eq('id', id);
    setSetups(p => p.filter(s => s.id !== id));
    if (selected?.id === id) { setSelected(null); setShowAnalysis(false); }
  }, [selected]);

  useEffect(() => { loadSetups(); }, [loadSetups]);

  const loadPrices = useCallback(async () => {
    try { const r = await fetch('/api/prices',{cache:'no-store'}); const d = await r.json(); if (d.prices) setPrices(d.prices); } catch {}
  }, []);

  const loadKz = useCallback(async () => {
    try { const r = await fetch('/api/killzone',{cache:'no-store'}); const d = await r.json(); setKz(d); } catch {}
  }, []);

  const loadCal = useCallback(async () => {
    try { const r = await fetch('/api/calendar',{cache:'no-store'}); const d = await r.json(); setCalEvents(d.events??[]); } catch {}
  }, []);

  // ── MONITOR: call /api/monitor every 30s to fire Telegram alerts ──
  const runMonitor = useCallback(async () => {
    try { await fetch('/api/monitor', {cache:'no-store'}); } catch {}
  }, []);

  useEffect(() => {
    loadPrices(); loadKz(); loadCal();
    const pi = setInterval(loadPrices, 15000);
    const ki = setInterval(loadKz, 60000);
    const ci = setInterval(loadCal, 300000);
    const mi = setInterval(runMonitor, 30000);
    return () => { clearInterval(pi); clearInterval(ki); clearInterval(ci); clearInterval(mi); };
  }, [loadPrices, loadKz, loadCal, runMonitor]);

  useEffect(() => {
    sb.from('smt_signals').select('id').gte('detected_at', new Date(Date.now()-4*60*60*1000).toISOString()).then(({data})=>setSmtBadge(data?.length??0));
  }, []);

  // Browser SL/entry toast alerts
  useEffect(() => {
    setups.forEach(s => {
      if (!['active','watching'].includes(s.status)) return;
      const p = prices[s.symbol as keyof Prices];
      if (!p) return;
      const isBull = s.direction === 'bull' || s.direction === 'long';
      const slK = `sl-${s.id}`;
      if (!firedAlerts.current.has(slK) && ((isBull && p < s.stop_loss) || (!isBull && p > s.stop_loss))) {
        firedAlerts.current.add(slK);
        addToast(`SL hit — ${s.symbol} ${s.setup_type}`, 'r');
      }
      const eK = `e-${s.id}`;
      if (!firedAlerts.current.has(eK) && p >= s.entry_low && p <= s.entry_high) {
        firedAlerts.current.add(eK);
        addToast(`Entry zone — ${s.symbol} ${s.setup_type}`, 'g');
      }
    });
  }, [prices, setups, addToast]);

  const dangerNews = calEvents.some(e => e.isDangerZone);
  const nextEvent = calEvents.find(e => e.isToday && (e.diffMin ?? -999) > -30);
  const pFmt = (sym: keyof Prices, dec = 1) => prices[sym] != null ? prices[sym]!.toFixed(dec) : '—';

  const TABS: Tab[] = ['Markets','Setups','Trades','Analytics','Journal','Knowledge','Backtest','Agents'];
  const MKT_TABS: MkTab[] = ['Futures','Crypto','Forex','Stocks','Institutional'];

  return (
    <div style={{height:'100dvh',display:'flex',flexDirection:'column',background:'var(--bg)',color:'var(--text)',overflow:'hidden'}}>
      {/* TOASTS */}
      <div style={{position:'fixed',top:16,right:16,zIndex:999,display:'flex',flexDirection:'column',gap:8,pointerEvents:'none'}}>
        {toasts.map(a => (
          <div key={a.id} className="fade-up" style={{
            padding:'8px 14px',borderRadius:8,fontSize:12,fontWeight:500,
            backdropFilter:'blur(16px)',border:'1px solid',boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
            background: a.type==='r'?'rgba(220,38,38,0.12)':a.type==='g'?'rgba(34,197,94,0.12)':'rgba(255,255,255,0.06)',
            borderColor: a.type==='r'?'rgba(239,68,68,0.3)':a.type==='g'?'rgba(34,197,94,0.3)':'rgba(255,255,255,0.1)',
            color: a.type==='r'?'#f87171':a.type==='g'?'#4ade80':'#e2e2e5',
          }}>{a.msg}</div>
        ))}
      </div>

      {/* HEADER */}
      <header style={{
        height:48,flexShrink:0,display:'flex',alignItems:'center',
        padding:'0 20px',gap:16,
        borderBottom:'1px solid var(--border)',
        background:'rgba(7,7,8,0.95)',backdropFilter:'blur(20px)',
        position:'relative',zIndex:40,
      }}>
        {/* Logo */}
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          <span style={{fontFamily:'JetBrains Mono',fontWeight:700,fontSize:13,letterSpacing:'0.12em',color:'#fff'}}>VECTOR</span>
          <div style={{width:5,height:5,borderRadius:'50%',background:prices.NQ?'var(--green-2)':'#3f3f46',
            boxShadow:prices.NQ?'0 0 0 3px rgba(34,197,94,0.2)':'none',transition:'all 0.3s'}}/>
        </div>

        <div style={{width:1,height:20,background:'var(--border)',flexShrink:0}}/>

        {/* Live prices ticker */}
        <div style={{display:'flex',alignItems:'center',gap:20,flex:1,overflow:'hidden'}}>
          {(['NQ','ES','GC','DXY','VIX'] as const).map(s => (
            <div key={s} style={{display:'flex',alignItems:'baseline',gap:5,flexShrink:0}}>
              <span style={{fontSize:10,fontFamily:'JetBrains Mono',color:'var(--muted)',fontWeight:500}}>{s}</span>
              <span style={{fontSize:13,fontFamily:'JetBrains Mono',fontWeight:600,color:'#e2e2e5',letterSpacing:'-0.01em'}}>
                {s==='DXY'?pFmt(s,3):s==='VIX'?pFmt(s,2):pFmt(s,1)}
              </span>
            </div>
          ))}
        </div>

        {/* Right side */}
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          {kz?.active && (
            <span style={{fontSize:10,fontFamily:'JetBrains Mono',fontWeight:600,padding:'2px 8px',borderRadius:4,
              background:'rgba(34,197,94,0.1)',color:'#4ade80',border:'1px solid rgba(34,197,94,0.2)',letterSpacing:'0.05em'}}>
              {kz.active.short}
            </span>
          )}
          {dangerNews && (
            <span style={{fontSize:10,fontFamily:'JetBrains Mono',fontWeight:600,padding:'2px 8px',borderRadius:4,
              background:'rgba(239,68,68,0.1)',color:'#f87171',border:'1px solid rgba(239,68,68,0.2)',
              animation:'pulse-dot 1.5s ease-in-out infinite',letterSpacing:'0.05em'}}>
              NEWS
            </span>
          )}
          <button onClick={()=>setShowTelegram(true)} style={{
            width:32,height:32,borderRadius:7,border:'1px solid var(--border)',
            background:'rgba(255,255,255,0.04)',color:'var(--muted)',cursor:'pointer',
            display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.15s',
          }} onMouseEnter={e=>{e.currentTarget.style.color='var(--text)';e.currentTarget.style.borderColor='var(--border-2)';}}
             onMouseLeave={e=>{e.currentTarget.style.color='var(--muted)';e.currentTarget.style.borderColor='var(--border)';}}>
            <Icons.Bell/>
          </button>
          <button onClick={()=>setShowScan(true)} className="btn btn-ghost" style={{fontSize:11,padding:'5px 12px',gap:5}}>
            <Icons.Scan/>Scan
          </button>
        </div>
      </header>

      {/* NAV TABS */}
      <nav style={{
        display:'flex',alignItems:'center',padding:'0 20px',gap:0,
        borderBottom:'1px solid var(--border)',background:'var(--bg-1)',flexShrink:0,
        overflowX:'auto',
      }}>
        {TABS.map(t => {
          const count = t==='Setups'&&setups.length>0?setups.length:t==='Markets'&&smtBadge>0?smtBadge:0;
          return (
            <button key={t} className={`ul-tab${tab===t?' active':''}`} onClick={()=>setTab(t)}
              style={{fontSize:12}}>
              {t}{count>0&&<span style={{marginLeft:5,fontSize:9,fontFamily:'JetBrains Mono',fontWeight:700,
                padding:'1px 5px',borderRadius:3,background:'rgba(34,197,94,0.15)',color:'var(--green-2)'}}>{count}</span>}
            </button>
          );
        })}
      </nav>

      {/* MAIN */}
      <main style={{flex:1,overflowY:'auto',padding:'20px'}}>
        <div style={{maxWidth:960,margin:'0 auto'}}>

        {tab === 'Markets' && (
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div className="pill-tabs" style={{alignSelf:'flex-start'}}>
              {MKT_TABS.map(t => (
                <button key={t} className={`pill-tab${mktTab===t?' active':''}`} onClick={()=>setMktTab(t)}>{t}</button>
              ))}
            </div>
            {mktTab === 'Futures' && (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                <div style={{gridColumn:'1/-1'}}><WeeklyBiasPanel/></div>
                <CalendarWidget/>
                <SMTPanel/>
              </div>
            )}
            {mktTab === 'Crypto' && <CryptoTab/>}
            {mktTab === 'Forex' && <ForexTab/>}
            {mktTab === 'Stocks' && <StocksTab/>}
            {mktTab === 'Institutional' && <InstitutionalTab/>}
          </div>
        )}

        {tab === 'Setups' && (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:11,color:'var(--muted)',fontWeight:500,letterSpacing:'0.06em',textTransform:'uppercase'}}>
                  Active Setups
                </span>
                {setups.length>0&&<span className="badge badge-green">{setups.length}</span>}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <MonitorButton onDone={loadSetups}/>
                <button onClick={()=>setShowScan(true)} className="btn btn-ghost" style={{fontSize:11,padding:'5px 12px'}}>
                  <Icons.Plus/> Scan
                </button>
              </div>
            </div>
            {dangerNews && (
              <div style={{padding:'8px 12px',borderRadius:8,background:'rgba(239,68,68,0.06)',
                border:'1px solid rgba(239,68,68,0.15)',fontSize:12,color:'#f87171',display:'flex',alignItems:'center',gap:6}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:'#ef4444',flexShrink:0,animation:'pulse-dot 1.5s infinite'}}/>
                High-impact news active — elevated risk
              </div>
            )}
            {setups.length === 0 ? (
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                padding:'80px 20px',gap:12,textAlign:'center'}}>
                <Icons.Target/>
                <p style={{color:'var(--muted)',fontSize:13}}>No setups found — run a scan to detect ICT patterns</p>
                <button onClick={()=>setShowScan(true)} className="btn btn-ghost" style={{marginTop:4}}>
                  <Icons.Scan/> Scan Market
                </button>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {setups.map(s => (
                  <div key={s.id}>
                    <SetupCard s={s} prices={prices} onDelete={deleteSetup}
                      onAnalyze={s=>{setSelected(s);setShowAnalysis(true);}}
                      onTrade={s=>{setTradingSetup(s);setShowTrade(true);}}
                      selected={selected?.id===s.id}
                      onSelect={s=>{setSelected(s);setShowAnalysis(false);}}
                    />
                    {showAnalysis && selected?.id === s.id && <AnalysisPanel setup={s} prices={prices} onClose={()=>setShowAnalysis(false)}/>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'Trades' && <TradesTab onNew={()=>setShowManualTrade(true)} onJournal={(t)=>setJournalTrade(t)}/>}
        {tab === 'Analytics' && <AnalyticsTab/>}
        {tab === 'Journal' && <JournalTab/>}
        {tab === 'Knowledge' && <KnowledgeTab/>}
        {tab === 'Backtest' && <BacktestTab/>}
        {tab === 'Agents' && <AgentsTab/>}

        </div>
      </main>

      {showScan && <ScanModal prices={prices} onClose={()=>setShowScan(false)} onDone={()=>{setShowScan(false);loadSetups();setTab('Setups');}}/>}
      {showTelegram && <TelegramSettings onClose={()=>setShowTelegram(false)}/>}
      {showTrade && tradingSetup && <TradeModal setup={tradingSetup} onClose={()=>{setShowTrade(false);setTradingSetup(null);}} onSaved={()=>{}}/>}
      {showManualTrade && <TradeModal setup={null} onClose={()=>setShowManualTrade(false)} onSaved={()=>{}}/>}
      {journalTrade && <JournalPromptModal trade={journalTrade} onClose={()=>setJournalTrade(null)}/>}
    </div>
  );
}
