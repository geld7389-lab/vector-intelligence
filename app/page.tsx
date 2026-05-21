'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── TYPES ─────────────────────────────────────────────────────────────
interface Setup {
  id: string; symbol: string; timeframe: string; direction: string;
  setup_type: string; entry_low: number; entry_high: number;
  stop_loss: number; target: number; rr_ratio: number;
  confluence_score: number; status: string; dol_target: string;
  ai_analysis: string; created_at: string;
  htf_bias: string; cisd_confirmed: boolean;
  volume_context: string; killzone_valid: string;
  correlated_align: boolean; expires_at: string;
  invalidated_reason: string;
}
interface Trade {
  id: string; symbol: string; direction: string; entry_price: number;
  stop_loss: number; take_profit: number; result: string; rr_achieved: number;
  notes: string; opened_at: string; closed_at: string;
}
interface KBArticle {
  id: string; title: string; content: string; category: string;
  source_episode: string; tags: string[];
}
interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number; }
interface Prices { NQ: number|null; ES: number|null; GC: number|null; DXY: number|null; VIX: number|null; }
interface KillzoneData {
  nyTime: string; active: { name: string; short: string; color: string; description: string } | null;
  upcoming: { name: string; short: string; color: string; minsAway: number }[];
  probability: string; shouldTrade: boolean; isLunch: boolean; isWeekend: boolean;
}
interface NewsEvent {
  date: string; time: string; name: string; impact: string;
  isToday: boolean; minutesAway: number | null; isDangerZone: boolean;
}
interface LiveSetup extends Setup {
  realScore: number;
  isExpired: boolean;
  slBreached: boolean;
  inEntryZone: boolean;
  priceAlert: string | null;
}

const TABS = ['Dashboard','Chart','Scanner','Knowledge','Backtest','Journal'] as const;
type Tab = typeof TABS[number];

function fmt(n: number | string | null | undefined, d = 2) {
  const num = Number(n);
  return isNaN(num) ? '—' : num.toFixed(d);
}
function dirColor(d: string) {
  if (d === 'bull' || d === 'long') return 'text-green-400';
  if (d === 'bear' || d === 'short') return 'text-red-400';
  return 'text-yellow-400';
}
function scoreColor(s: number) {
  if (s >= 70) return 'text-green-400 bg-green-900/20';
  if (s >= 50) return 'text-yellow-400 bg-yellow-900/20';
  return 'text-red-400 bg-red-900/20';
}

function calcPnl(t: Trade): number {
  const pts = t.result === 'win'
    ? Math.abs(t.take_profit - t.entry_price)
    : -Math.abs(t.entry_price - t.stop_loss);
  return pts * (t.symbol === 'NQ' ? 20 : 50);
}

// ── REALTIME SCORE ENGINE ──────────────────────────────────────────────
function calcRealScore(s: Setup, kz: KillzoneData | null, newsEvents: NewsEvent[]): number {
  let score = s.confluence_score;
  const dangerNews = newsEvents.some(e => e.isDangerZone);
  if (dangerNews) return Math.max(0, score - 40);
  const kzValid = (s.killzone_valid || 'any').split(',');
  const activeKz = kz?.active?.short ?? '';
  const inKillzone = kzValid.includes('any') || kzValid.includes(activeKz);
  if (!inKillzone) score -= 25;
  if (kz?.isLunch) score -= 20;
  if (s.htf_bias === 'bearish' && (s.direction === 'bull' || s.direction === 'long')) score -= 20;
  if (s.htf_bias === 'bullish' && (s.direction === 'bear' || s.direction === 'short')) score -= 20;
  if (!s.cisd_confirmed) score -= 10;
  if (s.volume_context === 'low') score -= 10;
  if (!s.correlated_align) score -= 15;
  if (s.expires_at && new Date(s.expires_at) < new Date()) score = 0;
  return Math.max(0, Math.min(100, score));
}

// ── SCORE RING ─────────────────────────────────────────────────────────
function ScoreRing({ score, base }: { score: number; base: number }) {
  const delta = score - base;
  const r = 14; const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 70 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
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

function KillzoneBadge({ kz }: { kz: KillzoneData | null }) {
  if (!kz) return <span className="text-gray-600 text-xs">–</span>;
  if (kz.active) return (
    <span className="text-xs px-2 py-0.5 rounded font-bold animate-pulse"
      style={{ color: kz.active.color, background: kz.active.color + '20', border: `1px solid ${kz.active.color}40` }}>
      {kz.active.short} · {kz.probability}
    </span>
  );
  const next = kz.upcoming[0];
  return (
    <span className="text-gray-500 text-xs px-2 py-0.5 rounded bg-gray-800">
      {next ? `${next.short} in ${next.minsAway}m` : 'OFF HOURS'} · DEAD
    </span>
  );
}

// ── CANVAS CHART ──────────────────────────────────────────────────────
function CandleChart({ symbol, tf, setup }: { symbol: string; tf: string; setup: Setup | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/candles?symbol=${symbol}&tf=${tf}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.error) { setError(data.error); setLoading(false); return; }
      setCandles(data.candles ?? []);
    } catch (e) { setError(String(e)); }
    setLoading(false);
  }, [symbol, tf]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  useEffect(() => {
    if (!candles.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const PL = 72, PR = 8, PT = 20, PB = 28;
    const chartW = W - PL - PR, chartH = H - PT - PB - 50;
    const volH = 40;
    ctx.clearRect(0, 0, W, H);

    const prices = candles.map(c => [c.l, c.h]).flat();
    let minP = Math.min(...prices), maxP = Math.max(...prices);
    if (setup) {
      const levels = [setup.entry_low, setup.entry_high, setup.stop_loss, setup.target];
      levels.forEach(l => { if (l < minP) minP = l; if (l > maxP) maxP = l; });
    }
    const pad = (maxP - minP) * 0.08;
    minP -= pad; maxP += pad;
    const pToY = (p: number) => PT + chartH - ((p - minP) / (maxP - minP)) * chartH;
    const maxVol = Math.max(...candles.map(c => c.v ?? 0));

    // Grid
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 6; i++) {
      const y = PT + (chartH / 6) * i;
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
      const price = maxP - ((maxP - minP) / 6) * i;
      ctx.fillStyle = '#4b5563'; ctx.font = '10px monospace';
      ctx.textAlign = 'right'; ctx.fillText(price.toFixed(1), PL - 3, y + 3);
    }

    // Setup overlay
    if (setup) {
      // Entry zone
      const ey1 = pToY(setup.entry_high), ey2 = pToY(setup.entry_low);
      ctx.fillStyle = 'rgba(34,197,94,0.07)';
      ctx.fillRect(PL, ey1, chartW, ey2 - ey1);
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.strokeRect(PL, ey1, chartW, ey2 - ey1); ctx.setLineDash([]);
      ctx.fillStyle = '#22c55e'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`ENTRY ${fmt(setup.entry_low)}–${fmt(setup.entry_high)}`, PL + 4, ey1 - 3);
      // SL
      const sly = pToY(setup.stop_loss);
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(PL, sly); ctx.lineTo(W - PR, sly); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#ef4444'; ctx.textAlign = 'right';
      ctx.fillText(`SL ${fmt(setup.stop_loss)}`, W - PR - 2, sly - 3);
      // TP
      const tpy = pToY(setup.target);
      ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(PL, tpy); ctx.lineTo(W - PR, tpy); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#3b82f6'; ctx.textAlign = 'right';
      ctx.fillText(`TP ${fmt(setup.target)}`, W - PR - 2, tpy - 3);
    }

    // Candles
    const cw = Math.max(2, Math.min(14, chartW / candles.length - 1));
    const gap = chartW / candles.length;
    candles.forEach((c, i) => {
      const x = PL + i * gap + gap / 2;
      const bull = c.c >= c.o;
      const color = bull ? '#22c55e' : '#ef4444';
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, pToY(c.h)); ctx.lineTo(x, pToY(c.l)); ctx.stroke();
      const oy = pToY(Math.max(c.o, c.c)), cy = pToY(Math.min(c.o, c.c));
      const bodyH = Math.max(1, cy - oy);
      ctx.fillStyle = hovered === i ? (bull ? '#86efac' : '#fca5a5') : color;
      ctx.fillRect(x - cw / 2, oy, cw, bodyH);
      // Volume bar
      if (c.v && maxVol > 0) {
        const vh = (c.v / maxVol) * volH;
        ctx.fillStyle = bull ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';
        ctx.fillRect(x - cw / 2, PT + chartH + 10 + volH - vh, cw, vh);
      }
    });

    // Hover tooltip
    if (hovered !== null && candles[hovered]) {
      const c = candles[hovered];
      const x = PL + hovered * gap + gap / 2;
      const tx = Math.min(x, W - 120);
      ctx.fillStyle = 'rgba(17,24,39,0.95)';
      ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(tx - 2, PT + 2, 110, 60, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9ca3af'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
      const d = new Date(c.t * 1000);
      ctx.fillText(d.toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}), tx + 4, PT + 13);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillText(`O:${c.o.toFixed(1)} H:${c.h.toFixed(1)}`, tx + 4, PT + 25);
      ctx.fillText(`L:${c.l.toFixed(1)} C:${c.c.toFixed(1)}`, tx + 4, PT + 37);
      if (c.v) ctx.fillText(`Vol: ${(c.v/1000).toFixed(1)}K`, tx + 4, PT + 49);
    }

    // Current price line
    if (candles.length > 0) {
      const last = candles[candles.length - 1];
      const ly = pToY(last.c);
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(PL, ly); ctx.lineTo(W - PR, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f59e0b'; ctx.textAlign = 'right';
      ctx.fillText(last.c.toFixed(1), W - PR - 2, ly - 3);
    }
  }, [candles, hovered, setup]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !candles.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const PL = 72; const chartW = canvasRef.current.width - 80;
    const gap = chartW / candles.length;
    const idx = Math.floor((x - PL) / gap);
    setHovered(idx >= 0 && idx < candles.length ? idx : null);
  };

  if (loading) return <div className="flex items-center justify-center h-full text-gray-600 text-xs">Loading candles...</div>;
  if (error) return <div className="flex items-center justify-center h-full text-red-500 text-xs">Chart error: {error}</div>;

  return (
    <canvas ref={canvasRef} width={900} height={420} className="w-full h-full cursor-crosshair"
      onMouseMove={handleMouseMove} onMouseLeave={() => setHovered(null)}/>
  );
}

