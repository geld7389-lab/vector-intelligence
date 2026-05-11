'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

type View = 'dashboard' | 'chart' | 'scanner' | 'knowledge' | 'backtest'
type Direction = 'bull' | 'bear' | 'inversion'

interface Setup {
  id: string
  symbol: string
  timeframe: string
  setup_type: string
  direction: Direction
  confluence_score: number
  entry_low: number
  entry_high: number
  stop_loss: number
  target: number
  rr_ratio: number
  status: string
  dol_target: string
  ai_analysis: string | null
  created_at: string
}

interface Alert { id: string; symbol: string; timeframe: string; message: string; severity: string; created_at: string }
interface Trade { id: string; symbol: string; direction: string; entry_price: number; stop_loss: number; take_profit: number; result: string; rr_achieved: number | null; notes: string | null; opened_at: string }

// ── Real prices via free Yahoo Finance proxy ──
async function fetchRealPrices() {
  try {
    const r = await fetch('/api/prices')
    if (!r.ok) throw new Error('no')
    return await r.json()
  } catch {
    return null
  }
}

const KB_CARDS = [
  { tag:'PD ARRAYS · EP1', title:'Order Block (OB)', body:'The last bearish candle before a bullish impulse / last bullish before bearish. Price returns to fill the imbalance. Only valid in correct premium/discount zone aligned with HTF bias. Highest-probability entry zone.', tags:['OB','Discount','Premium'] },
  { tag:'PD ARRAYS · EP1', title:'Fair Value Gap (BISI / SIBI)', body:'3-candle imbalance where candle 1 and 3 wicks do not overlap. <strong>BISI</strong> = Buy Side Imbalance (bullish, buy from). <strong>SIBI</strong> = Sell Side Imbalance (bearish). Visible Ep1 on weekly SPX.', tags:['FVG','BISI','SIBI','Imbalance'] },
  { tag:'PD ARRAYS · EP4', title:'Inversion PD Arrays', body:'When OB/FVG/BRK broken through with full body close — it inverts. <strong>IOB</strong> = Inversion OB. Trade from opposite side on return. Stacked inversions = strongest levels. Shown ES 15m Ep4.', tags:['IOB','IFVG','IBRK','Inversion'] },
  { tag:'THE MODEL · EP2', title:'CISD — Change in State of Delivery', body:'Must be <strong>FULL CANDLE BODY CLOSE</strong> through prior swing. A wick is NOT a real MSS — most important rule. Bullish: body closes above swing high after SSL sweep. This is the trigger.', tags:['CISD','MSS','Trigger'] },
  { tag:'DOL FRAMEWORK · EP3', title:'Draw On Liquidity (DOL)', body:'Where price is drawn next. Always a liquidity pool. <strong>5 questions:</strong> from where? CISD where? price at? arrays respected? delivering to where? All answered before entry.', tags:['DOL','Liquidity','BSL','SSL'] },
  { tag:'REFINEMENT · EP6', title:'Liquidity Sequencing Rule', body:'"<strong>When bullish and price hits BSL — wait for run on sell stops before going long.</strong>" Never buy into BSL. Wait for SSL sweep → CISD → PD array entry. Eliminates most losing trades.', tags:['BSL','SSL','Key Rule'] },
  { tag:'MMXM · BONUS', title:'Market Maker Model (MMXM)', body:'<strong>Accumulation</strong> → <strong>Manipulation</strong> (stop hunt) → <strong>Distribution</strong> (true delivery). Multi-TF DOL: 1H = macro, 5m = micro entry. SPX weekly Bonus episode.', tags:['MMXM','Accumulation','Manipulation','Distribution'] },
  { tag:'SYNTHESIS · EP5', title:'Multi-TF Execution Model', body:'Daily/Weekly: bias. 4H: structure. 1H: CISD + DOL. 15m/5m: entry PD array left by CISD impulse. Live NQ execution Ep5: BRK daily → IOB 15m. Never skip a timeframe.', tags:['MTF','Execution','Top-Down'] },
]

const RULES = [
  { num:'R1', text:'<strong>Never buy into buyside liquidity.</strong> Wait for the sweep → CISD → entry. — Ep6' },
  { num:'R2', text:'<strong>CISD must be a full candle body close.</strong> A wick through a level is NOT a real MSS. — Ep2' },
  { num:'R3', text:'<strong>All timeframes must align.</strong> Daily → 4H → 1H → 15m. One misaligned TF = skip. — Ep5' },
  { num:'R4', text:'<strong>Violated OB/FVG inverts.</strong> Trade it from the other side on the return. — Ep4' },
  { num:'R5', text:'<strong>Know your DOL before touching the chart.</strong> No DOL = no trade. — Ep3' },
  { num:'R6', text:'<strong>Respect the MMXM cycle.</strong> Trading against manipulation phase loses every time. — Bonus' },
  { num:'R7', text:'<strong>PD Arrays only in correct premium/discount zone.</strong> Buying OB in premium = wrong. — Ep1' },
]

