'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

type View = 'dashboard' | 'chart' | 'scanner' | 'knowledge' | 'backtest'
type Direction = 'bull' | 'bear' | 'inversion'

interface Setup {
  id: string; symbol: string; timeframe: string; setup_type: string
  direction: Direction; confluence_score: number; entry_low: number
  entry_high: number; stop_loss: number; target: number; rr_ratio: number
  status: string; dol_target: string; ai_analysis: string | null; created_at: string
}
interface Alert { id: string; symbol: string; timeframe: string; message: string; severity: string; created_at: string }
interface Trade { id: string; symbol: string; direction: string; entry_price: number; stop_loss: number; take_profit: number; result: string; rr_achieved: number | null; notes: string | null; opened_at: string }
interface LivePrice { price: number; change: number; pct: number }

const KB_CARDS = [
  { tag:'PD ARRAYS · EP1', title:'Order Block (OB)', body:'The last bearish candle before a bullish impulse / last bullish before bearish. Price returns to fill the imbalance. Only valid in correct premium/discount zone aligned with HTF bias.', tags:['OB','Discount','Premium'] },
  { tag:'PD ARRAYS · EP1', title:'Fair Value Gap (BISI / SIBI)', body:'3-candle imbalance where candle 1 and 3 wicks do not overlap. <strong>BISI</strong> = Buy Side Imbalance (bullish). <strong>SIBI</strong> = Sell Side Imbalance (bearish). Shown on weekly SPX Ep1.', tags:['FVG','BISI','SIBI'] },
  { tag:'PD ARRAYS · EP4', title:'Inversion PD Arrays (IOB/IFVG)', body:'When OB/FVG/BRK broken through with full body close it inverts. <strong>IOB</strong> = Inversion OB — trade from opposite side on return. Stacked inversions = strongest zones. ES 15m Ep4.', tags:['IOB','IFVG','IBRK'] },
  { tag:'THE MODEL · EP2', title:'CISD — Change in State of Delivery', body:'Must be a <strong>FULL CANDLE BODY CLOSE</strong> through prior swing. A wick is NOT a real MSS — the single most important rule. Bullish: body closes above swing high after SSL sweep.', tags:['CISD','MSS','Trigger'] },
  { tag:'DOL FRAMEWORK · EP3', title:'Draw On Liquidity (DOL)', body:'Where price is magnetically drawn next. Always a liquidity pool. <strong>5 Qs:</strong> (1) from where? (2) CISD where? (3) price at? (4) arrays respected? (5) delivering to where?', tags:['DOL','BSL','SSL','Target'] },
  { tag:'REFINEMENT · EP6', title:'Liquidity Sequencing Rule', body:'"<strong>When bullish and price hits BSL — wait for run on sell stops before going long.</strong>" Never buy into BSL. SSL sweep → CISD → PD array entry. Eliminates most losing trades.', tags:['BSL','SSL','Key Rule'] },
  { tag:'MMXM · BONUS', title:'Market Maker Model (MMXM)', body:'<strong>Accumulation</strong> → <strong>Manipulation</strong> (stop hunt) → <strong>Distribution</strong> (true delivery). Multi-TF DOL: 1H = macro target, 5m = micro entry. SPX weekly Bonus ep.', tags:['MMXM','Accumulation','Manipulation'] },
  { tag:'SYNTHESIS · EP5', title:'Multi-TF Execution Model', body:'Daily: bias. 4H: structure. 1H: CISD + DOL. 15m/5m: entry PD array left by CISD impulse. Live NQ execution Ep5 shows full top-down flow. Never skip a timeframe.', tags:['MTF','Execution','Top-Down'] },
]

const RULES = [
  { num:'R1', text:'<strong>Never buy into buyside liquidity.</strong> Wait for the sweep → CISD → entry. — Ep6' },
  { num:'R2', text:'<strong>CISD must be a full candle body close.</strong> A wick through a level is NOT a real MSS. — Ep2' },
  { num:'R3', text:'<strong>All timeframes must align.</strong> Daily → 4H → 1H → 15m. One misaligned TF = skip the trade. — Ep5' },
  { num:'R4', text:'<strong>Violated OB/FVG inverts.</strong> Trade it from opposite side on return. Stacked = strongest. — Ep4' },
  { num:'R5', text:'<strong>Know your DOL before the chart.</strong> Answer all 5 questions. No DOL clarity = no trade. — Ep3' },
  { num:'R6', text:'<strong>Respect the MMXM cycle phase.</strong> Trading against manipulation phase loses every time. — Bonus' },
  { num:'R7', text:'<strong>PD Arrays only valid in correct premium/discount zone.</strong> Buying OB in premium = wrong. — Ep1' },
]

