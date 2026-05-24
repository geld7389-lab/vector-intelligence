'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

// ── TYPES ────────────────────────────────────────────────────────────
interface Setup { id:string; symbol:string; timeframe:string; direction:string; setup_type:string; entry_low:number; entry_high:number; stop_loss:number; target:number; rr_ratio:number; confluence_score:number; status:string; dol_target:string; ai_analysis:string; htf_bias:string; cisd_confirmed:boolean; volume_context:string; killzone_valid:string; correlated_align:boolean; expires_at:string; market_section:string; }
interface Prices { NQ:number|null; ES:number|null; GC:number|null; DXY:number|null; VIX:number|null; }
interface KZ { nyTime:string; active:{name:string;short:string;color:string}|null; upcoming:{name:string;short:string;minsAway:number}[]; probability:string; isLunch:boolean; }
interface News { date:string; time:string; name:string; impact:string; isToday:boolean; minutesAway:number|null; isDangerZone:boolean; }
interface CryptoPrice { symbol:string; name:string; price:number|null; change24h:number|null; high24h:number|null; low24h:number|null; volume24h:number|null; }
interface NewsItem { headline:string; body:string|null; release_time:string; symbol:string; metadata:string; }
interface BtResult { id:string; symbol:string; market_section:string; setup_type:string; from_date:string; to_date:string; total_signals:number; wins:number; losses:number; win_rate:number; avg_rr:number; total_pnl:number; profit_factor:number; best_year:string; worst_year:string; yearly_breakdown:Record<string,{wins:number;losses:number;total:number}>; }
interface Candle { t:number; o:number; h:number; l:number; c:number; v?:number; }

const MARKET_TABS = ['Futures','Crypto','Forex','Stocks','Institutional'] as const;
const PLATFORM_TABS = ['Markets','Chart','Scan','MMXM','Backtest','Journal','Knowledge'] as const;
type MarketTab = typeof MARKET_TABS[number];
type PlatformTab = typeof PLATFORM_TABS[number];

const f = (n:number|string|null|undefined, d=2) => { const x=Number(n); return isNaN(x)||x===null?'—':x.toFixed(d); };
const fc = (n:number|null|undefined) => n===null||n===undefined?'text-white/30':n>0?'text-green-400/80':'text-red-400/70';
const dc = (d:string) => d==='bull'||d==='long'?'#22c55e':d==='bear'||d==='short'?'#ef4444':'#f59e0b';

// ── MINI SPARKLINE ───────────────────────────────────────────────────
function Spark({ change }: { change: number | null }) {
  if (!change) return null;
  const up = change > 0;
  return (
    <svg width="40" height="16" viewBox="0 0 40 16">
      <polyline fill="none" stroke={up ? '#22c55e' : '#ef4444'} strokeWidth="1.5" opacity="0.6"
        points={up ? "0,14 10,10 20,8 30,5 40,2" : "0,2 10,5 20,8 30,11 40,14"}/>
    </svg>
  );
}

// ── SCORE RING ───────────────────────────────────────────────────────
function Ring({ score }: { score: number }) {
  const r=12, circ=2*Math.PI*r, fill=(score/100)*circ;
  const color = score>=70?'#22c55e':score>=50?'#f59e0b':'#ef4444';
  return (
    <div className="relative w-8 h-8 flex items-center justify-center shrink-0">
      <svg width="32" height="32" className="-rotate-90">
        <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2"/>
        <circle cx="16" cy="16" r={r} fill="none" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={`${fill} ${circ}`} stroke={color}/>
      </svg>
      <span className="absolute text-xs" style={{color,fontSize:'9px'}}>{score}</span>
    </div>
  );
}

// ── CANVAS CHART ────────────────────────────────────────────────────
function CandleChart({ sym, tf, setup }: { sym:string; tf:string; setup:Setup|null }) {
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
    const W=cv.width, H=cv.height, PL=56, PR=6, PT=14, volH=30, chartH=H-PT-volH-22;
    ctx.clearRect(0,0,W,H);
    const px=candles.map(c=>[c.l,c.h]).flat();
    let mn=Math.min(...px), mx=Math.max(...px);
    if(setup){[setup.entry_low,setup.entry_high,setup.stop_loss,setup.target].forEach(l=>{if(l<mn)mn=l;if(l>mx)mx=l;});}
    const pad=(mx-mn)*0.06; mn-=pad; mx+=pad;
    const pY=(v:number)=>PT+chartH-(((v-mn)/(mx-mn))*chartH);
    const chartW=W-PL-PR, gap=chartW/candles.length, cw=Math.max(1.5,Math.min(10,gap-1));
    const maxV=Math.max(...candles.map(c=>c.v??0));
    ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=0.5;
    for(let i=0;i<=5;i++){const y=PT+(chartH/5)*i; ctx.beginPath();ctx.moveTo(PL,y);ctx.lineTo(W-PR,y);ctx.stroke(); const pv=mx-((mx-mn)/5)*i; ctx.fillStyle='rgba(255,255,255,0.2)';ctx.font='9px monospace';ctx.textAlign='right';ctx.fillText(pv.toFixed(0),PL-3,y+3);}
    if(setup){
      const ey1=pY(setup.entry_high),ey2=pY(setup.entry_low);
      ctx.fillStyle='rgba(34,197,94,0.05)';ctx.fillRect(PL,ey1,chartW,ey2-ey1);
      ctx.strokeStyle='rgba(34,197,94,0.35)';ctx.lineWidth=0.7;ctx.setLineDash([3,3]);ctx.strokeRect(PL,ey1,chartW,ey2-ey1);ctx.setLineDash([]);
      const sly=pY(setup.stop_loss); ctx.strokeStyle='rgba(239,68,68,0.5)';ctx.lineWidth=0.7;ctx.setLineDash([4,2]);ctx.beginPath();ctx.moveTo(PL,sly);ctx.lineTo(W-PR,sly);ctx.stroke();ctx.setLineDash([]);
      const tpy=pY(setup.target); ctx.strokeStyle='rgba(59,130,246,0.5)';ctx.lineWidth=0.7;ctx.setLineDash([4,2]);ctx.beginPath();ctx.moveTo(PL,tpy);ctx.lineTo(W-PR,tpy);ctx.stroke();ctx.setLineDash([]);
    }
    candles.forEach((c,i)=>{
      const x=PL+i*gap+gap/2, bull=c.c>=c.o, col=bull?'#22c55e':'#ef4444';
      ctx.strokeStyle=hov===i?'#fff':col; ctx.lineWidth=0.7;
      ctx.beginPath();ctx.moveTo(x,pY(c.h));ctx.lineTo(x,pY(c.l));ctx.stroke();
      const oy=pY(Math.max(c.o,c.c)), cy2=pY(Math.min(c.o,c.c)), bh=Math.max(1,cy2-oy);
      ctx.fillStyle=hov===i?'rgba(255,255,255,0.9)':col; ctx.fillRect(x-cw/2,oy,cw,bh);
      if(c.v&&maxV>0){const vh=(c.v/maxV)*volH;ctx.fillStyle=bull?'rgba(34,197,94,0.18)':'rgba(239,68,68,0.18)';ctx.fillRect(x-cw/2,PT+chartH+4+volH-vh,cw,vh);}
    });
    if(hov!==null&&candles[hov]){
      const c=candles[hov], x=Math.min(PL+hov*gap+gap/2, W-90);
      ctx.fillStyle='rgba(8,10,16,0.95)';ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=0.5;
      ctx.beginPath();(ctx as CanvasRenderingContext2D & {roundRect(x:number,y:number,w:number,h:number,r:number):void}).roundRect(x,PT+2,86,50,3);ctx.fill();ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.4)';ctx.font='9px monospace';ctx.textAlign='left';
      ctx.fillText(new Date(c.t).toLocaleDateString('en-US',{month:'short',day:'numeric'}),x+4,PT+11);
      ctx.fillStyle='rgba(255,255,255,0.75)';
      ctx.fillText(`O:${c.o.toFixed(0)} H:${c.h.toFixed(0)}`,x+4,PT+23);
      ctx.fillText(`L:${c.l.toFixed(0)} C:${c.c.toFixed(0)}`,x+4,PT+35);
    }
    const last=candles[candles.length-1];
    if(last){const ly=pY(last.c);ctx.strokeStyle='rgba(251,191,36,0.4)';ctx.lineWidth=0.5;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(PL,ly);ctx.lineTo(W-PR,ly);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#fbbf24';ctx.textAlign='right';ctx.font='9px monospace';ctx.fillText(last.c.toFixed(1),W-PR-2,ly-2);}
  },[candles,hov,setup]);

  const onMM=(e:React.MouseEvent<HTMLCanvasElement>)=>{ if(!ref.current||!candles.length)return; const rect=ref.current.getBoundingClientRect(),x=e.clientX-rect.left,gap=(ref.current.width-62)/candles.length,idx=Math.floor((x-56)/gap); setHov(idx>=0&&idx<candles.length?idx:null); };
  return <canvas ref={ref} width={900} height={400} className="w-full h-full cursor-crosshair" onMouseMove={onMM} onMouseLeave={()=>setHov(null)}/>;
}

