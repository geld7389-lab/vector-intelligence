'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Setup {
  id: string; symbol: string; timeframe: string; direction: string;
  setup_type: string; entry_low: number; entry_high: number;
  stop_loss: number; target: number; rr_ratio: number;
  confluence_score: number; status: string; dol_target: string; ai_analysis: string;
  created_at: string;
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

const TABS = ['Dashboard','Chart','Scanner','Knowledge','Backtest'] as const;
type Tab = typeof TABS[number];

function calcPnl(t: Trade): number {
  const isLong = t.direction === 'long';
  const pts = t.result === 'win'
    ? Math.abs(t.take_profit - t.entry_price)
    : -Math.abs(t.entry_price - t.stop_loss);
  return pts * (t.symbol === 'NQ' ? 20 : 50);
}

// ── CHART COMPONENT ──────────────────────────────────────────────────
function CandleChart({ symbol, tf, setup }: { symbol: string; tf: string; setup: Setup|null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hoveredIdx, setHoveredIdx] = useState<number|null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/candles?symbol=${symbol}&tf=${tf}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.error) { setError(data.error); setLoading(false); return; }
      setCandles(data.candles ?? []);
    } catch(e) { setError(String(e)); }
    setLoading(false);
  }, [symbol, tf]);

  useEffect(() => { load(); }, [load]);
  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!candles.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const PAD_L = 70, PAD_R = 10, PAD_T = 20, PAD_B = 30;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, W, H);

    const visible = candles.slice(-100);
    const highs = visible.map(c => c.h);
    const lows  = visible.map(c => c.l);
    let priceHigh = Math.max(...highs);
    let priceLow  = Math.min(...lows);

    // Expand range to include setup levels if present
    if (setup && setup.symbol === symbol) {
      priceHigh = Math.max(priceHigh, setup.stop_loss, setup.target, setup.entry_high);
      priceLow  = Math.min(priceLow,  setup.stop_loss, setup.target, setup.entry_low);
    }
    const priceRange = priceHigh - priceLow || 1;
    const pad = priceRange * 0.05;
    const lo = priceLow - pad, hi = priceHigh + pad;
    const range = hi - lo;

    const toY = (p: number) => PAD_T + ((hi - p) / range) * chartH;
    const candleW = Math.max(2, Math.floor(chartW / visible.length) - 1);
    const gap = (chartW - visible.length * candleW) / (visible.length + 1);

    // Grid lines
    const gridCount = 6;
    ctx.strokeStyle = '#1e2130';
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridCount; i++) {
      const price = lo + (range * i / gridCount);
      const y = toY(price);
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      ctx.fillStyle = '#4a5568';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(price.toFixed(2), PAD_L - 4, y + 3);
    }

    // Setup overlay — entry zone, SL, TP
    if (setup && setup.symbol === symbol) {
      // Entry zone (green fill)
      const ezTop = toY(setup.entry_high);
      const ezBot = toY(setup.entry_low);
      ctx.fillStyle = 'rgba(34,197,94,0.12)';
      ctx.fillRect(PAD_L, ezTop, chartW, ezBot - ezTop);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1;
      ctx.setLineDash([4,3]);
      ctx.beginPath(); ctx.moveTo(PAD_L, ezTop); ctx.lineTo(W-PAD_R, ezTop); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD_L, ezBot); ctx.lineTo(W-PAD_R, ezBot); ctx.stroke();
      ctx.setLineDash([]);

      // SL line (red)
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6,3]);
      const slY = toY(setup.stop_loss);
      ctx.beginPath(); ctx.moveTo(PAD_L, slY); ctx.lineTo(W-PAD_R, slY); ctx.stroke();

      // Target line (blue)
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      const tpY = toY(setup.target);
      ctx.beginPath(); ctx.moveTo(PAD_L, tpY); ctx.lineTo(W-PAD_R, tpY); ctx.stroke();
      ctx.setLineDash([]);

      // Labels
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#22c55e';
      ctx.fillText(`ENTRY ${setup.entry_low}–${setup.entry_high}`, PAD_L + 4, ezBot - 4);
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`SL ${setup.stop_loss}`, PAD_L + 4, slY - 4);
      ctx.fillStyle = '#3b82f6';
      ctx.fillText(`TARGET ${setup.target}`, PAD_L + 4, tpY + 14);
    }

    // Candles
    visible.forEach((c, i) => {
      const x = PAD_L + gap + i * (candleW + gap);
      const isUp = c.c >= c.o;
      const color = isUp ? '#22c55e' : '#ef4444';
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;

      // Wick
      const wickX = x + candleW / 2;
      ctx.beginPath();
      ctx.moveTo(wickX, toY(c.h));
      ctx.lineTo(wickX, toY(c.l));
      ctx.stroke();

      // Body
      const bodyTop    = toY(Math.max(c.o, c.c));
      const bodyBottom = toY(Math.min(c.o, c.c));
      const bodyH = Math.max(1, bodyBottom - bodyTop);
      ctx.fillRect(x, bodyTop, candleW, bodyH);

      // Hover highlight
      if (hoveredIdx === i) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x - 1, PAD_T, candleW + 2, chartH);
      }
    });

    // Time axis labels (last 5)
    ctx.fillStyle = '#4a5568';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const labelCount = 5;
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.floor(i * visible.length / labelCount);
      const c = visible[idx];
      if (!c) continue;
      const x = PAD_L + gap + idx * (candleW + gap) + candleW / 2;
      const d = new Date(c.t);
      const label = tf === 'D'
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' });
      ctx.fillText(label, x, H - 6);
    }

    // Hover info
    if (hoveredIdx !== null) {
      const c = visible[hoveredIdx];
      if (c) {
        const info = `O:${c.o?.toFixed(2)} H:${c.h?.toFixed(2)} L:${c.l?.toFixed(2)} C:${c.c?.toFixed(2)}`;
        ctx.fillStyle = 'rgba(15,17,23,0.9)';
        ctx.fillRect(PAD_L + 4, PAD_T + 2, 320, 16);
        ctx.fillStyle = c.c >= c.o ? '#22c55e' : '#ef4444';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(info, PAD_L + 8, PAD_T + 14);
      }
    }
  }, [candles, setup, symbol, hoveredIdx]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !candles.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const PAD_L = 70, PAD_R = 10;
    const chartW = canvasRef.current.width - PAD_L - PAD_R;
    const visible = candles.slice(-100);
    const candleW = Math.max(2, Math.floor(chartW / visible.length) - 1);
    const gap = (chartW - visible.length * candleW) / (visible.length + 1);
    const idx = Math.floor((x - PAD_L - gap) / (candleW + gap));
    setHoveredIdx(idx >= 0 && idx < visible.length ? idx : null);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-gray-950 text-gray-500 text-xs">
      Loading {symbol} {tf} candles...
    </div>
  );
  if (error) return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-950 text-red-400 text-xs gap-2">
      <div>Failed to load candles: {error}</div>
      <button onClick={load} className="px-3 py-1 bg-blue-600 text-white rounded text-xs">Retry</button>
    </div>
  );

  return (
    <canvas
      ref={canvasRef}
      width={1400}
      height={600}
      className="w-full h-full"
      style={{ imageRendering: 'crisp-edges' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredIdx(null)}
    />
  );
}