export default function VectorPlatform() {
  const [view, setView] = useState<View>('dashboard')
  const [prices, setPrices] = useState({ ES: 5870.50, NQ: 29459.00 })
  const [setups, setSetups] = useState<Setup[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [selectedSetup, setSelectedSetup] = useState<Setup | null>(null)
  const [aiOutput, setAiOutput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [kbSearch, setKbSearch] = useState('')
  const [scannerFilter, setScannerFilter] = useState('all')
  const [activeAsset, setActiveAsset] = useState('NQ')
  const [chartTF, setChartTF] = useState('60')
  const [time, setTime] = useState('')
  const [session, setSession] = useState('NY SESSION')
  const [dbStatus, setDbStatus] = useState('Connecting...')

  // ── Live clock (client only) ──
  useEffect(() => {
    const tick = () => {
      const et = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' })
      setTime(et + ' ET')
      const h = parseInt(et.split(':')[0])
      setSession(h >= 9 && h < 16 ? 'NY SESSION' : h >= 2 && h < 8 ? 'LONDON' : 'ASIA')
    }
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])

  // ── Fetch real prices every 10s ──
  useEffect(() => {
    const load = async () => {
      const data = await fetchRealPrices()
      if (data?.NQ && data?.ES) setPrices({ NQ: data.NQ, ES: data.ES })
    }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])

  // ── Micro jitter between real price fetches ──
  useEffect(() => {
    const id = setInterval(() => {
      setPrices(p => ({
        ES: parseFloat((p.ES + (Math.random() - 0.5) * 0.5).toFixed(2)),
        NQ: parseFloat((p.NQ + (Math.random() - 0.5) * 2).toFixed(2)),
      }))
    }, 1200)
    return () => clearInterval(id)
  }, [])

  // ── Load from Supabase ──
  useEffect(() => {
    async function load() {
      const { data: s, error } = await supabase.from('setups').select('*').order('confluence_score', { ascending: false })
      if (error) { console.error(error); setDbStatus('DB Error'); return }
      setSetups((s as Setup[]) || [])
      setDbStatus('DB Connected')

      const { data: a } = await supabase.from('scanner_alerts').select('*').eq('is_read', false).order('created_at', { ascending: false }).limit(5)
      setAlerts((a as Alert[]) || [])

      const { data: t } = await supabase.from('trades').select('*').order('opened_at', { ascending: false }).limit(15)
      setTrades((t as Trade[]) || [])
    }
    load()
    const ch = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'setups' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scanner_alerts' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // ── AI Analysis ──
  async function runAnalysis() {
    const setup = selectedSetup ?? setups[0]
    if (!setup) return
    setAiLoading(true); setAiOutput('')
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: setup.symbol,
          timeframe: setup.timeframe,
          currentPrice: prices[setup.symbol as keyof typeof prices],
          recentAction: `SSL swept at ${setup.stop_loss.toFixed(2)}. ${setup.direction === 'bull' ? 'Bullish' : 'Bearish'} CISD forming. Price at ${prices[setup.symbol as keyof typeof prices].toFixed(2)}.`,
          htfContext: `Daily + 4H ${setup.direction === 'bull' ? 'bullish' : 'bearish'}. Key PD array at ${setup.entry_low.toFixed(2)}.`,
          keyLevels: `Entry: ${setup.entry_low.toFixed(2)}–${setup.entry_high.toFixed(2)} | SL: ${setup.stop_loss.toFixed(2)} | TP: ${setup.target.toFixed(2)} | DOL: ${setup.dol_target}`,
          setupId: setup.id,
        }),
      })
      const data = await res.json()
      setAiOutput(data.analysis || 'No response.')
    } catch { setAiOutput('API error. Check NVIDIA_API_KEY in Vercel env vars.') }
    setAiLoading(false)
  }

  const topSetup = setups[0]
  const filteredSetups = setups.filter(s => {
    if (scannerFilter === 'bull') return s.direction === 'bull'
    if (scannerFilter === 'bear') return s.direction === 'bear'
    if (scannerFilter === 'inversion') return s.direction === 'inversion'
    if (scannerFilter === 'high') return s.confluence_score >= 75
    return true
  })
  const filteredKB = kbSearch ? KB_CARDS.filter(k =>
    k.title.toLowerCase().includes(kbSearch.toLowerCase()) ||
    k.body.toLowerCase().includes(kbSearch.toLowerCase()) ||
    k.tags.some(t => t.toLowerCase().includes(kbSearch.toLowerCase()))
  ) : KB_CARDS

  const dirColor = (d: Direction) => d === 'bull' ? '#00FF41' : d === 'bear' ? '#EF4444' : '#22D3EE'
  const dirBg   = (d: Direction) => d === 'bull' ? 'rgba(0,255,65,0.1)' : d === 'bear' ? 'rgba(239,68,68,0.1)' : 'rgba(34,211,238,0.1)'
  const scoreColor = (s: number) => s >= 75 ? '#00FF41' : s >= 55 ? '#F59E0B' : '#EF4444'

  const formatAI = (text: string) => text.split('\n').map((line, i) => {
    const hdrs = ['BIAS:','DOL:','SETUP TYPE:','PHASE:','ENTRY LOGIC:','CONFLUENCE FACTORS:','INVALIDATION:','RISK NOTE:','VERDICT:']
    const h = hdrs.find(x => line.startsWith(x))
    if (h) return <div key={i}><div style={{fontSize:8,letterSpacing:'0.12em',color:'#00FF41',textTransform:'uppercase',marginTop:10,marginBottom:3}}>{h.replace(':','')}</div><div style={{fontSize:10,color:h==='VERDICT:'||h==='BIAS:'?'#00FF41':h==='INVALIDATION:'?'#EF4444':'#e8e8e8',lineHeight:1.6}}>{line.replace(h,'').trim()}</div></div>
    if (line.startsWith('-')) return <div key={i} style={{fontSize:10,color:'#555',paddingLeft:10,lineHeight:1.8}}>{line}</div>
    if (!line.trim()) return <div key={i} style={{height:4}}/>
    return <div key={i} style={{fontSize:10,color:'#777',lineHeight:1.6}}>{line}</div>
  })

  const winCount = trades.filter(t => t.result === 'win').length
  const winRate = trades.length > 0 ? ((winCount / trades.length) * 100).toFixed(1) : '0'
  const avgRR = trades.filter(t => t.rr_achieved && t.result === 'win').length > 0
    ? (trades.filter(t => t.result === 'win' && t.rr_achieved).reduce((a, t) => a + (t.rr_achieved || 0), 0) / trades.filter(t => t.result === 'win').length).toFixed(2)
    : '0'

  // ── Styles ──
  const S = {
    app:      { display:'grid', height:'100vh', gridTemplateRows:'42px 1fr 30px', gridTemplateColumns:'220px 1fr 340px' } as React.CSSProperties,
    topbar:   { gridColumn:'1/-1', gridRow:'1', background:'#0a0a0a', borderBottom:'1px solid #222', display:'flex', alignItems:'center', padding:'0 16px', gap:16, zIndex:100 } as React.CSSProperties,
    sidebar:  { gridColumn:'1', gridRow:'2', background:'#0a0a0a', borderRight:'1px solid #222', overflowY:'auto' as const, display:'flex', flexDirection:'column' as const },
    main:     { gridColumn:'2', gridRow:'2', overflow:'hidden', display:'flex', flexDirection:'column' as const, background:'#000' },
    right:    { gridColumn:'3', gridRow:'2', background:'#0a0a0a', borderLeft:'1px solid #222', overflowY:'auto' as const, display:'flex', flexDirection:'column' as const },
    statusBr: { gridColumn:'1/-1', gridRow:'3', background:'#0a0a0a', borderTop:'1px solid #222', display:'flex', alignItems:'center', padding:'0 16px', gap:20, fontSize:10, color:'#555' },
    nav: (a:boolean): React.CSSProperties => ({ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', cursor:'pointer', borderLeft:`2px solid ${a?'#00FF41':'transparent'}`, background:a?'rgba(0,255,65,0.06)':'transparent', color:a?'#00FF41':'#666', fontSize:11 }),
    tab: (a:boolean): React.CSSProperties => ({ padding:'0 18px', height:36, display:'flex', alignItems:'center', fontSize:10, letterSpacing:'0.06em', color:a?'#00FF41':'#666', cursor:'pointer', borderBottom:`2px solid ${a?'#00FF41':'transparent'}`, whiteSpace:'nowrap' }),
    sHdr: { padding:'10px 14px', fontSize:9, letterSpacing:'0.1em', color:'#666', textTransform:'uppercase' as const, display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #222' },
    tag: (c:string,bg:string): React.CSSProperties => ({ display:'inline-block', fontSize:8, padding:'2px 6px', color:c, background:bg, border:`1px solid ${c}44` }),
    btn: (a:boolean): React.CSSProperties => ({ fontSize:9, padding:'3px 8px', border:`1px solid ${a?'#00FF41':'#222'}`, color:a?'#00FF41':'#666', cursor:'pointer', background:a?'rgba(0,255,65,0.08)':'transparent', letterSpacing:'0.04em' }),
  }

  return (
    <div style={S.app}>

      {/* TOPBAR */}
      <div style={S.topbar}>
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
        <div style={{display:'flex',gap:20,flex:1}}>
          {[{sym:'ES1!',price:prices.ES,ch:'+18.25',up:true},{sym:'NQ1!',price:prices.NQ,ch:'+124.50',up:true},{sym:'DXY',price:99.82,ch:'-0.41',up:false},{sym:'VIX',price:18.24,ch:'+0.62',up:false},{sym:'GC1!',price:3326.40,ch:'+12.10',up:true}].map(t=>(
            <div key={t.sym} style={{display:'flex',gap:6,fontSize:10,alignItems:'center'}}>
              <span style={{color:'#555'}}>{t.sym}</span>
              <span style={{fontWeight:600}}>{typeof t.price==='number'?t.price.toFixed(2):t.price}</span>
              <span style={{color:t.up?'#00FF41':'#EF4444'}}>{t.ch}</span>
            </div>
          ))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12,marginLeft:'auto'}}>
          <div style={{fontSize:9,padding:'2px 8px',border:'1px solid #F59E0B',color:'#F59E0B',letterSpacing:'0.06em'}}>{session}</div>
          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,color:'#00FF41',letterSpacing:'0.1em'}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:'#00FF41'}} className="animate-pulse-dot"/>LIVE
          </div>
          <div style={{fontSize:10,color:'#555',minWidth:80}}>{time}</div>
        </div>
      </div>

      {/* SIDEBAR */}
      <div style={S.sidebar}>
        <div style={{borderBottom:'1px solid #222'}}>
          <div style={{fontSize:9,letterSpacing:'0.12em',color:'#333',padding:'10px 14px 6px',textTransform:'uppercase'}}>Navigation</div>
          {(['dashboard','chart','scanner','knowledge','backtest'] as View[]).map(v=>(
            <div key={v} style={S.nav(view===v)} onClick={()=>setView(v)}>
              {v.charAt(0).toUpperCase()+v.slice(1)}
              {v==='scanner'&&<span style={{marginLeft:'auto',fontSize:9,padding:'1px 5px',background:'rgba(245,158,11,0.15)',color:'#F59E0B',border:'1px solid rgba(245,158,11,0.3)'}}>{setups.length}</span>}
              {v==='dashboard'&&<span style={{marginLeft:'auto',fontSize:9,padding:'1px 5px',background:'rgba(239,68,68,0.12)',color:'#EF4444',border:'1px solid rgba(239,68,68,0.3)'}}>{alerts.length}</span>}
              {v==='chart'&&<span style={{marginLeft:'auto',fontSize:9,padding:'1px 5px',background:'rgba(0,255,65,0.08)',color:'#00FF41',border:'1px solid rgba(0,255,65,0.2)'}}>LIVE</span>}
            </div>
          ))}
        </div>
        {[{sym:'ES1! · E-MINI S&P',k:'ES',price:prices.ES,dol:topSetup?.symbol==='ES'?topSetup.dol_target:'5,920'},{sym:'NQ1! · E-MINI NQ',k:'NQ',price:prices.NQ,dol:topSetup?.symbol==='NQ'?topSetup.dol_target:'29,750'}].map(m=>(
          <div key={m.k} style={{margin:10,background:'#111',border:'1px solid #222',padding:10}}>
            <div style={{fontSize:10,color:'#555',marginBottom:4}}>{m.sym}</div>
            <div style={{fontSize:18,fontWeight:700,lineHeight:1,fontFamily:'JetBrains Mono,monospace'}}>{m.price.toFixed(2)}</div>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <span style={S.tag('#00FF41','rgba(0,255,65,0.1)')}>BULLISH</span>
              <span style={{fontSize:9,color:'#555'}}>DOL: {m.dol}</span>
            </div>
          </div>
        ))}
        <div style={{padding:'0 10px 10px'}}>
          <div style={{fontSize:9,color:'#333',letterSpacing:'0.1em',textTransform:'uppercase',padding:'8px 4px'}}>Active Alerts</div>
          {alerts.length===0?<div style={{fontSize:10,color:'#444',padding:'4px'}}>No active alerts</div>:alerts.slice(0,3).map(a=>(
            <div key={a.id} style={{padding:8,marginBottom:4,borderLeft:`2px solid ${a.severity==='critical'?'#EF4444':a.severity==='warning'?'#F59E0B':'#00FF41'}`,background:a.severity==='critical'?'rgba(239,68,68,0.06)':'rgba(0,255,65,0.05)'}}>
              <div style={{fontSize:9,color:'#555'}}>{a.symbol} {a.timeframe}</div>
              <div style={{fontSize:10,color:'#ccc',marginTop:2}}>{a.message}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MAIN */}
      <div style={S.main}>
        <div style={{display:'flex',borderBottom:'1px solid #222',background:'#0a0a0a'}}>
          {(['dashboard','chart','scanner','knowledge','backtest'] as View[]).map((v,i)=>(
            <div key={v} style={S.tab(view===v)} onClick={()=>setView(v)}>{['Overview','Chart','Scanner','Knowledge','Backtest'][i]}</div>
          ))}
        </div>
        <div style={{flex:1,overflow:'hidden'}}>

          {/* ─── DASHBOARD ─── */}
          {view==='dashboard'&&(
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:1,background:'#222'}}>
                {[
                  {label:'Active Setups',value:setups.length.toString(),sub:`ES(${setups.filter(s=>s.symbol==='ES').length}) · NQ(${setups.filter(s=>s.symbol==='NQ').length}) · ${Array.from(new Set(setups.map(s=>s.timeframe))).length} TFs`,color:'#F59E0B'},
                  {label:'Best Confluence',value:`${topSetup?.confluence_score??0}/100`,sub:topSetup?`${topSetup.symbol} ${topSetup.timeframe} · ${topSetup.setup_type}`:'Loading...',color:'#00FF41'},
                  {label:'HTF Bias',value:'BULLISH',sub:'Daily · 4H · 1H aligned',color:'#00FF41'},
                ].map((k,i)=>(
                  <div key={i} style={{background:'#0a0a0a',padding:'16px 18px'}}>
                    <div style={{fontSize:9,letterSpacing:'0.1em',color:'#555',textTransform:'uppercase',marginBottom:8}}>{k.label}</div>
                    <div style={{fontSize:24,fontWeight:700,fontFamily:'Syne,sans-serif',color:k.color}}>{k.value}</div>
                    <div style={{fontSize:10,color:'#555',marginTop:4}}>{k.sub}</div>
                  </div>
                ))}
              </div>

              <div style={{padding:'10px 14px',borderBottom:'1px solid #222',fontSize:9,letterSpacing:'0.1em',color:'#555',textTransform:'uppercase',background:'#0a0a0a'}}>Active Setups — Live from Supabase</div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                <thead><tr>{['Symbol','TF','Setup Type','Dir','Confluence','DOL Target','Status'].map(h=>(
                  <th key={h} style={{textAlign:'left',fontSize:9,color:'#444',letterSpacing:'0.08em',padding:'8px 14px',borderBottom:'1px solid #1a1a1a',fontWeight:500,textTransform:'uppercase'}}>{h}</th>
                ))}</tr></thead>
                <tbody>
                  {setups.length===0?(
                    <tr><td colSpan={7} style={{padding:'20px 14px',color:'#444',fontSize:10}}>Loading from Supabase...</td></tr>
                  ):setups.map(s=>(
                    <tr key={s.id} style={{cursor:'pointer'}} onClick={()=>{setSelectedSetup(s);setView('chart')}}>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a',fontWeight:700,color:'#e8e8e8'}}>{s.symbol}</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a',color:'#555'}}>{s.timeframe}</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a',color:'#888'}}>{s.setup_type}</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a'}}><span style={S.tag(dirColor(s.direction),dirBg(s.direction))}>{s.direction.toUpperCase()}</span></td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a'}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <div style={{width:60,height:3,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}><div style={{width:`${s.confluence_score}%`,height:'100%',background:scoreColor(s.confluence_score)}}/></div>
                          <span style={{fontSize:9,color:scoreColor(s.confluence_score)}}>{s.confluence_score}</span>
                        </div>
                      </td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a',color:s.direction==='bull'?'#00FF41':'#EF4444'}}>{s.dol_target}</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a'}}><span style={S.tag(s.confluence_score>=75?'#00FF41':'#F59E0B',s.confluence_score>=75?'rgba(0,255,65,0.08)':'rgba(245,158,11,0.08)')}>{s.status==='active'?'ENTRY ZONE':'WATCHING'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{padding:'10px 14px',borderBottom:'1px solid #222',fontSize:9,letterSpacing:'0.1em',color:'#555',textTransform:'uppercase',background:'#0a0a0a',marginTop:1}}>
                {topSetup?`5-Question DOL — ${topSetup.symbol} ${topSetup.timeframe}`:'DOL Framework'}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:'#222'}}>
                <div style={{background:'#0a0a0a',padding:16}}>
                  {topSetup?[
                    ['Q1','Delivering FROM:',`${topSetup.direction==='bull'?'Discount':'Premium'} PD Array zone`],
                    ['Q2','CISD at:',`${topSetup.timeframe} — ${topSetup.direction==='bull'?'Bullish':'Bearish'} confirmed`],
                    ['Q3','Price now:',`${prices[topSetup.symbol as keyof typeof prices]?.toFixed(2)} — pullback to entry`],
                    ['Q4','Arrays respected:',topSetup.setup_type],
                    ['Q5','Delivering TO:',topSetup.dol_target],
                  ].map(([n,q,a])=>(
                    <div key={String(n)} style={{display:'flex',gap:10,marginBottom:6,fontSize:9}}>
                      <span style={{color:'#00FF41',minWidth:20}}>{n}</span>
                      <span style={{color:'#555'}}>{q}</span>
                      <span style={{color:'#ccc',fontWeight:500}}>{a}</span>
                    </div>
                  )):<div style={{fontSize:10,color:'#444'}}>Loading...</div>}
                </div>
                <div style={{background:'#0a0a0a',padding:16}}>
                  <div style={{fontSize:9,color:'#555',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:10}}>MMXM Phase</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:10}}>
                    {[{l:'ACCUMULATE',done:true,act:false},{l:'MANIPULATE',done:true,act:false},{l:'DISTRIBUTE',done:false,act:true}].map(p=>(
                      <div key={p.l} style={{padding:8,border:`1px solid ${p.act?'#F59E0B':'#222'}`,background:p.act?'rgba(245,158,11,0.08)':'#111',textAlign:'center'}}>
                        <div style={{fontSize:8,color:p.act?'#F59E0B':'#444',marginBottom:4}}>{p.l}</div>
                        <div style={{fontSize:10,color:p.act?'#F59E0B':'#555'}}>{p.act?'NOW ↑':'✓'}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:9,color:'#555',lineHeight:1.7}}>
                    {topSetup?`SSL at ${topSetup.stop_loss.toFixed(2)} swept. ${topSetup.direction==='bull'?'Bullish':'Bearish'} CISD confirmed. Targeting ${topSetup.dol_target}.`:'Loading...'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── CHART — Real TradingView ─── */}
          {view==='chart'&&(
            <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',borderBottom:'1px solid #222',background:'#0a0a0a',flexWrap:'wrap'}}>
                <span style={{fontSize:9,color:'#444'}}>SYMBOL</span>
                {['ES','NQ'].map(s=><button key={s} style={S.btn(activeAsset===s)} onClick={()=>setActiveAsset(s)}>{s}</button>)}
                <div style={{width:1,height:16,background:'#222'}}/>
                <span style={{fontSize:9,color:'#444'}}>TF</span>
                {[['5','5m'],['15','15m'],['60','1H'],['240','4H'],['D','D']].map(([v,l])=>(
                  <button key={v} style={S.btn(chartTF===v)} onClick={()=>setChartTF(v)}>{l}</button>
                ))}
                <div style={{width:1,height:16,background:'#222'}}/>
                {selectedSetup&&(
                  <span style={{fontSize:9,color:'#F59E0B',fontFamily:'JetBrains Mono,monospace'}}>
                    {selectedSetup.symbol} · Entry {selectedSetup.entry_low.toFixed(0)}–{selectedSetup.entry_high.toFixed(0)} · SL {selectedSetup.stop_loss.toFixed(0)} · DOL {selectedSetup.target.toFixed(0)}
                  </span>
                )}
              </div>
              <div style={{flex:1,background:'#000'}}>
                <iframe
                  key={`${activeAsset}-${chartTF}`}
                  src={`https://s.tradingview.com/widgetembed/?symbol=CME_MINI%3A${activeAsset === 'NQ' ? 'NQ1!' : 'ES1!'}&interval=${chartTF}&theme=dark&style=1&locale=en&toolbar_bg=%230a0a0a&enable_publishing=false&hide_top_toolbar=false&hide_legend=false&save_image=false&backgroundColor=%23000000&gridColor=%23161616&hide_side_toolbar=false&withdateranges=true&container_id=tv_chart`}
                  style={{width:'100%',height:'100%',border:'none'}}
                  allow="clipboard-write"
                />
              </div>
            </div>
          )}

          {/* ─── SCANNER ─── */}
          {view==='scanner'&&(
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{display:'flex',gap:8,padding:'12px 14px',borderBottom:'1px solid #222',flexWrap:'wrap'}}>
                {[['all','ALL'],['bull','BULLISH'],['bear','BEARISH'],['inversion','INVERSION'],['high','HIGH CONF 75+']].map(([f,l])=>(
                  <button key={f} style={S.btn(scannerFilter===f)} onClick={()=>setScannerFilter(f)}>{l}</button>
                ))}
                <span style={{marginLeft:'auto',fontSize:9,color:'#444',padding:'3px 0'}}>{filteredSetups.length} setups · Supabase live</span>
              </div>
              {filteredSetups.length===0?(
                <div style={{padding:'24px 14px',color:'#444',fontSize:10}}>No setups match. Check Supabase connection.</div>
              ):filteredSetups.map(s=>(
                <div key={s.id} style={{padding:'12px 14px',borderBottom:'1px solid #1a1a1a',cursor:'pointer'}} onClick={()=>{setSelectedSetup(s);setView('chart')}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <span style={{fontSize:13,fontWeight:700,fontFamily:'Syne,sans-serif'}}>{s.symbol}</span>
                    <span style={{fontSize:9,color:'#555'}}>{s.timeframe}</span>
                    <span style={S.tag(dirColor(s.direction),dirBg(s.direction))}>{s.direction.toUpperCase()}</span>
                    {s.ai_analysis&&<span style={{fontSize:9,padding:'1px 5px',background:'rgba(0,255,65,0.08)',color:'#00FF41',border:'1px solid rgba(0,255,65,0.2)'}}>AI ✓</span>}
                    <span style={{marginLeft:'auto',fontSize:9,color:'#444'}}>{new Date(s.created_at).toLocaleDateString()}</span>
                  </div>
                  <div style={{fontSize:11,color:'#ccc',marginBottom:4}}>{s.setup_type}</div>
                  <div style={{fontSize:9,color:'#555',marginBottom:8}}>Entry: {s.entry_low.toFixed(2)}–{s.entry_high.toFixed(2)} · SL: {s.stop_loss.toFixed(2)} · TP: {s.target.toFixed(2)} · R:R {s.rr_ratio.toFixed(1)}</div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={S.tag('#F59E0B','rgba(245,158,11,0.1)')}>DOL: {s.dol_target}</span>
                    <span style={{fontSize:9,color:'#555'}}>Confluence: <span style={{color:scoreColor(s.confluence_score)}}>{s.confluence_score}/100</span></span>
                    <div style={{width:60,height:3,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}><div style={{width:`${s.confluence_score}%`,height:'100%',background:scoreColor(s.confluence_score)}}/></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ─── KNOWLEDGE ─── */}
          {view==='knowledge'&&(
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{margin:14,position:'relative'}}>
                <svg style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',width:13,height:13}} viewBox="0 0 16 16" fill="none" stroke="#444" strokeWidth="2"><circle cx="7" cy="7" r="4"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>
                <input value={kbSearch} onChange={e=>setKbSearch(e.target.value)} placeholder="Search concepts, rules, PD arrays..." style={{width:'100%',background:'#111',border:'1px solid #222',color:'#e8e8e8',fontFamily:'JetBrains Mono,monospace',fontSize:11,padding:'8px 12px 8px 32px',outline:'none'}}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:'#222'}}>
                {filteredKB.map((k,i)=>(
                  <div key={i} style={{background:'#0a0a0a',padding:14}}>
                    <div style={{fontSize:8,letterSpacing:'0.1em',color:'#444',marginBottom:6,textTransform:'uppercase'}}>{k.tag}</div>
                    <div style={{fontSize:12,fontWeight:600,fontFamily:'Syne,sans-serif',color:'#e8e8e8',marginBottom:6}}>{k.title}</div>
                    <div style={{fontSize:10,color:'#666',lineHeight:1.7}} dangerouslySetInnerHTML={{__html:k.body}}/>
                    <div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:8}}>
                      {k.tags.map(t=><span key={t} style={{fontSize:9,padding:'2px 7px',background:'#161616',border:'1px solid #222',color:'#555'}}>{t}</span>)}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:'10px 14px',borderTop:'1px solid #222',fontSize:9,letterSpacing:'0.1em',color:'#555',textTransform:'uppercase',background:'#0a0a0a'}}>Critical Rules — Extracted From Videos</div>
              {RULES.map(r=>(
                <div key={r.num} style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid #1a1a1a'}}>
                  <span style={{fontSize:9,color:'#00FF41',minWidth:24}}>{r.num}</span>
                  <span style={{fontSize:10,color:'#666',lineHeight:1.6}} dangerouslySetInnerHTML={{__html:r.text}}/>
                </div>
              ))}
            </div>
          )}

          {/* ─── BACKTEST ─── */}
          {view==='backtest'&&(
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:1,background:'#222'}}>
                {[
                  {label:'Win Rate',val:`${winRate}%`,color:'#00FF41'},
                  {label:'Avg Win R:R',val:avgRR,color:'#00FF41'},
                  {label:'Total Trades',val:trades.length.toString(),color:'#F59E0B'},
                  {label:'Winners',val:winCount.toString(),color:'#00FF41'},
                ].map(s=>(
                  <div key={s.label} style={{background:'#0a0a0a',padding:14}}>
                    <div style={{fontSize:9,color:'#444',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{s.label}</div>
                    <div style={{fontSize:22,fontWeight:700,fontFamily:'Syne,sans-serif',color:s.color}}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{padding:'10px 14px',borderBottom:'1px solid #222',fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'0.1em',background:'#0a0a0a'}}>Trade History — From Supabase</div>
              {trades.length===0?<div style={{padding:'20px 14px',color:'#444',fontSize:10}}>Loading trades...</div>:trades.map(t=>(
                <div key={t.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderBottom:'1px solid #1a1a1a',fontSize:10}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:t.result==='win'?'#00FF41':'#EF4444',flexShrink:0}}/>
                  <span style={{fontSize:9,color:'#444',minWidth:90}}>{new Date(t.opened_at).toLocaleDateString()}</span>
                  <span style={{fontWeight:700,color:'#e8e8e8',minWidth:30}}>{t.symbol}</span>
                  <span style={{color:'#666',flex:1,fontSize:9}}>{t.notes?.split('—')[0]?.trim()??'—'}</span>
                  <span style={{color:'#555',fontSize:9}}>In: {t.entry_price}</span>
                  <span style={{color:'#EF4444',fontSize:9,margin:'0 6px'}}>SL: {t.stop_loss}</span>
                  <span style={{color:'#00FF41',fontSize:9}}>TP: {t.take_profit}</span>
                  <span style={{fontWeight:700,fontSize:11,minWidth:44,textAlign:'right',color:t.result==='win'?'#00FF41':'#EF4444'}}>{t.result==='win'?`+${t.rr_achieved}R`:'-1R'}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* RIGHT PANEL */}
      <div style={S.right}>
        <div style={{borderBottom:'1px solid #222'}}>
          <div style={S.sHdr}><span>Asset Focus</span></div>
          <div style={{display:'flex',gap:6,padding:'8px 14px'}}>
            {['NQ','ES'].map(a=>(
              <button key={a} style={{flex:1,padding:6,border:`1px solid ${activeAsset===a?'#00FF41':'#222'}`,background:activeAsset===a?'rgba(0,255,65,0.08)':'transparent',color:activeAsset===a?'#00FF41':'#555',fontFamily:'JetBrains Mono,monospace',fontSize:10,cursor:'pointer'}} onClick={()=>setActiveAsset(a)}>{a}</button>
            ))}
          </div>
        </div>

        <div style={{borderBottom:'1px solid #222'}}>
          <div style={S.sHdr}><span>Multi-TF Bias</span></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,padding:'10px 14px'}}>
            {[{tf:'DAILY',bias:'BULLISH',note:'ATH breakout',bull:true},{tf:'4 HOUR',bias:'BULLISH',note:'CISD confirmed',bull:true},{tf:'1 HOUR',bias:'BULLISH',note:'OB holding',bull:true},{tf:'15 MIN',bias:'PULLBACK',note:'Into discount',bull:false}].map(m=>(
              <div key={m.tf} style={{border:'1px solid #222',padding:8,background:'#111'}}>
                <div style={{fontSize:9,color:'#555'}}>{m.tf}</div>
                <div style={{fontSize:11,fontWeight:600,color:m.bull?'#00FF41':'#F59E0B',marginTop:3}}>{m.bias}</div>
                <div style={{fontSize:9,color:'#444',marginTop:3}}>{m.note}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{borderBottom:'1px solid #222'}}>
          <div style={S.sHdr}><span>Confluence Score</span></div>
          <div style={{padding:'10px 14px'}}>
            {[{name:'HTF Bias',pct:100,score:20},{name:'CISD Confirm',pct:100,score:20},{name:'PD Array',pct:85,score:17},{name:'DOL Clarity',pct:75,score:15},{name:'SSL Swept',pct:100,score:15}].map(c=>(
              <div key={c.name} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,fontSize:9}}>
                <span style={{color:'#555',minWidth:85}}>{c.name}</span>
                <div style={{flex:1,height:4,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}><div style={{width:`${c.pct}%`,height:'100%',background:c.pct>=80?'#00FF41':'#F59E0B'}}/></div>
                <span style={{color:'#ccc',minWidth:20,textAlign:'right'}}>{c.score}</span>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',marginTop:10,paddingTop:8,borderTop:'1px solid #222'}}>
              <span style={{fontSize:9,color:'#555',letterSpacing:'0.08em'}}>TOTAL</span>
              <span style={{fontSize:22,fontWeight:700,color:'#00FF41',fontFamily:'Syne,sans-serif'}}>{topSetup?.confluence_score??87}</span>
            </div>
          </div>
        </div>

        <div style={{borderBottom:'1px solid #222'}}>
          <div style={S.sHdr}><span>Trade Parameters</span></div>
          <div style={{padding:'10px 14px'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
              {[
                {label:'Entry Zone',val:(selectedSetup??topSetup)?`${(selectedSetup??topSetup)!.entry_low.toFixed(0)}–${(selectedSetup??topSetup)!.entry_high.toFixed(0)}`:'Loading...',color:'#F59E0B'},
                {label:'Stop Loss',val:(selectedSetup??topSetup)?.stop_loss.toFixed(0)??'—',color:'#EF4444'},
                {label:'Target (DOL)',val:(selectedSetup??topSetup)?.target.toFixed(0)??'—',color:'#00FF41'},
                {label:'R:R',val:(selectedSetup??topSetup)?`${(selectedSetup??topSetup)!.rr_ratio.toFixed(1)}R`:'—',color:'#00FF41'},
                {label:'Setup',val:(selectedSetup??topSetup)?.setup_type.split('+')[0].trim()??'—',color:'#888'},
                {label:'Invalidation',val:'Close below OB',color:'#EF4444'},
              ].map(p=>(
                <div key={p.label} style={{background:'#111',padding:'8px 10px',border:'1px solid #222'}}>
                  <div style={{fontSize:8,color:'#444',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>{p.label}</div>
                  <div style={{fontSize:11,fontWeight:600,color:p.color}}>{p.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI ANALYST */}
        <div style={{flex:1,display:'flex',flexDirection:'column'}}>
          <div style={S.sHdr}>
            <span>AI Analyst</span>
            <span style={{color:aiLoading?'#F59E0B':aiOutput?'#00FF41':'#555',fontSize:9}}>{aiLoading?'Generating...':aiOutput?'Complete':'Ready'}</span>
          </div>
          <div style={{flex:1,padding:'12px 14px',fontSize:10,lineHeight:1.8,color:'#666',overflowY:'auto'}}>
            {aiLoading?(
              <span>Analyzing {(selectedSetup??topSetup)?.symbol??'NQ'}...<span className="animate-blink" style={{display:'inline-block',width:8,height:12,background:'#00FF41',verticalAlign:'middle',marginLeft:4}}/></span>
            ):aiOutput?formatAI(aiOutput):(
              <span style={{color:'#444'}}>Select a setup then click Run Analysis for full SMC reasoning via AI.</span>
            )}
          </div>
          <button onClick={runAnalysis} disabled={aiLoading||setups.length===0}
            style={{margin:'12px 14px',padding:10,background:'transparent',border:'1px solid #00FF41',color:'#00FF41',fontFamily:'JetBrains Mono,monospace',fontSize:10,letterSpacing:'0.1em',cursor:'pointer',opacity:aiLoading||setups.length===0?0.4:1,textTransform:'uppercase'}}>
            ⬡ RUN AI ANALYSIS
          </button>
        </div>
      </div>

      {/* STATUS BAR */}
      <div style={S.statusBr}>
        {[{l:'Data Feed',c:'#00FF41'},{l:'AI Engine',c:'#00FF41'},{l:'Scanner',c:setups.length>0?'#00FF41':'#F59E0B'},{l:dbStatus,c:dbStatus==='DB Connected'?'#00FF41':dbStatus==='Connecting...'?'#F59E0B':'#EF4444'}].map(s=>(
          <div key={s.l} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:4,height:4,borderRadius:'50%',background:s.c}}/>
            {s.l}
          </div>
        ))}
        <div style={{marginLeft:'auto',display:'flex',gap:16}}>
          <span>ES: {prices.ES.toFixed(2)}</span>
          <span>NQ: {prices.NQ.toFixed(2)}</span>
          <span>{setups.length} setups live</span>
          <span>{time}</span>
        </div>
      </div>

    </div>
  )
}