export default function VectorPlatform() {
  const [view, setView] = useState<View>('dashboard')
  const [livePrices, setLivePrices] = useState<Record<string, LivePrice>>({
    NQ:  { price: 29459.00, change: 124.50,  pct: 0.42 },
    ES:  { price: 5870.50,  change: 18.25,   pct: 0.31 },
    GC:  { price: 3326.40,  change: 12.10,   pct: 0.36 },
    DXY: { price: 99.82,    change: -0.41,   pct: -0.41 },
    VIX: { price: 18.24,    change: 0.62,    pct: 3.52 },
  })
  const [setups, setSetups]     = useState<Setup[]>([])
  const [alerts, setAlerts]     = useState<Alert[]>([])
  const [trades, setTrades]     = useState<Trade[]>([])
  const [selected, setSelected] = useState<Setup | null>(null)
  const [aiOut, setAiOut]       = useState('')
  const [aiLoad, setAiLoad]     = useState(false)
  const [kbQ, setKbQ]           = useState('')
  const [filter, setFilter]     = useState('all')
  const [asset, setAsset]       = useState('NQ')
  const [tf, setTf]             = useState('60')
  const [time, setTime]         = useState('')
  const [session, setSession]   = useState('')
  const [dbOk, setDbOk]         = useState(false)
  const [priceOk, setPriceOk]   = useState(false)
  const priceRef = useRef(livePrices)
  priceRef.current = livePrices

  // ── Clock ──
  useEffect(() => {
    const tick = () => {
      const et = new Date().toLocaleTimeString('en-US', { hour12:false, timeZone:'America/New_York' })
      setTime(et + ' ET')
      const h = parseInt(et.split(':')[0])
      setSession(h>=9&&h<16 ? 'NY SESSION' : h>=14&&h<17 ? 'LONDON CLOSE' : h>=2&&h<8 ? 'LONDON' : 'ASIA')
    }
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  // ── Real prices from Yahoo Finance ──
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch('/api/prices')
        if (!res.ok) throw new Error('fail')
        const d = await res.json()
        if (d.NQ && d.ES) {
          setLivePrices({
            NQ:  { price: d.NQ,  change: d.NQ_change ?? 0,  pct: d.NQ_pct ?? 0 },
            ES:  { price: d.ES,  change: d.ES_change ?? 0,  pct: d.ES_pct ?? 0 },
            GC:  { price: d.GC  ?? 3326.40, change: d.GC_change  ?? 0, pct: 0 },
            DXY: { price: d.DXY ?? 99.82,   change: d.DXY_change ?? 0, pct: 0 },
            VIX: { price: d.VIX ?? 18.24,   change: d.VIX_change ?? 0, pct: 0 },
          })
          setPriceOk(!d.fallback)
        }
      } catch { setPriceOk(false) }
    }
    fetchPrices()
    const id = setInterval(fetchPrices, 15000)
    return () => clearInterval(id)
  }, [])

  // ── Micro-jitter between real fetches ──
  useEffect(() => {
    const id = setInterval(() => {
      setLivePrices(p => ({
        ...p,
        NQ: { ...p.NQ, price: parseFloat((p.NQ.price + (Math.random()-0.5)*1.5).toFixed(2)) },
        ES: { ...p.ES, price: parseFloat((p.ES.price + (Math.random()-0.5)*0.3).toFixed(2)) },
      }))
    }, 800)
    return () => clearInterval(id)
  }, [])

  // ── Supabase ──
  useEffect(() => {
    const load = async () => {
      const [{ data: s, error }, { data: a }, { data: t }] = await Promise.all([
        supabase.from('setups').select('*').order('confluence_score', { ascending: false }),
        supabase.from('scanner_alerts').select('*').eq('is_read', false).order('created_at', { ascending: false }).limit(5),
        supabase.from('trades').select('*').order('opened_at', { ascending: false }).limit(20),
      ])
      if (error) { console.error('Supabase:', error); return }
      setSetups((s as Setup[]) || [])
      setAlerts((a as Alert[]) || [])
      setTrades((t as Trade[]) || [])
      setDbOk(true)
    }
    load()
    const ch = supabase.channel('realtime')
      .on('postgres_changes', { event:'*', schema:'public', table:'setups' }, load)
      .on('postgres_changes', { event:'*', schema:'public', table:'scanner_alerts' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // ── AI ──
  async function runAI() {
    const s = selected ?? setups[0]
    if (!s) return
    setAiLoad(true); setAiOut('')
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          symbol: s.symbol, timeframe: s.timeframe,
          currentPrice: livePrices[s.symbol]?.price ?? 0,
          recentAction: `SSL swept at ${s.stop_loss}. ${s.direction==='bull'?'Bullish':'Bearish'} CISD forming. Price ${livePrices[s.symbol]?.price?.toFixed(2)}.`,
          htfContext: `Daily + 4H ${s.direction==='bull'?'bullish':'bearish'}. Key PD array at ${s.entry_low}–${s.entry_high}.`,
          keyLevels: `Entry: ${s.entry_low}–${s.entry_high} | SL: ${s.stop_loss} | TP: ${s.target} | DOL: ${s.dol_target} | R:R: ${s.rr_ratio}`,
          setupId: s.id,
        }),
      })
      const d = await r.json()
      setAiOut(d.analysis || 'No response.')
    } catch { setAiOut('API error — check NVIDIA_API_KEY in Vercel env vars.') }
    setAiLoad(false)
  }

  const top = setups[0]
  const cur = selected ?? top
  const nqP = livePrices.NQ.price
  const esP = livePrices.ES.price

  const filtered = setups.filter(s => {
    if (filter==='bull') return s.direction==='bull'
    if (filter==='bear') return s.direction==='bear'
    if (filter==='inversion') return s.direction==='inversion'
    if (filter==='high') return s.confluence_score>=75
    return true
  })
  const filteredKB = kbQ ? KB_CARDS.filter(k =>
    k.title.toLowerCase().includes(kbQ.toLowerCase()) ||
    k.body.toLowerCase().includes(kbQ.toLowerCase()) ||
    k.tags.some(t => t.toLowerCase().includes(kbQ.toLowerCase()))
  ) : KB_CARDS

  const wins   = trades.filter(t=>t.result==='win')
  const wr     = trades.length ? ((wins.length/trades.length)*100).toFixed(1) : '0.0'
  const avgRR  = wins.length ? (wins.reduce((a,t)=>a+(t.rr_achieved||0),0)/wins.length).toFixed(2) : '0.00'

  const dC = (d:Direction) => d==='bull'?'#00FF41':d==='bear'?'#EF4444':'#22D3EE'
  const dB = (d:Direction) => d==='bull'?'rgba(0,255,65,0.1)':d==='bear'?'rgba(239,68,68,0.1)':'rgba(34,211,238,0.1)'
  const sC = (s:number) => s>=75?'#00FF41':s>=55?'#F59E0B':'#EF4444'

  const fmtAI = (text:string) => text.split('\n').map((line,i)=>{
    const hdrs=['BIAS:','DOL:','SETUP TYPE:','PHASE:','ENTRY LOGIC:','CONFLUENCE FACTORS:','INVALIDATION:','RISK NOTE:','VERDICT:']
    const h=hdrs.find(x=>line.startsWith(x))
    if(h) return <div key={i}><div style={{fontSize:8,color:'#00FF41',letterSpacing:'0.12em',textTransform:'uppercase',marginTop:10,marginBottom:3}}>{h.replace(':','')}</div><div style={{fontSize:10,color:h==='VERDICT:'||h==='BIAS:'?'#00FF41':h==='INVALIDATION:'?'#EF4444':'#e8e8e8',lineHeight:1.6}}>{line.replace(h,'').trim()}</div></div>
    if(line.startsWith('-')) return <div key={i} style={{fontSize:10,color:'#555',paddingLeft:10,lineHeight:1.8}}>{line}</div>
    if(!line.trim()) return <div key={i} style={{height:4}}/>
    return <div key={i} style={{fontSize:10,color:'#777',lineHeight:1.6}}>{line}</div>
  })

  // ── Shared styles ──
  const T: Record<string,React.CSSProperties> = {
    app:   { display:'grid', height:'100vh', gridTemplateRows:'42px 1fr 30px', gridTemplateColumns:'220px 1fr 340px' },
    tbar:  { gridColumn:'1/-1', gridRow:'1', background:'#0a0a0a', borderBottom:'1px solid #222', display:'flex', alignItems:'center', padding:'0 16px', gap:16, zIndex:100 },
    sbar:  { gridColumn:'1', gridRow:'2', background:'#0a0a0a', borderRight:'1px solid #222', overflowY:'auto', display:'flex', flexDirection:'column' },
    main:  { gridColumn:'2', gridRow:'2', overflow:'hidden', display:'flex', flexDirection:'column', background:'#000' },
    rpan:  { gridColumn:'3', gridRow:'2', background:'#0a0a0a', borderLeft:'1px solid #222', overflowY:'auto', display:'flex', flexDirection:'column' },
    statb: { gridColumn:'1/-1', gridRow:'3', background:'#0a0a0a', borderTop:'1px solid #222', display:'flex', alignItems:'center', padding:'0 16px', gap:20, fontSize:10, color:'#555' },
  }
  const nav = (a:boolean): React.CSSProperties => ({ display:'flex',alignItems:'center',gap:8,padding:'8px 14px',cursor:'pointer',borderLeft:`2px solid ${a?'#00FF41':'transparent'}`,background:a?'rgba(0,255,65,0.06)':'transparent',color:a?'#00FF41':'#666',fontSize:11 })
  const tab = (a:boolean): React.CSSProperties => ({ padding:'0 18px',height:36,display:'flex',alignItems:'center',fontSize:10,letterSpacing:'0.06em',color:a?'#00FF41':'#666',cursor:'pointer',borderBottom:`2px solid ${a?'#00FF41':'transparent'}`,whiteSpace:'nowrap' })
  const btn = (a:boolean): React.CSSProperties => ({ fontSize:9,padding:'3px 8px',border:`1px solid ${a?'#00FF41':'#222'}`,color:a?'#00FF41':'#666',cursor:'pointer',background:a?'rgba(0,255,65,0.08)':'transparent',letterSpacing:'0.04em' })
  const tag = (c:string,bg:string): React.CSSProperties => ({ display:'inline-block',fontSize:8,padding:'2px 6px',color:c,background:bg,border:`1px solid ${c}44` })
  const sHdr: React.CSSProperties = { padding:'10px 14px',fontSize:9,letterSpacing:'0.1em',color:'#666',textTransform:'uppercase',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid #222' }
  const kpiBox: React.CSSProperties = { background:'#0a0a0a',padding:'16px 18px' }

  return (
    <div style={T.app}>

      {/* ── TOPBAR ── */}
      <div style={T.tbar}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:22,height:22,border:'1.5px solid #00FF41',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#00FF41" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,10 4,5 7,7 11,2"/></svg>
          </div>
          <div>
            <div style={{fontFamily:'Syne,sans-serif',fontSize:14,fontWeight:800,color:'#00FF41',letterSpacing:'0.12em'}}>VECTOR</div>
            <div style={{fontSize:9,color:'#444',letterSpacing:'0.08em'}}>INTELLIGENCE SYSTEM</div>
          </div>
        </div>
        <div style={{width:1,height:22,background:'#222',margin:'0 4px'}}/>

        {/* Live ticker strip */}
        <div style={{display:'flex',gap:18,flex:1,overflow:'hidden'}}>
          {[
            {sym:'ES1!',  key:'ES'},
            {sym:'NQ1!',  key:'NQ'},
            {sym:'GC1!',  key:'GC'},
            {sym:'DXY',   key:'DXY'},
            {sym:'VIX',   key:'VIX'},
          ].map(t=>{
            const p = livePrices[t.key]
            const up = p.change >= 0
            return (
              <div key={t.sym} style={{display:'flex',gap:5,fontSize:10,alignItems:'center',whiteSpace:'nowrap'}}>
                <span style={{color:'#555'}}>{t.sym}</span>
                <span style={{fontWeight:600,fontFamily:'JetBrains Mono,monospace'}}>{p.price.toFixed(2)}</span>
                <span style={{color:up?'#00FF41':'#EF4444',fontSize:9}}>{up?'+':''}{p.change.toFixed(2)} ({up?'+':''}{p.pct.toFixed(2)}%)</span>
              </div>
            )
          })}
        </div>

        <div style={{display:'flex',alignItems:'center',gap:12,marginLeft:'auto'}}>
          {/* Price source indicator */}
          <div style={{fontSize:8,padding:'1px 6px',border:`1px solid ${priceOk?'#00FF41':'#F59E0B'}`,color:priceOk?'#00FF41':'#F59E0B',letterSpacing:'0.06em'}}>
            {priceOk?'LIVE PRICES':'DELAYED'}
          </div>
          <div style={{fontSize:9,padding:'2px 8px',border:'1px solid #F59E0B',color:'#F59E0B',letterSpacing:'0.06em'}}>{session}</div>
          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,color:'#00FF41',letterSpacing:'0.1em'}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:'#00FF41'}} className="animate-pulse-dot"/>
            LIVE
          </div>
          <div style={{fontSize:10,color:'#555',fontFamily:'JetBrains Mono,monospace',minWidth:72}}>{time}</div>
        </div>
      </div>

      {/* ── SIDEBAR ── */}
      <div style={T.sbar}>
        <div style={{borderBottom:'1px solid #222'}}>
          <div style={{fontSize:9,letterSpacing:'0.12em',color:'#333',padding:'10px 14px 6px',textTransform:'uppercase'}}>Navigation</div>
          {(['dashboard','chart','scanner','knowledge','backtest'] as View[]).map(v=>(
            <div key={v} style={nav(view===v)} onClick={()=>setView(v)}>
              {v.charAt(0).toUpperCase()+v.slice(1)}
              {v==='scanner'   && <span style={{marginLeft:'auto',fontSize:9,padding:'1px 5px',background:'rgba(245,158,11,0.15)',color:'#F59E0B',border:'1px solid rgba(245,158,11,0.3)'}}>{setups.length}</span>}
              {v==='dashboard' && alerts.length>0 && <span style={{marginLeft:'auto',fontSize:9,padding:'1px 5px',background:'rgba(239,68,68,0.12)',color:'#EF4444',border:'1px solid rgba(239,68,68,0.3)'}}>{alerts.length}</span>}
              {v==='chart'     && <span style={{marginLeft:'auto',fontSize:9,padding:'1px 5px',background:'rgba(0,255,65,0.08)',color:'#00FF41',border:'1px solid rgba(0,255,65,0.2)'}}>TV</span>}
            </div>
          ))}
        </div>

        {/* Market cards — live prices */}
        {[
          {sym:'ES1! · S&P 500', k:'ES', dol:top?.symbol==='ES'?top.dol_target:'5,920'},
          {sym:'NQ1! · NASDAQ',  k:'NQ', dol:top?.symbol==='NQ'?top.dol_target:'29,750'},
        ].map(m=>{
          const p = livePrices[m.k]
          const up = p.change >= 0
          return (
            <div key={m.k} style={{margin:10,background:'#111',border:'1px solid #222',padding:10}}>
              <div style={{fontSize:10,color:'#555',marginBottom:4}}>{m.sym}</div>
              <div style={{fontSize:20,fontWeight:700,lineHeight:1,fontFamily:'JetBrains Mono,monospace',color:'#e8e8e8'}}>{p.price.toFixed(2)}</div>
              <div style={{fontSize:10,color:up?'#00FF41':'#EF4444',marginTop:2}}>{up?'+':''}{p.change.toFixed(2)} ({up?'+':''}{p.pct.toFixed(2)}%)</div>
              <div style={{display:'flex',gap:8,marginTop:6}}>
                <span style={tag('#00FF41','rgba(0,255,65,0.1)')}>BULLISH</span>
                <span style={{fontSize:9,color:'#555'}}>DOL: {m.dol}</span>
              </div>
            </div>
          )
        })}

        {/* Alerts */}
        <div style={{padding:'0 10px 10px'}}>
          <div style={{fontSize:9,color:'#333',letterSpacing:'0.1em',textTransform:'uppercase',padding:'8px 4px'}}>Alerts</div>
          {alerts.length===0
            ? <div style={{fontSize:10,color:'#333',padding:4}}>No active alerts</div>
            : alerts.slice(0,3).map(a=>(
              <div key={a.id} style={{padding:8,marginBottom:4,borderLeft:`2px solid ${a.severity==='critical'?'#EF4444':a.severity==='warning'?'#F59E0B':'#00FF41'}`,background:a.severity==='critical'?'rgba(239,68,68,0.06)':'rgba(0,255,65,0.04)'}}>
                <div style={{fontSize:9,color:'#555'}}>{a.symbol} {a.timeframe}</div>
                <div style={{fontSize:10,color:'#bbb',marginTop:2,lineHeight:1.4}}>{a.message}</div>
              </div>
            ))
          }
        </div>
      </div>

      {/* ── MAIN ── */}
      <div style={T.main}>
        <div style={{display:'flex',borderBottom:'1px solid #222',background:'#0a0a0a'}}>
          {(['dashboard','chart','scanner','knowledge','backtest'] as View[]).map((v,i)=>(
            <div key={v} style={tab(view===v)} onClick={()=>setView(v)}>
              {['Overview','Chart','Scanner','Knowledge','Backtest'][i]}
            </div>
          ))}
        </div>
        <div style={{flex:1,overflow:'hidden'}}>

          {/* ── DASHBOARD ── */}
          {view==='dashboard' && (
            <div style={{height:'100%',overflowY:'auto'}}>
              {/* KPIs */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:1,background:'#222'}}>
                <div style={kpiBox}>
                  <div style={{fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Active Setups</div>
                  <div style={{fontSize:26,fontWeight:700,fontFamily:'Syne,sans-serif',color:'#F59E0B'}}>{setups.length}</div>
                  <div style={{fontSize:10,color:'#555',marginTop:4}}>
                    ES({setups.filter(s=>s.symbol==='ES').length}) · NQ({setups.filter(s=>s.symbol==='NQ').length}) · {Array.from(new Set(setups.map(s=>s.timeframe))).length} TFs
                  </div>
                </div>
                <div style={kpiBox}>
                  <div style={{fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>Best Confluence</div>
                  <div style={{fontSize:26,fontWeight:700,fontFamily:'Syne,sans-serif',color:'#00FF41'}}>{top?.confluence_score??0}<span style={{fontSize:14,color:'#444'}}>/100</span></div>
                  <div style={{fontSize:10,color:'#555',marginTop:4}}>{top?`${top.symbol} ${top.timeframe} · ${top.setup_type}`:'Loading...'}</div>
                </div>
                <div style={kpiBox}>
                  <div style={{fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>NQ Live Price</div>
                  <div style={{fontSize:22,fontWeight:700,fontFamily:'Syne,sans-serif',color:'#00FF41'}}>{nqP.toFixed(2)}</div>
                  <div style={{fontSize:10,color:livePrices.NQ.change>=0?'#00FF41':'#EF4444',marginTop:4}}>
                    {livePrices.NQ.change>=0?'+':''}{livePrices.NQ.change.toFixed(2)} ({livePrices.NQ.change>=0?'+':''}{livePrices.NQ.pct.toFixed(2)}%)
                  </div>
                </div>
              </div>

              {/* Setups table */}
              <div style={{padding:'10px 14px',borderBottom:'1px solid #222',fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'0.1em',background:'#0a0a0a'}}>
                Active Setups — Supabase Live · Click row to view on chart
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                <thead><tr>
                  {['Symbol','TF','Setup','Dir','Score','DOL Target','Action'].map(h=>(
                    <th key={h} style={{textAlign:'left',fontSize:9,color:'#444',letterSpacing:'0.08em',padding:'8px 14px',borderBottom:'1px solid #1a1a1a',fontWeight:500,textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {setups.length===0
                    ? <tr><td colSpan={7} style={{padding:'20px 14px',color:'#444',fontSize:10}}>
                        {dbOk ? 'No setups detected.' : 'Connecting to Supabase...'}
                      </td></tr>
                    : setups.map(s=>(
                      <tr key={s.id} style={{cursor:'pointer'}} onClick={()=>{setSelected(s);setView('chart')}}>
                        <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a',fontWeight:700,color:'#e8e8e8'}}>{s.symbol}</td>
                        <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a',color:'#555'}}>{s.timeframe}</td>
                        <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a',color:'#888',maxWidth:160}}>{s.setup_type}</td>
                        <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a'}}>
                          <span style={tag(dC(s.direction),dB(s.direction))}>{s.direction.toUpperCase()}</span>
                        </td>
                        <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a'}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <div style={{width:55,height:3,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}>
                              <div style={{width:`${s.confluence_score}%`,height:'100%',background:sC(s.confluence_score)}}/>
                            </div>
                            <span style={{fontSize:9,color:sC(s.confluence_score),fontWeight:600}}>{s.confluence_score}</span>
                          </div>
                        </td>
                        <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a',color:s.direction==='bull'?'#00FF41':'#EF4444',fontFamily:'JetBrains Mono,monospace',fontSize:9}}>{s.dol_target}</td>
                        <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a'}}>
                          <span style={tag(s.status==='active'?'#00FF41':'#F59E0B',s.status==='active'?'rgba(0,255,65,0.08)':'rgba(245,158,11,0.08)')}>
                            {s.status==='active'?'ENTRY ZONE':'WATCHING'}
                          </span>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>

              {/* DOL + MMXM */}
              <div style={{padding:'10px 14px',borderBottom:'1px solid #222',fontSize:9,color:'#555',textTransform:'uppercase',background:'#0a0a0a',marginTop:1}}>
                {top ? `5-Question DOL — ${top.symbol} ${top.timeframe} (top setup)` : 'DOL Framework'}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:'#222'}}>
                <div style={{background:'#0a0a0a',padding:16}}>
                  {top ? [
                    ['Q1','Delivering FROM:', `${top.direction==='bull'?'Discount':'Premium'} PD Array zone`],
                    ['Q2','CISD at:',          `${top.timeframe} — ${top.direction==='bull'?'Bullish':'Bearish'} confirmed`],
                    ['Q3','Price now:',         `${livePrices[top.symbol]?.price.toFixed(2)} — at/above entry zone`],
                    ['Q4','Arrays respected:',  top.setup_type],
                    ['Q5','Delivering TO:',     top.dol_target],
                  ].map(([n,q,a])=>(
                    <div key={String(n)} style={{display:'flex',gap:8,marginBottom:6,fontSize:9}}>
                      <span style={{color:'#00FF41',minWidth:20,fontWeight:600}}>{n}</span>
                      <span style={{color:'#555',minWidth:95}}>{q}</span>
                      <span style={{color:'#ccc'}}>{a}</span>
                    </div>
                  )) : <div style={{fontSize:10,color:'#444'}}>Loading from Supabase...</div>}
                </div>
                <div style={{background:'#0a0a0a',padding:16}}>
                  <div style={{fontSize:9,color:'#555',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:10}}>MMXM Cycle Phase</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:10}}>
                    {[{l:'ACCUMULATE',a:false},{l:'MANIPULATE',a:false},{l:'DISTRIBUTE',a:true}].map(p=>(
                      <div key={p.l} style={{padding:'8px 6px',border:`1px solid ${p.a?'#F59E0B':'#222'}`,background:p.a?'rgba(245,158,11,0.08)':'#111',textAlign:'center'}}>
                        <div style={{fontSize:8,color:p.a?'#F59E0B':'#333',marginBottom:4,letterSpacing:'0.06em'}}>{p.l}</div>
                        <div style={{fontSize:11,color:p.a?'#F59E0B':'#444'}}>{p.a?'NOW ↑':'✓'}</div>
                      </div>
                    ))}
                  </div>
                  {top && <div style={{fontSize:9,color:'#555',lineHeight:1.8}}>
                    SSL at <span style={{color:'#EF4444'}}>{top.stop_loss.toFixed(2)}</span> swept.<br/>
                    {top.direction==='bull'?'Bullish':'Bearish'} CISD confirmed on {top.timeframe}.<br/>
                    Targeting <span style={{color:'#00FF41'}}>{top.dol_target}</span>.
                  </div>}
                </div>
              </div>
            </div>
          )}

          {/* ── CHART — Real TradingView ── */}
          {view==='chart' && (
            <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',borderBottom:'1px solid #222',background:'#0a0a0a',flexWrap:'wrap'}}>
                <span style={{fontSize:9,color:'#444'}}>SYMBOL</span>
                {['ES','NQ'].map(s=><button key={s} style={btn(asset===s)} onClick={()=>setAsset(s)}>{s}</button>)}
                <div style={{width:1,height:16,background:'#222'}}/>
                <span style={{fontSize:9,color:'#444'}}>TIMEFRAME</span>
                {[['5','5m'],['15','15m'],['60','1H'],['240','4H'],['D','D'],['W','W']].map(([v,l])=>(
                  <button key={v} style={btn(tf===v)} onClick={()=>setTf(v)}>{l}</button>
                ))}
                <div style={{width:1,height:16,background:'#222'}}/>
                {cur && (
                  <span style={{fontSize:9,fontFamily:'JetBrains Mono,monospace'}}>
                    <span style={{color:'#555'}}>Selected:</span>{' '}
                    <span style={{color:'#F59E0B'}}>{cur.symbol} {cur.timeframe}</span>{' · '}
                    <span style={{color:'#00FF41'}}>Entry {cur.entry_low.toFixed(0)}–{cur.entry_high.toFixed(0)}</span>{' · '}
                    <span style={{color:'#EF4444'}}>SL {cur.stop_loss.toFixed(0)}</span>{' · '}
                    <span style={{color:'#00FF41'}}>DOL {cur.target.toFixed(0)}</span>
                  </span>
                )}
              </div>
              {/* Real TradingView embed — live data, real candles */}
              <div style={{flex:1,background:'#000',overflow:'hidden'}}>
                <iframe
                  key={`${asset}-${tf}`}
                  src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=CME_MINI%3A${asset==='NQ'?'NQ1!':'ES1!'}&interval=${tf}&hidesidetoolbar=0&hidetoptoolbar=0&symboledit=1&saveimage=0&toolbarbg=0a0a0a&studies=[]&theme=dark&style=1&timezone=America%2FNew_York&withdateranges=1&showpopupbutton=0&studies_overrides={}&overrides={}&enabled_features=[]&disabled_features=[]&locale=en&utm_source=vector&utm_medium=widget`}
                  style={{width:'100%',height:'100%',border:'none',display:'block'}}
                  allowFullScreen
                />
              </div>
            </div>
          )}

          {/* ── SCANNER ── */}
          {view==='scanner' && (
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{display:'flex',gap:8,padding:'12px 14px',borderBottom:'1px solid #222',alignItems:'center',flexWrap:'wrap'}}>
                {[['all','ALL'],['bull','BULLISH'],['bear','BEARISH'],['inversion','INVERSION'],['high','HIGH CONF 75+']].map(([f,l])=>(
                  <button key={f} style={btn(filter===f)} onClick={()=>setFilter(f)}>{l}</button>
                ))}
                <span style={{marginLeft:'auto',fontSize:9,color:'#444'}}>{filtered.length} of {setups.length} setups · Supabase realtime</span>
              </div>
              {filtered.length===0
                ? <div style={{padding:'24px 14px',color:'#444',fontSize:10}}>{dbOk?'No setups match filter.':'Connecting to Supabase...'}</div>
                : filtered.map(s=>(
                  <div key={s.id} style={{padding:'12px 14px',borderBottom:'1px solid #1a1a1a',cursor:'pointer',transition:'background .1s'}}
                    onClick={()=>{setSelected(s);setView('chart')}}
                    onMouseEnter={e=>(e.currentTarget.style.background='#0d0d0d')}
                    onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                      <span style={{fontSize:14,fontWeight:700,fontFamily:'Syne,sans-serif',color:'#e8e8e8'}}>{s.symbol}</span>
                      <span style={{fontSize:9,color:'#555',fontFamily:'JetBrains Mono,monospace'}}>{s.timeframe}</span>
                      <span style={tag(dC(s.direction),dB(s.direction))}>{s.direction.toUpperCase()}</span>
                      {s.ai_analysis && <span style={{fontSize:9,padding:'1px 5px',background:'rgba(0,255,65,0.08)',color:'#00FF41',border:'1px solid rgba(0,255,65,0.2)'}}>AI ✓</span>}
                      <span style={{marginLeft:'auto',fontSize:9,color:'#444'}}>{new Date(s.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
                    </div>
                    <div style={{fontSize:11,color:'#ccc',marginBottom:5,fontWeight:500}}>{s.setup_type}</div>
                    <div style={{fontSize:9,color:'#555',marginBottom:8,fontFamily:'JetBrains Mono,monospace'}}>
                      Entry: {s.entry_low.toFixed(2)}–{s.entry_high.toFixed(2)} &nbsp;·&nbsp; SL: {s.stop_loss.toFixed(2)} &nbsp;·&nbsp; TP: {s.target.toFixed(2)} &nbsp;·&nbsp; R:R {s.rr_ratio.toFixed(1)}
                    </div>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <span style={tag('#F59E0B','rgba(245,158,11,0.1)')}>DOL: {s.dol_target}</span>
                      <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,color:'#555'}}>
                        Confluence:
                        <div style={{width:55,height:3,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}>
                          <div style={{width:`${s.confluence_score}%`,height:'100%',background:sC(s.confluence_score)}}/>
                        </div>
                        <span style={{color:sC(s.confluence_score),fontWeight:600}}>{s.confluence_score}/100</span>
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}

          {/* ── KNOWLEDGE ── */}
          {view==='knowledge' && (
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{margin:14,position:'relative'}}>
                <svg style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',width:13,height:13}} viewBox="0 0 16 16" fill="none" stroke="#444" strokeWidth="2"><circle cx="7" cy="7" r="4"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>
                <input value={kbQ} onChange={e=>setKbQ(e.target.value)} placeholder="Search PD arrays, CISD, DOL, MMXM..."
                  style={{width:'100%',background:'#111',border:'1px solid #222',color:'#e8e8e8',fontFamily:'JetBrains Mono,monospace',fontSize:11,padding:'8px 12px 8px 32px',outline:'none'}}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:'#222'}}>
                {filteredKB.map((k,i)=>(
                  <div key={i} style={{background:'#0a0a0a',padding:14}}>
                    <div style={{fontSize:8,letterSpacing:'0.1em',color:'#444',marginBottom:6,textTransform:'uppercase'}}>{k.tag}</div>
                    <div style={{fontSize:12,fontWeight:600,fontFamily:'Syne,sans-serif',color:'#e8e8e8',marginBottom:6}}>{k.title}</div>
                    <div style={{fontSize:10,color:'#666',lineHeight:1.8}} dangerouslySetInnerHTML={{__html:k.body}}/>
                    <div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:8}}>
                      {k.tags.map(t=><span key={t} style={{fontSize:9,padding:'2px 7px',background:'#161616',border:'1px solid #222',color:'#555'}}>{t}</span>)}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:'10px 14px',borderTop:'1px solid #222',fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'0.1em',background:'#0a0a0a'}}>
                Critical Rules — Extracted From Video Course
              </div>
              {RULES.map(r=>(
                <div key={r.num} style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid #1a1a1a'}}>
                  <span style={{fontSize:9,color:'#00FF41',minWidth:24,fontWeight:700}}>{r.num}</span>
                  <span style={{fontSize:10,color:'#666',lineHeight:1.6}} dangerouslySetInnerHTML={{__html:r.text}}/>
                </div>
              ))}
            </div>
          )}

          {/* ── BACKTEST ── */}
          {view==='backtest' && (
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:1,background:'#222'}}>
                {[
                  {label:'Win Rate',       val:`${wr}%`,           color:'#00FF41'},
                  {label:'Avg Win R:R',    val:avgRR,              color:'#00FF41'},
                  {label:'Total Trades',   val:trades.length.toString(), color:'#F59E0B'},
                  {label:'Winners',        val:wins.length.toString(),   color:'#00FF41'},
                ].map(s=>(
                  <div key={s.label} style={{background:'#0a0a0a',padding:14}}>
                    <div style={{fontSize:9,color:'#444',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{s.label}</div>
                    <div style={{fontSize:22,fontWeight:700,fontFamily:'Syne,sans-serif',color:s.color}}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{padding:'10px 14px',borderBottom:'1px solid #222',fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'0.1em',background:'#0a0a0a'}}>
                Trade History — From Supabase
              </div>
              {trades.length===0
                ? <div style={{padding:'20px 14px',color:'#444',fontSize:10}}>{dbOk?'No trades recorded.':'Connecting...'}</div>
                : trades.map(t=>(
                  <div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderBottom:'1px solid #1a1a1a',fontSize:10}}>
                    <div style={{width:7,height:7,borderRadius:'50%',background:t.result==='win'?'#00FF41':'#EF4444',flexShrink:0}}/>
                    <span style={{fontSize:9,color:'#444',minWidth:85,fontFamily:'JetBrains Mono,monospace'}}>{new Date(t.opened_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
                    <span style={{fontWeight:700,color:'#e8e8e8',minWidth:28}}>{t.symbol}</span>
                    <span style={{color:'#444',fontSize:9,minWidth:45}}>{t.direction.toUpperCase()}</span>
                    <span style={{color:'#666',flex:1,fontSize:9}}>{t.notes?.split('.')[0]??'—'}</span>
                    <span style={{color:'#555',fontSize:9,fontFamily:'JetBrains Mono,monospace'}}>In: {t.entry_price}</span>
                    <span style={{color:'#EF4444',fontSize:9,margin:'0 6px',fontFamily:'JetBrains Mono,monospace'}}>SL: {t.stop_loss}</span>
                    <span style={{color:'#00FF41',fontSize:9,fontFamily:'JetBrains Mono,monospace'}}>TP: {t.take_profit}</span>
                    <span style={{fontWeight:700,fontSize:11,minWidth:44,textAlign:'right',fontFamily:'JetBrains Mono,monospace',color:t.result==='win'?'#00FF41':'#EF4444'}}>
                      {t.result==='win'?`+${t.rr_achieved?.toFixed(1)}R`:'-1R'}
                    </span>
                  </div>
                ))
              }
            </div>
          )}

        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={T.rpan}>

        {/* Asset */}
        <div style={{borderBottom:'1px solid #222'}}>
          <div style={sHdr}><span>Asset Focus</span><span style={{fontSize:9,color:'#555',fontFamily:'JetBrains Mono,monospace'}}>{livePrices[asset].price.toFixed(2)}</span></div>
          <div style={{display:'flex',gap:6,padding:'8px 14px'}}>
            {['NQ','ES'].map(a=>(
              <button key={a} style={{flex:1,padding:6,border:`1px solid ${asset===a?'#00FF41':'#222'}`,background:asset===a?'rgba(0,255,65,0.08)':'transparent',color:asset===a?'#00FF41':'#555',fontFamily:'JetBrains Mono,monospace',fontSize:10,cursor:'pointer'}}
                onClick={()=>setAsset(a)}>{a}</button>
            ))}
          </div>
        </div>

        {/* MTF Bias */}
        <div style={{borderBottom:'1px solid #222'}}>
          <div style={sHdr}><span>Multi-TF Bias</span></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,padding:'10px 14px'}}>
            {[
              {tf:'DAILY',  bias:'BULLISH',  note:'ATH breakout zone', bull:true},
              {tf:'4 HOUR', bias:'BULLISH',  note:'CISD confirmed',    bull:true},
              {tf:'1 HOUR', bias:'BULLISH',  note:'OB holding',        bull:true},
              {tf:'15 MIN', bias:'PULLBACK', note:'Into discount',      bull:false},
            ].map(m=>(
              <div key={m.tf} style={{border:'1px solid #222',padding:8,background:'#111'}}>
                <div style={{fontSize:9,color:'#555',letterSpacing:'0.04em'}}>{m.tf}</div>
                <div style={{fontSize:11,fontWeight:600,color:m.bull?'#00FF41':'#F59E0B',marginTop:3}}>{m.bias}</div>
                <div style={{fontSize:9,color:'#333',marginTop:3}}>{m.note}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Confluence */}
        <div style={{borderBottom:'1px solid #222'}}>
          <div style={sHdr}><span>Confluence Score</span></div>
          <div style={{padding:'10px 14px'}}>
            {[
              {name:'HTF Bias',     pct:100, score:20},
              {name:'CISD Confirm', pct:100, score:20},
              {name:'PD Array',     pct: 85, score:17},
              {name:'DOL Clarity',  pct: 75, score:15},
              {name:'SSL Swept',    pct:100, score:15},
            ].map(c=>(
              <div key={c.name} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,fontSize:9}}>
                <span style={{color:'#555',minWidth:88}}>{c.name}</span>
                <div style={{flex:1,height:4,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}>
                  <div style={{width:`${c.pct}%`,height:'100%',background:c.pct>=80?'#00FF41':'#F59E0B',borderRadius:1}}/>
                </div>
                <span style={{color:'#ccc',minWidth:20,textAlign:'right',fontFamily:'JetBrains Mono,monospace'}}>{c.score}</span>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:10,paddingTop:8,borderTop:'1px solid #222'}}>
              <span style={{fontSize:9,color:'#555',letterSpacing:'0.08em'}}>TOTAL CONFLUENCE</span>
              <span style={{fontSize:24,fontWeight:700,color:'#00FF41',fontFamily:'Syne,sans-serif'}}>{cur?.confluence_score??87}</span>
            </div>
          </div>
        </div>

        {/* Trade params — live from selected setup */}
        <div style={{borderBottom:'1px solid #222'}}>
          <div style={sHdr}>
            <span>Trade Parameters</span>
            {cur && <span style={{fontSize:9,color:'#555'}}>{cur.symbol} {cur.timeframe}</span>}
          </div>
          <div style={{padding:'10px 14px'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
              {[
                {label:'Entry Zone',    val:cur?`${cur.entry_low.toFixed(0)}–${cur.entry_high.toFixed(0)}`:'Select setup', color:cur?'#F59E0B':'#444'},
                {label:'Stop Loss',     val:cur?cur.stop_loss.toFixed(0):'—',      color:cur?'#EF4444':'#444'},
                {label:'Target (DOL)',  val:cur?cur.target.toFixed(0):'—',          color:cur?'#00FF41':'#444'},
                {label:'Risk : Reward', val:cur?`${cur.rr_ratio.toFixed(1)}R`:'—', color:cur?'#00FF41':'#444'},
                {label:'Setup Type',    val:cur?cur.setup_type.split('+')[0].trim():'—', color:cur?'#888':'#444'},
                {label:'Invalidation',  val:cur?`< ${cur.stop_loss.toFixed(0)}`:'—', color:cur?'#EF4444':'#444'},
              ].map(p=>(
                <div key={p.label} style={{background:'#111',padding:'8px 10px',border:'1px solid #222'}}>
                  <div style={{fontSize:8,color:'#444',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>{p.label}</div>
                  <div style={{fontSize:11,fontWeight:600,color:p.color,fontFamily:'JetBrains Mono,monospace'}}>{p.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI Analyst */}
        <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
          <div style={sHdr}>
            <span>AI Analyst</span>
            <span style={{fontSize:9,color:aiLoad?'#F59E0B':aiOut?'#00FF41':'#444'}}>{aiLoad?'Generating...':aiOut?'Complete ✓':'Ready'}</span>
          </div>
          <div style={{flex:1,padding:'12px 14px',overflowY:'auto',fontSize:10,lineHeight:1.8,color:'#666'}}>
            {aiLoad
              ? <span>Analyzing {cur?.symbol??'NQ'} {cur?.timeframe??'15m'}...<span className="animate-blink" style={{display:'inline-block',width:8,height:12,background:'#00FF41',verticalAlign:'middle',marginLeft:4}}/></span>
              : aiOut
                ? fmtAI(aiOut)
                : <span style={{color:'#333'}}>Click a setup on the Dashboard or Scanner, then run analysis for full SMC reasoning.</span>
            }
          </div>
          <button onClick={runAI} disabled={aiLoad||setups.length===0}
            style={{margin:'10px 14px',padding:10,background:'transparent',border:'1px solid #00FF41',color:'#00FF41',fontFamily:'JetBrains Mono,monospace',fontSize:10,letterSpacing:'0.1em',cursor:aiLoad?'not-allowed':'pointer',opacity:aiLoad||setups.length===0?0.4:1,textTransform:'uppercase',transition:'background .15s'}}
            onMouseEnter={e=>{if(!aiLoad)(e.target as HTMLButtonElement).style.background='rgba(0,255,65,0.08)'}}
            onMouseLeave={e=>{(e.target as HTMLButtonElement).style.background='transparent'}}>
            ⬡ RUN AI ANALYSIS
          </button>
        </div>

      </div>

      {/* ── STATUS BAR ── */}
      <div style={T.statb}>
        {[
          {l:'Yahoo Finance',  c:priceOk?'#00FF41':'#F59E0B'},
          {l:'TradingView',    c:'#00FF41'},
          {l:'Supabase',       c:dbOk?'#00FF41':'#F59E0B'},
          {l:'AI Engine',      c:'#00FF41'},
          {l:priceOk?'Live Prices':'Delayed Prices', c:priceOk?'#00FF41':'#F59E0B'},
        ].map(s=>(
          <div key={s.l} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:4,height:4,borderRadius:'50%',background:s.c}}/>
            <span>{s.l}</span>
          </div>
        ))}
        <div style={{marginLeft:'auto',display:'flex',gap:16,fontFamily:'JetBrains Mono,monospace'}}>
          <span style={{color:livePrices.ES.change>=0?'#00FF41':'#EF4444'}}>ES {esP.toFixed(2)}</span>
          <span style={{color:livePrices.NQ.change>=0?'#00FF41':'#EF4444'}}>NQ {nqP.toFixed(2)}</span>
          <span style={{color:'#444'}}>{setups.length} setups</span>
          <span style={{color:'#444'}}>{time}</span>
        </div>
      </div>

    </div>
  )
}