// ── MAIN APP ─────────────────────────────────────────────────────────
export default function VectorPlatform() {
  const [activeTab, setActiveTab] = useState<Tab>('Dashboard');
  const [prices, setPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [prevPrices, setPrevPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [setups, setSetups] = useState<Setup[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [clock, setClock] = useState('');
  const [selectedSetup, setSelectedSetup] = useState<Setup|null>(null);
  const [chartSetup, setChartSetup] = useState<Setup|null>(null); // setup overlaid on chart
  const [searchKB, setSearchKB] = useState('');
  const [chartTf, setChartTf] = useState('15m');
  const [chartSymbol, setChartSymbol] = useState('NQ');
  const priceRef = useRef<NodeJS.Timeout|null>(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true }));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/prices', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setPrevPrices(p => ({ ...p }));
      setPrices(data);
    } catch {}
  }, []);

  useEffect(() => {
    fetchPrices();
    priceRef.current = setInterval(fetchPrices, 15000);
    return () => { if (priceRef.current) clearInterval(priceRef.current); };
  }, [fetchPrices]);

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

  const selectSetup = (s: Setup) => {
    setSelectedSetup(s);
    setAiResponse('');
  };

  const showOnChart = (s: Setup) => {
    setChartSetup(s);
    setChartSymbol(s.symbol);
    setChartTf(s.timeframe);
    setActiveTab('Chart');
  };

  const runAI = async () => {
    if (!selectedSetup) return;
    setAiLoading(true); setAiResponse('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: selectedSetup, prices }),
      });
      const data = await res.json();
      setAiResponse(data.analysis || data.error || 'No response');
    } catch(e: any) { setAiResponse('Error: ' + e.message); }
    setAiLoading(false);
  };

  const fmt = (n: number|null|undefined, dec = 2) => n == null ? '—' : Number(n).toFixed(dec);
  const arrowCls = (cur: number|null, prev: number|null) => {
    if (!cur || !prev || cur === prev) return { arrow: '', cls: 'text-gray-400' };
    return cur > prev ? { arrow: ' ▲', cls: 'text-green-400' } : { arrow: ' ▼', cls: 'text-red-400' };
  };

  const wins = trades.filter(t => t.result === 'win').length;
  const winRate = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const totalPnl = trades.reduce((a, t) => a + calcPnl(t), 0);
  const avgRR = trades.length ? (trades.reduce((a, t) => a + Number(t.rr_achieved||0), 0) / trades.length).toFixed(1) : '0';
  const activeCount = setups.filter(s => s.status === 'active').length;
  const filteredArticles = articles.filter(a =>
    !searchKB || a.title?.toLowerCase().includes(searchKB.toLowerCase()) ||
    a.content?.toLowerCase().includes(searchKB.toLowerCase())
  );

  const dirColor = (d: string) =>
    d === 'bull' || d === 'long' ? 'text-green-400' :
    d === 'bear' || d === 'short' ? 'text-red-400' : 'text-purple-400';
  const scoreColor = (s: number) =>
    s >= 80 ? 'bg-green-900 text-green-300' : s >= 65 ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300';

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono text-sm select-none flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-blue-400 font-bold text-lg tracking-widest">VECTOR</span>
          <span className="text-gray-600 text-xs">INTELLIGENCE</span>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse ml-1" />
          <span className="text-green-400 text-xs">LIVE</span>
        </div>
        <div className="flex items-center gap-5 text-xs">
          {(['NQ','ES','GC','DXY','VIX'] as const).map(sym => {
            const cur = prices[sym], prev = prevPrices[sym];
            const { arrow, cls } = arrowCls(cur, prev);
            return (
              <div key={sym} className="flex items-center gap-1">
                <span className="text-gray-500">{sym}</span>
                <span className={cls}>{fmt(cur)}{arrow}</span>
              </div>
            );
          })}
          <span className="text-gray-500 ml-3">NY {clock}</span>
        </div>
      </header>

      {/* Tabs */}
      <nav className="bg-gray-900 border-b border-gray-800 px-4 flex shrink-0">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-xs transition-colors ${activeTab === t ? 'border-b-2 border-blue-400 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-hidden p-4">

        {/* ── DASHBOARD ── */}
        {activeTab === 'Dashboard' && (
          <div className="grid grid-cols-12 gap-4 h-full overflow-y-auto">
            {/* Stats */}
            <div className="col-span-12 grid grid-cols-4 gap-3">
              {[
                { label: `Win Rate (${trades.length} trades)`, value: trades.length ? `${winRate}%` : '—', color: 'text-green-400' },
                { label: 'Backtest P&L', value: trades.length ? `$${Math.round(totalPnl).toLocaleString()}` : '—', color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: 'Avg R:R', value: trades.length ? `${avgRR}R` : '—', color: 'text-blue-400' },
                { label: 'Active Setups', value: activeCount.toString(), color: 'text-yellow-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="text-gray-500 text-xs">{s.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Setup table */}
            <div className="col-span-8 bg-gray-900 border border-gray-800 rounded p-3 overflow-y-auto max-h-96">
              <div className="text-gray-400 text-xs mb-2 uppercase tracking-wider">
                Setups ({setups.length})
              </div>
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="text-gray-600 border-b border-gray-800">
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-left">TF</th>
                    <th className="text-left">Dir</th>
                    <th className="text-left">Type</th>
                    <th className="text-right">Entry</th>
                    <th className="text-right">SL</th>
                    <th className="text-right">Target</th>
                    <th className="text-right">Score</th>
                    <th className="text-right">Chart</th>
                  </tr>
                </thead>
                <tbody>
                  {setups.map(s => (
                    <tr key={s.id} onClick={() => selectSetup(s)}
                      className={`border-b border-gray-800 cursor-pointer hover:bg-gray-800 transition-colors ${selectedSetup?.id === s.id ? 'bg-gray-800' : ''}`}>
                      <td className="py-1 text-white font-bold">{s.symbol}</td>
                      <td className="text-gray-500">{s.timeframe}</td>
                      <td className={dirColor(s.direction)}>{s.direction}</td>
                      <td className="text-blue-300 max-w-xs truncate">{s.setup_type}</td>
                      <td className="text-right text-gray-300">{fmt(s.entry_low)}</td>
                      <td className="text-right text-red-400">{fmt(s.stop_loss)}</td>
                      <td className="text-right text-green-400">{fmt(s.target)}</td>
                      <td className="text-right">
                        <span className={`px-1 rounded text-xs ${scoreColor(s.confluence_score)}`}>{s.confluence_score}</span>
                      </td>
                      <td className="text-right">
                        <button
                          onClick={e => { e.stopPropagation(); showOnChart(s); }}
                          className="text-xs px-2 py-0.5 bg-blue-700 hover:bg-blue-500 text-white rounded transition-colors"
                          title="Show on chart"
                        >
                          📈
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!setups.length && <tr><td colSpan={9} className="py-6 text-center text-gray-600">Loading setups...</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Right panel */}
            <div className="col-span-4 flex flex-col gap-3">
              {selectedSetup && (
                <div className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="flex justify-between items-start mb-1">
                    <div className="text-gray-400 text-xs uppercase tracking-wider">Selected Setup</div>
                    <button onClick={() => showOnChart(selectedSetup)}
                      className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center gap-1">
                      📈 Show on Chart
                    </button>
                  </div>
                  <div className="text-white font-bold text-base mt-1">
                    {selectedSetup.symbol} <span className="text-gray-500 text-xs">{selectedSetup.timeframe}</span>{' '}
                    <span className={dirColor(selectedSetup.direction)}>{selectedSetup.direction}</span>
                  </div>
                  <div className="text-blue-300 text-xs mb-2">{selectedSetup.setup_type}</div>
                  <div className="grid grid-cols-2 gap-y-1 text-xs">
                    <div><span className="text-gray-600">Entry Zone </span><span className="text-white">{fmt(selectedSetup.entry_low)}–{fmt(selectedSetup.entry_high)}</span></div>
                    <div><span className="text-gray-600">SL </span><span className="text-red-400">{fmt(selectedSetup.stop_loss)}</span></div>
                    <div><span className="text-gray-600">Target </span><span className="text-green-400">{fmt(selectedSetup.target)}</span></div>
                    <div><span className="text-gray-600">R:R </span><span className="text-blue-400">{fmt(selectedSetup.rr_ratio,1)}R</span></div>
                    <div className="col-span-2"><span className="text-gray-600">DOL </span><span className="text-yellow-400 text-xs">{selectedSetup.dol_target}</span></div>
                  </div>
                </div>
              )}
              <div className="bg-gray-900 border border-gray-800 rounded p-3 flex-1">
                <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">AI Analyst</div>
                <button onClick={runAI} disabled={aiLoading || !selectedSetup}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-2 rounded mb-2 transition-colors">
                  {aiLoading ? 'Analyzing...' : 'Run AI Analysis'}
                </button>
                {aiResponse ? (
                  <div className="text-gray-300 text-xs leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-gray-700 pt-2">{aiResponse}</div>
                ) : selectedSetup?.ai_analysis ? (
                  <div className="text-gray-500 text-xs leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-gray-700 pt-2">
                    <div className="text-gray-700 mb-1">Saved analysis:</div>{selectedSetup.ai_analysis}
                  </div>
                ) : (
                  <div className="text-gray-700 text-xs">Select a setup then click Run AI Analysis.</div>
                )}
              </div>
            </div>

            {/* DOL */}
            <div className="col-span-12 bg-gray-900 border border-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">DOL Framework — 5 Questions</div>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { q:'Q1', label:'Where is price?', ans: selectedSetup ? `${selectedSetup.symbol} entry ${fmt(selectedSetup.entry_low)}–${fmt(selectedSetup.entry_high)}` : 'Select a setup' },
                  { q:'Q2', label:'Draw on Liquidity?', ans: selectedSetup ? `DOL: ${selectedSetup.dol_target}` : '—' },
                  { q:'Q3', label:'PD Array?', ans: selectedSetup?.setup_type ?? '—' },
                  { q:'Q4', label:'Liquidity aligned?', ans: selectedSetup ? (selectedSetup.confluence_score >= 70 ? `YES — ${selectedSetup.confluence_score}/100` : 'PARTIAL — watch more') : '—' },
                  { q:'Q5', label:'CISD confirmed?', ans: selectedSetup ? (selectedSetup.status === 'active' ? 'YES — Entry valid' : 'PENDING') : '—' },
                ].map(item => (
                  <div key={item.q} className="bg-gray-800 rounded p-2">
                    <div className="text-blue-400 text-xs font-bold">{item.q}</div>
                    <div className="text-gray-500 text-xs">{item.label}</div>
                    <div className="text-white text-xs mt-1">{item.ans}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── CHART ── */}
        {activeTab === 'Chart' && (
          <div className="flex flex-col gap-2 h-full">
            {/* Controls */}
            <div className="flex gap-3 items-center flex-wrap shrink-0">
              <div className="flex gap-1">
                {['NQ','ES'].map(s => (
                  <button key={s} onClick={() => { setChartSymbol(s); setChartSetup(null); }}
                    className={`text-xs px-3 py-1 rounded ${chartSymbol === s ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {['15m','1h','4h','D'].map(t => (
                  <button key={t} onClick={() => setChartTf(t)}
                    className={`text-xs px-3 py-1 rounded ${chartTf === t ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                    {t}
                  </button>
                ))}
              </div>
              {chartSetup && (
                <div className="flex items-center gap-2 bg-gray-800 px-3 py-1 rounded text-xs">
                  <span className="text-green-400">●</span>
                  <span className="text-white">{chartSetup.symbol} {chartSetup.timeframe} — {chartSetup.setup_type}</span>
                  <button onClick={() => setChartSetup(null)} className="text-gray-500 hover:text-red-400 ml-1">✕</button>
                </div>
              )}
              {!chartSetup && (
                <span className="text-gray-600 text-xs">Click 📈 on any setup to overlay entry/SL/target on this chart</span>
              )}
            </div>

            {/* Legend */}
            {chartSetup && (
              <div className="flex gap-4 text-xs shrink-0">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-400 inline-block"></span> Entry {fmt(chartSetup.entry_low)}–{fmt(chartSetup.entry_high)}</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-400 inline-block"></span> SL {fmt(chartSetup.stop_loss)}</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-400 inline-block"></span> Target {fmt(chartSetup.target)}</span>
                <span className="text-gray-500">R:R {fmt(chartSetup.rr_ratio,1)}R · Score {chartSetup.confluence_score}</span>
              </div>
            )}

            {/* Chart */}
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded overflow-hidden min-h-0">
              <CandleChart symbol={chartSymbol} tf={chartTf} setup={chartSetup} />
            </div>

            {/* Quick setups for this symbol/tf */}
            <div className="shrink-0">
              <div className="text-gray-600 text-xs mb-1">
                Setups for {chartSymbol} {chartTf}:
              </div>
              <div className="flex gap-2 flex-wrap">
                {setups.filter(s => s.symbol === chartSymbol && s.timeframe === chartTf).map(s => (
                  <button key={s.id} onClick={() => setChartSetup(s)}
                    className={`text-xs px-3 py-1 rounded border transition-colors ${chartSetup?.id === s.id ? 'border-blue-400 bg-blue-900/40 text-blue-300' : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500'}`}>
                    <span className={dirColor(s.direction)}>{s.direction}</span> {s.setup_type} <span className={`ml-1 text-xs ${scoreColor(s.confluence_score).split(' ')[1]}`}>{s.confluence_score}</span>
                  </button>
                ))}
                {!setups.filter(s => s.symbol === chartSymbol && s.timeframe === chartTf).length && (
                  <span className="text-gray-700 text-xs">No setups for this symbol/timeframe</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SCANNER ── */}
        {activeTab === 'Scanner' && (
          <div className="space-y-3 overflow-y-auto h-full">
            <div className="flex gap-2 text-xs text-gray-500">
              {['All','15m','1h','4h','D'].map(f => (
                <button key={f} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded"
                  onClick={() => {}}>
                  {f}
                </button>
              ))}
              <span className="ml-2">{setups.length} total setups</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {setups.map(s => (
                <div key={s.id} className="bg-gray-900 border border-gray-800 rounded p-3 hover:border-gray-600 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-white font-bold">{s.symbol}</span>
                      <span className="text-gray-500 text-xs ml-1">{s.timeframe}</span>
                      <span className={`ml-2 text-xs ${dirColor(s.direction)}`}>{s.direction.toUpperCase()}</span>
                    </div>
                    <span className={`text-xs px-1 rounded ${scoreColor(s.confluence_score)}`}>{s.confluence_score}%</span>
                  </div>
                  <div className="text-blue-300 text-xs mb-2">{s.setup_type}</div>
                  <div className="grid grid-cols-2 gap-1 text-xs mb-2">
                    <div><span className="text-gray-600">Entry </span><span className="text-gray-300">{fmt(s.entry_low)}</span></div>
                    <div><span className="text-gray-600">Target </span><span className="text-green-400">{fmt(s.target)}</span></div>
                    <div><span className="text-gray-600">SL </span><span className="text-red-400">{fmt(s.stop_loss)}</span></div>
                    <div><span className="text-gray-600">R:R </span><span className="text-blue-400">{fmt(s.rr_ratio,1)}R</span></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { selectSetup(s); setActiveTab('Dashboard'); }}
                      className="flex-1 text-xs py-1 bg-gray-700 hover:bg-gray-600 rounded">Select</button>
                    <button onClick={() => showOnChart(s)}
                      className="flex-1 text-xs py-1 bg-blue-700 hover:bg-blue-600 rounded">📈 Chart</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── KNOWLEDGE ── */}
        {activeTab === 'Knowledge' && (
          <div className="flex flex-col gap-3 h-full overflow-hidden">
            <input type="text" placeholder="Search knowledge base..." value={searchKB}
              onChange={e => setSearchKB(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500 shrink-0" />
            <div className="text-gray-600 text-xs shrink-0">{filteredArticles.length} of {articles.length} articles</div>
            <div className="overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3 pb-4">
                {filteredArticles.map(a => (
                  <div key={a.id} className="bg-gray-900 border border-gray-800 rounded p-3">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-white text-xs font-bold">{a.title}</span>
                      <span className="text-blue-400 text-xs ml-2 shrink-0">{a.source_episode}</span>
                    </div>
                    <span className="text-yellow-600 text-xs px-1 rounded bg-yellow-900/30">{a.category}</span>
                    <p className="text-gray-400 text-xs mt-2 leading-relaxed">{a.content}</p>
                    {a.tags?.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-2">
                        {a.tags.map((tag: string) => (
                          <span key={tag} className="text-xs text-gray-600 bg-gray-800 px-1 rounded">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {!filteredArticles.length && articles.length > 0 && (
                  <div className="col-span-2 text-center text-gray-600 py-8">No results for "{searchKB}"</div>
                )}
                {!articles.length && (
                  <div className="col-span-2 text-center text-gray-600 py-8">Loading knowledge base...</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── BACKTEST ── */}
        {activeTab === 'Backtest' && (
          <div className="space-y-4 overflow-y-auto h-full">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total Trades', value: trades.length.toString(), color: 'text-white' },
                { label: 'Win Rate', value: `${winRate}%`, color: 'text-green-400' },
                { label: 'Net P&L', value: `$${Math.round(totalPnl).toLocaleString()}`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: 'Avg R:R', value: `${avgRR}R`, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="text-gray-500 text-xs">{s.label}</div>
                  <div className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Trade History</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600 border-b border-gray-800">
                    <th className="text-left py-1">Date</th>
                    <th className="text-left">Symbol</th>
                    <th className="text-left">Dir</th>
                    <th className="text-right">Entry</th>
                    <th className="text-right">SL</th>
                    <th className="text-right">TP</th>
                    <th className="text-right">P&L</th>
                    <th className="text-right">R:R</th>
                    <th className="text-right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => {
                    const pnl = calcPnl(t);
                    return (
                      <tr key={t.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                        <td className="py-1 text-gray-500">
                          {new Date(t.opened_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="text-white font-bold">{t.symbol}</td>
                        <td className={dirColor(t.direction)}>{t.direction}</td>
                        <td className="text-right text-gray-300">{fmt(t.entry_price)}</td>
                        <td className="text-right text-red-400">{fmt(t.stop_loss)}</td>
                        <td className="text-right text-green-400">{fmt(t.take_profit)}</td>
                        <td className={`text-right ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>${Math.round(pnl).toLocaleString()}</td>
                        <td className="text-right text-gray-300">{Number(t.rr_achieved).toFixed(1)}R</td>
                        <td className={`text-right font-bold ${t.result === 'win' ? 'text-green-400' : 'text-red-400'}`}>{t.result?.toUpperCase()}</td>
                      </tr>
                    );
                  })}
                  {!trades.length && <tr><td colSpan={9} className="py-6 text-center text-gray-600">Loading trades...</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
