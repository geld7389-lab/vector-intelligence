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

const TABS = ['Dashboard','Chart','Scanner','Knowledge','Backtest'] as const;
type Tab = typeof TABS[number];

function calcPnl(t: Trade): number {
  const pts = t.result === 'win'
    ? Math.abs(t.take_profit - t.entry_price)
    : -Math.abs(t.entry_price - t.stop_loss);
  return pts * (t.symbol === 'NQ' ? 20 : 50);
}

// ── REALTIME SCORE (adds killzone+bias+volume+cisd+news to base score) ──
function calcRealScore(s: Setup, kz: KillzoneData | null, newsEvents: NewsEvent[]): number {
  let score = s.confluence_score;
  const dangerNews = newsEvents.some(e => e.isDangerZone);
  if (dangerNews) return Math.max(0, score - 40); // news kills the score
  const kzValid = s.killzone_valid.split(',');
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
    const chartW = W - PL - PR, chartH = H - PT - PB;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0c12'; ctx.fillRect(0, 0, W, H);

    const visible = candles.slice(-100);
    let hi = Math.max(...visible.map(c => c.h));
    let lo = Math.min(...visible.map(c => c.l));
    if (setup?.symbol === symbol) {
      hi = Math.max(hi, setup.stop_loss, setup.target, setup.entry_high);
      lo = Math.min(lo, setup.stop_loss, setup.target, setup.entry_low);
    }
    const pad = (hi - lo) * 0.06;
    const top = hi + pad, bot = lo - pad, range = top - bot;
    const toY = (p: number) => PT + ((top - p) / range) * chartH;
    const cw = Math.max(2, Math.floor(chartW / visible.length) - 1);
    const gap = (chartW - visible.length * cw) / (visible.length + 1);

    // Grid
    for (let i = 0; i <= 6; i++) {
      const p = bot + (range * i / 6);
      const y = toY(p);
      ctx.strokeStyle = '#1a1e2e'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
      ctx.fillStyle = '#4a5568'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(p.toFixed(0), PL - 3, y + 3);
    }

    // Setup overlay
    if (setup?.symbol === symbol) {
      // Entry zone
      const ezT = toY(setup.entry_high), ezB = toY(setup.entry_low);
      ctx.fillStyle = 'rgba(34,197,94,0.10)'; ctx.fillRect(PL, ezT, chartW, ezB - ezT);
      ctx.setLineDash([5, 3]); ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(PL, ezT); ctx.lineTo(W-PR, ezT); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PL, ezB); ctx.lineTo(W-PR, ezB); ctx.stroke();
      // SL
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5;
      const slY = toY(setup.stop_loss);
      ctx.beginPath(); ctx.moveTo(PL, slY); ctx.lineTo(W-PR, slY); ctx.stroke();
      // Target
      ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5;
      const tpY = toY(setup.target);
      ctx.beginPath(); ctx.moveTo(PL, tpY); ctx.lineTo(W-PR, tpY); ctx.stroke();
      ctx.setLineDash([]);
      // Labels
      ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = '#22c55e';
      ctx.fillText(`ENTRY ${setup.entry_low}–${setup.entry_high}`, PL+4, ezB - 3);
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`SL  ${setup.stop_loss}`, PL+4, slY - 3);
      ctx.fillStyle = '#3b82f6';
      ctx.fillText(`TP  ${setup.target}`, PL+4, tpY + 12);
    }

    // Candles
    visible.forEach((c, i) => {
      const x = PL + gap + i * (cw + gap);
      const isUp = c.c >= c.o;
      const col = isUp ? '#22c55e' : '#ef4444';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      const wx = x + cw / 2;
      ctx.beginPath(); ctx.moveTo(wx, toY(c.h)); ctx.lineTo(wx, toY(c.l)); ctx.stroke();
      const bT = toY(Math.max(c.o, c.c)), bB = toY(Math.min(c.o, c.c));
      ctx.fillRect(x, bT, cw, Math.max(1, bB - bT));
      if (hovered === i) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(x-1, PT, cw+2, chartH);
      }
    });

    // Volume bars
    const maxVol = Math.max(...visible.map(c => c.v ?? 0));
    if (maxVol > 0) {
      visible.forEach((c, i) => {
        if (!c.v) return;
        const x = PL + gap + i * (cw + gap);
        const vh = Math.max(1, ((c.v / maxVol) * 30));
        ctx.fillStyle = c.c >= c.o ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';
        ctx.fillRect(x, PT + chartH - vh, cw, vh);
      });
    }

    // Time labels
    ctx.fillStyle = '#374151'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    [0, 25, 50, 75, 99].forEach(idx => {
      const c = visible[Math.min(idx, visible.length-1)];
      if (!c) return;
      const x = PL + gap + Math.min(idx, visible.length-1) * (cw+gap) + cw/2;
      const d = new Date(c.t);
      const lbl = tf === 'D'
        ? d.toLocaleDateString('en-US', { month:'short', day:'numeric' })
        : d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'America/New_York' });
      ctx.fillText(lbl, x, H - 6);
    });

    // Hover OHLC
    if (hovered !== null) {
      const c = visible[hovered];
      if (c) {
        ctx.fillStyle = 'rgba(10,12,18,0.92)'; ctx.fillRect(PL+2, PT+2, 330, 16);
        ctx.fillStyle = c.c >= c.o ? '#22c55e' : '#ef4444';
        ctx.font = '10px monospace'; ctx.textAlign = 'left';
        ctx.fillText(`O:${c.o?.toFixed(2)} H:${c.h?.toFixed(2)} L:${c.l?.toFixed(2)} C:${c.c?.toFixed(2)} V:${(c.v||0).toLocaleString()}`, PL+6, PT+13);
      }
    }
  }, [candles, setup, symbol, hovered]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !candles.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const PL = 72;
    const chartW = canvasRef.current.width - PL - 8;
    const visible = candles.slice(-100);
    const cw = Math.max(2, Math.floor(chartW / visible.length) - 1);
    const gap = (chartW - visible.length * cw) / (visible.length + 1);
    const idx = Math.floor((x - PL - gap) / (cw + gap));
    setHovered(idx >= 0 && idx < visible.length ? idx : null);
  };

  if (loading) return <div className="flex items-center justify-center h-full text-gray-600 text-xs">Loading {symbol} {tf} candles from Yahoo Finance...</div>;
  if (error) return <div className="flex flex-col items-center justify-center h-full gap-2"><div className="text-red-400 text-xs">{error}</div><button onClick={load} className="px-3 py-1 bg-blue-600 text-white rounded text-xs">Retry</button></div>;
  return <canvas ref={canvasRef} width={1400} height={580} className="w-full h-full" style={{ imageRendering: 'crisp-edges' }} onMouseMove={onMove} onMouseLeave={() => setHovered(null)} />;
}

