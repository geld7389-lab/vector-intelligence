'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── TYPES ──────────────────────────────────────────────────────────────
interface Setup {
  id: string; symbol: string; timeframe: string; direction: string;
  setup_type: string; entry_low: number; entry_high: number;
  stop_loss: number; target: number; rr_ratio: number;
  confluence_score: number; status: string; dol_target: string;
  ai_analysis: string; created_at: string; htf_bias: string;
  cisd_confirmed: boolean; volume_context: string; killzone_valid: string;
  correlated_align: boolean; expires_at: string; invalidated_reason: string;
}
interface Trade {
  id: string; symbol: string; direction: string; entry_price: number;
  stop_loss: number; take_profit: number; result: string; rr_achieved: number;
  notes: string; opened_at: string; session: string; pnl: number;
}
interface KBArticle {
  id: string; title: string; content: string; category: string;
  source_episode: string; tags: string[]; is_user_note: boolean; user_reviewed: boolean;
}
interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number; }
interface Prices { NQ: number|null; ES: number|null; GC: number|null; DXY: number|null; VIX: number|null; }
interface KZData {
  nyTime: string;
  active: { name: string; short: string; color: string; description: string } | null;
  upcoming: { name: string; short: string; color: string; minsAway: number }[];
  probability: string; shouldTrade: boolean; isLunch: boolean; isWeekend: boolean;
}
interface NewsEvent {
  date: string; time: string; name: string; impact: string;
  isToday: boolean; minutesAway: number | null; isDangerZone: boolean;
}
interface SMTSignal {
  type: string; description: string; nq_price: number; es_price: number;
  nq_swing: string; es_swing: string; strength: string; timeframe: string;
  detected_at?: string; divergence_type?: string;
}
interface WeekBias {
  id: string; week_start: string; symbol: string; bias: string;
  amd_phase: string; htf_draw: string; pd_array_in_play: string; notes: string;
}
interface BacktestRun {
  id: string; name: string; symbol: string; timeframe: string;
  total_trades: number; wins: number; losses: number; win_rate: number;
  total_pnl: number; max_drawdown: number; sharpe_ratio: number;
  profit_factor: number; expectancy: number; avg_rr: number;
  max_consecutive_losses: number; created_at: string;
}
interface LiveSetup extends Setup {
  realScore: number; isExpired: boolean; slBreached: boolean;
  inEntryZone: boolean; priceAlert: string | null;
}

const TABS = ['Dashboard','Chart','Scanner','MMXM','Analytics','Backtest','Journal','Knowledge'] as const;
type Tab = typeof TABS[number];

function fmt(n: number|string|null|undefined, d = 2) {
  const x = Number(n); return isNaN(x) ? '—' : x.toFixed(d);
}
function dirColor(d: string) {
  return d === 'bull' || d === 'long' ? 'text-green-400' : d === 'bear' || d === 'short' ? 'text-red-400' : 'text-yellow-400';
}
function calcRealScore(s: Setup, kz: KZData | null, news: NewsEvent[]): number {
  let sc = s.confluence_score;
  if (news.some(e => e.isDangerZone)) return Math.max(0, sc - 40);
  const kzV = (s.killzone_valid || 'any').split(',');
  const aKz = kz?.active?.short ?? '';
  if (!kzV.includes('any') && !kzV.includes(aKz)) sc -= 25;
  if (kz?.isLunch) sc -= 20;
  if ((s.htf_bias === 'bearish' && (s.direction === 'bull' || s.direction === 'long')) ||
      (s.htf_bias === 'bullish' && (s.direction === 'bear' || s.direction === 'short'))) sc -= 20;
  if (!s.cisd_confirmed) sc -= 10;
  if (s.volume_context === 'low') sc -= 10;
  if (!s.correlated_align) sc -= 15;
  if (s.expires_at && new Date(s.expires_at) < new Date()) sc = 0;
  return Math.max(0, Math.min(100, sc));
}

function ScoreRing({ score, base }: { score: number; base: number }) {
  const r = 14, circ = 2 * Math.PI * r, fill = (score / 100) * circ;
  const color = score >= 70 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  const delta = score - base;
  return (
    <div className="relative flex items-center justify-center w-10 h-10 shrink-0">
      <svg width="40" height="40" className="-rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="#1f2937" strokeWidth="3"/>
        <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"/>
      </svg>
      <div className="absolute text-center">
        <div className="text-xs font-bold leading-none" style={{ color }}>{score}</div>
        <div className={`text-xs leading-none ${delta >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {delta >= 0 ? '+' : ''}{delta}
        </div>
      </div>
    </div>
  );
}

function KZBadge({ kz }: { kz: KZData | null }) {
  if (!kz) return <span className="text-gray-600 text-xs">–</span>;
  if (kz.active) return (
    <span className="text-xs px-2 py-0.5 rounded font-bold animate-pulse"
      style={{ color: kz.active.color, background: kz.active.color + '20', border: `1px solid ${kz.active.color}40` }}>
      {kz.active.short} · {kz.probability}
    </span>
  );
  const next = kz.upcoming[0];
  return <span className="text-gray-500 text-xs px-2 py-0.5 rounded bg-gray-800">{next ? `${next.short} in ${next.minsAway}m` : 'OFF HOURS'} · DEAD</span>;
}

// ── CANVAS CHART ───────────────────────────────────────────────────────
function CandleChart({ symbol, tf, setup }: { symbol: string; tf: string; setup: Setup | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/candles?symbol=${symbol}&tf=${tf}`, { cache: 'no-store' });
      const d = await r.json();
      setCandles(d.candles ?? []);
    } catch {}
    setLoading(false);
  }, [symbol, tf]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  useEffect(() => {
    if (!candles.length || !canvasRef.current) return;
    const canvas = canvasRef.current, ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const PL = 72, PR = 8, PT = 20, PB = 28, chartW = W - PL - PR, chartH = H - PT - PB - 50, volH = 40;
    ctx.clearRect(0, 0, W, H);
    const prices = candles.map(c => [c.l, c.h]).flat();
    let minP = Math.min(...prices), maxP = Math.max(...prices);
    if (setup) [setup.entry_low, setup.entry_high, setup.stop_loss, setup.target].forEach(l => {
      if (l < minP) minP = l; if (l > maxP) maxP = l;
    });
    const pad = (maxP - minP) * 0.08; minP -= pad; maxP += pad;
    const pY = (p: number) => PT + chartH - ((p - minP) / (maxP - minP)) * chartH;
    const maxVol = Math.max(...candles.map(c => c.v ?? 0));
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 6; i++) {
      const y = PT + (chartH / 6) * i;
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
      const price = maxP - ((maxP - minP) / 6) * i;
      ctx.fillStyle = '#4b5563'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(price.toFixed(1), PL - 3, y + 3);
    }
    if (setup) {
      const ey1 = pY(setup.entry_high), ey2 = pY(setup.entry_low);
      ctx.fillStyle = 'rgba(34,197,94,0.07)'; ctx.fillRect(PL, ey1, chartW, ey2 - ey1);
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.strokeRect(PL, ey1, chartW, ey2 - ey1); ctx.setLineDash([]);
      ctx.fillStyle = '#22c55e'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`ENTRY ${fmt(setup.entry_low)}-${fmt(setup.entry_high)}`, PL + 4, ey1 - 3);
      const sly = pY(setup.stop_loss);
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(PL, sly); ctx.lineTo(W - PR, sly); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#ef4444'; ctx.textAlign = 'right';
      ctx.fillText(`SL ${fmt(setup.stop_loss)}`, W - PR - 2, sly - 3);
      const tpy = pY(setup.target);
      ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(PL, tpy); ctx.lineTo(W - PR, tpy); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#3b82f6'; ctx.textAlign = 'right';
      ctx.fillText(`TP ${fmt(setup.target)}`, W - PR - 2, tpy - 3);
    }
    const cw = Math.max(2, Math.min(14, chartW / candles.length - 1)), gap = chartW / candles.length;
    candles.forEach((c, i) => {
      const x = PL + i * gap + gap / 2, bull = c.c >= c.o, color = bull ? '#22c55e' : '#ef4444';
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, pY(c.h)); ctx.lineTo(x, pY(c.l)); ctx.stroke();
      const oy = pY(Math.max(c.o, c.c)), cy2 = pY(Math.min(c.o, c.c)), bodyH = Math.max(1, cy2 - oy);
      ctx.fillStyle = hovered === i ? (bull ? '#86efac' : '#fca5a5') : color;
      ctx.fillRect(x - cw / 2, oy, cw, bodyH);
      if (c.v && maxVol > 0) {
        const vh = (c.v / maxVol) * volH;
        ctx.fillStyle = bull ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';
        ctx.fillRect(x - cw / 2, PT + chartH + 10 + volH - vh, cw, vh);
      }
    });
    if (hovered !== null && candles[hovered]) {
      const c = candles[hovered], x = PL + hovered * gap + gap / 2, tx = Math.min(x, W - 120);
      ctx.fillStyle = 'rgba(17,24,39,0.95)'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
      ctx.beginPath();
      (ctx as CanvasRenderingContext2D & { roundRect(x:number,y:number,w:number,h:number,r:number):void }).roundRect(tx - 2, PT + 2, 110, 60, 4);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9ca3af'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
      const d = new Date(c.t * 1000);
      ctx.fillText(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), tx + 4, PT + 13);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillText(`O:${c.o.toFixed(1)} H:${c.h.toFixed(1)}`, tx + 4, PT + 25);
      ctx.fillText(`L:${c.l.toFixed(1)} C:${c.c.toFixed(1)}`, tx + 4, PT + 37);
      if (c.v) ctx.fillText(`Vol:${(c.v / 1000).toFixed(1)}K`, tx + 4, PT + 49);
    }
    if (candles.length > 0) {
      const last = candles[candles.length - 1], ly = pY(last.c);
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(PL, ly); ctx.lineTo(W - PR, ly); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#f59e0b'; ctx.textAlign = 'right';
      ctx.fillText(last.c.toFixed(1), W - PR - 2, ly - 3);
    }
  }, [candles, hovered, setup]);

  const onMM = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !candles.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, PL = 72, chartW = canvasRef.current.width - 80;
    const gap = chartW / candles.length, idx = Math.floor((x - PL) / gap);
    setHovered(idx >= 0 && idx < candles.length ? idx : null);
  };

  if (loading) return <div className="flex items-center justify-center h-full text-gray-600 text-xs">Loading candles...</div>;
  return <canvas ref={canvasRef} width={900} height={420} className="w-full h-full cursor-crosshair" onMouseMove={onMM} onMouseLeave={() => setHovered(null)}/>;
}

