'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://xavkbjbgmuasfkliptsh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

type Tab = 'Markets'|'Setups'|'Trades'|'Analytics'|'Journal'|'Knowledge';
type MkTab = 'Futures'|'Crypto'|'Forex'|'Stocks'|'Institutional';
type Prices = { NQ:number|null; ES:number|null; GC:number|null; DXY:number|null; VIX:number|null };

interface Setup {
  id: string; symbol: string; timeframe: string; direction: string; setup_type: string;
  entry_low: number; entry_high: number; stop_loss: number; target: number; rr_ratio: number;
  htf_bias: string; cisd_confirmed: boolean; volume_context: string; dol_target: string;
  killzone_valid: string; confluence_score: number; status: string; ai_analysis: string;
  expires_at: string; created_at: string; correlated_align: boolean; market_section: string;
}

const cx = (...a: (string|boolean|undefined|null)[]) => a.filter(Boolean).join(' ');

// ─────────────────────────────────────────────
// LIGHTWEIGHT MINI CHART (canvas-based sparkline)
// ─────────────────────────────────────────────
function Sparkline({ data, color = '#22c55e', height = 32 }: { data: (number | null | undefined)[]; color?: string; height?: number }) {
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

// ─────────────────────────────────────────────
// PRICE ROW COMPONENT
// ─────────────────────────────────────────────
function PriceRow({ symbol, price, change, changePct, history, currency = '' }: {
  symbol: string; price: number | null; change?: number | null; changePct?: number | null;
  history?: (number | null | undefined)[]; currency?: string;
}) {
  const up = (change ?? 0) >= 0;
  const fmt = (v: number | null, d = 2) => v == null ? '—' : v.toFixed(d);
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-zinc-800/50 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xs font-mono text-zinc-300 w-20 shrink-0">{symbol}</span>
        {history && history.length > 2 && <Sparkline data={history} color={up ? '#22c55e' : '#ef4444'} />}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <span className="text-sm font-mono text-zinc-200">{currency}{fmt(price)}</span>
        {change != null && (
          <span className={cx('text-xs font-mono w-16 text-right', up ? 'text-emerald-400' : 'text-red-400')}>
            {up ? '+' : ''}{fmt(change)} ({up ? '+' : ''}{fmt(changePct ?? null, 2)}%)
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SETUP CARD
// ─────────────────────────────────────────────
function SetupCard({ s, prices, onDelete, onAnalyze, onTrade, onSelect, selected }: {
  s: Setup; prices: Prices; onDelete: (id: string) => void;
  onAnalyze: (s: Setup) => void; onTrade: (s: Setup) => void;
  onSelect: (s: Setup) => void; selected: boolean;
}) {
  const price = prices[s.symbol as keyof Prices];
  const isBull = s.direction === 'bull' || s.direction === 'long';
  const inZone = price != null && price >= s.entry_low && price <= s.entry_high;
  const nearZone = price != null && !inZone && Math.abs(price - (isBull ? s.entry_high : s.entry_low)) / Math.abs(s.entry_high - s.entry_low) < 2;
  const statusColor = s.status === 'won' ? 'text-emerald-400' : s.status === 'lost' ? 'text-red-400' : inZone ? 'text-yellow-400 animate-pulse' : 'text-zinc-500';
  const scoreColor = s.confluence_score >= 80 ? 'text-emerald-400' : s.confluence_score >= 65 ? 'text-yellow-400' : 'text-zinc-500';

  return (
    <div onClick={() => onSelect(s)} className={cx(
      'rounded-xl border p-3 cursor-pointer transition-all',
      selected ? 'border-zinc-500 bg-zinc-800/60' : 'border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700'
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono font-bold text-white">{s.symbol}</span>
          <span className={cx('text-xs font-mono font-semibold', isBull ? 'text-emerald-400' : 'text-red-400')}>
            {isBull ? '↑ BULL' : '↓ BEAR'}
          </span>
          <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{s.setup_type}</span>
          <span className="text-xs text-zinc-600">{s.timeframe}</span>
          {s.cisd_confirmed && <span className="text-xs text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">CISD✓</span>}
          {inZone && <span className="text-xs text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded animate-pulse">IN ZONE</span>}
          {nearZone && !inZone && <span className="text-xs text-zinc-500">near zone</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cx('text-xs font-mono font-bold', scoreColor)}>{s.confluence_score}</span>
          <span className={cx('text-xs', statusColor)}>{s.status}</span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-xs font-mono">
        <div><span className="text-zinc-600">Entry </span><span className="text-zinc-300">{s.entry_low}–{s.entry_high}</span></div>
        <div><span className="text-zinc-600">SL </span><span className="text-red-400">{s.stop_loss}</span></div>
        <div><span className="text-zinc-600">TP </span><span className="text-emerald-400">{s.target}</span></div>
        <div><span className="text-zinc-600">RR </span><span className="text-zinc-300">{s.rr_ratio}R</span></div>
        <div><span className="text-zinc-600">Vol </span><span className={s.volume_context === 'high' ? 'text-emerald-400' : s.volume_context === 'low' ? 'text-red-400' : 'text-zinc-400'}>{s.volume_context}</span></div>
        <div><span className="text-zinc-600">Price </span><span className={inZone ? 'text-yellow-400' : 'text-zinc-400'}>{price?.toFixed(1) ?? '—'}</span></div>
      </div>

      <div className="mt-1.5 text-xs text-zinc-600 truncate">{s.dol_target} · HTF {s.htf_bias}</div>

      <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <button onClick={() => onAnalyze(s)} className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">AI</button>
        <button onClick={() => onTrade(s)} className="text-xs px-2 py-1 rounded bg-emerald-900/40 hover:bg-emerald-900/70 text-emerald-400 transition-colors">Log</button>
        <button onClick={() => onDelete(s.id)} className="text-xs px-2 py-1 rounded hover:bg-red-900/30 text-zinc-700 hover:text-red-400 transition-colors">✕</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ANALYSIS PANEL
// ─────────────────────────────────────────────
function AnalysisPanel({ setup, prices, onClose }: { setup: Setup; prices: Prices; onClose: () => void }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (setup.ai_analysis) { setText(setup.ai_analysis); return; }
    setLoading(true);
    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup, prices }),
    }).then(r => r.json()).then(d => { setText(d.analysis ?? d.error ?? 'No response'); setLoading(false); }).catch(() => setLoading(false));
  }, [setup.id]);

  return (
    <div className="mt-2 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">AI Analysis — {setup.symbol} {setup.setup_type}</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400 text-sm">✕</button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="animate-spin">⟳</span> Analyzing with ICT knowledge base + COT data…
        </div>
      ) : (
        <pre className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed font-mono">{text}</pre>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SCAN MODAL
// ─────────────────────────────────────────────
function ScanModal({ prices, onClose, onDone }: { prices: Prices; onClose: () => void; onDone: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState('');
  const [syms, setSyms] = useState(['NQ','ES','GC']);
  const [tfs, setTfs] = useState(['15m','1h']);
  const symOpts = ['NQ','ES','GC','CL','BTC','ETH','SOL','EURUSD','GBPUSD','SPY','QQQ','NVDA'];
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
            <p className="text-xs text-zinc-600 mb-2 uppercase tracking-wider">Timeframes (HTF confirmation auto-enabled)</p>
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
          {scanning ? '⟳ Scanning with HTF confirmation…' : `Scan ${syms.length} symbols × ${tfs.length} timeframes`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TRADE MODAL (with mistake tagging + journal prompt)
// ─────────────────────────────────────────────
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
    const ePrice = parseFloat(entry), slPrice = parseFloat(sl), tpPrice = parseFloat(tp);
    await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({
      symbol: setup?.symbol ?? 'MANUAL', direction: setup?.direction ?? 'bull',
      entry_price: ePrice, stop_loss: slPrice, target: tpPrice,
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
            <label className="text-xs text-zinc-600 block mb-1.5">Mistakes (tag if any)</label>
            <div className="flex flex-wrap gap-1.5">
              {MISTAKES.map(m => <button key={m} onClick={()=>toggle(m)} className={cx('px-2 py-0.5 rounded text-xs border transition-all', mistakes.includes(m)?'border-red-700 bg-red-900/40 text-red-300':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>{m}</button>)}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-600 block mb-1">Notes</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 resize-none"/>
          </div>
        </div>
        <button onClick={save} disabled={saving} className="mt-4 w-full py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-sm text-white font-medium transition-colors">
          {saving ? 'Saving…' : 'Save Trade'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CLOSE TRADE MODAL
// ─────────────────────────────────────────────
function CloseTradeModal({ trade, onClose, onSaved }: { trade: any; onClose: ()=>void; onSaved: ()=>void }) {
  const [exit, setExit] = useState('');
  const [notes, setNotes] = useState(trade.notes ?? '');
  const [mistakes, setMistakes] = useState<string[]>(trade.mistakes ?? []);
  const [saving, setSaving] = useState(false);
  const toggle = (m: string) => setMistakes(p => p.includes(m) ? p.filter(x=>x!==m) : [...p, m]);
  const save = async () => {
    setSaving(true);
    await fetch('/api/trades', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id: trade.id, exit_price: parseFloat(exit), notes, mistakes }) });
    setSaving(false); onSaved(); onClose();
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
            {pnlR !== null && <p className={cx('text-xs mt-1 font-mono', pnlR > 0 ? 'text-emerald-400' : 'text-red-400')}>{pnlR > 0 ? '+' : ''}{pnlR}R &nbsp;{trade.risk_dollars ? `(${ (pnlR * trade.risk_dollars).toFixed(0) })` : ''}</p>}
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
        <button onClick={save} disabled={saving||!exit} className="mt-4 w-full py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white font-medium disabled:opacity-50">
          {saving ? 'Saving…' : 'Close Trade'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MARKET DATA TABS
// ─────────────────────────────────────────────
function CryptoTab() {
  const [data, setData] = useState<any[]>([]);
  useEffect(() => { fetch('/api/crypto').then(r=>r.json()).then(d=>setData(d.prices??[])); }, []);
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 divide-y divide-zinc-800/40">
      {data.length === 0 ? <div className="py-8 text-center text-xs text-zinc-600">Loading…</div> :
        data.map((a: any) => <PriceRow key={a.symbol} symbol={a.symbol} price={a.price} change={a.change} changePct={a.changePct} />)}
    </div>
  );
}
function ForexTab() {
  const [data, setData] = useState<any[]>([]);
  useEffect(() => { fetch('/api/forex').then(r=>r.json()).then(d=>setData(d.prices??[])); }, []);
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 divide-y divide-zinc-800/40">
      {data.length === 0 ? <div className="py-8 text-center text-xs text-zinc-600">Loading…</div> :
        data.map((a: any) => <PriceRow key={a.symbol} symbol={a.symbol} price={a.price} change={a.change} changePct={a.changePct} />)}
    </div>
  );
}
function StocksTab() {
  const [data, setData] = useState<any[]>([]);
  useEffect(() => { fetch('/api/stocks').then(r=>r.json()).then(d=>setData(d.prices??[])); }, []);
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 divide-y divide-zinc-800/40">
      {data.length === 0 ? <div className="py-8 text-center text-xs text-zinc-600">Loading…</div> :
        data.map((a: any) => <PriceRow key={a.symbol} symbol={a.symbol} price={a.price} change={a.change} changePct={a.changePct} />)}
    </div>
  );
}

// ─────────────────────────────────────────────
// WEEKLY BIAS PANEL (now visible in Futures tab)
// ─────────────────────────────────────────────
function WeeklyBiasPanel({ onBiasChange }: { onBiasChange?: (biases: Record<string, string>) => void }) {
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
                  isBull ? 'border-emerald-700/60 bg-emerald-900/30 text-emerald-400 hover:bg-emerald-900/50' :
                  isBear ? 'border-red-700/60 bg-red-900/30 text-red-400 hover:bg-red-900/50' :
                  'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>
                <div>{sym}</div>
                <div className="text-xs font-normal mt-0.5">{b ? (isBull?'↑ bull':isBear?'↓ bear':'–neutral') : '+ set'}</div>
              </button>
            </div>
          );
        })}
      </div>
      {editing && (
        <div className="mt-3 p-3 bg-zinc-800/60 rounded-lg space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-zinc-400 font-medium">{editing} bias this week</span>
            <button onClick={()=>setEditing(null)} className="text-zinc-600 hover:text-zinc-400 text-xs">✕</button>
          </div>
          <div className="flex gap-2">
            {['bullish','neutral','bearish'].map(v=>(
              <button key={v} onClick={()=>setForm(p=>({...p,bias:v}))} className={cx('flex-1 py-1.5 rounded-lg border text-xs transition-all',
                form.bias===v ? (v==='bullish'?'border-emerald-700 bg-emerald-900/40 text-emerald-400':v==='bearish'?'border-red-700 bg-red-900/40 text-red-400':'border-zinc-600 bg-zinc-700 text-zinc-300') : 'border-zinc-700 text-zinc-600'
              )}>{v}</button>
            ))}
          </div>
          <input value={form.key_levels} onChange={e=>setForm(p=>({...p,key_levels:e.target.value}))} placeholder="Key levels (e.g. 21400, 20800)" className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 font-mono"/>
          <textarea value={form.reasoning} onChange={e=>setForm(p=>({...p,reasoning:e.target.value}))} placeholder="Reasoning..." rows={2} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 resize-none"/>
          <button onClick={()=>save(editing)} disabled={saving} className="w-full py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white disabled:opacity-50">{saving?'Saving…':'Save Bias'}</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SMT SIGNALS PANEL
// ─────────────────────────────────────────────
function SMTPanel() {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    await fetch('/api/smt', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) });
    const r = await fetch('/api/smt');
    const d = await r.json();
    setSignals((d.signals ?? []).slice(0, 8));
    setLoading(false);
  };
  useEffect(() => {
    fetch('/api/smt').then(r=>r.json()).then(d=>setSignals((d.signals??[]).slice(0,8)));
  }, []);

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">SMT Divergence · NQ/ES</span>
        <button onClick={run} disabled={loading} className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:opacity-50">{loading?'Scanning…':'Scan SMT'}</button>
      </div>
      {signals.length === 0 ? (
        <p className="text-xs text-zinc-700 text-center py-4">No recent SMT divergences — click Scan SMT</p>
      ) : signals.map((s,i) => (
        <div key={i} className="flex items-center justify-between py-1.5 border-b border-zinc-800/40 last:border-0">
          <div>
            <span className={cx('text-xs font-semibold', s.divergence_type?.includes('bull') ? 'text-emerald-400' : 'text-red-400')}>{s.divergence_type}</span>
            <span className="text-xs text-zinc-600 ml-2">{s.notes}</span>
          </div>
          <span className="text-xs text-zinc-700 font-mono">{s.detected_at ? new Date(s.detected_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—'}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// ECONOMIC CALENDAR WIDGET
// ─────────────────────────────────────────────
function CalendarWidget() {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/calendar').then(r=>r.json()).then(d=>setEvents(d.events??[]));
  }, []);
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
              {e.isDangerZone && <span className="text-red-400 text-xs animate-pulse">⚠ ACTIVE</span>}
            </div>
            <span className="text-zinc-600 font-mono">{e.isToday ? e.time : new Date(e.date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// INSTITUTIONAL TAB (COT)
// ─────────────────────────────────────────────
function InstitutionalTab() {
  const [data, setData] = useState<any>(null);
  const [sel, setSel] = useState('NQ');
  const syms = ['NQ','ES','GC','CL','EUR','GBP'];
  useEffect(() => {
    setData(null);
    fetch(`/api/cot?symbol=${sel}`).then(r=>r.json()).then(d=>setData(d));
  }, [sel]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {syms.map(s => <button key={s} onClick={()=>setSel(s)} className={cx('px-3 py-1.5 rounded-lg text-xs border transition-all', sel===s?'border-zinc-500 bg-zinc-800 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>{s}</button>)}
      </div>
      {!data ? <div className="py-12 text-center text-xs text-zinc-600">Loading COT data…</div> : (
        <div className="space-y-3">
          {data.error ? <div className="text-xs text-red-400 p-3 bg-red-900/20 rounded-xl">{data.error}</div> : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Commercials', val: data.latest?.comm_net, desc: 'Hedgers — smart money' },
                  { label: 'Large Specs', val: data.latest?.large_net, desc: 'Trend followers' },
                  { label: 'Small Specs', val: data.latest?.small_net, desc: 'Retail — contrarian' },
                ].map(item => (
                  <div key={item.label} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 text-center">
                    <div className="text-xs text-zinc-600 mb-1">{item.label}</div>
                    <div className={cx('text-base font-mono font-bold', (item.val??0)>0?'text-emerald-400':'text-red-400')}>
                      {(item.val??0)>0?'+':''}{((item.val??0)/1000).toFixed(0)}k
                    </div>
                    <div className="text-xs text-zinc-700 mt-0.5">{item.desc}</div>
                  </div>
                ))}
              </div>
              {data.history && data.history.length > 0 && (
                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
                  <span className="text-xs text-zinc-600 block mb-2">12-Week History — Commercials Net</span>
                  <div className="space-y-1">
                    {data.history.slice(0,8).map((w: any, i: number) => {
                      const max = Math.max(...data.history.map((x:any)=>Math.abs(x.comm_net)));
                      const pct = max > 0 ? Math.abs(w.comm_net)/max*100 : 0;
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs text-zinc-700 font-mono w-20 shrink-0">{w.date?.slice(5)}</span>
                          <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div className={cx('h-full rounded-full', w.comm_net>0?'bg-emerald-500/60':'bg-red-500/60')} style={{width:`${pct}%`}}/>
                          </div>
                          <span className={cx('text-xs font-mono w-14 text-right', w.comm_net>0?'text-emerald-400':'text-red-400')}>
                            {w.comm_net>0?'+':''}{(w.comm_net/1000).toFixed(0)}k
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {data.interpretation && (
                <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 p-3">
                  <span className="text-xs text-zinc-500 block mb-1">Interpretation</span>
                  <p className="text-xs text-zinc-300 leading-relaxed">{data.interpretation}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TRADES TAB
// ─────────────────────────────────────────────
function TradesTab({ onNew }: { onNew?: () => void }) {
  const [trades, setTrades] = useState<any[]>([]);
  const [closing, setClosing] = useState<any|null>(null);
  const load = useCallback(async () => {
    const r = await fetch('/api/trades'); const d = await r.json();
    setTrades(d.trades ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const del = async (id: string) => {
    await fetch('/api/trades', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
    load();
  };

  const open = trades.filter(t => t.result === 'open');
  const closed = trades.filter(t => t.result !== 'open');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">Open Trades · {open.length}</span>
        {onNew && <button onClick={onNew} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:border-zinc-500">+ Manual</button>}
      </div>

      {open.length > 0 && (
        <div className="space-y-2">
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
        </div>
      )}

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
      {trades.length === 0 && <div className="py-20 text-center text-xs text-zinc-700">No trades yet — log from a setup or click + Manual</div>}
      {closing && <CloseTradeModal trade={closing} onClose={()=>setClosing(null)} onSaved={load}/>}
    </div>
  );
}

// ─────────────────────────────────────────────
// ANALYTICS TAB (full — setup type, mistakes, streaks, equity)
// ─────────────────────────────────────────────
function AnalyticsTab() {
  const [stats, setStats] = useState<any>(null);
  const [view, setView] = useState<'overview'|'types'|'mistakes'|'sessions'>('overview');
  useEffect(() => {
    fetch('/api/analytics').then(r=>r.json()).then(d=>setStats(d.stats));
  }, []);

  if (!stats) return <div className="py-20 text-center text-xs text-zinc-600">Loading analytics…</div>;
  if (stats.total === 0) return <div className="py-20 text-center text-xs text-zinc-700">No closed trades yet — close trades to see analytics</div>;

  const tabs = ['overview','types','mistakes','sessions'] as const;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {tabs.map(t => <button key={t} onClick={()=>setView(t)} className={cx('px-3 py-1.5 rounded-lg text-xs border transition-all capitalize', view===t?'border-zinc-500 bg-zinc-800 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>{t}</button>)}
      </div>

      {view === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Win Rate', val: `${stats.winRate}%`, color: Number(stats.winRate) >= 50 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Total R', val: `${stats.totalR > 0 ? '+' : ''}${stats.totalR}R`, color: stats.totalR > 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Profit Factor', val: stats.profitFactor, color: Number(stats.profitFactor) >= 1.5 ? 'text-emerald-400' : 'text-yellow-400' },
              { label: 'Trades', val: stats.total, color: 'text-zinc-300' },
              { label: 'Avg Win', val: `+${stats.avgWin}R`, color: 'text-emerald-400' },
              { label: 'Avg Loss', val: `-${stats.avgLoss}R`, color: 'text-red-400' },
              { label: 'Best Streak', val: `${stats.maxWinStreak}W`, color: 'text-emerald-400' },
              { label: 'Worst Streak', val: `${stats.maxLossStreak}L`, color: 'text-red-400' },
            ].map(item => (
              <div key={item.label} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 text-center">
                <div className={cx('text-lg font-mono font-bold', item.color)}>{item.val}</div>
                <div className="text-xs text-zinc-600 mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>
          {stats.curve?.length > 1 && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
              <span className="text-xs text-zinc-600 block mb-3">Equity Curve (R)</span>
              <div className="flex items-end gap-0.5 h-16">
                {stats.curve.map((p: any, i: number) => {
                  const allR = stats.curve.map((x: any) => x.equity);
                  const min = Math.min(...allR), max = Math.max(...allR);
                  const range = max - min || 1;
                  const pct = ((p.equity - min) / range) * 100;
                  return <div key={i} title={`${p.date}: ${p.equity}R`} className={cx('flex-1 rounded-t-sm min-h-[2px]', p.equity >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60')} style={{ height: `${Math.max(4, pct)}%` }}/>;
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'types' && (
        <div className="space-y-2">
          <span className="text-xs text-zinc-600 block">Performance by setup type</span>
          {Object.entries(stats.byType as Record<string,{wins:number;losses:number;totalR:number}>)
            .sort((a,b)=>b[1].totalR-a[1].totalR)
            .map(([type, s]) => {
              const total = s.wins + s.losses;
              const wr = total > 0 ? ((s.wins/total)*100).toFixed(0) : 0;
              return (
                <div key={type} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-zinc-300">{type}</span>
                    <div className="flex gap-3 text-xs font-mono">
                      <span className="text-zinc-500">{total} trades</span>
                      <span className={Number(wr) >= 50 ? 'text-emerald-400' : 'text-red-400'}>{wr}% WR</span>
                      <span className={s.totalR >= 0 ? 'text-emerald-400' : 'text-red-400'}>{s.totalR >= 0 ? '+' : ''}{s.totalR.toFixed(1)}R</span>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${wr}%` }}/>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {view === 'mistakes' && (
        <div className="space-y-2">
          <span className="text-xs text-zinc-600 block">Most frequent mistakes</span>
          {Object.entries(stats.mistakeCounts as Record<string,number>)
            .sort((a,b)=>b[1]-a[1])
            .map(([m, count]) => {
              const max = Math.max(...Object.values(stats.mistakeCounts as Record<string,number>));
              return (
                <div key={m} className="rounded-xl border border-zinc-800/40 bg-zinc-900/30 p-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-sm text-zinc-400">{m}</span>
                    <span className="text-xs font-mono text-red-400">{count}×</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500/50 rounded-full" style={{ width: `${(count/max)*100}%` }}/>
                  </div>
                </div>
              );
            })}
          {Object.keys(stats.mistakeCounts).length === 0 && <p className="text-xs text-zinc-700 text-center py-8">No mistakes tagged yet — tag them when logging trades</p>}
        </div>
      )}

      {view === 'sessions' && (
        <div className="space-y-2">
          <span className="text-xs text-zinc-600 block">Performance by session</span>
          {Object.entries(stats.bySess as Record<string,{wins:number;losses:number;totalR:number}>)
            .sort((a,b)=>b[1].totalR-a[1].totalR)
            .map(([sess, s]) => {
              const total = s.wins + s.losses;
              const wr = total > 0 ? ((s.wins/total)*100).toFixed(0) : 0;
              return (
                <div key={sess} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 flex justify-between items-center">
                  <span className="text-sm text-zinc-300">{sess}</span>
                  <div className="flex gap-3 text-xs font-mono">
                    <span className="text-zinc-500">{total} trades</span>
                    <span className={Number(wr) >= 50 ? 'text-emerald-400' : 'text-red-400'}>{wr}% WR</span>
                    <span className={s.totalR >= 0 ? 'text-emerald-400' : 'text-red-400'}>{s.totalR >= 0 ? '+' : ''}{s.totalR.toFixed(1)}R</span>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// JOURNAL TAB (linked to trades)
// ─────────────────────────────────────────────
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
          <div>
            <label className="text-xs text-zinc-600 block mb-1">Date</label>
            <input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300"/>
          </div>
          <div>
            <label className="text-xs text-zinc-600 block mb-1">Session result</label>
            <select value={form.result} onChange={e=>setForm(p=>({...p,result:e.target.value}))} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300">
              <option value="">-</option>
              <option>Profitable</option><option>Break-even</option><option>Loss</option><option>No trade</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-zinc-600 block mb-1.5">Emotional state</label>
          <div className="flex flex-wrap gap-1.5">
            {emotions.map(e=><button key={e} onClick={()=>setForm(p=>({...p,emotion:e}))} className={cx('px-2.5 py-1 rounded-lg text-xs border transition-all', form.emotion===e?'border-zinc-500 bg-zinc-700 text-white':'border-zinc-800 text-zinc-600')}>{e}</button>)}
          </div>
        </div>
        <div>
          <label className="text-xs text-zinc-600 block mb-1">Title</label>
          <input value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="What happened today?" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"/>
        </div>
        <div>
          <label className="text-xs text-zinc-600 block mb-1">Notes</label>
          <textarea value={form.body} onChange={e=>setForm(p=>({...p,body:e.target.value}))} rows={4} placeholder="What did you see? What did you do? What should you do differently?" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 resize-none leading-relaxed"/>
        </div>
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
                </div>
              </div>
              <span className="text-zinc-700 text-xs">{open===e.id?'▲':'▼'}</span>
            </div>
            {open===e.id && e.body && <p className="mt-2 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">{e.body}</p>}
          </div>
        ))}
        {entries.length===0 && <div className="py-12 text-center text-xs text-zinc-700">No entries yet — write your first journal entry above</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// KNOWLEDGE TAB
// ─────────────────────────────────────────────
function KnowledgeTab() {
  const [articles, setArticles] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string|null>(null);
  useEffect(() => {
    const client = createClient('https://xavkbjbgmuasfkliptsh.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M');
    client.from('knowledge_base').select('*').order('source_episode').then(({data})=>setArticles(data??[]));
  }, []);
  const filtered = articles.filter(a => !q || a.title?.toLowerCase().includes(q.toLowerCase()) || a.content?.toLowerCase().includes(q.toLowerCase()) || a.tags?.some((t:string)=>t.toLowerCase().includes(q.toLowerCase())));
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
        {filtered.length===0 && articles.length===0 && <div className="py-12 text-center text-xs text-zinc-700">Loading articles…</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TELEGRAM SETTINGS
// ─────────────────────────────────────────────
function TelegramSettings({ onClose }: { onClose: ()=>void }) {
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [alerts, setAlerts] = useState({ sl:true, entry:true, tp:true, scan:true });

  useEffect(()=>{
    sb.from('telegram_config').select('*').single().then(({data})=>{
      if(data){ setToken(data.bot_token??''); setChatId(data.chat_id??''); setAlerts(data.alert_types??{sl:true,entry:true,tp:true,scan:true}); }
    });
  },[]);

  const save = async ()=>{
    await sb.from('telegram_config').upsert({ id:1, bot_token:token, chat_id:chatId, alert_types:alerts, updated_at:new Date().toISOString() },{ onConflict:'id' });
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
          <span className="text-sm font-bold text-white">🔔 Telegram Alerts</span>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400">✕</button>
        </div>
        <div className="text-xs text-zinc-600 bg-zinc-800/60 rounded-lg p-3 mb-4 space-y-1">
          <p>1. Message <span className="text-zinc-400">@BotFather</span> → /newbot → copy token</p>
          <p>2. Message <span className="text-zinc-400">@userinfobot</span> → copy your Chat ID</p>
          <p>3. Paste both below → Save → Test</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-600 block mb-1">Bot Token</label>
            <input value={token} onChange={e=>setToken(e.target.value)} placeholder="123456:ABC..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono"/>
          </div>
          <div>
            <label className="text-xs text-zinc-600 block mb-1">Chat ID</label>
            <input value={chatId} onChange={e=>setChatId(e.target.value)} placeholder="-100..." className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono"/>
          </div>
          <div>
            <label className="text-xs text-zinc-600 block mb-2">Alert types</label>
            <div className="grid grid-cols-2 gap-1.5">
              {[['sl','SL Hit 🔴'],['entry','Entry Zone 🟡'],['tp','TP Hit 🟢'],['scan','New Setup 🔵']].map(([k,label])=>(
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

// ─────────────────────────────────────────────
// BACKTEST TAB
// ─────────────────────────────────────────────
function BacktestTab() {
  const [sym, setSym] = useState('NQ');
  const [tf, setTf] = useState('1h');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const syms = ['NQ','ES','GC','BTC','ETH','EURUSD','SPY','QQQ'];
  const tfs = ['15m','1h','4h'];

  const run = async () => {
    setRunning(true); setResult(null);
    const r = await fetch('/api/backtest', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbol: sym, timeframe: tf }) });
    const d = await r.json();
    setResult(d); setRunning(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4 space-y-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">ICT Strategy Backtest</span>
        <div>
          <label className="text-xs text-zinc-600 block mb-2">Symbol</label>
          <div className="flex flex-wrap gap-1.5">{syms.map(s=><button key={s} onClick={()=>setSym(s)} className={cx('px-2.5 py-1.5 rounded-lg text-xs border transition-all', sym===s?'border-zinc-500 bg-zinc-700 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>{s}</button>)}</div>
        </div>
        <div>
          <label className="text-xs text-zinc-600 block mb-2">Timeframe</label>
          <div className="flex gap-1.5">{tfs.map(t=><button key={t} onClick={()=>setTf(t)} className={cx('px-2.5 py-1.5 rounded-lg text-xs border transition-all', tf===t?'border-zinc-500 bg-zinc-700 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>{t}</button>)}</div>
        </div>
        <button onClick={run} disabled={running} className="w-full py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm text-white disabled:opacity-50">{running?'⟳ Running ICT backtest…':'Run Backtest'}</button>
      </div>

      {result && (
        <div className="space-y-3">
          {result.error ? <div className="text-xs text-red-400 p-3 bg-red-900/20 rounded-xl">{result.error}</div> : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label:'Win Rate', val:`${result.winRate ?? 0}%`, color: (result.winRate??0)>=50?'text-emerald-400':'text-red-400' },
                  { label:'Total R', val:`${(result.totalR??0)>0?'+':''}${result.totalR??0}R`, color: (result.totalR??0)>0?'text-emerald-400':'text-red-400' },
                  { label:'Trades', val:result.totalTrades??0, color:'text-zinc-300' },
                  { label:'Profit Factor', val:result.profitFactor??0, color:(result.profitFactor??0)>=1.5?'text-emerald-400':'text-yellow-400' },
                  { label:'Avg Win', val:`+${result.avgWin??0}R`, color:'text-emerald-400' },
                  { label:'Avg Loss', val:`-${result.avgLoss??0}R`, color:'text-red-400' },
                ].map(item=>(
                  <div key={item.label} className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 text-center">
                    <div className={cx('text-lg font-mono font-bold', item.color)}>{item.val}</div>
                    <div className="text-xs text-zinc-600 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
              {result.trades?.length > 0 && (
                <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
                  <span className="text-xs text-zinc-600 block mb-2">Sample trades</span>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {result.trades.slice(0,20).map((t: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs font-mono">
                        <span className="text-zinc-500">{t.type}</span>
                        <span className={t.r >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t.r >= 0 ? '+' : ''}{t.r}R</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>('Markets');
  const [mktTab, setMktTab] = useState<MkTab>('Futures');
  const [setups, setSetups] = useState<Setup[]>([]);
  const [prices, setPrices] = useState<Prices>({ NQ:null, ES:null, GC:null, DXY:null, VIX:null });
  const [kz, setKz] = useState<{nyTime:string;active:{name:string;short:string;color:string}|null}|null>(null);
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
  const firedAlerts = useRef<Set<string>>(new Set());

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
    try {
      const r = await fetch('/api/prices', {cache:'no-store'});
      const d = await r.json();
      if (d.prices) setPrices(d.prices);
    } catch {}
  }, []);

  const loadKz = useCallback(async () => {
    try { const r = await fetch('/api/killzone',{cache:'no-store'}); const d = await r.json(); setKz(d); } catch {}
  }, []);

  const loadCal = useCallback(async () => {
    try { const r = await fetch('/api/calendar',{cache:'no-store'}); const d = await r.json(); setCalEvents(d.events??[]); } catch {}
  }, []);

  useEffect(() => {
    loadPrices(); loadKz(); loadCal();
    const pi = setInterval(loadPrices, 15000);
    const ki = setInterval(loadKz, 60000);
    const ci = setInterval(loadCal, 300000);
    return () => { clearInterval(pi); clearInterval(ki); clearInterval(ci); };
  }, [loadPrices, loadKz, loadCal]);

  // SMT badge check
  useEffect(() => {
    sb.from('smt_signals').select('id').gte('detected_at', new Date(Date.now()-4*60*60*1000).toISOString()).then(({data})=>setSmtBadge(data?.length??0));
  }, []);

  // In-browser SL/entry alerts
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

  const TABS: Tab[] = ['Markets','Setups','Trades','Analytics','Journal','Knowledge'];
  const MKT_TABS: MkTab[] = ['Futures','Crypto','Forex','Stocks','Institutional'];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200" style={{fontFamily:'ui-monospace,SFMono-Regular,monospace'}}>

      {/* TOASTS */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map(a => (
          <div key={a.id} className={cx('px-3 py-2 rounded-xl text-xs border shadow-xl backdrop-blur',
            a.type==='r'?'bg-red-900/90 border-red-700 text-red-200':
            a.type==='g'?'bg-emerald-900/90 border-emerald-700 text-emerald-200':
            'bg-zinc-800/90 border-zinc-600 text-zinc-200')}>{a.msg}
          </div>
        ))}
      </div>

      {/* HEADER */}
      <header className="border-b border-zinc-800/60 px-4 py-2 flex items-center justify-between sticky top-0 bg-zinc-950/95 backdrop-blur-sm z-40 gap-2">
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-bold tracking-widest text-white">VECTOR</span>
          <div className={cx('w-1.5 h-1.5 rounded-full', prices.NQ ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700')}/>
          {kz && (
            <span className="text-xs hidden sm:flex items-center gap-1.5">
              {kz.active
                ? <span className={cx('font-semibold', kz.active.color==='yellow'?'text-yellow-400':kz.active.color==='green'?'text-emerald-400':'text-blue-400')}>{kz.active.short}</span>
                : <span className="text-zinc-700">OFF</span>}
              <span className="text-zinc-700">{kz.nyTime}</span>
            </span>
          )}
          {dangerNews && <span className="text-xs text-red-400 animate-pulse font-semibold hidden sm:block">⚠ NEWS</span>}
          {nextEvent && !dangerNews && <span className="text-xs text-zinc-600 hidden sm:block">{nextEvent.name} {nextEvent.diffMin != null ? `${nextEvent.diffMin}m` : ''}</span>}
        </div>

        <div className="flex items-center gap-3 overflow-x-auto flex-1 justify-center">
          {(['NQ','ES','GC','DXY','VIX'] as const).map(s => (
            <span key={s} className="text-xs shrink-0 font-mono">
              <span className="text-zinc-600">{s} </span>
              <span className="text-zinc-300">{s==='DXY'?pFmt(s,3):s==='VIX'?pFmt(s,2):pFmt(s,1)}</span>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={()=>setShowTelegram(true)} title="Telegram alerts" className="text-zinc-600 hover:text-zinc-300 text-lg leading-none">🔔</button>
          <button onClick={()=>setShowScan(true)} className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:border-zinc-500 transition-colors">Scan</button>
        </div>
      </header>

      {/* MAIN NAV */}
      <nav className="border-b border-zinc-800/60 px-4 flex overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={()=>setTab(t)} className={cx('px-4 py-2.5 text-xs border-b-2 transition-all whitespace-nowrap',
            tab===t?'border-zinc-400 text-zinc-200':'border-transparent text-zinc-600 hover:text-zinc-400')}>
            {t}{t==='Setups'&&setups.length>0?` ·${setups.length}`:''}
          </button>
        ))}
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-4">

        {/* ── MARKETS TAB ── */}
        {tab === 'Markets' && (
          <div className="space-y-3">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {MKT_TABS.map(t => (
                <button key={t} onClick={()=>setMktTab(t)} className={cx('px-3 py-1.5 rounded-lg text-xs border transition-all whitespace-nowrap',
                  mktTab===t?'bg-zinc-800 border-zinc-600 text-white':'border-zinc-800 text-zinc-600 hover:border-zinc-700')}>
                  {t}{t==='Futures'&&smtBadge>0?` (${smtBadge} SMT)`:''}
                </button>
              ))}
            </div>

            {mktTab === 'Futures' && (
              <div className="space-y-3">
                <WeeklyBiasPanel/>
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

        {/* ── SETUPS TAB ── */}
        {tab === 'Setups' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-600 uppercase tracking-wider">Active Setups · {setups.length}</span>
              <button onClick={()=>setShowScan(true)} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:border-zinc-500">+ Scan</button>
            </div>
            {calEvents.some(e=>e.isDangerZone) && (
              <div className="rounded-xl border border-red-800/50 bg-red-900/20 px-3 py-2 text-xs text-red-300">
                ⚠ High-impact news active — trading risk elevated. Check calendar before entering.
              </div>
            )}
            {setups.length === 0 ? (
              <div className="text-center py-20 space-y-3">
                <p className="text-zinc-600 text-sm">No setups — run a scan to detect ICT setups</p>
                <button onClick={()=>setShowScan(true)} className="px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:border-zinc-500">Scan Market</button>
              </div>
            ) : (
              <div className="space-y-2">
                {setups.map(s => (
                  <div key={s.id}>
                    <SetupCard s={s} prices={prices} onDelete={deleteSetup}
                      onAnalyze={s=>{setSelected(s);setShowAnalysis(true);}}
                      onTrade={s=>{setTradingSetup(s);setShowTrade(true);}}
                      selected={selected?.id===s.id}
                      onSelect={s=>{setSelected(s);setShowAnalysis(false);}}
                    />
                    {showAnalysis && selected?.id === s.id && (
                      <AnalysisPanel setup={s} prices={prices} onClose={()=>setShowAnalysis(false)}/>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TRADES TAB ── */}
        {tab === 'Trades' && <TradesTab onNew={()=>setShowManualTrade(true)}/>}

        {/* ── ANALYTICS TAB ── */}
        {tab === 'Analytics' && <AnalyticsTab/>}

        {/* ── JOURNAL TAB ── */}
        {tab === 'Journal' && <JournalTab/>}

        {/* ── KNOWLEDGE TAB ── */}
        {tab === 'Knowledge' && <KnowledgeTab/>}

      </main>

      {/* MODALS */}
      {showScan && <ScanModal prices={prices} onClose={()=>setShowScan(false)} onDone={()=>{setShowScan(false);loadSetups();setTab('Setups');}}/>}
      {showTelegram && <TelegramSettings onClose={()=>setShowTelegram(false)}/>}
      {showTrade && tradingSetup && <TradeModal setup={tradingSetup} onClose={()=>{setShowTrade(false);setTradingSetup(null);}} onSaved={()=>{}}/>}
      {showManualTrade && <TradeModal setup={null} onClose={()=>setShowManualTrade(false)} onSaved={()=>{}}/>}
    </div>
  );
}