// ── KILLZONE BADGE ────────────────────────────────────────────────────
function KillzoneBadge({ kz }: { kz: KillzoneData | null }) {
  if (!kz) return <span className="text-gray-600 text-xs">Loading...</span>;
  const prob = kz.probability;
  const cls = prob === 'HIGHEST' ? 'bg-blue-900 text-blue-300 border-blue-600'
    : prob === 'HIGH' ? 'bg-green-900 text-green-300 border-green-600'
    : prob === 'MEDIUM' ? 'bg-yellow-900 text-yellow-300 border-yellow-600'
    : prob === 'AVOID' ? 'bg-red-900 text-red-300 border-red-600 animate-pulse'
    : prob === 'DEAD' ? 'bg-gray-800 text-gray-500 border-gray-700'
    : 'bg-gray-800 text-gray-400 border-gray-600';
  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded border text-xs ${cls}`}>
      <span className="font-bold">{kz.active?.short ?? 'OFF'}</span>
      <span>{kz.active?.name ?? 'Out of session'}</span>
      <span className="text-xs opacity-70">· {prob}</span>
    </div>
  );
}

// ── SCORE RING ────────────────────────────────────────────────────────
function ScoreRing({ score, base }: { score: number; base: number }) {
  const color = score >= 75 ? '#22c55e' : score >= 55 ? '#f59e0b' : '#ef4444';
  const delta = score - base;
  return (
    <div className="flex items-center gap-1">
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r="11" fill="none" stroke="#1e2130" strokeWidth="3"/>
        <circle cx="14" cy="14" r="11" fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${(score / 100) * 69.1} 69.1`}
          strokeLinecap="round" transform="rotate(-90 14 14)"/>
        <text x="14" y="18" textAnchor="middle" fontSize="8" fill={color} fontFamily="monospace">{score}</text>
      </svg>
      {delta !== 0 && (
        <span className={`text-xs ${delta < 0 ? 'text-red-400' : 'text-green-400'}`}>
          {delta > 0 ? '+' : ''}{delta}
        </span>
      )}
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────
export default function VectorPlatform() {
  const [activeTab, setActiveTab] = useState<Tab>('Dashboard');
  const [prices, setPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [prevPrices, setPrevPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [setups, setSetups] = useState<Setup[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [kz, setKz] = useState<KillzoneData | null>(null);
  const [newsEvents, setNewsEvents] = useState<NewsEvent[]>([]);
  const [dangerNews, setDangerNews] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [clock, setClock] = useState('');
  const [selectedSetup, setSelectedSetup] = useState<Setup | null>(null);
  const [chartSetup, setChartSetup] = useState<Setup | null>(null);
  const [searchKB, setSearchKB] = useState('');
  const [chartTf, setChartTf] = useState('15m');
  const [chartSymbol, setChartSymbol] = useState('NQ');
  const [scanFilter, setScanFilter] = useState('all');
  const [htfFilter, setHtfFilter] = useState('all');

  // Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true }));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);

  // Prices
  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/prices', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setPrevPrices(p => ({ ...p })); setPrices(data);
    } catch {}
  }, []);
  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, 15000);
    return () => clearInterval(id);
  }, [fetchPrices]);

  // Killzone — refresh every minute
  const fetchKz = useCallback(async () => {
    try {
      const res = await fetch('/api/killzone', { cache: 'no-store' });
      const data = await res.json();
      setKz(data);
    } catch {}
  }, []);
  useEffect(() => {
    fetchKz();
    const id = setInterval(fetchKz, 60000);
    return () => clearInterval(id);
  }, [fetchKz]);

  // News/macro calendar
  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news', { cache: 'no-store' });
      const data = await res.json();
      setNewsEvents(data.events ?? []);
      setDangerNews(data.dangerNow ?? false);
    } catch {}
  }, []);
  useEffect(() => {
    fetchNews();
    const id = setInterval(fetchNews, 60000);
    return () => clearInterval(id);
  }, [fetchNews]);

  // Supabase
  useEffect(() => {
    Promise.all([
      supabase.from('setups').select('*').order('confluence_score', { ascending: false }),
      supabase.from('trades').select('*').order('opened_at', { ascending: false }),
      supabase.from('knowledge_base').select('*').order('category'),
    ]).then(([s, t, k]) => {
      if (s.data?.length) { setSetups(s.data); setSelectedSetup(s.data[0]); }
      if (t.data) setTrades(t.data);
      if (k.data) setArticles(k.data);
    });
  }, []);

  // Auto-expire setups client-side
  const liveSetups = setups.map(s => ({
    ...s,
    realScore: calcRealScore(s, kz, newsEvents),
    isExpired: s.expires_at ? new Date(s.expires_at) < new Date() : false,
  }));

  const selectSetup = (s: Setup) => { setSelectedSetup(s); setAiResponse(''); };
  const showOnChart = (s: Setup) => {
    setChartSetup(s); setChartSymbol(s.symbol);
    setChartTf(s.timeframe === '1H' ? '1h' : s.timeframe === '4H' ? '4h' : s.timeframe.toLowerCase());
    setActiveTab('Chart');
  };

  const runAI = async () => {
    if (!selectedSetup) return;
    setAiLoading(true); setAiResponse('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: selectedSetup, prices, killzone: kz, newsEvents }),
      });
      const data = await res.json();
      setAiResponse(data.analysis || data.error || 'No response');
    } catch (e: any) { setAiResponse('Error: ' + e.message); }
    setAiLoading(false);
  };

  const fmt = (n: number | null | undefined, dec = 2) => n == null ? '—' : Number(n).toFixed(dec);
  const arrowCls = (cur: number | null, prev: number | null) => {
    if (!cur || !prev || cur === prev) return { arrow: '', cls: 'text-gray-400' };
    return cur > prev ? { arrow: ' ▲', cls: 'text-green-400' } : { arrow: ' ▼', cls: 'text-red-400' };
  };
  const dirColor = (d: string) =>
    d === 'bull' || d === 'long' ? 'text-green-400' :
    d === 'bear' || d === 'short' ? 'text-red-400' : 'text-purple-400';
  const scoreColor = (s: number) =>
    s >= 75 ? 'bg-green-900/60 text-green-300' : s >= 55 ? 'bg-yellow-900/60 text-yellow-300' : 'bg-red-900/60 text-red-300';

  const wins = trades.filter(t => t.result === 'win').length;
  const winRate = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const totalPnl = trades.reduce((a, t) => a + calcPnl(t), 0);
  const avgRR = trades.length ? (trades.reduce((a, t) => a + Number(t.rr_achieved || 0), 0) / trades.length).toFixed(1) : '0';

  const filteredSetups = liveSetups.filter(s => {
    if (scanFilter !== 'all' && s.timeframe !== scanFilter) return false;
    if (htfFilter !== 'all' && s.htf_bias !== htfFilter) return false;
    return true;
  });

  const todayNews = newsEvents.filter(e => e.isToday);
  const upcomingNews = newsEvents.filter(e => !e.isToday).slice(0, 4);

  const selectedReal = liveSetups.find(s => s.id === selectedSetup?.id);

  return (
    <div className="h-screen bg-gray-950 text-gray-100 font-mono text-sm flex flex-col overflow-hidden">

      {/* ── HEADER ── */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-blue-400 font-bold text-lg tracking-widest">VECTOR</span>
          <span className="text-gray-600 text-xs">INTELLIGENCE</span>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse ml-1" />
          <span className="text-green-400 text-xs">LIVE</span>
          {dangerNews && (
            <span className="ml-2 px-2 py-0.5 bg-red-900 text-red-300 text-xs rounded border border-red-600 animate-pulse">
              ⚠ HIGH IMPACT NEWS — AVOID ENTRIES
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs">
          <KillzoneBadge kz={kz} />
          <div className="flex items-center gap-4 ml-2">
            {(['NQ','ES','GC','DXY','VIX'] as const).map(sym => {
              const cur = prices[sym], prev = prevPrices[sym];
              const { arrow, cls } = arrowCls(cur, prev);
              return (
                <div key={sym} className="flex items-center gap-0.5">
                  <span className="text-gray-500">{sym}</span>
                  <span className={`ml-1 ${cls}`}>{fmt(cur)}{arrow}</span>
                </div>
              );
            })}
          </div>
          <span className="text-gray-600 ml-2">NY {clock}</span>
        </div>
      </header>

      {/* ── TABS ── */}
      <nav className="bg-gray-900 border-b border-gray-800 px-4 flex shrink-0">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-xs transition-colors ${activeTab === t ? 'border-b-2 border-blue-400 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
            {t.toUpperCase()}
          </button>
        ))}
        {/* Killzone info bar */}
        {kz?.active && (
          <div className="ml-auto flex items-center gap-3 text-xs text-gray-600 pr-2">
            <span style={{ color: kz.active.color }}>{kz.active.description}</span>
          </div>
        )}
      </nav>

      <main className="flex-1 overflow-hidden p-3 min-h-0">

        {/* ══════════════════ DASHBOARD ══════════════════ */}
        {activeTab === 'Dashboard' && (
          <div className="h-full grid grid-cols-12 gap-3 overflow-y-auto">

            {/* Stats row */}
            <div className="col-span-12 grid grid-cols-6 gap-2">
              {[
                { label: `Win Rate (${trades.length}T)`, value: `${winRate}%`, color: 'text-green-400' },
                { label: 'Backtest P&L', value: `$${Math.round(totalPnl).toLocaleString()}`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: 'Avg R:R', value: `${avgRR}R`, color: 'text-blue-400' },
                { label: 'Setups', value: liveSetups.filter(s => !s.isExpired).length.toString(), color: 'text-yellow-400' },
                { label: 'Killzone', value: kz?.probability ?? '—', color: kz?.shouldTrade ? 'text-green-400' : 'text-red-400' },
                { label: 'News Risk', value: dangerNews ? 'DANGER' : todayNews.length > 0 ? 'WATCH' : 'CLEAR', color: dangerNews ? 'text-red-400 animate-pulse' : todayNews.length ? 'text-yellow-400' : 'text-green-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-2">
                  <div className="text-gray-600 text-xs">{s.label}</div>
                  <div className={`text-lg font-bold mt-0.5 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Setup table */}
            <div className="col-span-8 bg-gray-900 border border-gray-800 rounded p-2 overflow-y-auto max-h-80">
              <div className="text-gray-500 text-xs mb-1 uppercase tracking-wider">Setups — Real Score = base + killzone + HTF bias + CISD + volume + news</div>
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="text-gray-600 border-b border-gray-800">
                    <th className="text-left py-1">Sym</th>
                    <th className="text-left">TF</th>
                    <th className="text-left">Dir</th>
                    <th className="text-left">Type</th>
                    <th className="text-left">HTF</th>
                    <th className="text-left">CISD</th>
                    <th className="text-left">Vol</th>
                    <th className="text-right">Entry</th>
                    <th className="text-right">SL</th>
                    <th className="text-right">TP</th>
                    <th className="text-right">Score</th>
                    <th className="text-right">📈</th>
                  </tr>
                </thead>
                <tbody>
                  {liveSetups.map(s => (
                    <tr key={s.id} onClick={() => selectSetup(s as Setup)}
                      className={`border-b border-gray-800 cursor-pointer hover:bg-gray-800 transition-colors ${selectedSetup?.id === s.id ? 'bg-gray-800' : ''} ${s.isExpired ? 'opacity-30 line-through' : ''}`}>
                      <td className="py-1 text-white font-bold">{s.symbol}</td>
                      <td className="text-gray-500">{s.timeframe}</td>
                      <td className={dirColor(s.direction)}>{s.direction}</td>
                      <td className="text-blue-300 max-w-xs truncate">{s.setup_type}</td>
                      <td className={`text-xs ${s.htf_bias === 'bullish' ? 'text-green-400' : s.htf_bias === 'bearish' ? 'text-red-400' : 'text-gray-500'}`}>
                        {s.htf_bias?.toUpperCase().slice(0,4)}
                      </td>
                      <td className={s.cisd_confirmed ? 'text-green-400' : 'text-gray-600'}>
                        {s.cisd_confirmed ? '✓' : '○'}
                      </td>
                      <td className={`text-xs ${s.volume_context === 'high' ? 'text-green-400' : s.volume_context === 'medium' ? 'text-yellow-400' : 'text-red-400'}`}>
                        {s.volume_context?.toUpperCase().slice(0,3)}
                      </td>
                      <td className="text-right text-gray-300">{fmt(s.entry_low)}</td>
                      <td className="text-right text-red-400">{fmt(s.stop_loss)}</td>
                      <td className="text-right text-green-400">{fmt(s.target)}</td>
                      <td className="text-right">
                        <ScoreRing score={s.realScore} base={s.confluence_score} />
                      </td>
                      <td className="text-right">
                        <button onClick={e => { e.stopPropagation(); showOnChart(s as Setup); }}
                          className="px-1.5 py-0.5 bg-blue-800 hover:bg-blue-600 rounded text-xs">📈</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Right panel */}
            <div className="col-span-4 flex flex-col gap-2">
              {/* Selected setup detail */}
              {selectedReal && (
                <div className="bg-gray-900 border border-gray-800 rounded p-2">
                  <div className="flex justify-between items-start mb-1">
                    <div className="text-gray-500 text-xs uppercase">Selected</div>
                    <button onClick={() => showOnChart(selectedSetup!)}
                      className="text-xs px-2 py-0.5 bg-blue-700 hover:bg-blue-500 text-white rounded">
                      📈 Chart
                    </button>
                  </div>
                  <div className="text-white font-bold">
                    {selectedReal.symbol} <span className="text-gray-500 text-xs">{selectedReal.timeframe}</span>{' '}
                    <span className={dirColor(selectedReal.direction)}>{selectedReal.direction}</span>
                  </div>
                  <div className="text-blue-300 text-xs mb-2">{selectedReal.setup_type}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs mb-2">
                    <div><span className="text-gray-600">Entry </span><span className="text-white">{fmt(selectedReal.entry_low)}–{fmt(selectedReal.entry_high)}</span></div>
                    <div><span className="text-gray-600">SL </span><span className="text-red-400">{fmt(selectedReal.stop_loss)}</span></div>
                    <div><span className="text-gray-600">Target </span><span className="text-green-400">{fmt(selectedReal.target)}</span></div>
                    <div><span className="text-gray-600">R:R </span><span className="text-blue-400">{fmt(selectedReal.rr_ratio, 1)}R</span></div>
                    <div><span className="text-gray-600">HTF </span><span className={selectedReal.htf_bias === 'bullish' ? 'text-green-400' : selectedReal.htf_bias === 'bearish' ? 'text-red-400' : 'text-gray-400'}>{selectedReal.htf_bias?.toUpperCase()}</span></div>
                    <div><span className="text-gray-600">CISD </span><span className={selectedReal.cisd_confirmed ? 'text-green-400' : 'text-yellow-400'}>{selectedReal.cisd_confirmed ? 'CONFIRMED' : 'PENDING'}</span></div>
                    <div><span className="text-gray-600">Vol </span><span className={selectedReal.volume_context === 'high' ? 'text-green-400' : selectedReal.volume_context === 'medium' ? 'text-yellow-400' : 'text-red-400'}>{selectedReal.volume_context?.toUpperCase()}</span></div>
                    <div><span className="text-gray-600">Real Score </span><span className="text-white font-bold">{selectedReal.realScore}</span></div>
                  </div>
                  <div className="text-gray-600 text-xs">DOL: {selectedReal.dol_target}</div>
                  {selectedReal.isExpired && <div className="text-red-400 text-xs mt-1">⚠ EXPIRED — setup invalidated by time</div>}
                </div>
              )}

              {/* AI */}
              <div className="bg-gray-900 border border-gray-800 rounded p-2 flex-1">
                <div className="text-gray-500 text-xs uppercase mb-1">AI Analyst</div>
                {dangerNews && <div className="text-red-400 text-xs mb-1 bg-red-900/20 px-2 py-1 rounded">⚠ High-impact news imminent — AI recommends no entry</div>}
                {kz && !kz.shouldTrade && !dangerNews && <div className="text-yellow-500 text-xs mb-1 bg-yellow-900/20 px-2 py-1 rounded">⚡ Outside killzone — reduced probability</div>}
                <button onClick={runAI} disabled={aiLoading || !selectedSetup}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-1.5 rounded mb-2 transition-colors">
                  {aiLoading ? 'Analyzing...' : 'Run AI Analysis'}
                </button>
                {aiResponse ? (
                  <div className="text-gray-300 text-xs leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-gray-800 pt-1">{aiResponse}</div>
                ) : selectedSetup?.ai_analysis ? (
                  <div className="text-gray-600 text-xs leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-gray-800 pt-1">
                    <div className="text-gray-700 mb-0.5">Saved:</div>{selectedSetup.ai_analysis}
                  </div>
                ) : (
                  <div className="text-gray-700 text-xs">Select a setup → Run AI Analysis</div>
                )}
              </div>
            </div>

            {/* Killzone + News row */}
            <div className="col-span-7 bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">Session Killzones — NY Time</div>
              <div className="grid grid-cols-6 gap-1">
                {[
                  { short: 'ASIA', name: 'Asian', time: '7–10PM', color: '#6366f1', desc: 'Range building. Low vol.' },
                  { short: 'LON', name: 'London', time: '2–5AM', color: '#f59e0b', desc: 'Judas swing. Sweep & reverse.' },
                  { short: 'NY', name: 'NY Open', time: '8:30–11AM', color: '#22c55e', desc: 'Main move. Highest vol.' },
                  { short: 'SB', name: 'Silver Bullet', time: '10–11AM', color: '#3b82f6', desc: 'Best 60min of day.' },
                  { short: 'LCL', name: 'Lunch', time: '11:30–1:30PM', color: '#ef4444', desc: 'AVOID. Chop & traps.' },
                  { short: 'NYA', name: 'NY PM', time: '1:30–4PM', color: '#a855f7', desc: 'Continuation or reversal.' },
                ].map(z => {
                  const isActive = kz?.active?.short === z.short;
                  return (
                    <div key={z.short} className={`rounded p-1.5 border transition-all ${isActive ? 'border-opacity-100' : 'border-gray-800'}`}
                      style={{ borderColor: isActive ? z.color : undefined, background: isActive ? `${z.color}18` : '#111318' }}>
                      <div className="font-bold text-xs" style={{ color: z.color }}>{z.short}</div>
                      <div className="text-gray-500 text-xs">{z.time}</div>
                      <div className="text-gray-600 text-xs mt-0.5 leading-tight">{z.desc}</div>
                      {isActive && <div className="text-xs mt-0.5 font-bold" style={{ color: z.color }}>● ACTIVE</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* News/Macro calendar */}
            <div className="col-span-5 bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">Macro Calendar</div>
              {todayNews.length > 0 && (
                <div className="mb-1">
                  <div className="text-yellow-500 text-xs mb-1">TODAY:</div>
                  {todayNews.map((e, i) => (
                    <div key={i} className={`flex justify-between items-center text-xs py-0.5 px-1 rounded mb-0.5 ${e.isDangerZone ? 'bg-red-900/40 text-red-300' : 'bg-gray-800 text-gray-300'}`}>
                      <span>{e.time} {e.name}</span>
                      <span className={`px-1 rounded text-xs ${e.impact === 'HIGH' ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}`}>{e.impact}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-gray-600 text-xs mb-1">UPCOMING:</div>
              {upcomingNews.map((e, i) => (
                <div key={i} className="flex justify-between items-center text-xs py-0.5 text-gray-500">
                  <span>{e.date.slice(5)} {e.time} — {e.name}</span>
                  <span className={`text-xs ${e.impact === 'HIGH' ? 'text-red-400' : 'text-yellow-500'}`}>{e.impact}</span>
                </div>
              ))}
              {todayNews.length === 0 && <div className="text-green-400 text-xs">✓ No high-impact events today</div>}
            </div>

            {/* DOL Framework */}
            <div className="col-span-12 bg-gray-900 border border-gray-800 rounded p-2">
              <div className="text-gray-500 text-xs uppercase mb-1">DOL Framework — 5 Questions + Killzone Check</div>
              <div className="grid grid-cols-6 gap-2">
                {[
                  { q:'Q1', label:'Price location?', ans: selectedReal ? `${selectedReal.symbol} @ ${fmt(selectedReal.entry_low)}–${fmt(selectedReal.entry_high)}` : '—' },
                  { q:'Q2', label:'Draw on Liquidity?', ans: selectedReal?.dol_target ?? '—' },
                  { q:'Q3', label:'PD Array valid?', ans: selectedReal?.setup_type ?? '—' },
                  { q:'Q4', label:'Liquidity aligned?', ans: selectedReal ? (selectedReal.realScore >= 70 ? `YES — ${selectedReal.realScore}/100` : `PARTIAL — ${selectedReal.realScore}/100`) : '—' },
                  { q:'Q5', label:'CISD confirmed?', ans: selectedReal ? (selectedReal.cisd_confirmed ? 'YES — full body close ✓' : 'PENDING — wait for close') : '—' },
                  { q:'KZ', label:'In killzone?', ans: kz ? (kz.shouldTrade ? `${kz.active?.name ?? 'Active'} — VALID` : kz.isLunch ? 'LUNCH — SKIP' : 'Off session — WAIT') : '—' },
                ].map(item => (
                  <div key={item.q} className={`rounded p-2 ${item.q === 'KZ' ? 'bg-blue-900/20 border border-blue-900' : 'bg-gray-800'}`}>
                    <div className={`text-xs font-bold ${item.q === 'KZ' ? 'text-blue-400' : 'text-blue-400'}`}>{item.q}</div>
                    <div className="text-gray-600 text-xs">{item.label}</div>
                    <div className="text-white text-xs mt-0.5 leading-snug">{item.ans}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ CHART ══════════════════ */}
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
              {/* Killzone on chart */}
              <KillzoneBadge kz={kz} />
              {dangerNews && <span className="text-red-400 text-xs animate-pulse">⚠ NEWS</span>}
              {chartSetup && (
                <div className="flex items-center gap-2 bg-gray-800 px-2 py-1 rounded text-xs ml-2">
                  <span className="text-green-400">●</span>
                  <span>{chartSetup.symbol} {chartSetup.setup_type}</span>
                  <button onClick={() => setChartSetup(null)} className="text-gray-500 hover:text-red-400">✕</button>
                </div>
              )}
            </div>
            {chartSetup && (
              <div className="flex gap-4 text-xs shrink-0 items-center">
                <span className="text-green-400">▬ Entry {fmt(chartSetup.entry_low)}–{fmt(chartSetup.entry_high)}</span>
                <span className="text-red-400">▬ SL {fmt(chartSetup.stop_loss)}</span>
                <span className="text-blue-400">▬ TP {fmt(chartSetup.target)}</span>
                <span className="text-gray-500">{fmt(chartSetup.rr_ratio,1)}R · Score {chartSetup.confluence_score} → Real {liveSetups.find(s=>s.id===chartSetup.id)?.realScore ?? '?'}</span>
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
                  <span className={dirColor(s.direction)}>{s.direction}</span> {s.timeframe} {s.setup_type.slice(0,12)} <span className={scoreColor(s.realScore).split(' ')[1]}>{s.realScore}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════ SCANNER ══════════════════ */}
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
                <div key={s.id} className={`bg-gray-900 border rounded p-2 ${s.isExpired ? 'opacity-30 border-gray-800' : s.realScore >= 70 ? 'border-green-900 hover:border-green-700' : s.realScore >= 50 ? 'border-yellow-900 hover:border-yellow-700' : 'border-red-900 hover:border-red-700'} transition-colors`}>
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
                  <div className="flex gap-1 flex-wrap mb-1">
                    <span className={`text-xs px-1 rounded ${s.htf_bias === 'bullish' ? 'bg-green-900/50 text-green-400' : s.htf_bias === 'bearish' ? 'bg-red-900/50 text-red-400' : 'bg-gray-700 text-gray-400'}`}>HTF:{s.htf_bias?.slice(0,4)}</span>
                    <span className={`text-xs px-1 rounded ${s.cisd_confirmed ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{s.cisd_confirmed ? 'CISD✓' : 'CISD○'}</span>
                    <span className={`text-xs px-1 rounded ${s.volume_context === 'high' ? 'bg-green-900/50 text-green-400' : s.volume_context === 'medium' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-red-900/50 text-red-400'}`}>VOL:{s.volume_context?.slice(0,3)}</span>
                    {s.isExpired && <span className="text-xs px-1 rounded bg-gray-800 text-gray-600">EXPIRED</span>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { selectSetup(s as Setup); setActiveTab('Dashboard'); }}
                      className="flex-1 text-xs py-0.5 bg-gray-700 hover:bg-gray-600 rounded">Select</button>
                    <button onClick={() => showOnChart(s as Setup)}
                      className="flex-1 text-xs py-0.5 bg-blue-800 hover:bg-blue-600 rounded">📈 Chart</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════ KNOWLEDGE ══════════════════ */}
        {activeTab === 'Knowledge' && (
          <div className="flex flex-col gap-2 h-full overflow-hidden">
            <input type="text" placeholder="Search knowledge base..." value={searchKB}
              onChange={e => setSearchKB(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500 shrink-0"/>
            <div className="text-gray-600 text-xs shrink-0">{articles.filter(a => !searchKB || a.title?.toLowerCase().includes(searchKB.toLowerCase()) || a.content?.toLowerCase().includes(searchKB.toLowerCase())).length} of {articles.length} articles</div>
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

        {/* ══════════════════ BACKTEST ══════════════════ */}
        {activeTab === 'Backtest' && (
          <div className="space-y-3 overflow-y-auto h-full">
            <div className="bg-yellow-900/20 border border-yellow-800 rounded px-3 py-1.5 text-xs text-yellow-400">
              ⚠ Sample backtest data — not a real verified track record. Real journaling required for statistical validation.
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
      </main>
    </div>
  );
}
