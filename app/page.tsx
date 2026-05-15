'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Setup {
  id: string;
  symbol: string;
  direction: string;
  setup_type: string;
  entry_low: number;
  entry_high: number;
  stop_loss: number;
  target: number;
  rr_ratio: number;
  confluence_score: number;
  status: string;
  dol_target: number;
  ai_analysis: string;
  timeframe: string;
  created_at: string;
}

interface Trade {
  id: string;
  symbol: string;
  direction: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  result: string; // 'win' | 'loss'
  rr_achieved: number;
  notes: string;
  opened_at: string;
  closed_at: string;
}

interface KBArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  source_episode: string;
  tags: string[];
}

interface Prices {
  NQ: number | null;
  ES: number | null;
  GC: number | null;
  DXY: number | null;
  VIX: number | null;
}

const TABS = ['Dashboard', 'Chart', 'Scanner', 'Knowledge', 'Backtest'] as const;
type Tab = typeof TABS[number];

function calcPnl(t: Trade): number {
  const diff = t.direction === 'long'
    ? t.take_profit - t.entry_price
    : t.entry_price - t.take_profit;
  const pts = t.result === 'win' ? Math.abs(diff) : -Math.abs(t.entry_price - t.stop_loss);
  // NQ = $20/pt, ES = $50/pt, others ≈ $100/pt
  const mult = t.symbol === 'NQ' ? 20 : t.symbol === 'ES' ? 50 : 100;
  return pts * mult;
}

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
  const [selectedSetup, setSelectedSetup] = useState<Setup | null>(null);
  const [searchKB, setSearchKB] = useState('');
  const [chartSymbol, setChartSymbol] = useState('NASDAQ:QQQ');
  const priceRef = useRef<NodeJS.Timeout | null>(null);

  // Live NY clock
  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Live prices
  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/prices', { cache: 'no-store' });
      if (!res.ok) return;
      const data: Prices = await res.json();
      setPrevPrices(p => ({ ...p }));
      setPrices(data);
    } catch {}
  }, []);

  useEffect(() => {
    fetchPrices();
    priceRef.current = setInterval(fetchPrices, 15000);
    return () => { if (priceRef.current) clearInterval(priceRef.current); };
  }, [fetchPrices]);

  // Supabase data — correct table & column names
  useEffect(() => {
    Promise.all([
      supabase.from('setups').select('*').order('created_at', { ascending: false }),
      supabase.from('trades').select('*').order('opened_at', { ascending: false }),
      supabase.from('knowledge_base').select('*').order('category'),
    ]).then(([s, t, k]) => {
      if (s.data && s.data.length > 0) {
        setSetups(s.data);
        setSelectedSetup(s.data[0]);
      }
      if (t.data) setTrades(t.data);
      if (k.data) setArticles(k.data);
    });
  }, []);

  const runAI = async () => {
    if (!selectedSetup) return;
    setAiLoading(true);
    setAiResponse('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: selectedSetup, prices }),
      });
      const data = await res.json();
      setAiResponse(data.analysis || data.error || 'No response');
    } catch (e: any) {
      setAiResponse('Error: ' + e.message);
    }
    setAiLoading(false);
  };

  const fmt = (n: number | null | undefined, dec = 2) =>
    n == null ? '—' : Number(n).toFixed(dec);

  const arrowColor = (cur: number | null, prev: number | null) => {
    if (!cur || !prev || cur === prev) return { arrow: '', cls: 'text-gray-400' };
    return cur > prev
      ? { arrow: ' ▲', cls: 'text-green-400' }
      : { arrow: ' ▼', cls: 'text-red-400' };
  };

  // Computed stats from real trades
  const wins = trades.filter(t => t.result === 'win').length;
  const winRate = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const totalPnl = trades.reduce((a, t) => a + calcPnl(t), 0);
  const avgRR = trades.length
    ? (trades.reduce((a, t) => a + Number(t.rr_achieved || 0), 0) / trades.length).toFixed(1)
    : '0';
  const activeSetups = setups.filter(s => s.status === 'active' || s.status === 'watching').length;

  const filteredArticles = articles.filter(a =>
    !searchKB ||
    a.title?.toLowerCase().includes(searchKB.toLowerCase()) ||
    a.content?.toLowerCase().includes(searchKB.toLowerCase()) ||
    a.category?.toLowerCase().includes(searchKB.toLowerCase())
  );

  const chartSymbols = [
    { label: 'NQ (NDX)', value: 'TVC:NDX' },
    { label: 'ES (SPX)', value: 'TVC:SPX' },
    { label: 'Gold', value: 'TVC:GOLD' },
    { label: 'DXY', value: 'TVC:DXY' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono text-sm select-none">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-blue-400 font-bold text-lg tracking-widest">VECTOR</span>
          <span className="text-gray-600 text-xs">INTELLIGENCE</span>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse ml-1" />
          <span className="text-green-400 text-xs">LIVE</span>
        </div>
        <div className="flex items-center gap-5 text-xs">
          {([
            ['NQ', prices.NQ, prevPrices.NQ],
            ['ES', prices.ES, prevPrices.ES],
            ['GC', prices.GC, prevPrices.GC],
            ['DXY', prices.DXY, prevPrices.DXY],
            ['VIX', prices.VIX, prevPrices.VIX],
          ] as [string, number | null, number | null][]).map(([sym, cur, prev]) => {
            const { arrow, cls } = arrowColor(cur, prev);
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
      <nav className="bg-gray-900 border-b border-gray-800 px-4 flex">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-xs transition-colors ${
              activeTab === t
                ? 'border-b-2 border-blue-400 text-blue-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      <main className="p-4">

        {/* ── DASHBOARD ── */}
        {activeTab === 'Dashboard' && (
          <div className="grid grid-cols-12 gap-4">
            {/* Stat cards */}
            <div className="col-span-12 grid grid-cols-4 gap-3">
              {[
                { label: 'Win Rate', value: `${winRate}%`, color: 'text-green-400' },
                { label: 'Total P&L', value: `$${Math.round(totalPnl).toLocaleString()}`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: 'Avg R:R', value: `${avgRR}R`, color: 'text-blue-400' },
                { label: 'Active Setups', value: activeSetups.toString(), color: 'text-yellow-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="text-gray-500 text-xs">{s.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Setup table */}
            <div className="col-span-8 bg-gray-900 border border-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs mb-2 uppercase tracking-wider">
                Active Setups ({setups.length})
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600 border-b border-gray-800">
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-left">TF</th>
                    <th className="text-left">Dir</th>
                    <th className="text-left">Type</th>
                    <th className="text-right">Entry Zone</th>
                    <th className="text-right">SL</th>
                    <th className="text-right">Target</th>
                    <th className="text-right">Score</th>
                    <th className="text-left pl-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {setups.map(s => (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedSetup(s)}
                      className={`border-b border-gray-800 cursor-pointer hover:bg-gray-800 transition-colors ${selectedSetup?.id === s.id ? 'bg-gray-800' : ''}`}
                    >
                      <td className="py-1 text-white font-bold">{s.symbol}</td>
                      <td className="text-gray-500">{s.timeframe}</td>
                      <td className={s.direction === 'bull' || s.direction === 'long' ? 'text-green-400' : s.direction === 'bear' || s.direction === 'short' ? 'text-red-400' : 'text-purple-400'}>
                        {s.direction}
                      </td>
                      <td className="text-blue-300">{s.setup_type}</td>
                      <td className="text-right text-gray-300">
                        {fmt(s.entry_low)} – {fmt(s.entry_high)}
                      </td>
                      <td className="text-right text-red-400">{fmt(s.stop_loss)}</td>
                      <td className="text-right text-green-400">{fmt(s.target)}</td>
                      <td className="text-right">
                        <span className={`px-1 rounded text-xs ${
                          s.confluence_score >= 80
                            ? 'bg-green-900 text-green-300'
                            : s.confluence_score >= 60
                            ? 'bg-yellow-900 text-yellow-300'
                            : 'bg-red-900 text-red-300'
                        }`}>
                          {s.confluence_score}
                        </span>
                      </td>
                      <td className="pl-2 text-gray-400">{s.status}</td>
                    </tr>
                  ))}
                  {setups.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-gray-600">
                        Loading setups...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Right panel */}
            <div className="col-span-4 flex flex-col gap-3">
              {selectedSetup && (
                <div className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Selected Setup</div>
                  <div className="text-white font-bold text-base">
                    {selectedSetup.symbol}{' '}
                    <span className={
                      selectedSetup.direction === 'bull' || selectedSetup.direction === 'long'
                        ? 'text-green-400'
                        : selectedSetup.direction === 'bear' || selectedSetup.direction === 'short'
                        ? 'text-red-400'
                        : 'text-purple-400'
                    }>
                      {selectedSetup.direction}
                    </span>
                  </div>
                  <div className="text-blue-300 text-xs mb-3">{selectedSetup.setup_type}</div>
                  <div className="grid grid-cols-2 gap-y-1 text-xs">
                    <div><span className="text-gray-600">Entry Low </span><span className="text-white">{fmt(selectedSetup.entry_low)}</span></div>
                    <div><span className="text-gray-600">Entry High </span><span className="text-white">{fmt(selectedSetup.entry_high)}</span></div>
                    <div><span className="text-gray-600">Stop Loss </span><span className="text-red-400">{fmt(selectedSetup.stop_loss)}</span></div>
                    <div><span className="text-gray-600">Target </span><span className="text-green-400">{fmt(selectedSetup.target)}</span></div>
                    <div><span className="text-gray-600">R:R </span><span className="text-blue-400">{fmt(selectedSetup.rr_ratio, 1)}R</span></div>
                    <div><span className="text-gray-600">DOL </span><span className="text-yellow-400">{fmt(selectedSetup.dol_target)}</span></div>
                  </div>
                </div>
              )}

              <div className="bg-gray-900 border border-gray-800 rounded p-3 flex-1">
                <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">AI Analyst</div>
                <button
                  onClick={runAI}
                  disabled={aiLoading || !selectedSetup}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs py-2 rounded mb-2 transition-colors"
                >
                  {aiLoading ? 'Analyzing...' : 'Run AI Analysis'}
                </button>
                {aiResponse && (
                  <div className="text-gray-300 text-xs leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {aiResponse}
                  </div>
                )}
                {!aiResponse && !aiLoading && (
                  <div className="text-gray-700 text-xs">
                    Select a setup above then click Run AI Analysis to get ICT/SMC reasoning.
                  </div>
                )}
              </div>
            </div>

            {/* DOL Framework */}
            <div className="col-span-12 bg-gray-900 border border-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">
                DOL Framework — 5 Questions
              </div>
              <div className="grid grid-cols-5 gap-2">
                {[
                  {
                    q: 'Q1', label: 'Where is price?',
                    ans: selectedSetup
                      ? `${selectedSetup.symbol} @ entry ${fmt(selectedSetup.entry_low)}–${fmt(selectedSetup.entry_high)}`
                      : 'Select a setup',
                  },
                  {
                    q: 'Q2', label: 'Draw on Liquidity?',
                    ans: selectedSetup
                      ? `DOL: ${fmt(selectedSetup.dol_target)} | Target: ${fmt(selectedSetup.target)}`
                      : '—',
                  },
                  {
                    q: 'Q3', label: 'PD Array in range?',
                    ans: selectedSetup ? selectedSetup.setup_type : '—',
                  },
                  {
                    q: 'Q4', label: 'Liquidity aligned?',
                    ans: selectedSetup
                      ? selectedSetup.confluence_score >= 70 ? 'YES — High confluence' : 'PARTIAL — Wait for more'
                      : '—',
                  },
                  {
                    q: 'Q5', label: 'CISD confirmed?',
                    ans: selectedSetup
                      ? selectedSetup.status === 'active' ? 'YES — Entry valid' : 'PENDING — Watch price'
                      : '—',
                  },
                ].map(item => (
                  <div key={item.q} className="bg-gray-800 rounded p-2">
                    <div className="text-blue-400 text-xs font-bold">{item.q}</div>
                    <div className="text-gray-500 text-xs mb-1">{item.label}</div>
                    <div className="text-white text-xs">{item.ans}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── CHART ── */}
        {activeTab === 'Chart' && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <span className="text-gray-500 text-xs">Symbol:</span>
              {chartSymbols.map(s => (
                <button
                  key={s.value}
                  onClick={() => setChartSymbol(s.value)}
                  className={`text-xs px-3 py-1 rounded transition-colors ${
                    chartSymbol === s.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <span className="text-gray-600 text-xs ml-2">
                (CME futures require TradingView Premium — using index equivalents)
              </span>
            </div>
            <div className="h-[78vh] bg-gray-900 border border-gray-800 rounded overflow-hidden">
              <iframe
                key={chartSymbol}
                src={`https://s.tradingview.com/widgetembed/?frameElementId=tv_chart&symbol=${encodeURIComponent(chartSymbol)}&interval=15&theme=dark&style=1&timezone=America%2FNew_York&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=1&save_image=0&details=1`}
                className="w-full h-full border-0"
                title="TradingView Chart"
              />
            </div>
          </div>
        )}

        {/* ── SCANNER ── */}
        {activeTab === 'Scanner' && (
          <div className="space-y-3">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">
              {setups.length} Setups in Database
            </div>
            <div className="grid grid-cols-3 gap-3">
              {setups.map(s => (
                <div
                  key={s.id}
                  onClick={() => { setSelectedSetup(s); setActiveTab('Dashboard'); }}
                  className="bg-gray-900 border border-gray-800 rounded p-3 cursor-pointer hover:border-blue-600 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-white font-bold">{s.symbol}</span>
                      <span className="text-gray-500 text-xs ml-1">{s.timeframe}</span>
                      <span className={`ml-2 text-xs ${
                        s.direction === 'bull' || s.direction === 'long'
                          ? 'text-green-400'
                          : s.direction === 'bear' || s.direction === 'short'
                          ? 'text-red-400'
                          : 'text-purple-400'
                      }`}>
                        {s.direction.toUpperCase()}
                      </span>
                    </div>
                    <span className={`text-xs px-1 rounded ${
                      s.confluence_score >= 80
                        ? 'bg-green-900 text-green-300'
                        : 'bg-yellow-900 text-yellow-300'
                    }`}>
                      {s.confluence_score}%
                    </span>
                  </div>
                  <div className="text-blue-300 text-xs mb-2">{s.setup_type}</div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div><span className="text-gray-600">Entry </span><span className="text-gray-300">{fmt(s.entry_low)}</span></div>
                    <div><span className="text-gray-600">Target </span><span className="text-green-400">{fmt(s.target)}</span></div>
                    <div><span className="text-gray-600">SL </span><span className="text-red-400">{fmt(s.stop_loss)}</span></div>
                    <div><span className="text-gray-600">R:R </span><span className="text-blue-400">{fmt(s.rr_ratio, 1)}R</span></div>
                  </div>
                  <div className={`text-xs mt-2 px-1 rounded inline-block ${
                    s.status === 'active' ? 'text-green-400' : 'text-gray-500'
                  }`}>
                    {s.status}
                  </div>
                </div>
              ))}
              {setups.length === 0 && (
                <div className="col-span-3 text-center text-gray-600 py-12">Loading setups...</div>
              )}
            </div>
          </div>
        )}

        {/* ── KNOWLEDGE BASE ── */}
        {activeTab === 'Knowledge' && (
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Search knowledge base..."
              value={searchKB}
              onChange={e => setSearchKB(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
            <div className="text-gray-600 text-xs">
              {filteredArticles.length} of {articles.length} articles
            </div>
            <div className="grid grid-cols-2 gap-3">
              {filteredArticles.map(a => (
                <div key={a.id} className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-white text-xs font-bold">{a.title}</span>
                    <span className="text-blue-400 text-xs ml-2 shrink-0">{a.source_episode}</span>
                  </div>
                  <span className="text-yellow-600 text-xs px-1 rounded bg-yellow-900/30">{a.category}</span>
                  <p className="text-gray-400 text-xs mt-2 leading-relaxed">{a.content}</p>
                  {a.tags && a.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-2">
                      {a.tags.map((tag: string) => (
                        <span key={tag} className="text-xs text-gray-600 bg-gray-800 px-1 rounded">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {filteredArticles.length === 0 && articles.length > 0 && (
                <div className="col-span-2 text-center text-gray-600 py-8">No articles match "{searchKB}"</div>
              )}
              {articles.length === 0 && (
                <div className="col-span-2 text-center text-gray-600 py-8">Loading knowledge base...</div>
              )}
            </div>
          </div>
        )}

        {/* ── BACKTEST ── */}
        {activeTab === 'Backtest' && (
          <div className="space-y-4">
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
                    <th className="text-right">Est. P&L</th>
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
                        <td className={t.direction === 'long' ? 'text-green-400' : 'text-red-400'}>
                          {t.direction}
                        </td>
                        <td className="text-right text-gray-300">{fmt(t.entry_price)}</td>
                        <td className="text-right text-red-400">{fmt(t.stop_loss)}</td>
                        <td className="text-right text-green-400">{fmt(t.take_profit)}</td>
                        <td className={`text-right ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ${Math.round(pnl).toLocaleString()}
                        </td>
                        <td className="text-right text-gray-300">{Number(t.rr_achieved).toFixed(1)}R</td>
                        <td className={`text-right font-bold ${t.result === 'win' ? 'text-green-400' : 'text-red-400'}`}>
                          {t.result?.toUpperCase()}
                        </td>
                      </tr>
                    );
                  })}
                  {trades.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-gray-600">Loading trades...</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
