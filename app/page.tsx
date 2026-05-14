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
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  confluence_score: number;
  status: string;
  notes: string;
  created_at: string;
}

interface Trade {
  id: string;
  symbol: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  result: string;
  pnl: number;
  rr_achieved: number;
  created_at: string;
}

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  episode: string;
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

export default function VectorPlatform() {
  const [activeTab, setActiveTab] = useState<Tab>('Dashboard');
  const [prices, setPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [prevPrices, setPrevPrices] = useState<Prices>({ NQ: null, ES: null, GC: null, DXY: null, VIX: null });
  const [setups, setSetups] = useState<Setup[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [clock, setClock] = useState('');
  const [selectedSetup, setSelectedSetup] = useState<Setup | null>(null);
  const [searchKB, setSearchKB] = useState('');
  const priceInterval = useRef<NodeJS.Timeout | null>(null);

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const ny = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true });
      setClock(`NY ${ny}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch real prices from our API route
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
    priceInterval.current = setInterval(fetchPrices, 15000);
    return () => { if (priceInterval.current) clearInterval(priceInterval.current); };
  }, [fetchPrices]);

  // Supabase data
  useEffect(() => {
    Promise.all([
      supabase.from('setups').select('*').order('created_at', { ascending: false }),
      supabase.from('trades').select('*').order('created_at', { ascending: false }),
      supabase.from('knowledge_articles').select('*'),
    ]).then(([s, t, k]) => {
      if (s.data) { setSetups(s.data); setSelectedSetup(s.data[0] ?? null); }
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

  const fmt = (n: number | null, dec = 2) => n == null ? '—' : n.toFixed(dec);
  const dir = (cur: number | null, prev: number | null) => {
    if (!cur || !prev) return '';
    return cur > prev ? '▲' : cur < prev ? '▼' : '';
  };
  const col = (cur: number | null, prev: number | null) => {
    if (!cur || !prev) return 'text-gray-400';
    return cur > prev ? 'text-green-400' : cur < prev ? 'text-red-400' : 'text-gray-400';
  };

  const winRate = trades.length ? Math.round(trades.filter(t => t.result === 'WIN').length / trades.length * 100) : 0;
  const totalPnl = trades.reduce((a, t) => a + (t.pnl || 0), 0);
  const avgRR = trades.length ? (trades.reduce((a, t) => a + (t.rr_achieved || 0), 0) / trades.length).toFixed(2) : '0';

  const filteredArticles = articles.filter(a =>
    !searchKB || a.title.toLowerCase().includes(searchKB.toLowerCase()) || a.content.toLowerCase().includes(searchKB.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono text-sm">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-blue-400 font-bold text-lg tracking-widest">VECTOR</span>
          <span className="text-gray-600 text-xs">INTELLIGENCE</span>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-green-400 text-xs">LIVE</span>
        </div>
        <div className="flex items-center gap-6 text-xs">
          {([['NQ', prices.NQ, prevPrices.NQ], ['ES', prices.ES, prevPrices.ES], ['GC', prices.GC, prevPrices.GC], ['DXY', prices.DXY, prevPrices.DXY], ['VIX', prices.VIX, prevPrices.VIX]] as [string, number|null, number|null][]).map(([sym, cur, prev]) => (
            <div key={sym} className="flex items-center gap-1">
              <span className="text-gray-500">{sym}</span>
              <span className={col(cur, prev)}>{fmt(cur, sym === 'VIX' || sym === 'DXY' ? 2 : 2)} {dir(cur, prev)}</span>
            </div>
          ))}
          <span className="text-gray-500 ml-4">{clock}</span>
        </div>
      </header>

      {/* Tabs */}
      <nav className="bg-gray-900 border-b border-gray-800 px-4 flex gap-1">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-xs transition-colors ${activeTab === t ? 'border-b-2 border-blue-400 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      <main className="p-4">
        {/* ── DASHBOARD ── */}
        {activeTab === 'Dashboard' && (
          <div className="grid grid-cols-12 gap-4">
            {/* Stats */}
            <div className="col-span-12 grid grid-cols-4 gap-3">
              {[
                { label: 'Win Rate', value: `${winRate}%`, color: 'text-green-400' },
                { label: 'Total P&L', value: `$${totalPnl.toFixed(0)}`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: 'Avg R:R', value: `${avgRR}R`, color: 'text-blue-400' },
                { label: 'Active Setups', value: setups.filter(s => s.status === 'ACTIVE').length.toString(), color: 'text-yellow-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="text-gray-500 text-xs">{s.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Setup Table */}
            <div className="col-span-8 bg-gray-900 border border-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs mb-2 uppercase tracking-wider">Active Setups</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600 border-b border-gray-800">
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-left">Dir</th>
                    <th className="text-left">Type</th>
                    <th className="text-right">Entry</th>
                    <th className="text-right">SL</th>
                    <th className="text-right">TP</th>
                    <th className="text-right">Score</th>
                    <th className="text-left pl-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {setups.slice(0, 8).map(s => (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedSetup(s)}
                      className={`border-b border-gray-800 cursor-pointer hover:bg-gray-800 transition-colors ${selectedSetup?.id === s.id ? 'bg-gray-800' : ''}`}
                    >
                      <td className="py-1 text-white font-bold">{s.symbol}</td>
                      <td className={s.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>{s.direction}</td>
                      <td className="text-blue-300">{s.setup_type}</td>
                      <td className="text-right text-gray-300">{fmt(s.entry_price)}</td>
                      <td className="text-right text-red-400">{fmt(s.stop_loss)}</td>
                      <td className="text-right text-green-400">{fmt(s.take_profit)}</td>
                      <td className="text-right">
                        <span className={`px-1 rounded text-xs ${s.confluence_score >= 80 ? 'bg-green-900 text-green-300' : s.confluence_score >= 60 ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'}`}>
                          {s.confluence_score}
                        </span>
                      </td>
                      <td className="pl-2 text-gray-400">{s.status}</td>
                    </tr>
                  ))}
                  {setups.length === 0 && (
                    <tr><td colSpan={8} className="py-4 text-center text-gray-600">Loading from Supabase...</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Selected Setup + AI */}
            <div className="col-span-4 flex flex-col gap-3">
              {selectedSetup && (
                <div className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Selected Setup</div>
                  <div className="text-white font-bold">{selectedSetup.symbol} <span className={selectedSetup.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>{selectedSetup.direction}</span></div>
                  <div className="text-blue-300 text-xs mb-2">{selectedSetup.setup_type}</div>
                  <div className="grid grid-cols-2 gap-1 text-xs mb-2">
                    <div><span className="text-gray-600">Entry </span><span className="text-white">{fmt(selectedSetup.entry_price)}</span></div>
                    <div><span className="text-gray-600">SL </span><span className="text-red-400">{fmt(selectedSetup.stop_loss)}</span></div>
                    <div><span className="text-gray-600">TP </span><span className="text-green-400">{fmt(selectedSetup.take_profit)}</span></div>
                    <div><span className="text-gray-600">Score </span><span className="text-yellow-400">{selectedSetup.confluence_score}</span></div>
                  </div>
                  <div className="text-gray-500 text-xs">{selectedSetup.notes}</div>
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
                  <div className="text-gray-300 text-xs leading-relaxed max-h-48 overflow-y-auto">{aiResponse}</div>
                )}
              </div>
            </div>

            {/* DOL Framework */}
            <div className="col-span-12 bg-gray-900 border border-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">DOL Framework — 5 Questions</div>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { q: 'Q1', label: 'Where is price now?', ans: selectedSetup ? `${selectedSetup.symbol} near ${fmt(selectedSetup.entry_price)}` : '—' },
                  { q: 'Q2', label: 'Where is price going?', ans: selectedSetup ? `Targeting ${fmt(selectedSetup.take_profit)}` : '—' },
                  { q: 'Q3', label: 'What PD array supports it?', ans: selectedSetup ? selectedSetup.setup_type : '—' },
                  { q: 'Q4', label: 'Is liquidity aligned?', ans: selectedSetup ? (selectedSetup.confluence_score >= 70 ? 'YES — aligned' : 'PARTIAL') : '—' },
                  { q: 'Q5', label: 'CISD confirmed?', ans: selectedSetup ? (selectedSetup.status === 'ACTIVE' ? 'PENDING' : 'CONFIRMED') : '—' },
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
          <div className="h-[80vh] bg-gray-900 border border-gray-800 rounded overflow-hidden">
            <iframe
              src="https://s.tradingview.com/widgetembed/?frameElementId=tv_chart&symbol=CME_MINI%3ANQ1%21&interval=15&theme=dark&style=1&timezone=America%2FNew_York&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=1&watchlist=CME_MINI%3ANQ1%21,CME_MINI%3AES1%21&details=1&hotlist=1&calendar=1"
              className="w-full h-full border-0"
              title="TradingView NQ Chart"
            />
          </div>
        )}

        {/* ── SCANNER ── */}
        {activeTab === 'Scanner' && (
          <div className="space-y-3">
            <div className="text-gray-400 text-xs uppercase tracking-wider">{setups.length} Setups Detected</div>
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
                      <span className={`ml-2 text-xs ${s.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{s.direction}</span>
                    </div>
                    <span className={`text-xs px-1 rounded ${s.confluence_score >= 80 ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
                      {s.confluence_score}%
                    </span>
                  </div>
                  <div className="text-blue-300 text-xs mb-1">{s.setup_type}</div>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div><span className="text-gray-600">E </span><span className="text-gray-300">{fmt(s.entry_price)}</span></div>
                    <div><span className="text-red-600">SL </span><span className="text-gray-300">{fmt(s.stop_loss)}</span></div>
                    <div><span className="text-green-600">TP </span><span className="text-gray-300">{fmt(s.take_profit)}</span></div>
                  </div>
                  <div className="text-gray-600 text-xs mt-2 truncate">{s.notes}</div>
                </div>
              ))}
              {setups.length === 0 && (
                <div className="col-span-3 text-center text-gray-600 py-12">Loading setups from Supabase...</div>
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
            <div className="grid grid-cols-2 gap-3">
              {filteredArticles.map(a => (
                <div key={a.id} className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-white text-xs font-bold">{a.title}</span>
                    <span className="text-blue-400 text-xs ml-2 shrink-0">{a.episode}</span>
                  </div>
                  <span className="text-yellow-600 text-xs">{a.category}</span>
                  <p className="text-gray-400 text-xs mt-2 leading-relaxed">{a.content}</p>
                </div>
              ))}
              {filteredArticles.length === 0 && (
                <div className="col-span-2 text-center text-gray-600 py-12">No results found</div>
              )}
            </div>
          </div>
        )}

        {/* ── BACKTEST ── */}
        {activeTab === 'Backtest' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total Trades', value: trades.length.toString() },
                { label: 'Win Rate', value: `${winRate}%`, color: 'text-green-400' },
                { label: 'Net P&L', value: `$${totalPnl.toFixed(0)}`, color: totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: 'Avg R:R', value: `${avgRR}R`, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-900 border border-gray-800 rounded p-3">
                  <div className="text-gray-500 text-xs">{s.label}</div>
                  <div className={`text-xl font-bold mt-1 ${s.color || 'text-white'}`}>{s.value}</div>
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
                    <th className="text-right">Exit</th>
                    <th className="text-right">P&L</th>
                    <th className="text-right">R:R</th>
                    <th className="text-right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => (
                    <tr key={t.id} className="border-b border-gray-800">
                      <td className="py-1 text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                      <td className="text-white">{t.symbol}</td>
                      <td className={t.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>{t.direction}</td>
                      <td className="text-right text-gray-300">{fmt(t.entry_price)}</td>
                      <td className="text-right text-gray-300">{fmt(t.exit_price)}</td>
                      <td className={`text-right ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>${t.pnl?.toFixed(0)}</td>
                      <td className="text-right text-gray-300">{t.rr_achieved?.toFixed(1)}R</td>
                      <td className={`text-right ${t.result === 'WIN' ? 'text-green-400' : 'text-red-400'}`}>{t.result}</td>
                    </tr>
                  ))}
                  {trades.length === 0 && (
                    <tr><td colSpan={8} className="py-4 text-center text-gray-600">Loading trades...</td></tr>
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