// ── RISK MODAL ─────────────────────────────────────────────────────────
function RiskModal({ setup, onClose }: { setup: Setup; onClose: () => void }) {
  const [acc, setAcc] = useState('25000');
  const [rPct, setRPct] = useState('1');
  const a = parseFloat(acc) || 0, rAmt = a * (parseFloat(rPct) / 100);
  const ptV = setup.symbol === 'NQ' ? 20 : 50;
  const slPts = Math.abs((setup.entry_low + setup.entry_high) / 2 - setup.stop_loss);
  const slD = slPts * ptV, contracts = slD > 0 ? Math.floor(rAmt / slD) : 0;
  const aRisk = contracts * slD;
  const tpPts = Math.abs(setup.target - (setup.entry_low + setup.entry_high) / 2);
  const profit = contracts * tpPts * ptV;
  const margin = (setup.symbol === 'NQ' ? 17000 : 13000) * contracts;
  const inp = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-96" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between mb-3">
          <span className="text-white font-bold text-sm">Risk Calculator — {setup.symbol} {setup.setup_type}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-red-400">x</button>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div><label className="text-gray-500 text-xs block mb-0.5">Account ($)</label><input value={acc} onChange={e => setAcc(e.target.value)} className={inp}/></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Risk %</label><input value={rPct} onChange={e => setRPct(e.target.value)} className={inp}/></div>
        </div>
        <div className="bg-gray-800 rounded p-3 space-y-1.5 text-xs mb-3">
          <div className="flex justify-between"><span className="text-gray-500">Entry Zone</span><span>{fmt(setup.entry_low)} - {fmt(setup.entry_high)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Stop Loss</span><span className="text-red-400">{fmt(setup.stop_loss)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Target</span><span className="text-green-400">{fmt(setup.target)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">SL Distance</span><span>{slPts.toFixed(1)} pts (${slD.toFixed(0)}/ct)</span></div>
          <div className="border-t border-gray-700 pt-1.5">
            <div className="flex justify-between"><span className="text-blue-400 font-bold">Contracts</span><span className="text-white font-bold text-base">{contracts}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">$ at Risk</span><span className="text-red-400">${aRisk.toFixed(0)}</span></div>
            <div className="flex justify-between"><span className="text-green-500">Target Profit</span><span className="text-green-400">${profit.toFixed(0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">R:R</span><span className="text-blue-400">{fmt(setup.rr_ratio, 1)}R</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Margin Est.</span><span className="text-yellow-400">${margin.toLocaleString()}</span></div>
          </div>
        </div>
        <div className={`text-xs text-center rounded p-1.5 font-bold ${contracts > 0 ? 'text-green-400 bg-green-900/20' : 'text-yellow-400 bg-yellow-900/20'}`}>
          {contracts > 0 ? `TRADE ${contracts} CONTRACT${contracts > 1 ? 'S' : ''} - RISK $${aRisk.toFixed(0)} - TARGET $${profit.toFixed(0)}` : 'Account too small or SL too wide'}
        </div>
      </div>
    </div>
  );
}

// ── NEW SETUP MODAL ────────────────────────────────────────────────────
function NewSetupModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    symbol: 'NQ', timeframe: '15m', direction: 'bull', setup_type: 'OB + FVG',
    entry_low: '', entry_high: '', stop_loss: '', target: '',
    dol_target: 'BSL at 29800', htf_bias: 'bullish', cisd_confirmed: false,
    volume_context: 'medium', killzone_valid: 'NY,SB', status: 'watching',
    confluence_score: '70', correlated_align: true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const upd = (k: string, v: string | boolean) => setF(p => ({ ...p, [k]: v }));
  const rrCalc = () => {
    const el = parseFloat(f.entry_low), eh = parseFloat(f.entry_high);
    const sl = parseFloat(f.stop_loss), tp = parseFloat(f.target);
    if (!el || !eh || !sl || !tp) return null;
    const entry = (el + eh) / 2, risk = Math.abs(entry - sl), reward = Math.abs(tp - entry);
    return risk > 0 ? (reward / risk).toFixed(1) : null;
  };
  const save = async () => {
    if (!f.entry_low || !f.stop_loss || !f.target) { setErr('Entry, SL, Target required'); return; }
    setSaving(true); setErr('');
    const expires = new Date(Date.now() + (f.status === 'active' ? 1 : 3) * 24 * 60 * 60 * 1000).toISOString();
    try {
      const r = await fetch('/api/setups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: f.symbol, timeframe: f.timeframe, direction: f.direction,
          setup_type: f.setup_type, entry_low: parseFloat(f.entry_low),
          entry_high: parseFloat(f.entry_high || f.entry_low), stop_loss: parseFloat(f.stop_loss),
          target: parseFloat(f.target), dol_target: f.dol_target, htf_bias: f.htf_bias,
          cisd_confirmed: f.cisd_confirmed, volume_context: f.volume_context,
          killzone_valid: f.killzone_valid, status: f.status,
          confluence_score: parseInt(f.confluence_score), correlated_align: f.correlated_align,
          rr_ratio: parseFloat(rrCalc() ?? '0'), expires_at: expires, ai_analysis: '', invalidated_reason: '' }),
      });
      const d = await r.json();
      if (d.error) throw new Error(JSON.stringify(d.error));
      onSaved(); onClose();
    } catch (e) { setErr(String(e)); }
    setSaving(false);
  };
  const inp = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";
  const sel = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-full max-w-lg max-h-screen overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <span className="text-white font-bold text-sm">+ New Setup</span>
          <button onClick={onClose} className="text-gray-500 hover:text-red-400">x</button>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div><label className="text-gray-500 text-xs block mb-0.5">Symbol</label><select className={sel} value={f.symbol} onChange={e => upd('symbol', e.target.value)}><option>NQ</option><option>ES</option></select></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">TF</label><select className={sel} value={f.timeframe} onChange={e => upd('timeframe', e.target.value)}><option>15m</option><option>1H</option><option>4H</option><option>D</option></select></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Direction</label><select className={sel} value={f.direction} onChange={e => upd('direction', e.target.value)}><option value="bull">Bull</option><option value="bear">Bear</option></select></div>
        </div>
        <div className="mb-2"><label className="text-gray-500 text-xs block mb-0.5">Setup Type</label><input className={inp} value={f.setup_type} onChange={e => upd('setup_type', e.target.value)}/></div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className="text-gray-500 text-xs block mb-0.5">Entry Low</label><input className={inp} type="number" value={f.entry_low} onChange={e => upd('entry_low', e.target.value)}/></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Entry High</label><input className={inp} type="number" value={f.entry_high} onChange={e => upd('entry_high', e.target.value)}/></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Stop Loss</label><input className={inp} type="number" value={f.stop_loss} onChange={e => upd('stop_loss', e.target.value)}/></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Target</label><input className={inp} type="number" value={f.target} onChange={e => upd('target', e.target.value)}/></div>
        </div>
        <div className="mb-2"><label className="text-gray-500 text-xs block mb-0.5">DOL</label><input className={inp} value={f.dol_target} onChange={e => upd('dol_target', e.target.value)}/></div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div><label className="text-gray-500 text-xs block mb-0.5">HTF Bias</label><select className={sel} value={f.htf_bias} onChange={e => upd('htf_bias', e.target.value)}><option value="bullish">Bullish</option><option value="bearish">Bearish</option><option value="neutral">Neutral</option></select></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Volume</label><select className={sel} value={f.volume_context} onChange={e => upd('volume_context', e.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Status</label><select className={sel} value={f.status} onChange={e => upd('status', e.target.value)}><option value="watching">Watching</option><option value="active">Active</option></select></div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className="text-gray-500 text-xs block mb-0.5">Score (0-100)</label><input className={inp} type="number" value={f.confluence_score} onChange={e => upd('confluence_score', e.target.value)}/></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Killzones (NY,SB or any)</label><input className={inp} value={f.killzone_valid} onChange={e => upd('killzone_valid', e.target.value)}/></div>
        </div>
        <div className="flex gap-4 mb-3 text-xs">
          <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer"><input type="checkbox" checked={f.cisd_confirmed} onChange={e => upd('cisd_confirmed', e.target.checked)} className="accent-blue-500"/>CISD Confirmed</label>
          <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer"><input type="checkbox" checked={f.correlated_align} onChange={e => upd('correlated_align', e.target.checked)} className="accent-blue-500"/>Correlated Aligned</label>
        </div>
        {rrCalc() && <div className="text-center text-blue-400 text-xs mb-2 bg-blue-900/20 rounded p-1.5">R:R = {rrCalc()}</div>}
        {err && <div className="text-red-400 text-xs mb-2 bg-red-900/20 rounded p-1.5">{err}</div>}
        <button onClick={save} disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-2 rounded font-bold">{saving ? 'Saving...' : 'Save Setup'}</button>
      </div>
    </div>
  );
}

// ── AUTO SCAN MODAL ────────────────────────────────────────────────────
function AutoScanModal({ prices, kz, onClose, onSaved }: { prices: Prices; kz: KZData | null; onClose: () => void; onSaved: () => void }) {
  const [syms, setSyms] = useState<string[]>(['NQ', 'ES']);
  const [tfs, setTfs] = useState<string[]>(['15m', '1h']);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ message: string; count: number; setups: Setup[] } | null>(null);
  const [error, setError] = useState('');
  const togS = (s: string) => setSyms(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  const togT = (t: string) => setTfs(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const scan = async () => {
    if (!syms.length || !tfs.length) return;
    setLoading(true); setResult(null); setError('');
    try {
      const r = await fetch('/api/autoscan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: syms, timeframes: tfs, currentPrices: prices }) });
      const d = await r.json();
      if (d.error) setError(typeof d.error === 'string' ? d.error : JSON.stringify(d.error));
      else setResult(d);
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-[420px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <span className="text-white font-bold text-sm">Auto-Scan — Find New Setups</span>
          <button onClick={onClose} className="text-gray-500 hover:text-red-400">x</button>
        </div>
        <div className="grid grid-cols-2 gap-2 bg-gray-800 rounded p-2 text-xs mb-3">
          {(['NQ','ES','GC','DXY'] as const).map(s => <div key={s} className="flex justify-between"><span className="text-gray-500">{s}</span><span className="text-white font-bold">{prices[s]?.toFixed(s === 'DXY' ? 3 : 1) ?? '—'}</span></div>)}
          {kz?.active && <div className="col-span-2 text-center" style={{ color: kz.active.color }}>{kz.active.name} — {kz.probability}</div>}
          {!kz?.active && kz?.upcoming[0] && <div className="col-span-2 text-center text-gray-600">Next: {kz.upcoming[0].name} in {kz.upcoming[0].minsAway}m</div>}
        </div>
        <div className="mb-2"><div className="text-gray-500 text-xs mb-1">Symbols:</div><div className="flex gap-2">{['NQ','ES'].map(s => <button key={s} onClick={() => togS(s)} className={`text-xs px-4 py-1.5 rounded border transition-colors ${syms.includes(s) ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>{s} {prices[s as keyof Prices]?.toFixed(0)}</button>)}</div></div>
        <div className="mb-3"><div className="text-gray-500 text-xs mb-1">Timeframes:</div><div className="flex gap-2">{['15m','1h','4h'].map(t => <button key={t} onClick={() => togT(t)} className={`text-xs px-4 py-1.5 rounded border transition-colors ${tfs.includes(t) ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>{t}</button>)}</div></div>
        <div className="text-gray-600 text-xs mb-3 bg-gray-800 rounded p-2">
          Scans {syms.length} symbol{syms.length !== 1 ? 's' : ''} x {tfs.length} timeframe{tfs.length !== 1 ? 's' : ''}. Detects FVG retests, OB sweeps, CISD displacement. Min R:R 2.0.
        </div>
        <button onClick={scan} disabled={loading || !syms.length || !tfs.length} className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-700 text-white text-sm py-2.5 rounded font-bold mb-3">
          {loading ? 'Scanning...' : 'Scan Market Now'}
        </button>
        {error && <div className="text-red-400 text-xs bg-red-900/20 rounded p-2 mb-2">{error}</div>}
        {result && (
          <div className={`rounded p-2 mb-2 text-xs ${result.count > 0 ? 'bg-green-900/20 border border-green-800' : 'bg-yellow-900/20 border border-yellow-800'}`}>
            <div className={`font-bold mb-2 ${result.count > 0 ? 'text-green-400' : 'text-yellow-400'}`}>{result.count > 0 ? 'FOUND: ' : 'NOTE: '}{result.message}</div>
            {result.setups?.map((s, i) => (
              <div key={i} className="bg-gray-800 rounded p-2 mb-1">
                <div className="flex justify-between mb-0.5">
                  <span className="text-white font-bold">{s.symbol} {s.timeframe}</span>
                  <span className={`text-xs px-1 rounded ${s.direction === 'bull' ? 'text-green-400 bg-green-900/40' : 'text-red-400 bg-red-900/40'}`}>{s.direction?.toUpperCase()}</span>
                </div>
                <div className="text-blue-300">{s.setup_type}</div>
                <div className="flex gap-3 text-xs mt-0.5">
                  <span className="text-gray-400">E:{fmt(s.entry_low)}-{fmt(s.entry_high)}</span>
                  <span className="text-red-400">SL:{fmt(s.stop_loss)}</span>
                  <span className="text-green-400">TP:{fmt(s.target)}</span>
                  <span className="text-blue-400">{fmt(s.rr_ratio,1)}R</span>
                </div>
              </div>
            ))}
            {result.count > 0 && <button onClick={() => { onSaved(); onClose(); }} className="w-full mt-1 bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 rounded">View in Dashboard</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MMXM TAB ───────────────────────────────────────────────────────────
function MMXMTab({ prices, kz }: { prices: Prices; kz: KZData | null }) {
  const [biases, setBiases] = useState<WeekBias[]>([]);
  const [smtData, setSmtData] = useState<{ signals: SMTSignal[]; recent: SMTSignal[] }>({ signals: [], recent: [] });
  const [currentWeek, setCurrentWeek] = useState('');
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState({ symbol: 'NQ', bias: 'bullish', amd_phase: 'accumulation', htf_draw: '', pd_array_in_play: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const inp = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";

  useEffect(() => {
    fetch('/api/weekbias').then(r => r.json()).then(d => { setBiases(d.biases ?? []); setCurrentWeek(d.currentWeek ?? ''); });
    fetch('/api/smt').then(r => r.json()).then(d => setSmtData({ signals: d.signals ?? [], recent: d.recent ?? [] }));
  }, []);

  const scanSMT = async () => {
    setScanning(true);
    const r = await fetch('/api/smt');
    const d = await r.json();
    setSmtData({ signals: d.signals ?? [], recent: d.recent ?? [] });
    setScanning(false);
  };

  const saveBias = async () => {
    setSaving(true);
    await fetch('/api/weekbias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, week_start: currentWeek }) });
    const r = await fetch('/api/weekbias');
    const d = await r.json();
    setBiases(d.biases ?? []);
    setSaving(false);
  };

  const phases = ['accumulation','manipulation','distribution','reaccumulation','redistribution'];

  return (
    <div className="flex flex-col gap-3 overflow-y-auto h-full pb-4">
      <div className="bg-gray-900 border border-gray-800 rounded p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-500 text-xs uppercase tracking-wider">SMT Divergence — NQ vs ES (15m)</span>
          <button onClick={scanSMT} disabled={scanning} className="text-xs px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded">{scanning ? 'Scanning...' : 'Scan Now'}</button>
        </div>
        {smtData.signals.length > 0 ? smtData.signals.map((s, i) => (
          <div key={i} className={`rounded p-2 mb-1 text-xs border ${s.type === 'bullish_smt' ? 'bg-green-900/20 border-green-800' : 'bg-red-900/20 border-red-800'}`}>
            <div className="flex justify-between mb-0.5">
              <span className={`font-bold ${s.type === 'bullish_smt' ? 'text-green-400' : 'text-red-400'}`}>{s.type === 'bullish_smt' ? 'BULLISH SMT' : 'BEARISH SMT'} - {s.strength?.toUpperCase()}</span>
              <span className="text-gray-500">{s.timeframe}</span>
            </div>
            <div className="text-gray-300">{s.description}</div>
            <div className="flex gap-4 mt-1 text-gray-500"><span>NQ: {s.nq_price?.toFixed(1)} ({s.nq_swing})</span><span>ES: {s.es_price?.toFixed(1)} ({s.es_swing})</span></div>
          </div>
        )) : <div className="text-gray-600 text-xs">No SMT divergence on current 15m data. Hit Scan Now to check.</div>}
        {smtData.recent.length > 0 && (
          <div className="mt-2">
            <div className="text-gray-600 text-xs mb-1">Recent history:</div>
            {smtData.recent.slice(0, 5).map((s, i) => (
              <div key={i} className="flex justify-between text-xs py-0.5 border-b border-gray-800">
                <span className={s.divergence_type === 'bullish_smt' ? 'text-green-400' : 'text-red-400'}>{s.divergence_type?.replace('_smt','').toUpperCase()} SMT</span>
                <span className="text-gray-600">{new Date(s.detected_at ?? '').toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded p-3">
        <div className="text-gray-500 text-xs uppercase mb-2 tracking-wider">Weekly Bias Builder — week of {currentWeek}</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {(['NQ','ES'] as const).map(sym => <button key={sym} onClick={() => setForm(p => ({ ...p, symbol: sym }))} className={`text-xs px-3 py-1 rounded ${form.symbol === sym ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>{sym}</button>)}
          {(['bullish','bearish','consolidation']).map(b => <button key={b} onClick={() => setForm(p => ({ ...p, bias: b }))} className={`text-xs px-3 py-1 rounded ml-1 ${form.bias === b ? (b === 'bullish' ? 'bg-green-700 text-white' : b === 'bearish' ? 'bg-red-700 text-white' : 'bg-yellow-700 text-white') : 'bg-gray-800 text-gray-400'}`}>{b}</button>)}
        </div>
        <div className="text-gray-500 text-xs mb-1">AMD Phase:</div>
        <div className="flex flex-wrap gap-1 mb-2">{phases.map(p => <button key={p} onClick={() => setForm(f => ({ ...f, amd_phase: p }))} className={`text-xs px-2 py-0.5 rounded ${form.amd_phase === p ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-400'}`}>{p}</button>)}</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className="text-gray-500 text-xs block mb-0.5">HTF Draw on Liquidity</label><input className={inp} value={form.htf_draw} onChange={e => setForm(p => ({ ...p, htf_draw: e.target.value }))} placeholder="e.g. Draw to 29800 BSL"/></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">PD Array in Play</label><input className={inp} value={form.pd_array_in_play} onChange={e => setForm(p => ({ ...p, pd_array_in_play: e.target.value }))} placeholder="e.g. Breaker at 29450"/></div>
        </div>
        <textarea className={inp + ' resize-none mb-2'} rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Why are you bullish/bearish this week? What is the narrative?"/>
        <button onClick={saveBias} disabled={saving} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-1.5 rounded font-bold">{saving ? 'Saving...' : 'Save Weekly Bias'}</button>
      </div>

      {biases.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded p-3">
          <div className="text-gray-500 text-xs uppercase mb-2 tracking-wider">Bias History</div>
          {biases.map(b => (
            <div key={b.id} className="border-b border-gray-800 py-2 last:border-0">
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-gray-500">{b.week_start} — {b.symbol}</span>
                <span className={`font-bold ${b.bias === 'bullish' ? 'text-green-400' : b.bias === 'bearish' ? 'text-red-400' : 'text-yellow-400'}`}>{b.bias?.toUpperCase()}</span>
              </div>
              <div className="text-xs text-blue-300">{b.amd_phase}{b.htf_draw ? ` — Draw: ${b.htf_draw}` : ''}</div>
              {b.notes && <div className="text-xs text-gray-500 mt-0.5">{b.notes}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded p-3">
        <div className="text-gray-500 text-xs uppercase mb-2 tracking-wider">AMD Model Reference</div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            ['Accumulation','Asia session. Price consolidates. Liquidity builds above and below range. No clear direction. This is where smart money positions.','#6366f1'],
            ['Manipulation','London open. Judas swing. Price sweeps one side of the range (SSL or BSL). Traps retail entries on the wrong side.','#f59e0b'],
            ['Distribution','NY session. The true directional move. Price delivers to the opposite DOL from where manipulation took out stops.','#22c55e'],
          ].map(([phase, desc, color]) => (
            <div key={phase} className="rounded p-2" style={{ background: color + '15', border: `1px solid ${color}30` }}>
              <div className="font-bold mb-1" style={{ color }}>{phase}</div>
              <div className="text-gray-400 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── ANALYTICS TAB ──────────────────────────────────────────────────────
function AnalyticsTab() {
  const [stats, setStats] = useState<{ totalTrades:number;wins:number;losses:number;winRate:number;totalPnl:number;avgWin:number;avgLoss:number;profitFactor:number;expectancy:number;maxDrawdown:number;maxConsecLoss:number } | null>(null);
  const [bySession, setBySession] = useState<{ session:string;trades:number;winRate:number;pnl:number }[]>([]);
  const [byDay, setByDay] = useState<{ day:string;trades:number;winRate:number;pnl:number }[]>([]);
  const [equityCurve, setEquityCurve] = useState<{ date:string;equity:number }[]>([]);
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [btForm, setBtForm] = useState({ symbol: 'NQ', timeframe: '15m', direction: 'bull', entryPct: '0.2', slPct: '0.15', tpPct: '0.5', name: 'NQ 15m Bull Test' });
  const [btRunning, setBtRunning] = useState(false);
  const [btResult, setBtResult] = useState<BacktestRun | null>(null);

  useEffect(() => {
    fetch('/api/analytics').then(r => r.json()).then(d => {
      if (d.stats) { setStats(d.stats); setBySession(d.bySession ?? []); setByDay(d.byDay ?? []); setEquityCurve(d.equityCurve ?? []); }
    });
    fetch('/api/backtest').then(r => r.json()).then(d => setRuns(d.runs ?? []));
  }, []);

  const runBt = async () => {
    setBtRunning(true); setBtResult(null);
    try {
      const r = await fetch('/api/backtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...btForm, entryPct: parseFloat(btForm.entryPct), slPct: parseFloat(btForm.slPct), tpPct: parseFloat(btForm.tpPct) }) });
      const d = await r.json();
      if (d.run) { setBtResult(d.run); setRuns(p => [d.run, ...p]); }
    } catch {}
    setBtRunning(false);
  };

  const inp = "bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";

  return (
    <div className="flex flex-col gap-3 overflow-y-auto h-full pb-4">
      {stats && (
        <>
          <div className="grid grid-cols-6 gap-2">
            {[['Trades',stats.totalTrades,'text-white'],['Win Rate',stats.winRate+'%','text-green-400'],['Net P&L','$'+stats.totalPnl.toLocaleString(),stats.totalPnl>=0?'text-green-400':'text-red-400'],['Profit Factor',stats.profitFactor.toFixed(2),'text-blue-400'],['Expectancy','$'+stats.expectancy,'text-yellow-400'],['Max Drawdown','$'+stats.maxDrawdown.toLocaleString(),'text-red-400']].map(([l,v,c]) => (
              <div key={l} className="bg-gray-900 border border-gray-800 rounded p-2">
                <div className="text-gray-600 text-xs">{l}</div>
                <div className={`text-base font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">By Session</div>
              {bySession.length > 0 ? bySession.map(s => (
                <div key={s.session} className="flex justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <span className="text-gray-400">{s.session}</span>
                  <span className="text-gray-500">{s.trades}T</span>
                  <span className={s.winRate >= 60 ? 'text-green-400' : s.winRate >= 45 ? 'text-yellow-400' : 'text-red-400'}>{s.winRate}%</span>
                  <span className={s.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>${s.pnl.toLocaleString()}</span>
                </div>
              )) : <div className="text-gray-700 text-xs">Tag your trades with session to see breakdown</div>}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">By Day of Week</div>
              {byDay.length > 0 ? byDay.map(d => (
                <div key={d.day} className="flex justify-between text-xs py-0.5 border-b border-gray-800 last:border-0">
                  <span className="text-gray-400">{d.day.slice(0,3)}</span>
                  <span className="text-gray-500">{d.trades}T</span>
                  <span className={d.winRate >= 60 ? 'text-green-400' : d.winRate >= 45 ? 'text-yellow-400' : 'text-red-400'}>{d.winRate}%</span>
                  <span className={d.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>${d.pnl.toLocaleString()}</span>
                </div>
              )) : <div className="text-gray-700 text-xs">No day data yet</div>}
            </div>
          </div>
          {equityCurve.length > 1 && (
            <div className="bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">Equity Curve</div>
              <div className="h-20">
                <svg width="100%" height="80" viewBox={`0 0 ${equityCurve.length} 80`} preserveAspectRatio="none">
                  <polyline fill="none" stroke="#22c55e" strokeWidth="1"
                    points={equityCurve.map((p, i) => {
                      const min = Math.min(...equityCurve.map(x => x.equity));
                      const max = Math.max(...equityCurve.map(x => x.equity));
                      const range = max - min || 1;
                      return `${i},${80 - ((p.equity - min) / range) * 70}`;
                    }).join(' ')}/>
                </svg>
              </div>
            </div>
          )}
        </>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded p-3">
        <div className="text-gray-500 text-xs uppercase mb-2 tracking-wider">Real Backtest Engine — runs against live candle data</div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div><label className="text-gray-500 text-xs block mb-0.5">Name</label><input className={inp + ' w-full'} value={btForm.name} onChange={e => setBtForm(p => ({ ...p, name: e.target.value }))}/></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Symbol</label><select className={inp + ' w-full'} value={btForm.symbol} onChange={e => setBtForm(p => ({ ...p, symbol: e.target.value }))}><option>NQ</option><option>ES</option></select></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Timeframe</label><select className={inp + ' w-full'} value={btForm.timeframe} onChange={e => setBtForm(p => ({ ...p, timeframe: e.target.value }))}><option>15m</option><option>1h</option><option>4h</option></select></div>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <div><label className="text-gray-500 text-xs block mb-0.5">Direction</label><select className={inp + ' w-full'} value={btForm.direction} onChange={e => setBtForm(p => ({ ...p, direction: e.target.value }))}><option value="bull">Bull</option><option value="bear">Bear</option></select></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">Entry pullback %</label><input className={inp + ' w-full'} type="number" value={btForm.entryPct} onChange={e => setBtForm(p => ({ ...p, entryPct: e.target.value }))}/></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">SL %</label><input className={inp + ' w-full'} type="number" value={btForm.slPct} onChange={e => setBtForm(p => ({ ...p, slPct: e.target.value }))}/></div>
          <div><label className="text-gray-500 text-xs block mb-0.5">TP %</label><input className={inp + ' w-full'} type="number" value={btForm.tpPct} onChange={e => setBtForm(p => ({ ...p, tpPct: e.target.value }))}/></div>
        </div>
        <button onClick={runBt} disabled={btRunning} className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-700 text-white text-xs py-1.5 rounded font-bold mb-2">{btRunning ? 'Running backtest on live candles...' : 'Run Backtest'}</button>
        {btResult && (
          <div className="bg-gray-800 rounded p-2 text-xs grid grid-cols-4 gap-2 mb-2">
            {[['Trades',btResult.total_trades,'text-white'],['Win Rate',btResult.win_rate+'%',btResult.win_rate>=55?'text-green-400':'text-red-400'],['Net P&L','$'+btResult.total_pnl?.toLocaleString(),btResult.total_pnl>=0?'text-green-400':'text-red-400'],['Profit Factor',btResult.profit_factor,'text-blue-400'],['Sharpe',btResult.sharpe_ratio,'text-yellow-400'],['Max DD','$'+btResult.max_drawdown?.toLocaleString(),'text-red-400'],['Avg R:R',btResult.avg_rr,'text-blue-400'],['Max Consec L',btResult.max_consecutive_losses,'text-red-400']].map(([l,v,c]) => (
              <div key={l as string}><div className="text-gray-500">{l}</div><div className={c as string}>{v}</div></div>
            ))}
          </div>
        )}
        {runs.length > 0 && (
          <div>
            <div className="text-gray-600 text-xs mb-1">Previous runs:</div>
            <table className="w-full text-xs">
              <thead><tr className="text-gray-600"><th className="text-left py-0.5">Name</th><th className="text-right">Trades</th><th className="text-right">WR%</th><th className="text-right">P&L</th><th className="text-right">PF</th><th className="text-right">Sharpe</th></tr></thead>
              <tbody>{runs.slice(0,8).map(r => (
                <tr key={r.id} className="border-t border-gray-800">
                  <td className="py-0.5 text-gray-400">{r.name}</td>
                  <td className="text-right text-gray-500">{r.total_trades}</td>
                  <td className={`text-right ${r.win_rate >= 55 ? 'text-green-400' : 'text-red-400'}`}>{r.win_rate}%</td>
                  <td className={`text-right ${r.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>${r.total_pnl?.toLocaleString()}</td>
                  <td className="text-right text-blue-400">{r.profit_factor}</td>
                  <td className="text-right text-yellow-400">{r.sharpe_ratio}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── JOURNAL TAB ────────────────────────────────────────────────────────
function JournalTab() {
  const [entries, setEntries] = useState<{ id:string;date:string;title:string;content:string;emotion:string;result:string }[]>([]);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0,10), title: '', content: '', emotion: 'neutral', result: 'no trade' });
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const inp = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";

  useEffect(() => {
    supabase.from('journal').select('*').order('date', { ascending: false }).limit(50).then(({ data }) => {
      if (data) setEntries(data as typeof entries);
    });
  }, []);

  const save = async () => {
    if (!form.title || !form.content) return;
    setSaving(true);
    const { data } = await supabase.from('journal').insert(form).select();
    if (data) { setEntries(p => [data[0] as typeof entries[0], ...p]); setAdding(false); setForm({ date: new Date().toISOString().slice(0,10), title: '', content: '', emotion: 'neutral', result: 'no trade' }); }
    setSaving(false);
  };

  const eC = (e: string) => e === 'confident' ? 'text-green-400' : e === 'patient' ? 'text-blue-400' : (e === 'anxious' || e === 'revenge' || e === 'fomo') ? 'text-red-400' : 'text-gray-400';
  const rC = (r: string) => r === 'win' ? 'text-green-400' : r === 'loss' ? 'text-red-400' : r === 'be' ? 'text-yellow-400' : 'text-gray-500';

  return (
    <div className="flex flex-col gap-2 h-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-gray-500 text-xs uppercase tracking-wider">Trading Journal</span>
        <button onClick={() => setAdding(true)} className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded">+ New Entry</button>
      </div>
      {adding && (
        <div className="bg-gray-900 border border-blue-800 rounded p-3 shrink-0">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div><label className="text-gray-500 text-xs block mb-0.5">Date</label><input type="date" className={inp} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}/></div>
            <div><label className="text-gray-500 text-xs block mb-0.5">Emotion</label><select className={inp} value={form.emotion} onChange={e => setForm(p => ({ ...p, emotion: e.target.value }))}><option value="confident">Confident</option><option value="patient">Patient</option><option value="neutral">Neutral</option><option value="anxious">Anxious</option><option value="fomo">FOMO</option><option value="revenge">Revenge</option></select></div>
            <div><label className="text-gray-500 text-xs block mb-0.5">Result</label><select className={inp} value={form.result} onChange={e => setForm(p => ({ ...p, result: e.target.value }))}><option value="win">Win</option><option value="loss">Loss</option><option value="be">Break Even</option><option value="no trade">No Trade</option></select></div>
          </div>
          <div className="mb-2"><label className="text-gray-500 text-xs block mb-0.5">Title / Setup Taken</label><input className={inp} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}/></div>
          <div className="mb-2"><label className="text-gray-500 text-xs block mb-0.5">Notes</label><textarea className={inp + ' min-h-16 resize-none'} value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} rows={4}/></div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-1.5 rounded">{saving ? 'Saving...' : 'Save Entry'}</button>
            <button onClick={() => setAdding(false)} className="px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded">Cancel</button>
          </div>
        </div>
      )}
      <div className="overflow-y-auto flex-1 space-y-2 pb-4">
        {entries.map(e => (
          <div key={e.id} className="bg-gray-900 border border-gray-800 rounded p-3">
            <div className="flex items-start justify-between mb-1">
              <div><span className="text-white text-xs font-bold">{e.title}</span><span className="text-gray-600 text-xs ml-2">{e.date}</span></div>
              <div className="flex gap-2 text-xs"><span className={eC(e.emotion)}>{e.emotion}</span><span className={rC(e.result)}>{e.result?.toUpperCase()}</span></div>
            </div>
            <p className="text-gray-400 text-xs leading-relaxed whitespace-pre-wrap">{e.content}</p>
          </div>
        ))}
        {!entries.length && !adding && <div className="text-center text-gray-600 text-xs py-12">No journal entries yet.</div>}
      </div>
    </div>
  );
}

// ── KNOWLEDGE TAB ──────────────────────────────────────────────────────
function KnowledgeTab() {
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', category: 'concept', source_episode: 'My Notes', tags: '' });
  const [saving, setSaving] = useState(false);
  const inp = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";

  useEffect(() => {
    supabase.from('knowledge_base').select('*').order('source_episode').limit(100).then(({ data }) => {
      if (data) setArticles(data as KBArticle[]);
    });
  }, []);

  const saveNote = async () => {
    if (!form.title || !form.content) return;
    setSaving(true);
    const { data } = await supabase.from('knowledge_base').insert({ ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), is_user_note: true }).select();
    if (data) { setArticles(p => [data[0] as KBArticle, ...p]); setAdding(false); setForm({ title: '', content: '', category: 'concept', source_episode: 'My Notes', tags: '' }); }
    setSaving(false);
  };

  const markReviewed = async (id: string) => {
    await supabase.from('knowledge_base').update({ user_reviewed: true, review_count: 1, last_reviewed_at: new Date().toISOString() }).eq('id', id);
    setArticles(p => p.map(a => a.id === id ? { ...a, user_reviewed: true } : a));
  };

  const filtered = articles.filter(a => !search || a.title?.toLowerCase().includes(search.toLowerCase()) || a.content?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-2 h-full overflow-hidden">
      <div className="flex gap-2 shrink-0">
        <input type="text" placeholder="Search knowledge base..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500"/>
        <button onClick={() => setAdding(!adding)} className="text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded">+ Add Note</button>
      </div>
      {adding && (
        <div className="bg-gray-900 border border-blue-800 rounded p-3 shrink-0">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div><label className="text-gray-500 text-xs block mb-0.5">Title</label><input className={inp} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}/></div>
            <div><label className="text-gray-500 text-xs block mb-0.5">Category</label><select className={inp} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}><option value="concept">Concept</option><option value="setup">Setup</option><option value="rule">Rule</option><option value="mistake">Mistake</option></select></div>
            <div><label className="text-gray-500 text-xs block mb-0.5">Tags (comma)</label><input className={inp} value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))}/></div>
          </div>
          <div className="mb-2"><textarea className={inp + ' resize-none'} rows={3} value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} placeholder="Describe the concept, rule, or observation..."/></div>
          <div className="flex gap-2">
            <button onClick={saveNote} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-1.5 rounded">{saving ? 'Saving...' : 'Save Note'}</button>
            <button onClick={() => setAdding(false)} className="px-4 bg-gray-700 text-gray-300 text-xs rounded">Cancel</button>
          </div>
        </div>
      )}
      <div className="text-gray-600 text-xs shrink-0">{filtered.length} of {articles.length} articles — {articles.filter(a => a.user_reviewed).length} reviewed</div>
      <div className="overflow-y-auto flex-1">
        <div className="grid grid-cols-2 gap-2 pb-4">
          {filtered.map(a => (
            <div key={a.id} className={`bg-gray-900 border rounded p-2 ${a.is_user_note ? 'border-blue-900' : 'border-gray-800'}`}>
              <div className="flex justify-between items-start mb-1">
                <span className="text-white text-xs font-bold">{a.title}</span>
                <div className="flex items-center gap-1">
                  <span className="text-blue-400 text-xs">{a.source_episode}</span>
                  {a.user_reviewed && <span className="text-green-400 text-xs">done</span>}
                </div>
              </div>
              <span className="text-yellow-600 text-xs px-1 rounded bg-yellow-900/20">{a.category}</span>
              <p className="text-gray-400 text-xs mt-1 leading-relaxed">{a.content}</p>
              {a.tags?.length > 0 && <div className="flex gap-1 flex-wrap mt-1">{a.tags.map((t: string) => <span key={t} className="text-xs text-gray-600 bg-gray-800 px-1 rounded">{t}</span>)}</div>}
              {!a.user_reviewed && <button onClick={() => markReviewed(a.id)} className="mt-1 text-xs text-gray-600 hover:text-green-400">Mark reviewed</button>}
            </div>
          ))}
          {!articles.length && <div className="col-span-2 text-center text-gray-600 py-8 text-xs">Loading...</div>}
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Dashboard');
  const [setups, setSetups] = useState<Setup[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [prices, setPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [prevPrices, setPrevPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [kz, setKz] = useState<KZData | null>(null);
  const [news, setNews] = useState<NewsEvent[]>([]);
  const [selectedSetup, setSelectedSetup] = useState<Setup | null>(null);
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [chartSym, setChartSym] = useState('NQ');
  const [chartTf, setChartTf] = useState('15m');
  const [chartSetup, setChartSetup] = useState<Setup | null>(null);
  const [scanFilter, setScanFilter] = useState('all');
  const [htfFilter, setHtfFilter] = useState('all');
  const [showRisk, setShowRisk] = useState(false);
  const [showNewSetup, setShowNewSetup] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [alerts, setAlerts] = useState<{ id: string; msg: string; color: string }[]>([]);
  const firedAlerts = useRef<Set<string>>(new Set());

  const addAlert = useCallback((msg: string, color = 'yellow') => {
    const id = Date.now().toString();
    setAlerts(p => [...p.slice(-3), { id, msg, color }]);
    setTimeout(() => setAlerts(p => p.filter(a => a.id !== id)), 8000);
  }, []);

  const loadSetups = useCallback(async () => {
    const { data } = await supabase.from('setups').select('*').in('status', ['active', 'watching', 'triggered']).order('confluence_score', { ascending: false }).limit(50);
    if (data) setSetups(data as Setup[]);
  }, []);

  useEffect(() => {
    loadSetups();
    supabase.from('trades').select('*').order('opened_at', { ascending: false }).limit(50).then(({ data }) => { if (data) setTrades(data as Trade[]); });
  }, [loadSetups]);

  const loadPrices = useCallback(async () => {
    try {
      const r = await fetch('/api/prices', { cache: 'no-store' });
      const d = await r.json();
      if (d.prices) { setPrevPrices(prices); setPrices(d.prices); }
    } catch {}
  }, [prices]);

  const loadKz = useCallback(async () => {
    try { const r = await fetch('/api/killzone', { cache: 'no-store' }); const d = await r.json(); setKz(d); } catch {}
  }, []);

  const loadNews = useCallback(async () => {
    try { const r = await fetch('/api/calendar', { cache: 'no-store' }); const d = await r.json(); setNews(d.events ?? []); } catch {}
  }, []);

  useEffect(() => {
    loadPrices(); loadKz(); loadNews();
    const pi = setInterval(loadPrices, 15000), ki = setInterval(loadKz, 60000), ni = setInterval(loadNews, 300000);
    return () => { clearInterval(pi); clearInterval(ki); clearInterval(ni); };
  }, [loadPrices, loadKz, loadNews]);

  useEffect(() => {
    if (!prices.NQ && !prices.ES) return;
    setups.forEach(s => {
      if (!['active','watching'].includes(s.status)) return;
      if (s.expires_at && new Date(s.expires_at) < new Date()) return;
      const price = prices[s.symbol as keyof Prices]; if (!price) return;
      const isBull = s.direction === 'bull' || s.direction === 'long';
      const slKey = `sl-${s.id}`;
      if (!firedAlerts.current.has(slKey) && ((isBull && price < s.stop_loss) || (!isBull && price > s.stop_loss))) {
        firedAlerts.current.add(slKey); addAlert(`SL BREACHED — ${s.symbol} ${s.setup_type} SL ${fmt(s.stop_loss)} | Now:${price.toFixed(1)}`, 'red');
      }
      const eKey = `e-${s.id}`;
      if (!firedAlerts.current.has(eKey) && price >= s.entry_low && price <= s.entry_high) {
        firedAlerts.current.add(eKey); addAlert(`IN ENTRY ZONE — ${s.symbol} ${s.setup_type} ${fmt(s.entry_low)}-${fmt(s.entry_high)}`, 'green');
      }
      const tKey = `tp-${s.id}`;
      if (!firedAlerts.current.has(tKey) && ((isBull && price >= s.target) || (!isBull && price <= s.target))) {
        firedAlerts.current.add(tKey); addAlert(`TARGET HIT — ${s.symbol} ${s.setup_type} TP ${fmt(s.target)}`, 'blue');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices]);

  const liveSetups: LiveSetup[] = setups.map(s => {
    const rs = calcRealScore(s, kz, news);
    const isExp = s.status === 'expired' || (s.expires_at ? new Date(s.expires_at) < new Date() : false);
    const price = prices[s.symbol as keyof Prices];
    const isBull = s.direction === 'bull' || s.direction === 'long';
    const slB = price !== null && (isBull ? price < s.stop_loss : price > s.stop_loss);
    const inEZ = price !== null && price >= s.entry_low && price <= s.entry_high;
    let pA: string | null = null;
    if (slB) pA = 'SL BREACHED';
    else if (inEZ) pA = 'IN ENTRY ZONE';
    else if (price && isBull && price >= s.target) pA = 'TARGET HIT';
    else if (price && !isBull && price <= s.target) pA = 'TARGET HIT';
    return { ...s, realScore: rs, isExpired: isExp, slBreached: slB, inEntryZone: inEZ, priceAlert: pA };
  });

  const filteredSetups = liveSetups.filter(s => {
    if (scanFilter !== 'all' && s.timeframe !== scanFilter) return false;
    if (htfFilter !== 'all' && s.htf_bias !== htfFilter) return false;
    return true;
  });

  const dangerNews = news.some(e => e.isDangerZone);
  const activeSetups = liveSetups.filter(s => !s.isExpired && !s.slBreached);
  const wins = trades.filter(t => t.result === 'win').length;
  const winRate = trades.length ? Math.round((wins / trades.length) * 100) : 0;
  const totalPnl = trades.reduce((a, t) => {
    const p = t.pnl || (t.result === 'win' ? Math.abs(t.take_profit - t.entry_price) * (t.symbol === 'NQ' ? 20 : 50) : -Math.abs(t.entry_price - t.stop_loss) * (t.symbol === 'NQ' ? 20 : 50));
    return a + p;
  }, 0);

  const selectSetup = (s: Setup) => { setSelectedSetup(s); setAiResponse(s.ai_analysis || ''); };
  const showOnChart = (s: Setup) => { setChartSym(s.symbol); setChartSetup(s); setActiveTab('Chart'); };

  const runAnalysis = async () => {
    if (!selectedSetup) return;
    const live = liveSetups.find(s => s.id === selectedSetup.id);
    if (live?.isExpired || live?.slBreached) {
      setAiResponse(`DO NOT TRADE — ${live.slBreached ? `SL at ${fmt(selectedSetup.stop_loss)} has been breached` : 'Setup has expired'}.\n\nThis setup is no longer valid. Do not enter.`);
      return;
    }
    setAiLoading(true); setAiResponse('');
    try {
      const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setup: selectedSetup, prices }) });
      const d = await r.json();
      setAiResponse(d.analysis || d.error || 'No response');
    } catch (e) { setAiResponse(String(e)); }
    setAiLoading(false);
  };

  const dolQ = selectedSetup ? [
    { q: 'Price location?', a: (() => { const p = prices[selectedSetup.symbol as keyof Prices]; return p ? (p < selectedSetup.entry_low ? `Below entry (${p.toFixed(1)})` : p > selectedSetup.entry_high ? `Above entry (${p.toFixed(1)})` : `IN ENTRY ZONE (${p.toFixed(1)})`) : '—'; })() },
    { q: 'Draw on Liquidity?', a: `${selectedSetup.dol_target} -> ${fmt(selectedSetup.target)}` },
    { q: 'PD Array valid?', a: `${selectedSetup.setup_type} ${fmt(selectedSetup.entry_low)}-${fmt(selectedSetup.entry_high)}` },
    { q: 'Liquidity aligned?', a: selectedSetup.correlated_align ? `Aligned (${selectedSetup.symbol === 'NQ' ? 'ES confirms' : 'NQ confirms'})` : 'Not confirmed' },
    { q: 'CISD confirmed?', a: selectedSetup.cisd_confirmed ? 'Full body close confirmed' : 'Pending — await close' },
    { q: 'In killzone?', a: kz?.active ? `${kz.active.name} — ${kz.probability}` : `No killzone. Next: ${kz?.upcoming[0]?.name ?? 'none'} in ${kz?.upcoming[0]?.minsAway ?? '?'}m` },
  ] : [];

  const aBg = (c: string) => c === 'red' ? 'bg-red-900/80 border-red-700 text-red-200' : c === 'green' ? 'bg-green-900/80 border-green-700 text-green-200' : c === 'blue' ? 'bg-blue-900/80 border-blue-700 text-blue-200' : 'bg-yellow-900/80 border-yellow-700 text-yellow-200';

  return (
    <div className="h-screen bg-gray-950 text-gray-100 font-mono text-sm flex flex-col overflow-hidden">
      <div className="fixed top-14 right-3 z-40 flex flex-col gap-1 pointer-events-none">
        {alerts.map(a => <div key={a.id} className={`text-xs px-3 py-1.5 rounded border ${aBg(a.color)} animate-pulse max-w-sm`}>{a.msg}</div>)}
      </div>

      <header className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-blue-400 font-bold text-lg tracking-widest">VECTOR</span>
          <span className="text-gray-600 text-xs">INTELLIGENCE</span>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse ml-1"></span>
          <span className="text-green-400 text-xs">LIVE</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {dangerNews && <span className="text-red-400 font-bold animate-pulse px-2 py-0.5 bg-red-900/30 border border-red-800 rounded">HIGH IMPACT NEWS</span>}
          <KZBadge kz={kz}/>
          <div className="flex items-center gap-4 ml-2">
            {(['NQ','ES','GC','DXY','VIX'] as const).map(sym => {
              const p = prices[sym], pp = prevPrices[sym];
              const up = p !== null && pp !== null && p > pp, dn = p !== null && pp !== null && p < pp;
              return (
                <div key={sym} className="flex items-center gap-0.5">
                  <span className="text-gray-500">{sym}</span>
                  <span className={`ml-1 ${up ? 'text-green-400' : dn ? 'text-red-400' : 'text-gray-400'}`}>{p !== null ? p.toFixed(sym === 'VIX' ? 2 : 1) : '—'}{up ? ' ^' : dn ? ' v' : ''}</span>
                </div>
              );
            })}
          </div>
          <span className="text-gray-600 ml-2">NY {kz?.nyTime ?? ''}</span>
        </div>
      </header>

      <nav className="bg-gray-900 border-b border-gray-800 px-4 flex items-center shrink-0">
        {TABS.map(t => <button key={t} onClick={() => setActiveTab(t)} className={`px-3 py-2 text-xs transition-colors border-b-2 ${activeTab === t ? 'border-blue-400 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>{t}</button>)}
        <div className="ml-auto flex gap-2">
          <button onClick={() => setShowNewSetup(true)} className="text-xs px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded">+ Setup</button>
          <button onClick={() => setShowScan(true)} className="text-xs px-3 py-1 bg-green-800 hover:bg-green-700 text-white rounded">Scan</button>
        </div>
      </nav>

      {showRisk && selectedSetup && <RiskModal setup={selectedSetup} onClose={() => setShowRisk(false)}/>}
      {showNewSetup && <NewSetupModal onClose={() => setShowNewSetup(false)} onSaved={loadSetups}/>}
      {showScan && <AutoScanModal prices={prices} kz={kz} onClose={() => setShowScan(false)} onSaved={loadSetups}/>}

      <main className="flex-1 overflow-hidden p-3 min-h-0">

        {activeTab === 'Dashboard' && (
          <div className="h-full grid grid-cols-12 gap-3 overflow-y-auto">
            <div className="col-span-12 grid grid-cols-6 gap-2">
              {[
                { label: `Win Rate (${trades.length}T)`, value: `${winRate}%`, color: 'text-green-400' },
                { label: 'Backtest P&L', value: `$${Math.round(totalPnl).toLocaleString()}`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: 'Active Setups', value: activeSetups.length.toString(), color: 'text-yellow-400' },
                { label: 'Killzone', value: kz?.active?.short ?? (kz?.upcoming[0]?.short ? `${kz.upcoming[0].short} -${kz.upcoming[0].minsAway}m` : 'DEAD'), color: kz?.active ? 'text-green-400' : 'text-red-400' },
                { label: 'News Risk', value: dangerNews ? 'DANGER' : 'CLEAR', color: dangerNews ? 'text-red-400 animate-pulse' : 'text-green-400' },
                { label: 'SMT', value: 'Check MMXM tab', color: 'text-purple-400' },
              ].map(s => <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-2"><div className="text-gray-600 text-xs">{s.label}</div><div className={`text-lg font-bold mt-0.5 ${s.color}`}>{s.value}</div></div>)}
            </div>

            <div className="col-span-8 bg-gray-900 border border-gray-800 rounded p-2 overflow-y-auto max-h-72">
              <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">Setups — Real Score</div>
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="text-gray-600 border-b border-gray-800">
                    <th className="text-left py-1">Sym</th><th className="text-left">TF</th><th className="text-left">Dir</th>
                    <th className="text-left">Type</th><th className="text-left">HTF</th><th className="text-left">CISD</th>
                    <th className="text-right">Entry</th><th className="text-right">SL</th><th className="text-right">TP</th>
                    <th className="text-right">Score</th><th className="text-right">Alert</th><th className="text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {liveSetups.map(s => (
                    <tr key={s.id} onClick={() => selectSetup(s as Setup)} className={`border-b border-gray-800 cursor-pointer transition-colors ${selectedSetup?.id === s.id ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'} ${s.isExpired || s.slBreached ? 'opacity-40' : ''}`}>
                      <td className="py-1 font-bold text-white">{s.symbol}</td>
                      <td className="text-gray-400">{s.timeframe}</td>
                      <td className={dirColor(s.direction)}>{s.direction}</td>
                      <td className="text-blue-300 max-w-20 truncate">{s.setup_type}</td>
                      <td><span className={`px-1 rounded text-xs ${s.htf_bias === 'bullish' ? 'text-green-400' : s.htf_bias === 'bearish' ? 'text-red-400' : 'text-gray-400'}`}>{s.htf_bias?.slice(0,4)}</span></td>
                      <td className={s.cisd_confirmed ? 'text-green-400' : 'text-gray-600'}>{s.cisd_confirmed ? 'y' : 'n'}</td>
                      <td className="text-right text-gray-300">{fmt(s.entry_low)}-{fmt(s.entry_high)}</td>
                      <td className="text-right text-red-400">{fmt(s.stop_loss)}</td>
                      <td className="text-right text-green-400">{fmt(s.target)}</td>
                      <td className="text-right"><ScoreRing score={s.realScore} base={s.confluence_score}/></td>
                      <td className="text-right">{s.priceAlert && <span className={`text-xs px-1 rounded ${s.priceAlert === 'SL BREACHED' ? 'text-red-400 bg-red-900/30 animate-pulse' : s.priceAlert === 'IN ENTRY ZONE' ? 'text-green-400 bg-green-900/30 animate-pulse' : 'text-blue-400 bg-blue-900/30'}`}>{s.priceAlert}</span>}</td>
                      <td className="text-right"><button onClick={e => { e.stopPropagation(); showOnChart(s as Setup); }} className="text-gray-600 hover:text-blue-400 ml-1">c</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!liveSetups.length && <div className="text-center text-gray-600 py-4 text-xs">No setups. Click + Setup or Scan.</div>}
            </div>

            <div className="col-span-4 flex flex-col gap-2">
              <div className="bg-gray-900 border border-gray-800 rounded p-2 flex-1 flex flex-col">
                <div className="text-gray-500 text-xs uppercase mb-1">AI Analyst</div>
                {selectedSetup && (
                  <div className="text-xs text-gray-400 mb-1 bg-gray-800 rounded px-2 py-1">
                    <span className="text-white">{selectedSetup.symbol}</span> {selectedSetup.setup_type}
                    {(() => { const l = liveSetups.find(s => s.id === selectedSetup.id); return l?.slBreached ? <span className="ml-1 text-red-400 font-bold"> SL BREACHED</span> : l?.isExpired ? <span className="ml-1 text-gray-600"> EXPIRED</span> : null; })()}
                  </div>
                )}
                <div className="flex gap-1 mb-2">
                  <button onClick={runAnalysis} disabled={!selectedSetup || aiLoading} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-1.5 rounded">{aiLoading ? 'Analyzing...' : 'Run AI Analysis'}</button>
                  {selectedSetup && <button onClick={() => setShowRisk(true)} className="px-3 bg-yellow-700 hover:bg-yellow-600 text-white text-xs py-1.5 rounded">Calc</button>}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {aiResponse ? <pre className={`text-xs leading-relaxed whitespace-pre-wrap font-mono ${aiResponse.startsWith('DO NOT') ? 'text-red-400' : 'text-gray-300'}`}>{aiResponse}</pre> : <div className="text-gray-700 text-xs">{selectedSetup ? 'Click Run AI Analysis' : 'Select a setup to analyse'}</div>}
                </div>
              </div>
            </div>

            <div className="col-span-7 bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">Session Killzones — NY Time</div>
              <div className="grid grid-cols-6 gap-1">
                {[
                  { short: 'ASIA', time: '7-10PM', color: '#6366f1', desc: 'Range building.' },
                  { short: 'LON', time: '2-5AM', color: '#f59e0b', desc: 'Judas swing.' },
                  { short: 'NY', time: '8:30-11AM', color: '#22c55e', desc: 'Main move.' },
                  { short: 'SB', time: '10-11AM', color: '#3b82f6', desc: 'Best 60min.' },
                  { short: 'LCL', time: '11:30-1:30PM', color: '#ef4444', desc: 'AVOID.' },
                  { short: 'NYA', time: '1:30-4PM', color: '#a855f7', desc: 'Continuation.' },
                ].map(z => {
                  const isA = kz?.active?.short === z.short;
                  return (
                    <div key={z.short} className={`rounded p-1.5 border transition-all ${isA ? 'border-current' : 'border-gray-800'}`} style={{ background: isA ? z.color + '20' : '#111318' }}>
                      <div className="font-bold text-xs" style={{ color: z.color }}>{z.short}</div>
                      <div className="text-gray-500 text-xs">{z.time}</div>
                      <div className="text-gray-600 text-xs mt-0.5">{z.desc}</div>
                      {isA && <div className="text-xs mt-0.5 font-bold animate-pulse" style={{ color: z.color }}>ACTIVE</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="col-span-5 bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">Economic Calendar</div>
              {news.slice(0, 7).map((e, i) => (
                <div key={i} className={`text-xs flex justify-between py-0.5 ${e.isDangerZone ? 'text-red-400 animate-pulse font-bold' : e.isToday ? 'text-yellow-400' : e.impact === 'critical' ? 'text-orange-400' : 'text-gray-600'}`}>
                  <span>{e.name}</span>
                  <span>{e.isToday ? (e.minutesAway !== null ? (e.minutesAway > 0 ? `in ${e.minutesAway}m` : `${Math.abs(e.minutesAway)}m ago`) : 'TODAY') : e.date}</span>
                </div>
              ))}
              {!news.some(e => e.isToday) && <div className="text-green-400 text-xs">No high-impact events today</div>}
            </div>

            <div className="col-span-12 bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">DOL Framework — 6 Questions</div>
              <div className="grid grid-cols-6 gap-2">
                {(dolQ.length ? dolQ : ['Price location?','Draw on Liquidity?','PD Array valid?','Liquidity aligned?','CISD confirmed?','In killzone?'].map(q => ({ q, a: 'Select a setup' }))).map((item, i) => (
                  <div key={i} className={`rounded p-2 ${i === 5 ? 'bg-blue-900/20 border border-blue-900' : 'bg-gray-800'}`}>
                    <div className="text-xs font-bold text-blue-400">Q{i + 1}</div>
                    <div className="text-gray-600 text-xs">{item.q}</div>
                    <div className="text-white text-xs mt-0.5 leading-snug">{item.a}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Chart' && (
          <div className="flex flex-col gap-2 h-full">
            <div className="flex gap-2 items-center flex-wrap shrink-0">
              <div className="flex gap-1">{['NQ','ES'].map(s => <button key={s} onClick={() => { setChartSym(s); setChartSetup(null); }} className={`text-xs px-3 py-1 rounded ${chartSym === s ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{s}</button>)}</div>
              <div className="flex gap-1">{['15m','1h','4h','D'].map(t => <button key={t} onClick={() => setChartTf(t)} className={`text-xs px-3 py-1 rounded ${chartTf === t ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{t}</button>)}</div>
              <KZBadge kz={kz}/>
              {dangerNews && <span className="text-red-400 text-xs animate-pulse">NEWS</span>}
              {chartSetup && <div className="flex items-center gap-2 bg-gray-800 px-2 py-1 rounded text-xs ml-2"><span className="text-green-400">*</span><span>{chartSetup.symbol} {chartSetup.setup_type}</span><button onClick={() => setChartSetup(null)} className="text-gray-500 hover:text-red-400">x</button></div>}
              <button onClick={() => setShowScan(true)} className="ml-auto text-xs px-2 py-1 bg-green-800 hover:bg-green-700 text-white rounded">Scan</button>
            </div>
            {chartSetup && (
              <div className="flex gap-4 text-xs shrink-0 items-center">
                <span className="text-green-400">Entry {fmt(chartSetup.entry_low)}-{fmt(chartSetup.entry_high)}</span>
                <span className="text-red-400">SL {fmt(chartSetup.stop_loss)}</span>
                <span className="text-blue-400">TP {fmt(chartSetup.target)}</span>
                <span className="text-gray-500">{fmt(chartSetup.rr_ratio, 1)}R</span>
                <span className={`px-1 rounded text-xs ${chartSetup.cisd_confirmed ? 'text-green-400 bg-green-900/30' : 'text-yellow-400 bg-yellow-900/30'}`}>CISD {chartSetup.cisd_confirmed ? 'confirmed' : 'pending'}</span>
              </div>
            )}
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded overflow-hidden min-h-0">
              <CandleChart symbol={chartSym} tf={chartTf} setup={chartSetup}/>
            </div>
            <div className="shrink-0 flex gap-2 flex-wrap">
              <span className="text-gray-600 text-xs">Setups:</span>
              {liveSetups.filter(s => s.symbol === chartSym).map(s => (
                <button key={s.id} onClick={() => setChartSetup(s as Setup)} className={`text-xs px-2 py-0.5 rounded border transition-colors ${chartSetup?.id === s.id ? 'border-blue-400 bg-blue-900/30 text-blue-300' : 'border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-500'}`}>
                  <span className={dirColor(s.direction)}>{s.direction}</span> {s.timeframe} {s.setup_type.slice(0,12)} <span className={s.realScore >= 70 ? 'text-green-400' : s.realScore >= 50 ? 'text-yellow-400' : 'text-red-400'}>{s.realScore}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'Scanner' && (
          <div className="flex flex-col gap-2 h-full overflow-y-auto">
            <div className="flex gap-2 items-center flex-wrap shrink-0">
              <div className="flex gap-1"><span className="text-gray-600 text-xs mr-1">TF:</span>{['all','15m','1H','4H','D'].map(f => <button key={f} onClick={() => setScanFilter(f)} className={`text-xs px-2 py-0.5 rounded ${scanFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{f}</button>)}</div>
              <div className="flex gap-1 ml-3"><span className="text-gray-600 text-xs mr-1">HTF:</span>{['all','bullish','bearish','neutral'].map(f => <button key={f} onClick={() => setHtfFilter(f)} className={`text-xs px-2 py-0.5 rounded ${htfFilter === f ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{f}</button>)}</div>
              <span className="text-gray-600 text-xs ml-auto">{filteredSetups.length} setups</span>
            </div>
            <div className="grid grid-cols-3 gap-2 overflow-y-auto pb-2">
              {filteredSetups.map(s => (
                <div key={s.id} className={`bg-gray-900 border rounded p-2 ${s.isExpired || s.slBreached ? 'opacity-30 border-gray-800' : s.realScore >= 70 ? 'border-green-900 hover:border-green-700' : s.realScore >= 50 ? 'border-yellow-900 hover:border-yellow-700' : 'border-red-900 hover:border-red-700'} transition-colors`}>
                  <div className="flex justify-between items-start mb-1">
                    <div><span className="text-white font-bold">{s.symbol}</span><span className="text-gray-500 text-xs ml-1">{s.timeframe}</span><span className={`ml-1 text-xs ${dirColor(s.direction)}`}>{s.direction.toUpperCase()}</span></div>
                    <ScoreRing score={s.realScore} base={s.confluence_score}/>
                  </div>
                  <div className="text-blue-300 text-xs mb-1">{s.setup_type}</div>
                  <div className="grid grid-cols-3 gap-x-2 text-xs mb-1">
                    <div><span className="text-gray-600">E </span><span className="text-gray-300">{fmt(s.entry_low)}</span></div>
                    <div><span className="text-red-600">SL </span><span className="text-gray-300">{fmt(s.stop_loss)}</span></div>
                    <div><span className="text-green-600">TP </span><span className="text-gray-300">{fmt(s.target)}</span></div>
                  </div>
                  {s.priceAlert && <div className={`text-xs px-1 rounded mb-1 ${s.priceAlert === 'SL BREACHED' ? 'bg-red-900/40 text-red-400' : s.priceAlert === 'IN ENTRY ZONE' ? 'bg-green-900/40 text-green-400 animate-pulse' : 'bg-blue-900/40 text-blue-400'}`}>{s.priceAlert}</div>}
                  <div className="flex gap-1 flex-wrap mb-1">
                    <span className={`text-xs px-1 rounded ${s.htf_bias === 'bullish' ? 'bg-green-900/50 text-green-400' : s.htf_bias === 'bearish' ? 'bg-red-900/50 text-red-400' : 'bg-gray-700 text-gray-400'}`}>{s.htf_bias?.slice(0,4)}</span>
                    <span className={`text-xs px-1 rounded ${s.cisd_confirmed ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{s.cisd_confirmed ? 'CISD ok' : 'CISD?'}</span>
                    <span className={`text-xs px-1 rounded ${s.volume_context === 'high' ? 'bg-green-900/50 text-green-400' : s.volume_context === 'medium' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-red-900/50 text-red-400'}`}>{s.volume_context?.slice(0,3)}</span>
                    {(s.isExpired || s.slBreached) && <span className="text-xs px-1 rounded bg-gray-800 text-gray-600">{s.slBreached ? 'SL HIT' : 'EXPIRED'}</span>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { selectSetup(s as Setup); setActiveTab('Dashboard'); }} className="flex-1 text-xs py-0.5 bg-gray-700 hover:bg-gray-600 rounded">Select</button>
                    <button onClick={() => showOnChart(s as Setup)} className="flex-1 text-xs py-0.5 bg-blue-800 hover:bg-blue-600 rounded">Chart</button>
                    <button onClick={() => { selectSetup(s as Setup); setShowRisk(true); }} className="text-xs px-2 py-0.5 bg-yellow-800 hover:bg-yellow-700 rounded">Calc</button>
                  </div>
                </div>
              ))}
              {!filteredSetups.length && <div className="col-span-3 text-center text-gray-600 py-12 text-xs">No setups. <button onClick={() => setShowNewSetup(true)} className="text-blue-400 underline">Add one</button> or <button onClick={() => setShowScan(true)} className="text-green-400 underline">scan market</button>.</div>}
            </div>
          </div>
        )}

        {activeTab === 'MMXM' && <MMXMTab prices={prices} kz={kz}/>}
        {activeTab === 'Analytics' && <AnalyticsTab/>}

        {activeTab === 'Backtest' && (
          <div className="space-y-3 overflow-y-auto h-full">
            <div className="bg-yellow-900/20 border border-yellow-800 rounded px-3 py-1.5 text-xs text-yellow-400">Sample trade data. Use Analytics tab for real statistical analysis of your own trades.</div>
            <div className="grid grid-cols-4 gap-2">
              {[{ label: 'Trades', value: trades.length.toString(), color: 'text-white' }, { label: 'Win Rate', value: `${winRate}%`, color: 'text-green-400' }, { label: 'Net P&L', value: `$${Math.round(totalPnl).toLocaleString()}`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' }, { label: 'Avg R:R', value: `${trades.length ? (trades.reduce((a,t) => a + Number(t.rr_achieved), 0) / trades.length).toFixed(1) : 0}R`, color: 'text-blue-400' }].map(s => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-2"><div className="text-gray-500 text-xs">{s.label}</div><div className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</div></div>
              ))}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-2">Trade History</div>
              <table className="w-full text-xs">
                <thead><tr className="text-gray-600 border-b border-gray-800"><th className="text-left py-1">Date</th><th className="text-left">Sym</th><th className="text-left">Dir</th><th className="text-right">Entry</th><th className="text-right">SL</th><th className="text-right">TP</th><th className="text-right">P&L</th><th className="text-right">Result</th><th className="text-left pl-2">Notes</th></tr></thead>
                <tbody>
                  {trades.map(t => {
                    const p = t.pnl || (t.result === 'win' ? Math.abs(t.take_profit - t.entry_price) * (t.symbol === 'NQ' ? 20 : 50) : -Math.abs(t.entry_price - t.stop_loss) * (t.symbol === 'NQ' ? 20 : 50));
                    return (
                      <tr key={t.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                        <td className="py-1 text-gray-500">{new Date(t.opened_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                        <td className="text-white font-bold">{t.symbol}</td>
                        <td className={dirColor(t.direction)}>{t.direction}</td>
                        <td className="text-right text-gray-300">{fmt(t.entry_price)}</td>
                        <td className="text-right text-red-400">{fmt(t.stop_loss)}</td>
                        <td className="text-right text-green-400">{fmt(t.take_profit)}</td>
                        <td className={`text-right ${p >= 0 ? 'text-green-400' : 'text-red-400'}`}>${Math.round(p).toLocaleString()}</td>
                        <td className={`text-right font-bold ${t.result === 'win' ? 'text-green-400' : 'text-red-400'}`}>{t.result?.toUpperCase()}</td>
                        <td className="pl-2 text-gray-600 text-xs max-w-xs truncate">{t.notes}</td>
                      </tr>
                    );
                  })}
                  {!trades.length && <tr><td colSpan={9} className="py-4 text-center text-gray-600">No trades</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'Journal' && <JournalTab/>}
        {activeTab === 'Knowledge' && <KnowledgeTab/>}
      </main>
    </div>
  );
}