// ── RISK CALCULATOR MODAL ──────────────────────────────────────────────
function RiskModal({ setup, onClose }: { setup: Setup; onClose: () => void }) {
  const [accountSize, setAccountSize] = useState('25000');
  const [riskPct, setRiskPct] = useState('1');

  const acc = parseFloat(accountSize) || 0;
  const riskAmt = acc * (parseFloat(riskPct) / 100);
  const isNQ = setup.symbol === 'NQ';
  const pointValue = isNQ ? 20 : 50;
  const slPts = Math.abs((setup.entry_low + setup.entry_high) / 2 - setup.stop_loss);
  const slDollars = slPts * pointValue;
  const contracts = slDollars > 0 ? Math.floor(riskAmt / slDollars) : 0;
  const actualRisk = contracts * slDollars;
  const tpPts = Math.abs(setup.target - (setup.entry_low + setup.entry_high) / 2);
  const potentialProfit = contracts * tpPts * pointValue;
  const margin = isNQ ? contracts * 17000 : contracts * 13000;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-96 max-w-full" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <span className="text-white font-bold text-sm">⚖ Risk Calculator — {setup.symbol} {setup.setup_type}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-red-400">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-gray-500 text-xs block mb-0.5">Account Size ($)</label>
            <input value={accountSize} onChange={e => setAccountSize(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500"/>
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-0.5">Risk %</label>
            <input value={riskPct} onChange={e => setRiskPct(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500"/>
          </div>
        </div>
        <div className="bg-gray-800 rounded p-3 space-y-2 text-xs mb-3">
          <div className="flex justify-between">
            <span className="text-gray-500">Entry Zone</span>
            <span className="text-gray-300">{fmt(setup.entry_low)} – {fmt(setup.entry_high)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Stop Loss</span>
            <span className="text-red-400">{fmt(setup.stop_loss)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Target</span>
            <span className="text-green-400">{fmt(setup.target)}</span>
          </div>
          <div className="border-t border-gray-700 pt-2 mt-1">
            <div className="flex justify-between">
              <span className="text-gray-500">SL Distance</span>
              <span className="text-gray-300">{slPts.toFixed(1)} pts (${slDollars.toFixed(0)}/contract)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Risk Amount</span>
              <span className="text-red-400">${riskAmt.toFixed(0)} ({riskPct}%)</span>
            </div>
            <div className="flex justify-between mt-1 border-t border-gray-700 pt-1">
              <span className="text-blue-400 font-bold">Contracts to Trade</span>
              <span className="text-white font-bold text-base">{contracts} {isNQ ? 'NQ' : 'ES'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Actual $ at Risk</span>
              <span className={actualRisk > riskAmt ? 'text-red-400' : 'text-gray-300'}>${actualRisk.toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-green-500">Potential Profit</span>
              <span className="text-green-400">${potentialProfit.toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">R:R Ratio</span>
              <span className="text-blue-400">{fmt(setup.rr_ratio, 1)}R</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Est. Margin Required</span>
              <span className="text-yellow-400">${margin.toLocaleString()}</span>
            </div>
          </div>
        </div>
        {contracts === 0 && (
          <div className="text-yellow-400 text-xs text-center bg-yellow-900/20 rounded p-1.5">
            Account too small or SL too wide for {riskPct}% risk at this size.
          </div>
        )}
        {contracts > 0 && (
          <div className="text-green-400 text-xs text-center bg-green-900/20 rounded p-1.5 font-bold">
            TRADE {contracts} CONTRACT{contracts > 1 ? 'S' : ''} · RISK ${actualRisk.toFixed(0)} · TARGET ${potentialProfit.toFixed(0)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── NEW SETUP MODAL ────────────────────────────────────────────────────
function NewSetupModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    symbol: 'NQ', timeframe: '15m', direction: 'bull', setup_type: 'OB + FVG',
    entry_low: '', entry_high: '', stop_loss: '', target: '', dol_target: 'BSL at 29800',
    htf_bias: 'bullish', cisd_confirmed: false, volume_context: 'medium',
    killzone_valid: 'NY,SB', status: 'watching', confluence_score: '70',
    correlated_align: true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const f = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }));

  const rr = () => {
    const el = parseFloat(form.entry_low), eh = parseFloat(form.entry_high);
    const sl = parseFloat(form.stop_loss), tp = parseFloat(form.target);
    if (!el || !eh || !sl || !tp) return null;
    const entry = (el + eh) / 2;
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    return risk > 0 ? (reward / risk).toFixed(1) : null;
  };

  const save = async () => {
    if (!form.entry_low || !form.stop_loss || !form.target) { setErr('Entry, SL, and Target required.'); return; }
    setSaving(true); setErr('');
    const rrVal = parseFloat(rr() ?? '0');
    const expiresAt = new Date(Date.now() + (form.status === 'active' ? 1 : 3) * 24 * 60 * 60 * 1000).toISOString();
    const payload = {
      symbol: form.symbol, timeframe: form.timeframe, direction: form.direction,
      setup_type: form.setup_type, entry_low: parseFloat(form.entry_low),
      entry_high: parseFloat(form.entry_high || form.entry_low),
      stop_loss: parseFloat(form.stop_loss), target: parseFloat(form.target),
      dol_target: form.dol_target, htf_bias: form.htf_bias,
      cisd_confirmed: form.cisd_confirmed, volume_context: form.volume_context,
      killzone_valid: form.killzone_valid, status: form.status,
      confluence_score: parseInt(form.confluence_score),
      correlated_align: form.correlated_align,
      rr_ratio: rrVal, expires_at: expiresAt,
      ai_analysis: '', invalidated_reason: '',
    };
    try {
      const res = await fetch('/api/setups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.error) { setErr(JSON.stringify(data.error)); setSaving(false); return; }
      onSaved(); onClose();
    } catch (e) { setErr(String(e)); }
    setSaving(false);
  };

  const inp = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";
  const sel = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";
  const lbl = "text-gray-500 text-xs block mb-0.5";

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-full max-w-lg max-h-screen overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <span className="text-white font-bold text-sm">+ New Setup</span>
          <button onClick={onClose} className="text-gray-500 hover:text-red-400">✕</button>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div><label className={lbl}>Symbol</label>
            <select className={sel} value={form.symbol} onChange={e => f('symbol', e.target.value)}>
              <option>NQ</option><option>ES</option>
            </select></div>
          <div><label className={lbl}>Timeframe</label>
            <select className={sel} value={form.timeframe} onChange={e => f('timeframe', e.target.value)}>
              <option>15m</option><option>1H</option><option>4H</option><option>D</option>
            </select></div>
          <div><label className={lbl}>Direction</label>
            <select className={sel} value={form.direction} onChange={e => f('direction', e.target.value)}>
              <option value="bull">Bull (Long)</option><option value="bear">Bear (Short)</option><option value="inversion">Inversion</option>
            </select></div>
        </div>
        <div className="mb-2"><label className={lbl}>Setup Type</label>
          <input className={inp} value={form.setup_type} onChange={e => f('setup_type', e.target.value)} placeholder="e.g. Bullish CISD + OB"/>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className={lbl}>Entry Low</label><input className={inp} type="number" value={form.entry_low} onChange={e => f('entry_low', e.target.value)}/></div>
          <div><label className={lbl}>Entry High</label><input className={inp} type="number" value={form.entry_high} onChange={e => f('entry_high', e.target.value)} placeholder="= Entry Low if same"/></div>
          <div><label className={lbl}>Stop Loss</label><input className={inp} type="number" value={form.stop_loss} onChange={e => f('stop_loss', e.target.value)}/></div>
          <div><label className={lbl}>Target / DOL Price</label><input className={inp} type="number" value={form.target} onChange={e => f('target', e.target.value)}/></div>
        </div>
        <div className="mb-2"><label className={lbl}>DOL Description (e.g. "BSL at 29800 — equal highs")</label>
          <input className={inp} value={form.dol_target} onChange={e => f('dol_target', e.target.value)}/>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div><label className={lbl}>HTF Bias</label>
            <select className={sel} value={form.htf_bias} onChange={e => f('htf_bias', e.target.value)}>
              <option value="bullish">Bullish</option><option value="bearish">Bearish</option><option value="neutral">Neutral</option>
            </select></div>
          <div><label className={lbl}>Volume Context</label>
            <select className={sel} value={form.volume_context} onChange={e => f('volume_context', e.target.value)}>
              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select></div>
          <div><label className={lbl}>Status</label>
            <select className={sel} value={form.status} onChange={e => f('status', e.target.value)}>
              <option value="watching">Watching</option><option value="active">Active</option>
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className={lbl}>Confluence Score (0–100)</label>
            <input className={inp} type="number" min="0" max="100" value={form.confluence_score} onChange={e => f('confluence_score', e.target.value)}/>
          </div>
          <div><label className={lbl}>Valid Killzones (comma sep)</label>
            <input className={inp} value={form.killzone_valid} onChange={e => f('killzone_valid', e.target.value)} placeholder="NY,SB or any"/>
          </div>
        </div>
        <div className="flex gap-4 mb-3 text-xs">
          <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer">
            <input type="checkbox" checked={form.cisd_confirmed} onChange={e => f('cisd_confirmed', e.target.checked)} className="accent-blue-500"/>
            CISD Confirmed
          </label>
          <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer">
            <input type="checkbox" checked={form.correlated_align} onChange={e => f('correlated_align', e.target.checked)} className="accent-blue-500"/>
            Correlated Assets Aligned
          </label>
        </div>
        {rr() && (
          <div className="text-center text-blue-400 text-xs mb-2 bg-blue-900/20 rounded p-1.5">
            Calculated R:R = {rr()}R
          </div>
        )}
        {err && <div className="text-red-400 text-xs mb-2 bg-red-900/20 rounded p-1.5">{err}</div>}
        <button onClick={save} disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-2 rounded font-bold transition-colors">
          {saving ? 'Saving...' : 'Save Setup'}
        </button>
      </div>
    </div>
  );
}

// ── AUTO SCAN MODAL ────────────────────────────────────────────────────
function MarketSyncModal({ prices, kz, onClose, onSaved }: {
  prices: Prices; kz: KillzoneData | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [symbols, setSymbols] = useState<string[]>(['NQ', 'ES']);
  const [timeframes, setTimeframes] = useState<string[]>(['15m', '1h']);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ message: string; count: number; setups: Partial<Setup>[] } | null>(null);
  const [error, setError] = useState('');

  const toggleSym = (s: string) => setSymbols(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  const toggleTf  = (t: string) => setTimeframes(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  const scan = async () => {
    if (!symbols.length || !timeframes.length) { setError('Select at least one symbol and timeframe.'); return; }
    setLoading(true); setResult(null); setError('');
    try {
      const res = await fetch('/api/autoscan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, timeframes, currentPrices: prices }),
      });
      const data = await res.json();
      if (data.error) { setError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error)); } else { setResult(data); }
    } catch (e) { setError(String(e)); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-[420px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <span className="text-white font-bold text-sm">⚡ Auto-Scan — Find New Setups from Live Market</span>
          <button onClick={onClose} className="text-gray-500 hover:text-red-400">✕</button>
        </div>

        {/* Live prices snapshot */}
        <div className="grid grid-cols-2 gap-2 bg-gray-800 rounded p-2 text-xs mb-3">
          {(['NQ','ES','GC','DXY'] as const).map(s => (
            <div key={s} className="flex justify-between">
              <span className="text-gray-500">{s}</span>
              <span className="text-white font-bold">{prices[s]?.toFixed(s === 'DXY' ? 3 : 1) ?? '—'}</span>
            </div>
          ))}
          {kz?.active && (
            <div className="col-span-2 text-center" style={{ color: kz.active.color }}>
              {kz.active.name} ACTIVE — {kz.probability}
            </div>
          )}
          {!kz?.active && kz?.upcoming[0] && (
            <div className="col-span-2 text-center text-gray-600">
              Next: {kz.upcoming[0].name} in {kz.upcoming[0].minsAway}m
            </div>
          )}
        </div>

        {/* Symbols */}
        <div className="mb-2">
          <div className="text-gray-500 text-xs mb-1">Scan Symbols:</div>
          <div className="flex gap-2">
            {['NQ','ES'].map(s => (
              <button key={s} onClick={() => toggleSym(s)}
                className={`text-xs px-4 py-1.5 rounded border transition-colors ${symbols.includes(s) ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                {s} {prices[s as keyof Prices] ? `${prices[s as keyof Prices]?.toFixed(0)}` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Timeframes */}
        <div className="mb-3">
          <div className="text-gray-500 text-xs mb-1">Timeframes:</div>
          <div className="flex gap-2">
            {['15m','1h','4h'].map(t => (
              <button key={t} onClick={() => toggleTf(t)}
                className={`text-xs px-4 py-1.5 rounded border transition-colors ${timeframes.includes(t) ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="text-gray-600 text-xs mb-3 bg-gray-800 rounded p-2">
          Scans {symbols.length} symbol{symbols.length !== 1 ? 's' : ''} × {timeframes.length} timeframe{timeframes.length !== 1 ? 's' : ''} = {symbols.length * timeframes.length} chart{symbols.length * timeframes.length !== 1 ? 's' : ''}.
          Detects: FVG retests · OB sweeps · CISD displacement candles · Premium/Discount zones.
          R:R filter: min 2.0. Saves valid setups directly to DB.
        </div>

        <button onClick={scan} disabled={loading || !symbols.length || !timeframes.length}
          className="w-full bg-green-700 hover:bg-green-600 disabled:bg-gray-700 text-white text-sm py-2.5 rounded font-bold mb-3 transition-colors">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⟳</span> Scanning {symbols.join('+')} {timeframes.join('/')}...
            </span>
          ) : `⚡ Scan Market Now`}
        </button>

        {error && <div className="text-red-400 text-xs bg-red-900/20 rounded p-2 mb-2">{error}</div>}

        {result && (
          <div className={`rounded p-2 mb-2 text-xs ${result.count > 0 ? 'bg-green-900/20 border border-green-800' : 'bg-yellow-900/20 border border-yellow-800'}`}>
            <div className={`font-bold mb-2 ${result.count > 0 ? 'text-green-400' : 'text-yellow-400'}`}>
              {result.count > 0 ? `✅ ${result.message}` : `⚠ ${result.message}`}
            </div>
            {result.setups?.map((s, i) => (
              <div key={i} className="bg-gray-800 rounded p-2 mb-1">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-white font-bold">{s.symbol} {s.timeframe}</span>
                  <span className={`text-xs px-1 rounded ${s.direction === 'bull' ? 'text-green-400 bg-green-900/40' : 'text-red-400 bg-red-900/40'}`}>{s.direction?.toUpperCase()}</span>
                </div>
                <div className="text-blue-300">{s.setup_type}</div>
                <div className="flex gap-3 text-xs mt-0.5">
                  <span className="text-gray-400">E: {fmt(s.entry_low)}–{fmt(s.entry_high)}</span>
                  <span className="text-red-400">SL: {fmt(s.stop_loss)}</span>
                  <span className="text-green-400">TP: {fmt(s.target)}</span>
                  <span className="text-blue-400">{fmt(s.rr_ratio, 1)}R · {s.confluence_score}</span>
                </div>
              </div>
            ))}
            {result.count > 0 && (
              <button onClick={() => { onSaved(); onClose(); }}
                className="w-full mt-1 bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 rounded">
                View in Dashboard →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── JOURNAL TAB ────────────────────────────────────────────────────────
function JournalTab() {
  const [entries, setEntries] = useState<{id:string;date:string;title:string;content:string;emotion:string;result:string;}[]>([]);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0,10), title: '', content: '', emotion: 'neutral', result: 'no trade' });
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('journal').select('*').order('date', { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setEntries(data as typeof entries); });
  }, []);

  const save = async () => {
    if (!form.title || !form.content) return;
    setSaving(true);
    const { data } = await supabase.from('journal').insert(form).select();
    if (data) { setEntries(p => [data[0] as typeof entries[0], ...p]); setAdding(false); setForm({ date: new Date().toISOString().slice(0,10), title:'', content:'', emotion:'neutral', result:'no trade' }); }
    setSaving(false);
  };

  const emotionColor = (e: string) => e === 'confident' ? 'text-green-400' : e === 'anxious' ? 'text-red-400' : e === 'fomo' ? 'text-yellow-400' : e === 'patient' ? 'text-blue-400' : 'text-gray-400';
  const resultColor = (r: string) => r === 'win' ? 'text-green-400' : r === 'loss' ? 'text-red-400' : r === 'be' ? 'text-yellow-400' : 'text-gray-500';
  const inp = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500";

  return (
    <div className="flex flex-col gap-2 h-full overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <span className="text-gray-500 text-xs uppercase tracking-wider">Trading Journal</span>
        <button onClick={() => setAdding(true)} className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded">+ New Entry</button>
      </div>
      {adding && (
        <div className="bg-gray-900 border border-blue-800 rounded p-3 shrink-0">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div><label className="text-gray-500 text-xs block mb-0.5">Date</label><input type="date" className={inp} value={form.date} onChange={e => setForm(p => ({...p, date: e.target.value}))}/></div>
            <div><label className="text-gray-500 text-xs block mb-0.5">Emotion</label>
              <select className={inp} value={form.emotion} onChange={e => setForm(p => ({...p, emotion: e.target.value}))}>
                <option value="confident">Confident</option><option value="patient">Patient</option><option value="neutral">Neutral</option>
                <option value="anxious">Anxious</option><option value="fomo">FOMO</option><option value="revenge">Revenge</option>
              </select></div>
            <div><label className="text-gray-500 text-xs block mb-0.5">Session Result</label>
              <select className={inp} value={form.result} onChange={e => setForm(p => ({...p, result: e.target.value}))}>
                <option value="win">Win</option><option value="loss">Loss</option><option value="be">Break Even</option><option value="no trade">No Trade</option>
              </select></div>
          </div>
          <div className="mb-2"><label className="text-gray-500 text-xs block mb-0.5">Title / Setup Taken</label>
            <input className={inp} value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} placeholder="e.g. NQ 15m SSL Sweep long from 29,450"/>
          </div>
          <div className="mb-2"><label className="text-gray-500 text-xs block mb-0.5">Notes — What did you see? What did you do? What did you learn?</label>
            <textarea className={inp + ' min-h-16 resize-none'} value={form.content} onChange={e => setForm(p => ({...p, content: e.target.value}))} rows={4}/>
          </div>
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
              <div>
                <span className="text-white text-xs font-bold">{e.title}</span>
                <span className="text-gray-600 text-xs ml-2">{e.date}</span>
              </div>
              <div className="flex gap-2 text-xs">
                <span className={emotionColor(e.emotion)}>{e.emotion}</span>
                <span className={resultColor(e.result)}>{e.result?.toUpperCase()}</span>
              </div>
            </div>
            <p className="text-gray-400 text-xs leading-relaxed whitespace-pre-wrap">{e.content}</p>
          </div>
        ))}
        {!entries.length && !adding && (
          <div className="text-center text-gray-600 text-xs py-12">No journal entries yet. Start logging your trades and thoughts.</div>
        )}
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('Dashboard');
  const [setups, setSetups] = useState<Setup[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [prices, setPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [prevPrices, setPrevPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [kz, setKz] = useState<KillzoneData | null>(null);
  const [newsEvents, setNewsEvents] = useState<NewsEvent[]>([]);
  const [selectedSetup, setSelectedSetup] = useState<Setup | null>(null);
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [chartSymbol, setChartSymbol] = useState('NQ');
  const [chartTf, setChartTf] = useState('15m');
  const [chartSetup, setChartSetup] = useState<Setup | null>(null);
  const [scanFilter, setScanFilter] = useState('all');
  const [htfFilter, setHtfFilter] = useState('all');
  const [searchKB, setSearchKB] = useState('');
  const [showRisk, setShowRisk] = useState(false);
  const [showNewSetup, setShowNewSetup] = useState(false);
  const [showMarketSync, setShowMarketSync] = useState(false);
  const [alerts, setAlerts] = useState<{ id: string; msg: string; color: string }[]>([]);

  const addAlert = useCallback((msg: string, color = 'yellow') => {
    const id = Date.now().toString();
    setAlerts(p => [...p.slice(-3), { id, msg, color }]);
    setTimeout(() => setAlerts(p => p.filter(a => a.id !== id)), 8000);
  }, []);

  const loadSetups = useCallback(async () => {
    const { data } = await supabase.from('setups').select('*').order('confluence_score', { ascending: false }).limit(50);
    if (data) setSetups(data as Setup[]);
  }, []);

  useEffect(() => {
    loadSetups();
    supabase.from('trades').select('*').order('opened_at', { ascending: false }).limit(50)
      .then(({ data }) => { if (data) setTrades(data as Trade[]); });
    supabase.from('knowledge_base').select('*').order('source_episode').limit(100)
      .then(({ data }) => { if (data) setArticles(data as KBArticle[]); });
  }, [loadSetups]);

  const loadPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/prices', { cache: 'no-store' });
      const data = await res.json();
      if (data.prices) {
        setPrevPrices(prices);
        setPrices(data.prices);
      }
    } catch (e) { console.error(e); }
  }, [prices]);

  const loadKz = useCallback(async () => {
    try {
      const res = await fetch('/api/killzone', { cache: 'no-store' });
      const data = await res.json();
      setKz(data);
    } catch (e) { console.error(e); }
  }, []);

  const loadNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news', { cache: 'no-store' });
      const data = await res.json();
      setNewsEvents(data.events ?? []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    loadPrices(); loadKz(); loadNews();
    const pi = setInterval(loadPrices, 15000);
    const ki = setInterval(loadKz, 60000);
    const ni = setInterval(loadNews, 300000);
    return () => { clearInterval(pi); clearInterval(ki); clearInterval(ni); };
  }, [loadPrices, loadKz, loadNews]);

  // Deduplicated live monitoring — only active/watching, fires once per setup
  const firedAlerts = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!prices.NQ && !prices.ES) return;
    setups.forEach(s => {
      if (!['active', 'watching'].includes(s.status)) return;
      if (s.expires_at && new Date(s.expires_at) < new Date()) return;
      const price = prices[s.symbol as keyof Prices];
      if (!price) return;
      const isBull = s.direction === 'bull' || s.direction === 'long';
      const slKey = `sl-${s.id}`;
      if (!firedAlerts.current.has(slKey) && ((isBull && price < s.stop_loss) || (!isBull && price > s.stop_loss))) {
        firedAlerts.current.add(slKey);
        addAlert(`🔴 SL BREACHED — ${s.symbol} ${s.setup_type} SL ${fmt(s.stop_loss)} | Now: ${price.toFixed(1)}`, 'red');
      }
      const entryKey = `entry-${s.id}`;
      if (!firedAlerts.current.has(entryKey) && price >= s.entry_low && price <= s.entry_high) {
        firedAlerts.current.add(entryKey);
        addAlert(`🟢 IN ENTRY ZONE — ${s.symbol} ${s.setup_type} ${fmt(s.entry_low)}–${fmt(s.entry_high)}`, 'green');
      }
      const tpKey = `tp-${s.id}`;
      if (!firedAlerts.current.has(tpKey) && ((isBull && price >= s.target) || (!isBull && price <= s.target))) {
        firedAlerts.current.add(tpKey);
        addAlert(`🎯 TARGET HIT — ${s.symbol} ${s.setup_type} TP ${fmt(s.target)}!`, 'blue');
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices]);

  // Enrich setups with live data
  const liveSetups: LiveSetup[] = setups.map(s => {
    const realScore = calcRealScore(s, kz, newsEvents);
    const isExpired = s.status === 'expired' || (s.expires_at ? new Date(s.expires_at) < new Date() : false);
    const price = prices[s.symbol as keyof Prices];
    const isBull = s.direction === 'bull' || s.direction === 'long';
    const slBreached = price !== null && (isBull ? price < s.stop_loss : price > s.stop_loss);
    const inEntryZone = price !== null && price >= s.entry_low && price <= s.entry_high;
    let priceAlert: string | null = null;
    if (slBreached) priceAlert = 'SL BREACHED';
    else if (inEntryZone) priceAlert = 'IN ENTRY ZONE';
    else if (price !== null && isBull && price >= s.target) priceAlert = 'TARGET HIT';
    else if (price !== null && !isBull && price <= s.target) priceAlert = 'TARGET HIT';
    return { ...s, realScore, isExpired, slBreached, inEntryZone, priceAlert };
  });

  const filteredSetups = liveSetups.filter(s => {
    if (scanFilter !== 'all' && s.timeframe !== scanFilter) return false;
    if (htfFilter !== 'all' && s.htf_bias !== htfFilter) return false;
    return true;
  });

  const dangerNews = newsEvents.some(e => e.isDangerZone);
  const activeSetups = liveSetups.filter(s => !s.isExpired && !s.slBreached);

  // Backtest stats
  const wins = trades.filter(t => t.result === 'win').length;
  const winRate = trades.length ? Math.round((wins / trades.length) * 100) : 0;
  const totalPnl = trades.reduce((acc, t) => acc + calcPnl(t), 0);
  const avgRR = trades.length ? (trades.reduce((a, t) => a + Number(t.rr_achieved), 0) / trades.length).toFixed(1) : '0';

  const selectSetup = (s: Setup) => {
    setSelectedSetup(s);
    setAiResponse(s.ai_analysis || '');
  };

  const showOnChart = (s: Setup) => {
    setChartSymbol(s.symbol);
    setChartSetup(s);
    setActiveTab('Chart');
  };

  const runAnalysis = async () => {
    if (!selectedSetup) return;
    // If setup is expired or SL breached — return DO NOT TRADE
    const live = liveSetups.find(s => s.id === selectedSetup.id);
    if (live?.isExpired || live?.slBreached) {
      const reason = live.slBreached ? `SL at ${fmt(selectedSetup.stop_loss)} has been breached` : 'Setup has expired';
      setAiResponse(`⛔ DO NOT TRADE — ${reason}.\n\nThis setup is no longer valid. Price has invalidated the original thesis. Do not enter.\n\nAction: Archive this setup and wait for a new structure to form.`);
      return;
    }
    setAiLoading(true); setAiResponse('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: selectedSetup, prices }),
      });
      const data = await res.json();
      setAiResponse(data.analysis || data.error || 'No response');
    } catch (e) { setAiResponse(String(e)); }
    setAiLoading(false);
  };

  // DOL 5 questions
  const dolQ = selectedSetup ? [
    { q: 'Price location?', a: (() => { const p = prices[selectedSetup.symbol as keyof Prices]; return p ? (p < selectedSetup.entry_low ? `Below entry zone (${p.toFixed(1)})` : p > selectedSetup.entry_high ? `Above entry zone (${p.toFixed(1)})` : `IN ENTRY ZONE (${p.toFixed(1)})`) : '—'; })() },
    { q: 'Draw on Liquidity?', a: `${selectedSetup.dol_target} (${fmt(selectedSetup.target)})` },
    { q: 'PD Array valid?', a: `${selectedSetup.setup_type} — entry ${fmt(selectedSetup.entry_low)}–${fmt(selectedSetup.entry_high)}` },
    { q: 'Liquidity aligned?', a: selectedSetup.correlated_align ? `✓ Aligned (${selectedSetup.symbol === 'NQ' ? 'ES confirms' : 'NQ confirms'})` : '✗ Not confirmed' },
    { q: 'CISD confirmed?', a: selectedSetup.cisd_confirmed ? '✓ Full body close confirmed' : '○ Pending — await close' },
    { q: 'In killzone?', a: kz?.active ? `✓ ${kz.active.name} — ${kz.probability}` : `✗ No killzone (next: ${kz?.upcoming[0]?.name ?? 'none'} in ${kz?.upcoming[0]?.minsAway ?? '?'}m)` },
  ] : [];

  const alertBg = (c: string) => c === 'red' ? 'bg-red-900/80 border-red-700 text-red-200' : c === 'green' ? 'bg-green-900/80 border-green-700 text-green-200' : c === 'blue' ? 'bg-blue-900/80 border-blue-700 text-blue-200' : 'bg-yellow-900/80 border-yellow-700 text-yellow-200';

  return (
    <div className="h-screen bg-gray-950 text-gray-100 font-mono text-sm flex flex-col overflow-hidden">
      {/* Alerts */}
      <div className="fixed top-14 right-3 z-40 flex flex-col gap-1 pointer-events-none">
        {alerts.map(a => (
          <div key={a.id} className={`text-xs px-3 py-1.5 rounded border ${alertBg(a.color)} animate-pulse max-w-sm`}>{a.msg}</div>
        ))}
      </div>

      {/* HEADER */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-blue-400 font-bold text-lg tracking-widest">VECTOR</span>
          <span className="text-gray-600 text-xs">INTELLIGENCE</span>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse ml-1"></span>
          <span className="text-green-400 text-xs">LIVE</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {dangerNews && (
            <span className="text-red-400 font-bold animate-pulse px-2 py-0.5 bg-red-900/30 border border-red-800 rounded">⚠ HIGH IMPACT NEWS — AVOID ENTRIES</span>
          )}
          <KillzoneBadge kz={kz} />
          <div className="flex items-center gap-4 ml-2">
            {(['NQ','ES','GC','DXY','VIX'] as const).map(sym => {
              const p = prices[sym]; const pp = prevPrices[sym];
              const up = p !== null && pp !== null && p > pp;
              const down = p !== null && pp !== null && p < pp;
              return (
                <div key={sym} className="flex items-center gap-0.5">
                  <span className="text-gray-500">{sym}</span>
                  <span className={`ml-1 ${up ? 'text-green-400' : down ? 'text-red-400' : 'text-gray-400'}`}>
                    {p !== null ? p.toFixed(sym === 'VIX' ? 2 : 1) : '—'}
                    {up ? ' ▲' : down ? ' ▼' : ''}
                  </span>
                </div>
              );
            })}
          </div>
          <span className="text-gray-600 ml-2">NY {kz?.nyTime ?? ''}</span>
        </div>
      </header>

      {/* NAV */}
      <nav className="bg-gray-900 border-b border-gray-800 px-4 flex items-center shrink-0">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-xs transition-colors border-b-2 ${activeTab === t ? 'border-blue-400 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {t}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button onClick={() => setShowNewSetup(true)}
            className="text-xs px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors">+ Setup</button>
          <button onClick={() => setShowMarketSync(true)}
            className="text-xs px-3 py-1 bg-green-800 hover:bg-green-700 text-white rounded transition-colors">🔄 Sync</button>
        </div>
      </nav>

      {/* MODALS */}
      {showRisk && selectedSetup && <RiskModal setup={selectedSetup} onClose={() => setShowRisk(false)}/>}
      {showNewSetup && <NewSetupModal onClose={() => setShowNewSetup(false)} onSaved={loadSetups}/>}
      {showMarketSync && <MarketSyncModal prices={prices} kz={kz} onClose={() => setShowMarketSync(false)} onSaved={loadSetups}/>}

      {/* MAIN */}
      <main className="flex-1 overflow-hidden p-3 min-h-0">

        {/* ══ DASHBOARD ══ */}
        {activeTab === 'Dashboard' && (
          <div className="h-full grid grid-cols-12 gap-3 overflow-y-auto">
            {/* Stat cards */}
            <div className="col-span-12 grid grid-cols-6 gap-2">
              {[
                { label: `Win Rate (${trades.length}T)`, value: `${winRate}%`, color: 'text-green-400' },
                { label: 'Backtest P&L', value: `$${Math.round(totalPnl).toLocaleString()}`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: 'Avg R:R', value: `${avgRR}R`, color: 'text-blue-400' },
                { label: 'Active Setups', value: activeSetups.length.toString(), color: 'text-yellow-400' },
                { label: 'Killzone', value: kz?.active?.short ?? (kz?.upcoming[0]?.short ? `${kz.upcoming[0].short} -${kz.upcoming[0].minsAway}m` : 'DEAD'), color: kz?.active ? 'text-green-400' : 'text-red-400' },
                { label: 'News Risk', value: dangerNews ? 'DANGER' : 'CLEAR', color: dangerNews ? 'text-red-400 animate-pulse' : 'text-green-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-2">
                  <div className="text-gray-600 text-xs">{s.label}</div>
                  <div className={`text-lg font-bold mt-0.5 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Setups table */}
            <div className="col-span-8 bg-gray-900 border border-gray-800 rounded p-2 overflow-y-auto max-h-72">
              <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">
                Setups — Real Score = base + killzone + HTF + CISD + volume + news
              </div>
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="text-gray-600 border-b border-gray-800">
                    <th className="text-left py-1">Sym</th><th className="text-left">TF</th>
                    <th className="text-left">Dir</th><th className="text-left">Type</th>
                    <th className="text-left">HTF</th><th className="text-left">CISD</th>
                    <th className="text-left">Vol</th><th className="text-right">Entry</th>
                    <th className="text-right">SL</th><th className="text-right">TP</th>
                    <th className="text-right">Score</th><th className="text-right">Alert</th><th className="text-right">⚙</th>
                  </tr>
                </thead>
                <tbody>
                  {liveSetups.map(s => (
                    <tr key={s.id}
                      onClick={() => selectSetup(s as Setup)}
                      className={`border-b border-gray-800 cursor-pointer transition-colors ${selectedSetup?.id === s.id ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'} ${s.isExpired || s.slBreached ? 'opacity-40' : ''}`}>
                      <td className="py-1 font-bold text-white">{s.symbol}</td>
                      <td className="text-gray-400">{s.timeframe}</td>
                      <td className={dirColor(s.direction)}>{s.direction}</td>
                      <td className="text-blue-300 max-w-24 truncate">{s.setup_type}</td>
                      <td><span className={`px-1 rounded text-xs ${s.htf_bias === 'bullish' ? 'text-green-400' : s.htf_bias === 'bearish' ? 'text-red-400' : 'text-gray-400'}`}>{s.htf_bias?.slice(0,4)}</span></td>
                      <td className={s.cisd_confirmed ? 'text-green-400' : 'text-gray-600'}>{s.cisd_confirmed ? '✓' : '○'}</td>
                      <td><span className={`text-xs ${s.volume_context === 'high' ? 'text-green-400' : s.volume_context === 'medium' ? 'text-yellow-400' : 'text-red-400'}`}>{s.volume_context?.slice(0,3)}</span></td>
                      <td className="text-right text-gray-300">{fmt(s.entry_low)}–{fmt(s.entry_high)}</td>
                      <td className="text-right text-red-400">{fmt(s.stop_loss)}</td>
                      <td className="text-right text-green-400">{fmt(s.target)}</td>
                      <td className="text-right"><ScoreRing score={s.realScore} base={s.confluence_score}/></td>
                      <td className="text-right">
                        {s.priceAlert && (
                          <span className={`text-xs px-1 rounded ${s.priceAlert === 'SL BREACHED' ? 'text-red-400 bg-red-900/30 animate-pulse' : s.priceAlert === 'IN ENTRY ZONE' ? 'text-green-400 bg-green-900/30 animate-pulse' : 'text-blue-400 bg-blue-900/30'}`}>
                            {s.priceAlert}
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <button onClick={(e) => { e.stopPropagation(); showOnChart(s as Setup); }}
                          className="text-gray-600 hover:text-blue-400 ml-1">📈</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!liveSetups.length && <div className="text-center text-gray-600 py-4 text-xs">No setups. Click "+ Setup" or "🔄 Sync" to add.</div>}
            </div>

            {/* AI Panel */}
            <div className="col-span-4 flex flex-col gap-2">
              <div className="bg-gray-900 border border-gray-800 rounded p-2 flex-1 flex flex-col">
                <div className="text-gray-500 text-xs uppercase mb-1">AI Analyst</div>
                {selectedSetup && (
                  <div className="text-xs text-gray-400 mb-1 bg-gray-800 rounded px-2 py-1">
                    <span className="text-white">{selectedSetup.symbol}</span> {selectedSetup.setup_type}
                    {(() => { const live = liveSetups.find(s => s.id === selectedSetup.id); return live?.slBreached ? <span className="ml-1 text-red-400 font-bold">⛔ SL BREACHED</span> : live?.isExpired ? <span className="ml-1 text-gray-600">EXPIRED</span> : null; })()}
                  </div>
                )}
                <div className="flex gap-1 mb-2">
                  <button onClick={runAnalysis} disabled={!selectedSetup || aiLoading}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-1.5 rounded transition-colors">
                    {aiLoading ? 'Analyzing...' : 'Run AI Analysis'}
                  </button>
                  {selectedSetup && (
                    <button onClick={() => setShowRisk(true)}
                      className="px-3 bg-yellow-700 hover:bg-yellow-600 text-white text-xs py-1.5 rounded transition-colors">⚖</button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {aiResponse ? (
                    <pre className={`text-xs leading-relaxed whitespace-pre-wrap font-mono ${aiResponse.startsWith('⛔') ? 'text-red-400' : 'text-gray-300'}`}>{aiResponse}</pre>
                  ) : (
                    <div className="text-gray-700 text-xs">{selectedSetup ? 'Click "Run AI Analysis" for full ICT breakdown' : 'Select a setup → Run AI Analysis'}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Killzones */}
            <div className="col-span-7 bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">Session Killzones — NY Time</div>
              <div className="grid grid-cols-6 gap-1">
                {[
                  { short: 'ASIA', name: 'Asian', time: '7–10PM', color: '#6366f1', desc: 'Range building. Low vol.' },
                  { short: 'LON', name: 'London', time: '2–5AM', color: '#f59e0b', desc: 'Judas swing. Sweep & reverse.' },
                  { short: 'NY', name: 'NY Open', time: '8:30–11AM', color: '#22c55e', desc: 'Main move. Highest vol.' },
                  { short: 'SB', name: 'Silver Bullet', time: '10–11AM', color: '#3b82f6', desc: 'Best 60min of day.' },
                  { short: 'LCL', name: 'Lunch', time: '11:30–1:30PM', color: '#ef4444', desc: 'AVOID. Chop & traps.' },
                  { short: 'NYA', name: 'NY Afternoon', time: '1:30–4PM', color: '#a855f7', desc: 'Continuation or reversal.' },
                ].map(z => {
                  const isActive = kz?.active?.short === z.short;
                  return (
                    <div key={z.short} className={`rounded p-1.5 border transition-all ${isActive ? 'border-current' : 'border-gray-800'}`}
                      style={{ background: isActive ? z.color + '20' : '#111318' }}>
                      <div className="font-bold text-xs" style={{ color: z.color }}>{z.short}</div>
                      <div className="text-gray-500 text-xs">{z.time}</div>
                      <div className="text-gray-600 text-xs mt-0.5 leading-tight">{z.desc}</div>
                      {isActive && <div className="text-xs mt-0.5 font-bold animate-pulse" style={{ color: z.color }}>ACTIVE</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Macro Calendar */}
            <div className="col-span-5 bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">Macro Calendar</div>
              <div className="text-gray-600 text-xs mb-1">UPCOMING:</div>
              {newsEvents.filter(e => e.minutesAway === null || e.minutesAway > -60).slice(0, 6).map((e, i) => (
                <div key={i} className={`text-xs flex justify-between py-0.5 ${e.isDangerZone ? 'text-red-400 animate-pulse' : e.isToday ? 'text-yellow-400' : 'text-gray-600'}`}>
                  <span>{e.name}</span>
                  <span>{e.isToday ? (e.minutesAway !== null ? (e.minutesAway > 0 ? `in ${e.minutesAway}m` : `${Math.abs(e.minutesAway)}m ago`) : 'TODAY') : e.date}</span>
                </div>
              ))}
              {!newsEvents.some(e => e.isToday) && <div className="text-green-400 text-xs">✓ No high-impact events today</div>}
            </div>

            {/* DOL Framework */}
            <div className="col-span-12 bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">DOL Framework — 5 Questions + Killzone Check</div>
              <div className="grid grid-cols-6 gap-2">
                {dolQ.length ? dolQ.map((q, i) => (
                  <div key={i} className={`rounded p-2 ${i === 5 ? 'bg-blue-900/20 border border-blue-900' : 'bg-gray-800'}`}>
                    <div className="text-xs font-bold text-blue-400">Q{i + 1}</div>
                    <div className="text-gray-600 text-xs">{q.q}</div>
                    <div className="text-white text-xs mt-0.5 leading-snug">{q.a}</div>
                  </div>
                )) : Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className={`rounded p-2 ${i === 5 ? 'bg-blue-900/20 border border-blue-900' : 'bg-gray-800'}`}>
                    <div className="text-xs font-bold text-blue-400">{i < 5 ? `Q${i + 1}` : 'KZ'}</div>
                    <div className="text-gray-600 text-xs">{['Price location?','Draw on Liquidity?','PD Array valid?','Liquidity aligned?','CISD confirmed?','In killzone?'][i]}</div>
                    <div className="text-gray-700 text-xs mt-0.5">—</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══ CHART ══ */}
        {activeTab === 'Chart' && (
          <div className="flex flex-col gap-2 h-full">
            <div className="flex gap-2 items-center flex-wrap shrink-0">
              <div className="flex gap-1">
                {['NQ','ES'].map(s => (
                  <button key={s} onClick={() => { setChartSymbol(s); setChartSetup(null); }}
                    className={`text-xs px-3 py-1 rounded ${chartSymbol===s ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{s}</button>
                ))}
              </div>
              <div className="flex gap-1">
                {['15m','1h','4h','D'].map(t => (
                  <button key={t} onClick={() => setChartTf(t)}
                    className={`text-xs px-3 py-1 rounded ${chartTf===t ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{t}</button>
                ))}
              </div>
              <KillzoneBadge kz={kz} />
              {dangerNews && <span className="text-red-400 text-xs animate-pulse">⚠ NEWS</span>}
              {chartSetup && (
                <div className="flex items-center gap-2 bg-gray-800 px-2 py-1 rounded text-xs ml-2">
                  <span className="text-green-400">●</span>
                  <span>{chartSetup.symbol} {chartSetup.setup_type}</span>
                  <button onClick={() => setChartSetup(null)} className="text-gray-500 hover:text-red-400">✕</button>
                </div>
              )}
              <button onClick={() => setShowMarketSync(true)} className="ml-auto text-xs px-2 py-1 bg-green-800 hover:bg-green-700 text-white rounded">🔄 Sync</button>
            </div>
            {chartSetup && (
              <div className="flex gap-4 text-xs shrink-0 items-center">
                <span className="text-green-400">▬ Entry {fmt(chartSetup.entry_low)}–{fmt(chartSetup.entry_high)}</span>
                <span className="text-red-400">▬ SL {fmt(chartSetup.stop_loss)}</span>
                <span className="text-blue-400">▬ TP {fmt(chartSetup.target)}</span>
                <span className="text-gray-500">{fmt(chartSetup.rr_ratio,1)}R · Real {liveSetups.find(s=>s.id===chartSetup.id)?.realScore ?? '?'}</span>
                <span className={`px-1 rounded text-xs ${chartSetup.cisd_confirmed ? 'text-green-400 bg-green-900/30' : 'text-yellow-400 bg-yellow-900/30'}`}>
                  CISD {chartSetup.cisd_confirmed ? '✓' : 'PENDING'}
                </span>
              </div>
            )}
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded overflow-hidden min-h-0">
              <CandleChart symbol={chartSymbol} tf={chartTf} setup={chartSetup} />
            </div>
            <div className="shrink-0 flex gap-2 flex-wrap">
              <span className="text-gray-600 text-xs">Setups:</span>
              {liveSetups.filter(s => s.symbol === chartSymbol).map(s => (
                <button key={s.id} onClick={() => setChartSetup(s as Setup)}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${chartSetup?.id===s.id ? 'border-blue-400 bg-blue-900/30 text-blue-300' : 'border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-500'}`}>
                  <span className={dirColor(s.direction)}>{s.direction}</span> {s.timeframe} {s.setup_type.slice(0,12)} <span className={s.realScore >= 70 ? 'text-green-400' : s.realScore >= 50 ? 'text-yellow-400' : 'text-red-400'}>{s.realScore}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══ SCANNER ══ */}
        {activeTab === 'Scanner' && (
          <div className="flex flex-col gap-2 h-full overflow-y-auto">
            <div className="flex gap-2 items-center flex-wrap shrink-0">
              <div className="flex gap-1">
                <span className="text-gray-600 text-xs mr-1">TF:</span>
                {['all','15m','1H','4H','D'].map(f => (
                  <button key={f} onClick={() => setScanFilter(f)}
                    className={`text-xs px-2 py-0.5 rounded ${scanFilter===f ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{f}</button>
                ))}
              </div>
              <div className="flex gap-1 ml-3">
                <span className="text-gray-600 text-xs mr-1">HTF Bias:</span>
                {['all','bullish','bearish','neutral'].map(f => (
                  <button key={f} onClick={() => setHtfFilter(f)}
                    className={`text-xs px-2 py-0.5 rounded ${htfFilter===f ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{f}</button>
                ))}
              </div>
              <span className="text-gray-600 text-xs ml-auto">{filteredSetups.length} setups</span>
            </div>
            <div className="grid grid-cols-3 gap-2 overflow-y-auto pb-2">
              {filteredSetups.map(s => (
                <div key={s.id} className={`bg-gray-900 border rounded p-2 ${s.isExpired || s.slBreached ? 'opacity-30 border-gray-800' : s.realScore >= 70 ? 'border-green-900 hover:border-green-700' : s.realScore >= 50 ? 'border-yellow-900 hover:border-yellow-700' : 'border-red-900 hover:border-red-700'} transition-colors`}>
                  <div className="flex justify-between items-start mb-1">
                    <div>
                      <span className="text-white font-bold">{s.symbol}</span>
                      <span className="text-gray-500 text-xs ml-1">{s.timeframe}</span>
                      <span className={`ml-1 text-xs ${dirColor(s.direction)}`}>{s.direction.toUpperCase()}</span>
                    </div>
                    <ScoreRing score={s.realScore} base={s.confluence_score} />
                  </div>
                  <div className="text-blue-300 text-xs mb-1">{s.setup_type}</div>
                  <div className="grid grid-cols-3 gap-x-2 text-xs mb-1">
                    <div><span className="text-gray-600">E </span><span className="text-gray-300">{fmt(s.entry_low)}</span></div>
                    <div><span className="text-red-600">SL </span><span className="text-gray-300">{fmt(s.stop_loss)}</span></div>
                    <div><span className="text-green-600">TP </span><span className="text-gray-300">{fmt(s.target)}</span></div>
                  </div>
                  {s.priceAlert && (
                    <div className={`text-xs px-1 rounded mb-1 ${s.priceAlert === 'SL BREACHED' ? 'bg-red-900/40 text-red-400' : s.priceAlert === 'IN ENTRY ZONE' ? 'bg-green-900/40 text-green-400 animate-pulse' : 'bg-blue-900/40 text-blue-400'}`}>
                      {s.priceAlert}
                    </div>
                  )}
                  <div className="flex gap-1 flex-wrap mb-1">
                    <span className={`text-xs px-1 rounded ${s.htf_bias === 'bullish' ? 'bg-green-900/50 text-green-400' : s.htf_bias === 'bearish' ? 'bg-red-900/50 text-red-400' : 'bg-gray-700 text-gray-400'}`}>HTF:{s.htf_bias?.slice(0,4)}</span>
                    <span className={`text-xs px-1 rounded ${s.cisd_confirmed ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{s.cisd_confirmed ? 'CISD✓' : 'CISD○'}</span>
                    <span className={`text-xs px-1 rounded ${s.volume_context === 'high' ? 'bg-green-900/50 text-green-400' : s.volume_context === 'medium' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-red-900/50 text-red-400'}`}>VOL:{s.volume_context?.slice(0,3)}</span>
                    {(s.isExpired || s.slBreached) && <span className="text-xs px-1 rounded bg-gray-800 text-gray-600">{s.slBreached ? 'SL HIT' : 'EXPIRED'}</span>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { selectSetup(s as Setup); setActiveTab('Dashboard'); }}
                      className="flex-1 text-xs py-0.5 bg-gray-700 hover:bg-gray-600 rounded">Select</button>
                    <button onClick={() => showOnChart(s as Setup)}
                      className="flex-1 text-xs py-0.5 bg-blue-800 hover:bg-blue-600 rounded">📈 Chart</button>
                    <button onClick={() => { selectSetup(s as Setup); setShowRisk(true); }}
                      className="text-xs px-2 py-0.5 bg-yellow-800 hover:bg-yellow-700 rounded">⚖</button>
                  </div>
                </div>
              ))}
              {!filteredSetups.length && (
                <div className="col-span-3 text-center text-gray-600 py-12 text-xs">
                  No setups match filters. <button onClick={() => setShowNewSetup(true)} className="text-blue-400 underline">Add a setup</button> or <button onClick={() => setShowMarketSync(true)} className="text-green-400 underline">sync with market</button>.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ KNOWLEDGE ══ */}
        {activeTab === 'Knowledge' && (
          <div className="flex flex-col gap-2 h-full overflow-hidden">
            <input type="text" placeholder="Search knowledge base..." value={searchKB}
              onChange={e => setSearchKB(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500 shrink-0"/>
            <div className="text-gray-600 text-xs shrink-0">
              {articles.filter(a => !searchKB || a.title?.toLowerCase().includes(searchKB.toLowerCase()) || a.content?.toLowerCase().includes(searchKB.toLowerCase())).length} of {articles.length} articles
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-2 pb-4">
                {articles.filter(a => !searchKB || a.title?.toLowerCase().includes(searchKB.toLowerCase()) || a.content?.toLowerCase().includes(searchKB.toLowerCase())).map(a => (
                  <div key={a.id} className="bg-gray-900 border border-gray-800 rounded p-2">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-white text-xs font-bold">{a.title}</span>
                      <span className="text-blue-400 text-xs ml-2 shrink-0">{a.source_episode}</span>
                    </div>
                    <span className="text-yellow-600 text-xs px-1 rounded bg-yellow-900/20">{a.category}</span>
                    <p className="text-gray-400 text-xs mt-1 leading-relaxed">{a.content}</p>
                    {a.tags?.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1">
                        {a.tags.map((tag: string) => <span key={tag} className="text-xs text-gray-600 bg-gray-800 px-1 rounded">{tag}</span>)}
                      </div>
                    )}
                  </div>
                ))}
                {!articles.length && <div className="col-span-2 text-center text-gray-600 py-8">Loading...</div>}
              </div>
            </div>
          </div>
        )}

        {/* ══ BACKTEST ══ */}
        {activeTab === 'Backtest' && (
          <div className="space-y-3 overflow-y-auto h-full">
            <div className="bg-yellow-900/20 border border-yellow-800 rounded px-3 py-1.5 text-xs text-yellow-400">
              ⚠ Sample backtest data — not a verified track record. Log real trades in Journal for statistical validation.
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Total Trades', value: trades.length.toString(), color: 'text-white' },
                { label: 'Win Rate', value: `${winRate}%`, color: 'text-green-400' },
                { label: 'Net P&L (est)', value: `$${Math.round(totalPnl).toLocaleString()}`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: 'Avg R:R', value: `${avgRR}R`, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-2">
                  <div className="text-gray-500 text-xs">{s.label}</div>
                  <div className={`text-xl font-bold mt-0.5 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-2">Trade History</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600 border-b border-gray-800">
                    <th className="text-left py-1">Date</th><th className="text-left">Sym</th><th className="text-left">Dir</th>
                    <th className="text-right">Entry</th><th className="text-right">SL</th><th className="text-right">TP</th>
                    <th className="text-right">P&L</th><th className="text-right">R:R</th><th className="text-right">Result</th>
                    <th className="text-left pl-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => {
                    const pnl = calcPnl(t);
                    return (
                      <tr key={t.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                        <td className="py-1 text-gray-500">{new Date(t.opened_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</td>
                        <td className="text-white font-bold">{t.symbol}</td>
                        <td className={dirColor(t.direction)}>{t.direction}</td>
                        <td className="text-right text-gray-300">{fmt(t.entry_price)}</td>
                        <td className="text-right text-red-400">{fmt(t.stop_loss)}</td>
                        <td className="text-right text-green-400">{fmt(t.take_profit)}</td>
                        <td className={`text-right ${pnl>=0?'text-green-400':'text-red-400'}`}>${Math.round(pnl).toLocaleString()}</td>
                        <td className="text-right text-gray-300">{Number(t.rr_achieved).toFixed(1)}R</td>
                        <td className={`text-right font-bold ${t.result==='win'?'text-green-400':'text-red-400'}`}>{t.result?.toUpperCase()}</td>
                        <td className="pl-2 text-gray-600 text-xs max-w-xs truncate">{t.notes}</td>
                      </tr>
                    );
                  })}
                  {!trades.length && <tr><td colSpan={10} className="py-4 text-center text-gray-600">Loading trades...</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══ JOURNAL ══ */}
        {activeTab === 'Journal' && <JournalTab />}

      </main>
    </div>
  );
}