// ── CRYPTO MARKET TAB ────────────────────────────────────────────────
function CryptoTab({ setups, prices: futPrices, onSetupSelect, onShowChart }: { setups:Setup[]; prices:Prices; onSetupSelect:(s:Setup)=>void; onShowChart:(s:Setup)=>void }) {
  const [prices, setPrices] = useState<CryptoPrice[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [btForm, setBtForm] = useState({ symbol: 'BTCUSD', setupTypes: ['Bullish FVG','Bearish FVG','Bullish OB','Bearish OB'] });
  const [btRunning, setBtRunning] = useState(false);
  const [btResult, setBtResult] = useState<BtResult | null>(null);
  const [btError, setBtError] = useState('');

  useEffect(() => {
    fetch('/api/crypto').then(r=>r.json()).then(d=>{ if(d.prices) setPrices(d.prices); });
    fetch('/api/newsfeed?section=crypto').then(r=>r.json()).then(d=>{ if(d.news) setNews(d.news.slice(0,8)); });
    const i = setInterval(() => fetch('/api/crypto').then(r=>r.json()).then(d=>{ if(d.prices) setPrices(d.prices); }), 30000);
    return () => clearInterval(i);
  }, []);

  const runBt = async () => {
    setBtRunning(true); setBtResult(null); setBtError('');
    try {
      const r = await fetch('/api/deepbacktest', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbol: btForm.symbol, marketSection: 'crypto', setupTypes: btForm.setupTypes }) });
      const d = await r.json();
      if (d.error) setBtError(d.error); else setBtResult(d.run);
    } catch(e) { setBtError(String(e)); }
    setBtRunning(false);
  };

  const cryptoSetups = setups.filter(s => s.market_section === 'crypto' || ['BTC','ETH','SOL','BNB','XRP','ADA'].some(c => s.symbol.includes(c)));

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pb-4">
      {/* Live Prices Grid */}
      <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
        <div className="text-white/30 text-xs uppercase tracking-wider mb-3">Live Crypto Prices · CoinDesk Index</div>
        <div className="grid grid-cols-5 gap-2">
          {prices.length === 0 && <div className="col-span-5 text-white/15 text-xs">Loading...</div>}
          {prices.map(p => (
            <div key={p.symbol} className="bg-white/2 border border-white/5 rounded-lg p-2.5">
              <div className="text-white/50 text-xs mb-0.5">{p.name}</div>
              <div className="text-white/85 text-sm font-medium">${p.price ? (p.price > 1000 ? p.price.toLocaleString('en-US',{maximumFractionDigits:0}) : p.price.toFixed(4)) : '—'}</div>
              <div className="flex items-center gap-1.5 mt-1">
                <Spark change={p.change24h} />
                <span className={`text-xs ${fc(p.change24h)}`}>{p.change24h !== null ? (p.change24h > 0 ? '+' : '') + p.change24h.toFixed(2) + '%' : '—'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Setups */}
        <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <span className="text-white/30 text-xs uppercase tracking-wider">ICT Setups · Crypto</span>
            <span className="text-white/20 text-xs">{cryptoSetups.length}</span>
          </div>
          {cryptoSetups.length === 0 ? (
            <div className="text-white/15 text-xs">No crypto setups. Run Scan with BTC/ETH symbols.</div>
          ) : cryptoSetups.map(s => (
            <button key={s.id} onClick={() => onSetupSelect(s)} className="w-full text-left border border-white/5 hover:border-white/10 rounded-lg px-3 py-2 mb-1.5 transition-colors">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-white/70 text-xs font-medium">{s.symbol}</span>
                  <span className="text-xs" style={{color:dc(s.direction)}}>{s.direction}</span>
                  <span className="text-white/30 text-xs">{s.setup_type}</span>
                </div>
                <div className="flex gap-2 items-center">
                  <Ring score={s.confluence_score}/>
                  <button onClick={e=>{e.stopPropagation();onShowChart(s);}} className="text-white/20 hover:text-white/50 text-xs">chart</button>
                </div>
              </div>
              <div className="flex gap-3 text-xs text-white/25 mt-0.5">
                <span>E {f(s.entry_low)}–{f(s.entry_high)}</span>
                <span className="text-red-400/50">SL {f(s.stop_loss)}</span>
                <span className="text-green-400/50">TP {f(s.target)}</span>
              </div>
            </button>
          ))}
        </div>

        {/* News Feed */}
        <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
          <div className="text-white/30 text-xs uppercase tracking-wider mb-3">Crypto News · MT Newswires</div>
          {news.length === 0 ? (
            <div className="text-white/15 text-xs">Loading news...</div>
          ) : news.map((n,i) => (
            <div key={i} className="border-b border-white/5 py-2 last:border-0">
              <div className="text-white/60 text-xs leading-snug">{n.headline}</div>
              <div className="text-white/20 text-xs mt-0.5">{n.release_time ? new Date(n.release_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : ''} · {n.symbol}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 10 Year Backtest */}
      <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
        <div className="text-white/30 text-xs uppercase tracking-wider mb-3">10-Year ICT Pattern Backtest · Real Historical Data</div>
        <div className="flex gap-3 items-end mb-3">
          <div>
            <label className="text-white/20 text-xs block mb-1">Symbol</label>
            <select className="bg-[#0d0f14] border border-white/8 rounded px-2 py-1.5 text-xs text-white/70 focus:outline-none" value={btForm.symbol} onChange={e=>setBtForm(p=>({...p,symbol:e.target.value}))}>
              {['BTCUSD','ETHUSD','SOLUSD','BNBUSD','XRPUSD'].map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={runBt} disabled={btRunning} className="bg-white/5 hover:bg-white/8 disabled:opacity-40 text-white/60 text-xs px-4 py-1.5 rounded-lg transition-colors">
            {btRunning ? 'Running 10 years...' : 'Run Deep Backtest'}
          </button>
        </div>
        {btError && <div className="text-red-400/60 text-xs bg-red-500/5 rounded p-2 mb-2">{btError}</div>}
        {btResult && (
          <div>
            <div className="grid grid-cols-6 gap-2 text-xs mb-3">
              {[
                ['Signals',btResult.total_signals,'text-white/60'],
                ['Win Rate',btResult.win_rate+'%',btResult.win_rate>=55?'text-green-400/70':'text-red-400/70'],
                ['Avg R:R',btResult.avg_rr+'R','text-blue-400/70'],
                ['Profit Factor',btResult.profit_factor,'text-yellow-400/70'],
                ['Best Year',btResult.best_year,'text-green-400/70'],
                ['Worst Year',btResult.worst_year,'text-red-400/70'],
              ].map(([l,v,c])=>(
                <div key={l as string} className="bg-white/3 rounded-lg p-2">
                  <div className="text-white/20 mb-0.5">{l}</div>
                  <div className={c as string}>{v}</div>
                </div>
              ))}
            </div>
            <div className="text-white/20 text-xs mb-2">Yearly breakdown:</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(btResult.yearly_breakdown).sort(([a],[b])=>a.localeCompare(b)).map(([yr,s])=>{
                const wr = s.total > 0 ? Math.round((s.wins/s.total)*100) : 0;
                return (
                  <div key={yr} className="bg-white/3 rounded px-2 py-1 text-xs">
                    <span className="text-white/30">{yr} </span>
                    <span className={wr>=55?'text-green-400/60':'text-red-400/60'}>{wr}%</span>
                    <span className="text-white/15"> ({s.total})</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── FUTURES TAB (existing NQ/ES) ─────────────────────────────────────
function FuturesTab({ setups, prices, kz, news, onSetupSelect, onShowChart }: {
  setups:Setup[]; prices:Prices; kz:KZ|null; news:News[];
  onSetupSelect:(s:Setup)=>void; onShowChart:(s:Setup)=>void;
}) {
  const [sel, setSel] = useState<Setup|null>(null);
  const [ai, setAi] = useState('');
  const [aiLoad, setAiLoad] = useState(false);
  const [showRisk, setShowRisk] = useState(false);
  const firedAlerts = useRef<Set<string>>(new Set());

  const futSetups = setups.filter(s => !s.market_section || s.market_section === 'futures');
  const dangerNews = news.some(e=>e.isDangerZone);

  const runAI = async () => {
    if (!sel) return;
    const p = prices[sel.symbol as keyof Prices];
    const isBull = sel.direction==='bull'||sel.direction==='long';
    const slB = p!==null && (isBull ? p < sel.stop_loss : p > sel.stop_loss);
    const exp = sel.expires_at && new Date(sel.expires_at) < new Date();
    if (slB || exp) { setAi(`INVALIDATED — ${slB?`SL at ${f(sel.stop_loss)} breached`:'expired'}.\n\nDo not trade this.`); return; }
    setAiLoad(true); setAi('');
    try {
      const r = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ setup: sel, prices, market: 'futures' }) });
      const d = await r.json();
      setAi(d.analysis || d.error || 'No response');
    } catch(e) { setAi(String(e)); }
    setAiLoad(false);
  };

  const dolQ = sel ? [
    {q:'Price location',a:(()=>{const p=prices[sel.symbol as keyof Prices];return p?(p<sel.entry_low?`Below zone (${(sel.entry_low-p).toFixed(0)}pts)`:p>sel.entry_high?`Above zone (${(p-sel.entry_high).toFixed(0)}pts)`:`INSIDE ZONE`):'—';})()},
    {q:'DOL',a:sel.dol_target||'—'},
    {q:'PD Array',a:`${sel.setup_type} ${f(sel.entry_low)}–${f(sel.entry_high)}`},
    {q:'Correlated',a:sel.correlated_align?'Aligned':'Not confirmed'},
    {q:'CISD',a:sel.cisd_confirmed?'Confirmed':'Pending — full body close needed'},
    {q:'Killzone',a:kz?.active?`${kz.active.name} ACTIVE`:`No KZ — next ${kz?.upcoming[0]?.name??'—'} in ${kz?.upcoming[0]?.minsAway??'?'}m`},
  ] : [];

  return (
    <div className="h-full grid grid-cols-12 gap-3 overflow-y-auto">
      {/* Stat bar */}
      <div className="col-span-12 grid grid-cols-6 gap-2">
        {[
          {l:'NQ',v:prices.NQ?.toFixed(1)??'—',c:prices.NQ&&prices.NQ>29000?'text-green-400/70':'text-red-400/70'},
          {l:'ES',v:prices.ES?.toFixed(1)??'—',c:'text-white/60'},
          {l:'VIX',v:prices.VIX?.toFixed(2)??'—',c:prices.VIX&&prices.VIX>20?'text-red-400/70':'text-green-400/70'},
          {l:'DXY',v:prices.DXY?.toFixed(3)??'—',c:'text-white/50'},
          {l:'Gold',v:prices.GC?.toFixed(1)??'—',c:'text-yellow-400/60'},
          {l:'Session',v:kz?.active?.short??'OFF',c:kz?.active?'text-green-400/60':'text-white/20'},
        ].map(s=>(
          <div key={s.l} className="bg-[#0a0c10] border border-white/5 rounded-xl p-3">
            <div className="text-white/25 text-xs mb-1">{s.l}</div>
            <div className={`text-base font-medium ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Setup list */}
      <div className="col-span-7 flex flex-col gap-2 overflow-hidden">
        <div className="text-white/25 text-xs uppercase tracking-wider">Active Setups · {futSetups.length}</div>
        <div className="overflow-y-auto flex-1 space-y-1.5">
          {futSetups.length === 0 && (
            <div className="text-center py-12 text-white/15 text-sm">No setups — run Scan</div>
          )}
          {futSetups.map(s => {
            const p = prices[s.symbol as keyof Prices];
            const inZone = p !== null && p >= s.entry_low && p <= s.entry_high;
            const slB = p !== null && (s.direction==='bull'?p<s.stop_loss:p>s.stop_loss);
            return (
              <button key={s.id} onClick={() => { setSel(s); setAi(s.ai_analysis||''); onSetupSelect(s); }}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${sel?.id===s.id?'border-white/15 bg-white/3':'border-white/5 hover:border-white/10'} ${slB?'opacity-25':''}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-white/80 font-medium text-xs">{s.symbol}</span>
                    <span className="text-white/25 text-xs">{s.timeframe}</span>
                    <span className="text-xs font-medium" style={{color:dc(s.direction)}}>{s.direction}</span>
                    <span className="text-white/35 text-xs">{s.setup_type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {inZone && <span className="text-green-400/70 text-xs animate-pulse">ENTRY</span>}
                    {slB && <span className="text-red-400/70 text-xs">SL HIT</span>}
                    <Ring score={s.confluence_score}/>
                    <button onClick={e=>{e.stopPropagation();onShowChart(s);}} className="text-white/20 hover:text-white/50 text-xs transition-colors">chart</button>
                  </div>
                </div>
                <div className="flex gap-4 text-xs text-white/25">
                  <span>E <span className="text-white/45">{f(s.entry_low)}–{f(s.entry_high)}</span></span>
                  <span>SL <span className="text-red-400/50">{f(s.stop_loss)}</span></span>
                  <span>TP <span className="text-green-400/50">{f(s.target)}</span></span>
                  <span>{f(s.rr_ratio,1)}R</span>
                  <span className="ml-auto text-white/20">{s.cisd_confirmed?'cisd✓':'cisd○'} · {s.htf_bias?.slice(0,4)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI + DOL */}
      <div className="col-span-5 flex flex-col gap-3 overflow-hidden">
        <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-3 shrink-0">
          <div className="text-white/25 text-xs uppercase tracking-wider mb-2.5">DOL Framework</div>
          {dolQ.length > 0 ? dolQ.map((q,i) => (
            <div key={i} className="flex gap-2 text-xs py-0.5">
              <span className="text-white/15 w-4 shrink-0">{i+1}</span>
              <span className="text-white/20 w-20 shrink-0">{q.q}</span>
              <span className={`text-white/50 ${i===4&&!sel?.cisd_confirmed?'text-yellow-400/60':''}`}>{q.a}</span>
            </div>
          )) : <div className="text-white/12 text-xs">Select a setup</div>}
        </div>
        <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-3 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2.5 shrink-0">
            <span className="text-white/25 text-xs uppercase tracking-wider">AI Analyst · ICT Methodology</span>
            <button onClick={runAI} disabled={!sel||aiLoad} className="text-xs px-3 py-1 bg-white/5 hover:bg-white/8 disabled:opacity-30 text-white/50 rounded-lg transition-colors">{aiLoad?'...':'Analyse'}</button>
          </div>
          {sel && <div className="text-white/25 text-xs mb-2 shrink-0">{sel.symbol} · {sel.setup_type}</div>}
          <div className="flex-1 overflow-y-auto">
            {ai ? <pre className={`text-xs leading-relaxed whitespace-pre-wrap ${ai.startsWith('INVALIDATED')?'text-red-400/60':'text-white/55'}`}>{ai}</pre>
              : <div className="text-white/10 text-xs">{sel?'Hit Analyse':'Select a setup'}</div>}
          </div>
        </div>

        {/* Killzones */}
        <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-3 shrink-0">
          <div className="grid grid-cols-6 gap-1 mb-2">
            {[{s:'ASIA',c:'#6366f1'},{s:'LON',c:'#f59e0b'},{s:'NY',c:'#22c55e'},{s:'SB',c:'#3b82f6'},{s:'LCL',c:'#ef4444'},{s:'NYA',c:'#a855f7'}].map(z=>{
              const isA=kz?.active?.short===z.s;
              return <div key={z.s} className="rounded py-1 text-center" style={{background:isA?z.c+'15':'rgba(255,255,255,0.02)',border:`0.5px solid ${isA?z.c+'40':'rgba(255,255,255,0.04)'}`}}>
                <div className="text-xs" style={{color:isA?z.c:'rgba(255,255,255,0.2)',fontSize:'9px'}}>{z.s}</div>
                {isA&&<div className="text-xs animate-pulse" style={{color:z.c,fontSize:'8px'}}>LIVE</div>}
              </div>;
            })}
          </div>
          {news.filter((_,i)=>i<4).map((e,i)=>(
            <div key={i} className={`flex justify-between text-xs py-0.5 ${e.isDangerZone?'text-red-400/70 animate-pulse':e.isToday?'text-yellow-400/50':'text-white/15'}`}>
              <span className="truncate mr-2">{e.name}</span>
              <span className="shrink-0">{e.isToday?(e.minutesAway!==null?(e.minutesAway>0?`${e.minutesAway}m`:`${Math.abs(e.minutesAway)}m ago`):'TODAY'):e.date}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── FOREX/STOCKS/INSTITUTIONAL PLACEHOLDER ───────────────────────────
function ComingSoonTab({ name, items }: { name: string; items: string[] }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4">
      <div className="text-white/20 text-sm font-medium">{name}</div>
      <div className="text-white/10 text-xs max-w-sm text-center leading-relaxed">
        Live data for this section requires FMP Starter plan upgrade at financialmodelingprep.com/developer/docs/pricing
      </div>
      <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4 text-xs text-white/20 space-y-1.5 max-w-sm w-full">
        {items.map(i => <div key={i}>· {i}</div>)}
      </div>
    </div>
  );
}

// ── SCAN MODAL ───────────────────────────────────────────────────────
function ScanModal({ prices, kz, onClose, onSaved }: { prices:Prices; kz:KZ|null; onClose:()=>void; onSaved:()=>void }) {
  const [syms, setSyms] = useState<string[]>(['NQ','ES']);
  const [tfs, setTfs] = useState<string[]>(['15m','1h']);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{message:string;count:number;setups:{symbol:string;timeframe:string;direction:string;setup_type:string;entry_low:number;entry_high:number;stop_loss:number;target:number;rr_ratio:number;confluence_score:number}[]}|null>(null);
  const [err, setErr] = useState('');
  const togS=(s:string)=>setSyms(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);
  const togT=(t:string)=>setTfs(p=>p.includes(t)?p.filter(x=>x!==t):[...p,t]);
  const scan=async()=>{ setLoading(true);setResult(null);setErr(''); try{ const r=await fetch('/api/autoscan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols:syms,timeframes:tfs,currentPrices:prices})}); const d=await r.json(); if(d.error)setErr(typeof d.error==='string'?d.error:JSON.stringify(d.error)); else setResult(d); }catch(e){setErr(String(e));} setLoading(false); };
  const btn=(active:boolean)=>`text-xs px-3 py-1.5 rounded-lg border transition-colors ${active?'border-white/20 bg-white/8 text-white/80':'border-white/5 text-white/30 hover:border-white/10'}`;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#0a0c10] border border-white/8 rounded-xl p-5 w-96 max-h-[85vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4"><span className="text-white/80 text-sm font-medium">Auto Scan · Live Market</span><button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg">×</button></div>
        <div className="grid grid-cols-2 gap-2 bg-white/3 rounded-lg p-3 text-xs mb-4">
          {(['NQ','ES','GC','DXY'] as const).map(s=><div key={s} className="flex justify-between"><span className="text-white/30">{s}</span><span className="text-white/60">{prices[s]?.toFixed(s==='DXY'?3:1)??'—'}</span></div>)}
        </div>
        <div className="mb-3"><div className="text-white/25 text-xs mb-2">Symbols</div><div className="flex flex-wrap gap-2">{['NQ','ES','BTC','ETH','SOL'].map(s=><button key={s} onClick={()=>togS(s)} className={btn(syms.includes(s))}>{s}</button>)}</div></div>
        <div className="mb-4"><div className="text-white/25 text-xs mb-2">Timeframes</div><div className="flex gap-2">{['15m','1h','4h'].map(t=><button key={t} onClick={()=>togT(t)} className={btn(tfs.includes(t))}>{t}</button>)}</div></div>
        <button onClick={scan} disabled={loading||!syms.length||!tfs.length} className="w-full bg-white/5 hover:bg-white/8 disabled:opacity-40 text-white/70 text-sm py-2.5 rounded-lg font-medium mb-4 transition-colors">{loading?'Scanning live candles...':'Scan Now'}</button>
        {err&&<div className="text-red-400/60 text-xs bg-red-500/5 rounded p-2 mb-3">{err}</div>}
        {result&&(
          <div className={`rounded-lg p-3 text-xs ${result.count>0?'bg-green-500/5 border border-green-500/15':'bg-yellow-500/5 border border-yellow-500/15'}`}>
            <div className={`font-medium mb-2 ${result.count>0?'text-green-400/80':'text-yellow-400/80'}`}>{result.message}</div>
            {result.setups?.map((s,i)=>(
              <div key={i} className="border-t border-white/5 pt-2 mt-2 first:border-0 first:mt-0 first:pt-0">
                <div className="flex justify-between mb-0.5"><span className="text-white/60 font-medium">{s.symbol} {s.timeframe}</span><span style={{color:dc(s.direction)}} className="text-xs">{s.direction.toUpperCase()}</span></div>
                <div className="text-white/35">{s.setup_type}</div>
                <div className="flex gap-3 mt-1 text-white/30"><span>E:{f(s.entry_low)}–{f(s.entry_high)}</span><span className="text-red-400/50">SL:{f(s.stop_loss)}</span><span className="text-green-400/50">TP:{f(s.target)}</span><span className="text-blue-400/50">{f(s.rr_ratio,1)}R</span></div>
              </div>
            ))}
            {result.count>0&&<button onClick={()=>{onSaved();onClose();}} className="w-full mt-3 bg-white/5 hover:bg-white/8 text-white/50 text-xs py-1.5 rounded-lg">View setups</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── KNOWLEDGE TAB ────────────────────────────────────────────────────
function KnowledgeTab() {
  const [articles, setArticles] = useState<{id:string;title:string;content:string;category:string;source_episode:string;tags:string[];is_user_note:boolean}[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    sb.from('knowledge_base').select('*').order('source_episode').limit(100).then(({data}) => { if(data) setArticles(data as typeof articles); });
  }, []);
  const filtered = articles.filter(a => !search || a.title?.toLowerCase().includes(search.toLowerCase()) || a.content?.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      <input placeholder="Search ICT concepts..." value={search} onChange={e=>setSearch(e.target.value)} className="bg-[#0a0c10] border border-white/8 rounded-lg px-3 py-1.5 text-xs text-white/60 placeholder-white/15 focus:outline-none focus:border-white/20 shrink-0"/>
      <div className="text-white/20 text-xs shrink-0">{filtered.length} of {articles.length} articles · from your 8 ICT videos</div>
      <div className="overflow-y-auto flex-1">
        <div className="grid grid-cols-2 gap-2 pb-4">
          {filtered.map(a => (
            <div key={a.id} className={`bg-[#0a0c10] border rounded-xl p-3 ${a.is_user_note?'border-blue-500/10':'border-white/5'}`}>
              <div className="flex justify-between items-start mb-1.5">
                <span className="text-white/70 text-xs font-medium">{a.title}</span>
                <span className="text-white/20 text-xs ml-2 shrink-0">{a.source_episode}</span>
              </div>
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/4 text-white/20">{a.category}</span>
              <p className="text-white/35 text-xs mt-2 leading-relaxed">{a.content}</p>
              {a.tags?.length>0&&<div className="flex gap-1 flex-wrap mt-2">{a.tags.map((t:string)=><span key={t} className="text-xs text-white/15 bg-white/3 px-1.5 py-0.5 rounded">{t}</span>)}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── JOURNAL TAB ──────────────────────────────────────────────────────
function JournalTab() {
  const [entries, setEntries] = useState<{id:string;date:string;title:string;content:string;emotion:string;result:string}[]>([]);
  const [form, setForm] = useState({date:new Date().toISOString().slice(0,10),title:'',content:'',emotion:'neutral',result:'no trade'});
  const [adding, setAdding] = useState(false), [saving, setSaving] = useState(false);
  const inp="w-full bg-[#0d0f14] border border-white/8 rounded px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-white/20";
  useEffect(()=>{ sb.from('journal').select('*').order('date',{ascending:false}).limit(50).then(({data})=>{if(data)setEntries(data as typeof entries);}); },[]);
  const save=async()=>{ if(!form.title||!form.content)return; setSaving(true); const {data}=await sb.from('journal').insert(form).select(); if(data){setEntries(p=>[data[0] as typeof entries[0],...p]);setAdding(false);setForm({date:new Date().toISOString().slice(0,10),title:'',content:'',emotion:'neutral',result:'no trade'});} setSaving(false); };
  const eC=(e:string)=>e==='confident'?'text-green-400/60':e==='patient'?'text-blue-400/60':(e==='fomo'||e==='revenge'||e==='anxious')?'text-red-400/60':'text-white/30';
  const rC=(r:string)=>r==='win'?'text-green-400/60':r==='loss'?'text-red-400/60':r==='be'?'text-yellow-400/60':'text-white/20';
  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
        <span className="text-white/30 text-xs uppercase tracking-wider">Journal</span>
        <button onClick={()=>setAdding(true)} className="text-xs px-3 py-1.5 bg-white/5 hover:bg-white/8 text-white/50 rounded-lg transition-colors">+ Entry</button>
      </div>
      {adding&&(
        <div className="bg-[#0a0c10] border border-white/8 rounded-xl p-4 shrink-0">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div><label className="text-white/25 text-xs block mb-1">Date</label><input type="date" className={inp} value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
            <div><label className="text-white/25 text-xs block mb-1">Emotion</label><select className={inp} value={form.emotion} onChange={e=>setForm(p=>({...p,emotion:e.target.value}))}><option value="confident">Confident</option><option value="patient">Patient</option><option value="neutral">Neutral</option><option value="anxious">Anxious</option><option value="fomo">FOMO</option><option value="revenge">Revenge</option></select></div>
            <div><label className="text-white/25 text-xs block mb-1">Result</label><select className={inp} value={form.result} onChange={e=>setForm(p=>({...p,result:e.target.value}))}><option value="win">Win</option><option value="loss">Loss</option><option value="be">BE</option><option value="no trade">No Trade</option></select></div>
          </div>
          <div className="mb-2"><label className="text-white/25 text-xs block mb-1">Title</label><input className={inp} value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/></div>
          <div className="mb-3"><label className="text-white/25 text-xs block mb-1">Notes</label><textarea className={inp+' resize-none'} rows={3} value={form.content} onChange={e=>setForm(p=>({...p,content:e.target.value}))}/></div>
          <div className="flex gap-2"><button onClick={save} disabled={saving} className="flex-1 bg-white/8 hover:bg-white/12 disabled:opacity-40 text-white/70 text-xs py-1.5 rounded-lg">{saving?'Saving...':'Save'}</button><button onClick={()=>setAdding(false)} className="px-4 bg-white/3 text-white/30 text-xs rounded-lg">Cancel</button></div>
        </div>
      )}
      <div className="overflow-y-auto flex-1 space-y-2 pb-4">
        {entries.map(e=>(
          <div key={e.id} className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
            <div className="flex justify-between mb-1.5">
              <div><span className="text-white/65 text-xs font-medium">{e.title}</span><span className="text-white/20 text-xs ml-2">{e.date}</span></div>
              <div className="flex gap-2 text-xs"><span className={eC(e.emotion)}>{e.emotion}</span><span className={rC(e.result)}>{e.result?.toUpperCase()}</span></div>
            </div>
            <p className="text-white/30 text-xs leading-relaxed whitespace-pre-wrap">{e.content}</p>
          </div>
        ))}
        {!entries.length&&!adding&&<div className="text-center py-16 text-white/12 text-sm">No entries yet</div>}
      </div>
    </div>
  );
}

// ── MAIN APP ─────────────────────────────────────────────────────────
export default function App() {
  const [platTab, setPlatTab] = useState<PlatformTab>('Markets');
  const [mktTab, setMktTab] = useState<MarketTab>('Futures');
  const [setups, setSetups] = useState<Setup[]>([]);
  const [prices, setPrices] = useState<Prices>({NQ:null,ES:null,GC:null,DXY:null,VIX:null});
  const [prev, setPrev] = useState<Prices>({NQ:null,ES:null,GC:null,DXY:null,VIX:null});
  const [kz, setKz] = useState<KZ|null>(null);
  const [news, setNews] = useState<News[]>([]);
  const [chartSym, setChartSym] = useState('NQ');
  const [chartTf, setChartTf] = useState('15m');
  const [chartSetup, setChartSetup] = useState<Setup|null>(null);
  const [showScan, setShowScan] = useState(false);
  const [alerts, setAlerts] = useState<{id:string;msg:string;type:string}[]>([]);
  const firedAlerts = useRef<Set<string>>(new Set());

  const addAlert = useCallback((msg:string, type='y') => { const id=Date.now().toString(); setAlerts(p=>[...p.slice(-2),{id,msg,type}]); setTimeout(()=>setAlerts(p=>p.filter(a=>a.id!==id)),7000); }, []);
  const loadSetups = useCallback(async () => { const {data}=await sb.from('setups').select('*').in('status',['active','watching','triggered']).order('confluence_score',{ascending:false}).limit(60); if(data)setSetups(data as Setup[]); }, []);

  useEffect(() => { loadSetups(); }, [loadSetups]);

  const loadPrices = useCallback(async () => { try{ const r=await fetch('/api/prices',{cache:'no-store'}); const d=await r.json(); if(d.prices){setPrev(prices);setPrices(d.prices);} }catch{} }, [prices]);
  const loadKz = useCallback(async () => { try{ const r=await fetch('/api/killzone',{cache:'no-store'}); const d=await r.json(); setKz(d); }catch{} }, []);
  const loadNews = useCallback(async () => { try{ const r=await fetch('/api/calendar',{cache:'no-store'}); const d=await r.json(); setNews(d.events??[]); }catch{} }, []);

  useEffect(() => { loadPrices();loadKz();loadNews(); const pi=setInterval(loadPrices,15000),ki=setInterval(loadKz,60000),ni=setInterval(loadNews,300000); return()=>{clearInterval(pi);clearInterval(ki);clearInterval(ni);}; }, [loadPrices,loadKz,loadNews]);

  useEffect(() => {
    if(!prices.NQ&&!prices.ES)return;
    setups.forEach(s=>{
      if(!['active','watching'].includes(s.status))return;
      if(s.expires_at&&new Date(s.expires_at)<new Date())return;
      const p=prices[s.symbol as keyof Prices]; if(!p)return;
      const bull=s.direction==='bull'||s.direction==='long';
      const slK=`sl-${s.id}`; if(!firedAlerts.current.has(slK)&&((bull&&p<s.stop_loss)||(!bull&&p>s.stop_loss))){firedAlerts.current.add(slK);addAlert(`SL hit — ${s.symbol} ${s.setup_type}`,'r');}
      const eK=`e-${s.id}`; if(!firedAlerts.current.has(eK)&&p>=s.entry_low&&p<=s.entry_high){firedAlerts.current.add(eK);addAlert(`Entry zone — ${s.symbol} ${s.setup_type}`,'g');}
    });
  }, [prices, setups, addAlert]);

  const dangerNews = news.some(e=>e.isDangerZone);
  const alertStyle=(t:string)=>t==='r'?'border-red-500/20 bg-red-500/8 text-red-300/70':t==='g'?'border-green-500/20 bg-green-500/8 text-green-300/70':'border-white/10 bg-white/5 text-white/50';

  const handleSetupSelect = (s: Setup) => { setChartSetup(s); };
  const handleShowChart = (s: Setup) => { setChartSym(s.symbol.includes('BTC')||s.symbol.includes('ETH')?'BTC':'NQ'); setChartSetup(s); setPlatTab('Chart'); };

  return (
    <div className="h-screen bg-[#060810] text-white font-mono text-sm flex flex-col overflow-hidden">
      {/* Alerts */}
      <div className="fixed top-11 right-3 z-50 flex flex-col gap-1.5 pointer-events-none">
        {alerts.map(a=><div key={a.id} className={`text-xs px-3 py-1.5 rounded-lg border ${alertStyle(a.type)}`}>{a.msg}</div>)}
      </div>

      {/* HEADER */}
      <header className="border-b border-white/5 px-5 h-11 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white/85 font-bold tracking-widest text-sm">VECTOR</span>
          <span className="w-1.5 h-1.5 rounded-full bg-green-400/60 animate-pulse"></span>
        </div>
        <div className="flex items-center gap-5 text-xs">
          {dangerNews&&<span className="text-red-400/70 animate-pulse text-xs">NEWS RISK</span>}
          {kz?.active ? <span className="text-xs px-2 py-0.5 rounded" style={{color:kz.active.color,background:kz.active.color+'12'}}>{kz.active.short} · {kz.probability}</span>
            : <span className="text-white/15 text-xs">{kz?.upcoming[0]?`${kz.upcoming[0].short} ${kz.upcoming[0].minsAway}m`:'off hours'}</span>}
          <div className="flex items-center gap-4">
            {(['NQ','ES','GC','DXY','VIX'] as const).map(sym=>{
              const p=prices[sym],pp=prev[sym],up=p!==null&&pp!==null&&p>pp,dn=p!==null&&pp!==null&&p<pp;
              return <span key={sym} className={`${up?'text-green-400/70':dn?'text-red-400/70':'text-white/25'}`}>{sym} {p!==null?p.toFixed(sym==='VIX'?2:1):'—'}</span>;
            })}
          </div>
          <span className="text-white/12">NY {kz?.nyTime??''}</span>
        </div>
      </header>

      {/* NAV */}
      <nav className="border-b border-white/5 px-5 flex items-center h-9 shrink-0">
        {PLATFORM_TABS.map(t=><button key={t} onClick={()=>setPlatTab(t)} className={`px-3 h-full text-xs border-b transition-colors ${platTab===t?'border-white/35 text-white/75':'border-transparent text-white/22 hover:text-white/45'}`}>{t}</button>)}
        <div className="ml-auto flex gap-2">
          <button onClick={()=>setShowScan(true)} className="text-xs px-3 py-1 rounded-lg border border-white/8 text-white/35 hover:text-white/55 hover:border-white/15 transition-colors">Scan</button>
        </div>
      </nav>

      {showScan && <ScanModal prices={prices} kz={kz} onClose={()=>setShowScan(false)} onSaved={loadSetups}/>}

      {/* MAIN */}
      <main className="flex-1 overflow-hidden p-4 min-h-0">

        {platTab === 'Markets' && (
          <div className="flex flex-col h-full gap-0">
            {/* Market section tabs */}
            <div className="flex gap-0 mb-3 shrink-0 border-b border-white/5 pb-2">
              {MARKET_TABS.map(t => (
                <button key={t} onClick={()=>setMktTab(t)} className={`px-4 py-1.5 text-xs rounded-lg mr-1 transition-colors ${mktTab===t?'bg-white/8 text-white/75':'text-white/25 hover:text-white/45'}`}>{t}</button>
              ))}
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              {mktTab === 'Futures' && <FuturesTab setups={setups} prices={prices} kz={kz} news={news} onSetupSelect={handleSetupSelect} onShowChart={handleShowChart}/>}
              {mktTab === 'Crypto' && <CryptoTab setups={setups} prices={prices} onSetupSelect={handleSetupSelect} onShowChart={handleShowChart}/>}
              {mktTab === 'Forex' && <ComingSoonTab name="Forex & Commodities" items={['EUR/USD, GBP/USD, USD/JPY, AUD/USD','Gold (XAUUSD), Silver, Crude Oil, Natural Gas','DXY correlation engine','COT institutional positioning from CFTC','Macro session filter (London/NY overlap)','FMP Starter plan required for live forex data']}/>}
              {mktTab === 'Stocks' && <ComingSoonTab name="Stocks & ETFs" items={['S&P 500, Nasdaq, Russell 2000 constituents','SPY, QQQ, IWM, GLD, TLT ETFs','Earnings-aware setup generation','Sector rotation heatmap','Top gainers/losers with ICT setups','FMP Starter plan required for live equity data']}/>}
              {mktTab === 'Institutional' && <ComingSoonTab name="Institutional & Macro" items={['BlackRock, Bridgewater, Citadel positioning','13F filings — what funds actually own','COT report — commercial vs non-commercial','Fed balance sheet & liquidity tracking','Bond yields vs equity correlation','FMP Premium plan required']}/>}
            </div>
          </div>
        )}

        {platTab === 'Chart' && (
          <div className="flex flex-col gap-3 h-full">
            <div className="flex gap-2 items-center shrink-0">
              <div className="flex gap-1">{['NQ','ES','BTC','ETH'].map(s=><button key={s} onClick={()=>{setChartSym(s);setChartSetup(null);}} className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${chartSym===s?'border-white/20 bg-white/5 text-white/70':'border-white/5 text-white/25 hover:border-white/10'}`}>{s}</button>)}</div>
              <div className="flex gap-1">{['15m','1h','4h','D'].map(t=><button key={t} onClick={()=>setChartTf(t)} className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${chartTf===t?'border-white/20 bg-white/5 text-white/70':'border-white/5 text-white/25 hover:border-white/10'}`}>{t}</button>)}</div>
              {chartSetup && <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-white/8 text-xs ml-2"><span style={{color:dc(chartSetup.direction)}}>●</span><span className="text-white/45">{chartSetup.symbol} {chartSetup.setup_type}</span><button onClick={()=>setChartSetup(null)} className="text-white/20 hover:text-white/50 ml-1">×</button></div>}
              <button onClick={()=>setShowScan(true)} className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-white/8 text-white/30 hover:text-white/50 transition-colors">Scan</button>
            </div>
            {chartSetup && <div className="flex gap-5 text-xs shrink-0 text-white/25">
              <span>Entry <span className="text-green-400/55">{f(chartSetup.entry_low)}–{f(chartSetup.entry_high)}</span></span>
              <span>SL <span className="text-red-400/55">{f(chartSetup.stop_loss)}</span></span>
              <span>TP <span className="text-blue-400/55">{f(chartSetup.target)}</span></span>
              <span>{f(chartSetup.rr_ratio,1)}R · {chartSetup.cisd_confirmed?'CISD confirmed':'CISD pending'}</span>
            </div>}
            <div className="flex-1 bg-[#0a0c10] border border-white/5 rounded-xl overflow-hidden min-h-0">
              <CandleChart sym={chartSym} tf={chartTf} setup={chartSetup}/>
            </div>
            <div className="flex gap-2 flex-wrap shrink-0">
              {setups.filter(s=>s.symbol===chartSym||s.symbol.includes(chartSym)).map(s=>(
                <button key={s.id} onClick={()=>setChartSetup(s)} className={`text-xs px-2 py-1 rounded-lg border transition-colors ${chartSetup?.id===s.id?'border-white/20 bg-white/5 text-white/60':'border-white/5 text-white/20 hover:border-white/10'}`}>
                  <span style={{color:dc(s.direction)}}>{s.direction}</span> {s.timeframe} · {s.setup_type.slice(0,14)}
                </button>
              ))}
            </div>
          </div>
        )}

        {platTab === 'MMXM' && (
          <div className="flex flex-col gap-3 overflow-y-auto h-full pb-4">
            <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
              <div className="text-white/30 text-xs uppercase tracking-wider mb-3">AMD Model Reference · From Your ICT Videos</div>
              <div className="grid grid-cols-3 gap-3">
                {[['Accumulation','Asia session. Range building. Liquidity stacks above and below. Smart money positions silently. No direction bias yet.','rgba(99,102,241,0.5)'],['Manipulation','London open. Judas swing. Price engineered to sweep SSL or BSL, trapping retail entries on the wrong side. CISD follows.','rgba(245,158,11,0.5)'],['Distribution','NY session. True delivery. Price moves to the opposing DOL from the manipulation sweep. This is where you trade.','rgba(34,197,94,0.5)']].map(([ph,desc,c])=>(
                  <div key={ph} className="rounded-xl p-4" style={{background:c.replace('0.5','0.06'),border:`0.5px solid ${c.replace('0.5','0.2')}`}}>
                    <div className="font-medium mb-2 text-sm" style={{color:c.replace('0.5','0.8')}}>{ph}</div>
                    <div className="text-white/35 text-xs leading-relaxed">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4">
              <div className="text-white/30 text-xs uppercase tracking-wider mb-3">ICT Key Rules · From Episodes 1–7</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['CISD Rule','A FULL candle body close through a prior swing is required. A wick is NOT a real MSS. This is the single most common error traders make.'],
                  ['Liquidity Sequencing','When bullish and price hits BSL — wait for a run on sell stops (SSL) before going long. Never buy directly into BSL.'],
                  ['Premium / Discount','Below 50% equilibrium = discount (longs). Above 50% = premium (shorts). Never buy premium, never sell discount.'],
                  ['DOL First','Always identify the Draw on Liquidity before looking for entry. The setup only makes sense if there is a clear pool for price to deliver to.'],
                  ['Multi-Timeframe','Daily/Weekly for bias. 4H for structure. 1H for CISD confirmation. 15m/5m for entry PD array. Never skip a timeframe.'],
                  ['Confluence','All 5 must align: HTF bias + liquidity sweep done + real CISD + PD array in correct zone + clear DOL. Missing any = no trade.'],
                ].map(([t,d])=>(
                  <div key={t} className="border border-white/5 rounded-xl p-3">
                    <div className="text-white/60 text-xs font-medium mb-1.5">{t}</div>
                    <div className="text-white/30 text-xs leading-relaxed">{d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {platTab === 'Backtest' && (
          <div className="flex flex-col gap-3 overflow-y-auto h-full pb-4">
            <div className="bg-yellow-500/5 border border-yellow-500/15 rounded-xl px-4 py-2.5 text-xs text-yellow-400/70">
              Use the Crypto tab for 10-year deep backtest on BTC/ETH using real FMP historical data.
            </div>
            <div className="bg-[#0a0c10] border border-white/5 rounded-xl p-4 text-white/20 text-xs">
              <div className="text-white/40 text-sm font-medium mb-2">Backtest Engine</div>
              <div>Go to Markets → Crypto → scroll down to find the 10-Year ICT Pattern Backtest. Select BTC/ETH/SOL and run. It pulls real daily OHLCV from 2016 and tests FVG + OB pattern detection across 10 years of actual price data.</div>
            </div>
          </div>
        )}

        {platTab === 'Journal' && <JournalTab/>}
        {platTab === 'Knowledge' && <KnowledgeTab/>}

        {platTab === 'Scan' && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-white/30 text-sm">Auto-Scan · Live Market</div>
            <div className="text-white/15 text-xs">Click the Scan button in the nav or use it from any market tab</div>
            <button onClick={()=>setShowScan(true)} className="text-xs px-6 py-2.5 bg-white/5 hover:bg-white/8 border border-white/10 text-white/60 rounded-xl transition-colors">Open Scanner</button>
          </div>
        )}
      </main>
    </div>
  );
}
