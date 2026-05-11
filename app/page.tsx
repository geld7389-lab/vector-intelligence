'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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

interface Alert {
  id: string
  symbol: string
  timeframe: string
  alert_type: string
  message: string
  severity: string
  is_read: boolean
  created_at: string
}

const KB_CARDS = [
  { tag:'PD ARRAYS · EP1', title:'Order Block (OB)', body:'The last bearish candle before a bullish impulse / last bullish before bearish. Price returns to fill the imbalance. Only valid in correct premium/discount zone aligned with HTF bias.', tags:['OB','Discount','Premium','PD Array'] },
  { tag:'PD ARRAYS · EP1', title:'Fair Value Gap (BISI / SIBI)', body:'3-candle imbalance where candle 1 and 3 wicks do not overlap. <strong>BISI</strong> = Buy Side Imbalance Sell Side Inefficiency (bullish). <strong>SIBI</strong> = bearish. Visible Ep1 on weekly SPX.', tags:['FVG','BISI','SIBI','Imbalance'] },
  { tag:'PD ARRAYS · EP4', title:'Inversion PD Arrays', body:'When OB/FVG/BRK is broken through with a full body close — it inverts. <strong>IOB</strong> = Inversion OB, <strong>IFVG</strong> = Inversion FVG. Trade from opposite side on return. Stacked = strongest zones.', tags:['IOB','IFVG','IBRK','Inversion'] },
  { tag:'THE MODEL · EP2', title:'Change in State of Delivery (CISD)', body:'MUST be a <strong>FULL CANDLE BODY CLOSE</strong> through prior swing. A wick is NOT a real MSS. Bullish: body closes above swing high after SSL sweep. The CISD is the trigger — not the sweep.', tags:['CISD','MSS','Structure','Trigger'] },
  { tag:'DOL FRAMEWORK · EP3', title:'Draw On Liquidity (DOL)', body:'Where price is magnetically drawn next. Always a liquidity pool. <strong>5 questions:</strong> from where? CISD where? price at? arrays respected? delivering to where? All answered before entry.', tags:['DOL','Liquidity','BSL','SSL','Target'] },
  { tag:'REFINEMENT · EP6', title:'Liquidity Sequencing Rule', body:'"<strong>When bullish and price hits buyside liquidity — wait for a run on sell stops before looking long.</strong>" Never buy directly into BSL. Wait for SSL sweep → CISD → PD array entry.', tags:['BSL','SSL','Sequencing','Key Rule'] },
  { tag:'MMXM · BONUS', title:'Market Maker Model (MMXM)', body:'<strong>Accumulation</strong> (range) → <strong>Manipulation</strong> (stop hunt) → <strong>Distribution</strong> (true delivery). Multi-TF DOL: 1H DOL = macro target, 5m MMMB DOL = micro entry. SPX weekly Bonus ep.', tags:['MMXM','Accumulation','Manipulation','Distribution'] },
  { tag:'SYNTHESIS · EP5', title:'Multi-TF Execution Model', body:'Daily/Weekly: bias. 4H: structure. 1H: CISD + DOL. 15m/5m: entry PD array left by CISD impulse. Live NQ execution Ep5: BRK daily → IOB 15m. Never skip a timeframe.', tags:['MTF','Execution','Top-Down','Confluence'] },
]

const RULES = [
  { num:'R1', text:'<strong>Never buy into buyside liquidity directly.</strong> Wait for the sweep → CISD → entry. — Ep6' },
  { num:'R2', text:'<strong>CISD must be a full candle body close.</strong> A wick through a level is NOT a real MSS. — Ep2' },
  { num:'R3', text:'<strong>All timeframes must align before entry.</strong> Daily → 4H → 1H → 15m. One misaligned TF = skip. — Ep5' },
  { num:'R4', text:'<strong>Violated OB/FVG becomes an inversion.</strong> Trade it from the other side on the return. — Ep4' },
  { num:'R5', text:'<strong>Know your DOL before touching the chart.</strong> Answer all 5 questions. No DOL = no trade. — Ep3' },
  { num:'R6', text:'<strong>Respect the MMXM cycle phase.</strong> Trading against manipulation phase loses every time. — Bonus' },
  { num:'R7', text:'<strong>PD Arrays only valid in correct premium/discount zone.</strong> Buying OB in premium = wrong. — Ep1' },
]

const TRADES = [
  { date:'2024-01-09', sym:'NQ', type:'Bullish CISD + OB', entry:16340, sl:16180, tp:16610, result:'win', rr:'+1.7R' },
  { date:'2024-01-08', sym:'ES', type:'BISI Entry', entry:4780, sl:4755, tp:4848, result:'win', rr:'+2.7R' },
  { date:'2024-01-05', sym:'NQ', type:'IOB Short', entry:16520, sl:16620, tp:16220, result:'win', rr:'+3.0R' },
  { date:'2024-01-04', sym:'ES', type:'Bullish CISD + FVG', entry:4740, sl:4715, tp:4810, result:'loss', rr:'-1R' },
  { date:'2024-01-03', sym:'NQ', type:'BRK Retest Long', entry:16390, sl:16300, tp:16620, result:'win', rr:'+2.6R' },
  { date:'2023-12-29', sym:'ES', type:'SIBI Short', entry:4820, sl:4855, tp:4715, result:'win', rr:'+3.0R' },
  { date:'2023-12-27', sym:'NQ', type:'Bullish OB Entry', entry:16240, sl:16150, tp:16480, result:'loss', rr:'-1R' },
  { date:'2023-12-26', sym:'ES', type:'BISI Bullish', entry:4740, sl:4715, tp:4840, result:'win', rr:'+4.0R' },
]

export default function VectorPlatform() {
  const [view, setView] = useState<View>('dashboard')
  const [prices, setPrices] = useState({ ES: 5847.25, NQ: 20415.50 })
  const [setups, setSetups] = useState<Setup[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [selectedSetup, setSelectedSetup] = useState<Setup | null>(null)
  const [aiOutput, setAiOutput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [kbSearch, setKbSearch] = useState('')
  const [scannerFilter, setScannerFilter] = useState('all')
  const [activeAsset, setActiveAsset] = useState('NQ')
  const [time, setTime] = useState('')
  const [session, setSession] = useState('NY SESSION')
  const [dbStatus, setDbStatus] = useState('Connecting...')
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartData = useRef<any[]>([])

  // ── Live clock ──
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const et = now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' })
      setTime(et + ' ET')
      const h = parseInt(et.split(':')[0])
      if (h >= 9 && h < 16) setSession('NY SESSION')
      else if (h >= 2 && h < 8) setSession('LONDON')
      else setSession('ASIA')
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Price jitter (realistic micro-movement) ──
  useEffect(() => {
    const id = setInterval(() => {
      setPrices(p => ({
        ES: parseFloat((p.ES + (Math.random() - 0.5) * 0.75).toFixed(2)),
        NQ: parseFloat((p.NQ + (Math.random() - 0.5) * 2.5).toFixed(2)),
      }))
    }, 900)
    return () => clearInterval(id)
  }, [])

  // ── Load setups from Supabase ──
  useEffect(() => {
    async function loadSetups() {
      const { data, error } = await supabase
        .from('setups')
        .select('*')
        .order('confluence_score', { ascending: false })
      if (error) {
        console.error('Setups error:', error)
        setDbStatus('DB Error')
        return
      }
      if (data) {
        setSetups(data as Setup[])
        setDbStatus('DB Connected')
      }
    }
    loadSetups()

    // Real-time subscription
    const channel = supabase
      .channel('setups-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'setups' }, () => {
        loadSetups()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Load alerts from Supabase ──
  useEffect(() => {
    async function loadAlerts() {
      const { data } = await supabase
        .from('scanner_alerts')
        .select('*')
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(5)
      if (data) setAlerts(data as Alert[])
    }
    loadAlerts()
  }, [])

  // ── Chart ──
  useEffect(() => {
    if (view === 'chart') setTimeout(drawChart, 80)
  }, [view, activeAsset])

  function generateCandles(n = 80) {
    const arr: any[] = []
    let p = activeAsset === 'NQ' ? prices.NQ * 0.985 : prices.ES * 0.985
    for (let i = 0; i < n; i++) {
      const o = p
      const vol = activeAsset === 'NQ' ? 15 : 6
      const ch = (Math.random() - 0.45) * vol
      const c = o + ch
      const h = Math.max(o, c) + Math.random() * vol * 0.4
      const l = Math.min(o, c) - Math.random() * vol * 0.4
      arr.push({ o, h, l, c })
      p = c
    }
    // Force last candle to match current price
    arr[arr.length - 1].c = activeAsset === 'NQ' ? prices.NQ : prices.ES
    return arr
  }

  function drawChart() {
    const canvas = chartRef.current
    if (!canvas) return
    const W = canvas.parentElement?.clientWidth ?? 800
    const H = canvas.parentElement?.clientHeight ?? 400
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')!
    if (!chartData.current.length) chartData.current = generateCandles()
    const candles = chartData.current
    const pad = { l: 65, r: 75, t: 20, b: 30 }
    const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b
    const allP = candles.flatMap((c: any) => [c.h, c.l])
    const minP = Math.min(...allP) - 2, maxP = Math.max(...allP) + 2
    const sY = (v: number) => pad.t + cH - ((v - minP) / (maxP - minP)) * cH
    const barW = cW / candles.length
    const bW = Math.max(barW * 0.65, 2)
    const bX = (i: number) => pad.l + i * barW + barW / 2

    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)

    // Grid lines
    for (let i = 0; i <= 6; i++) {
      const y = pad.t + (cH / 6) * i
      ctx.strokeStyle = '#161616'; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke()
      const pv = maxP - ((maxP - minP) / 6) * i
      ctx.fillStyle = '#333'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'right'
      ctx.fillText(pv.toFixed(2), pad.l - 6, y + 3)
    }
    for (let i = 0; i < candles.length; i += 15) {
      const x = bX(i)
      ctx.strokeStyle = '#111'; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke()
    }

    // OB zone (realistic position)
    const obIdx = Math.floor(candles.length * 0.28)
    const ob = candles[obIdx]
    if (ob) {
      const x = pad.l + obIdx * barW
      const obTop = sY(Math.max(ob.o, ob.c))
      const obBot = sY(Math.min(ob.o, ob.c))
      ctx.fillStyle = 'rgba(245,158,11,0.09)'
      ctx.fillRect(x, obTop, W - pad.r - x, obBot - obTop)
      ctx.strokeStyle = 'rgba(245,158,11,0.45)'; ctx.lineWidth = 0.8; ctx.setLineDash([])
      ctx.strokeRect(x, obTop, W - pad.r - x, obBot - obTop)
      ctx.fillStyle = 'rgba(245,158,11,0.85)'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'left'
      ctx.fillText('OB', x + 3, obTop - 3)
    }

    // BISI zone (FVG)
    const fvgPrice = minP + (maxP - minP) * 0.38
    const fvgTop = sY(fvgPrice + (maxP - minP) * 0.04)
    const fvgBot = sY(fvgPrice)
    ctx.fillStyle = 'rgba(0,255,65,0.06)'
    ctx.fillRect(pad.l + cW * 0.42, fvgTop, cW * 0.58, fvgBot - fvgTop)
    ctx.strokeStyle = 'rgba(0,255,65,0.28)'; ctx.lineWidth = 0.5
    ctx.strokeRect(pad.l + cW * 0.42, fvgTop, cW * 0.58, fvgBot - fvgTop)
    ctx.fillStyle = 'rgba(0,255,65,0.75)'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'left'
    ctx.fillText('BISI', pad.l + cW * 0.42 + 3, fvgTop + 9)

    // SSL line (dashed red)
    const sslP = minP + (maxP - minP) * 0.06
    ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(239,68,68,0.55)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(pad.l, sY(sslP)); ctx.lineTo(W - pad.r, sY(sslP)); ctx.stroke()
    ctx.setLineDash([]); ctx.fillStyle = 'rgba(239,68,68,0.85)'; ctx.textAlign = 'right'; ctx.font = '8px JetBrains Mono'
    ctx.fillText('SSL ▼', W - pad.r - 3, sY(sslP) - 3)

    // BSL line (dashed green)
    const bslP = minP + (maxP - minP) * 0.93
    ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(0,255,65,0.55)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(pad.l, sY(bslP)); ctx.lineTo(W - pad.r, sY(bslP)); ctx.stroke()
    ctx.setLineDash([]); ctx.fillStyle = 'rgba(0,255,65,0.85)'; ctx.textAlign = 'right'
    ctx.fillText('BSL ▲ DOL', W - pad.r - 3, sY(bslP) - 3)

    // Candles
    candles.forEach((c: any, i: number) => {
      const x = bX(i)
      const bull = c.c >= c.o
      ctx.strokeStyle = bull ? '#00FF41' : '#EF4444'; ctx.lineWidth = 1; ctx.setLineDash([])
      ctx.beginPath(); ctx.moveTo(x, sY(c.h)); ctx.lineTo(x, sY(c.l)); ctx.stroke()
      const top = Math.min(sY(c.o), sY(c.c))
      const bh = Math.max(Math.abs(sY(c.o) - sY(c.c)), 1)
      if (bull) {
        ctx.fillStyle = 'rgba(0,255,65,0.12)'; ctx.fillRect(x - bW/2, top, bW, bh)
        ctx.strokeStyle = '#00FF41'; ctx.lineWidth = 0.8; ctx.strokeRect(x - bW/2, top, bW, bh)
      } else {
        ctx.fillStyle = '#EF4444'; ctx.fillRect(x - bW/2, top, bW, bh)
      }
    })

    // Current price line + label
    const last = candles[candles.length - 1].c
    ctx.setLineDash([3, 4]); ctx.strokeStyle = '#00FF41'; ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.moveTo(pad.l, sY(last)); ctx.lineTo(W - pad.r, sY(last)); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#00FF41'; ctx.fillRect(W - pad.r + 1, sY(last) - 9, 73, 18)
    ctx.fillStyle = '#000'; ctx.font = 'bold 9px JetBrains Mono'; ctx.textAlign = 'center'
    ctx.fillText(last.toFixed(2), W - pad.r + 37, sY(last) + 3)

    // CISD marker
    const cisdIdx = Math.floor(candles.length * 0.6)
    const cisdX = bX(cisdIdx)
    const cisdY = sY(candles[cisdIdx].h) - 8
    ctx.fillStyle = '#00FF41'; ctx.font = 'bold 8px JetBrains Mono'; ctx.textAlign = 'center'
    ctx.fillText('CISD ↑', cisdX, cisdY)
    ctx.strokeStyle = 'rgba(0,255,65,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([3,3])
    ctx.beginPath(); ctx.moveTo(cisdX, cisdY + 3); ctx.lineTo(cisdX, sY(candles[cisdIdx].h)); ctx.stroke()
    ctx.setLineDash([])
  }

  // ── AI Analysis ──
  async function runAnalysis() {
    setAiLoading(true)
    setAiOutput('')
    const setup = selectedSetup ?? (setups.length > 0 ? setups[0] : null)
    if (!setup) { setAiLoading(false); return }

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: setup.symbol,
          timeframe: setup.timeframe,
          currentPrice: prices[setup.symbol as keyof typeof prices],
          recentAction: `SSL swept at ${setup.stop_loss.toFixed(2)}. CISD forming. Price at ${prices[setup.symbol as keyof typeof prices]}.`,
          htfContext: `Daily + 4H bullish. OB at ${setup.entry_low.toFixed(2)} holding. Bias aligned.`,
          keyLevels: `Entry: ${setup.entry_low.toFixed(2)}–${setup.entry_high.toFixed(2)} | SL: ${setup.stop_loss.toFixed(2)} | TP: ${setup.target.toFixed(2)} | DOL: ${setup.dol_target}`,
          setupId: setup.id,
        }),
      })
      const data = await res.json()
      setAiOutput(data.analysis || 'No response from AI.')
    } catch (e) {
      setAiOutput('Connection error. Check API key in Vercel env vars.')
    }
    setAiLoading(false)
  }

  // ── Helpers ──
  const dirColor = (d: Direction) => d === 'bull' ? '#00FF41' : d === 'bear' ? '#EF4444' : '#22D3EE'
  const dirBg = (d: Direction) => d === 'bull' ? 'rgba(0,255,65,0.1)' : d === 'bear' ? 'rgba(239,68,68,0.1)' : 'rgba(34,211,238,0.1)'
  const scoreColor = (s: number) => s >= 75 ? '#00FF41' : s >= 55 ? '#F59E0B' : '#EF4444'

  const filteredSetups = setups.filter(s => {
    if (scannerFilter === 'bull') return s.direction === 'bull'
    if (scannerFilter === 'bear') return s.direction === 'bear'
    if (scannerFilter === 'inversion') return s.direction === 'inversion'
    if (scannerFilter === 'high') return s.confluence_score >= 75
    return true
  })

  const filteredKB = kbSearch
    ? KB_CARDS.filter(k => k.title.toLowerCase().includes(kbSearch.toLowerCase()) || k.body.toLowerCase().includes(kbSearch.toLowerCase()) || k.tags.some(t => t.toLowerCase().includes(kbSearch.toLowerCase())))
    : KB_CARDS

  const formatAI = (text: string) => text.split('\n').map((line, i) => {
    const headers = ['BIAS:','DOL:','SETUP TYPE:','PHASE:','ENTRY LOGIC:','CONFLUENCE FACTORS:','INVALIDATION:','RISK NOTE:','VERDICT:']
    const hdr = headers.find(h => line.startsWith(h))
    if (hdr) {
      const rest = line.replace(hdr, '').trim()
      const col = hdr === 'VERDICT:' || hdr === 'BIAS:' ? '#00FF41' : hdr === 'INVALIDATION:' ? '#EF4444' : '#e8e8e8'
      return <div key={i}><div style={{fontSize:8,letterSpacing:'0.12em',color:'#00FF41',textTransform:'uppercase',marginTop:10,marginBottom:3}}>{hdr.replace(':','')}</div><div style={{fontSize:10,color:col,lineHeight:1.6}}>{rest}</div></div>
    }
    if (line.startsWith('-')) return <div key={i} style={{fontSize:10,color:'#555',paddingLeft:10,lineHeight:1.7}}>{line}</div>
    if (!line.trim()) return <div key={i} style={{height:4}} />
    return <div key={i} style={{fontSize:10,color:'#777',lineHeight:1.6}}>{line}</div>
  })

  // ── Styles ──
  const S = {
    app: { display:'grid', height:'100vh', gridTemplateRows:'42px 1fr 30px', gridTemplateColumns:'220px 1fr 340px' } as React.CSSProperties,
    topbar: { gridColumn:'1/-1', gridRow:'1', background:'#0a0a0a', borderBottom:'1px solid #222', display:'flex', alignItems:'center', padding:'0 16px', gap:16, zIndex:100 } as React.CSSProperties,
    sidebar: { gridColumn:'1', gridRow:'2', background:'#0a0a0a', borderRight:'1px solid #222', overflowY:'auto' as const, display:'flex', flexDirection:'column' as const },
    main: { gridColumn:'2', gridRow:'2', overflow:'hidden', display:'flex', flexDirection:'column' as const, background:'#000' },
    right: { gridColumn:'3', gridRow:'2', background:'#0a0a0a', borderLeft:'1px solid #222', overflowY:'auto' as const, display:'flex', flexDirection:'column' as const },
    statusBar: { gridColumn:'1/-1', gridRow:'3', background:'#0a0a0a', borderTop:'1px solid #222', display:'flex', alignItems:'center', padding:'0 16px', gap:20, fontSize:10, color:'#555' },
    navItem: (active: boolean) => ({ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', cursor:'pointer', borderLeft:`2px solid ${active ? '#00FF41' : 'transparent'}`, background: active ? 'rgba(0,255,65,0.06)' : 'transparent', color: active ? '#00FF41' : '#666', fontSize:11, transition:'all .12s' } as React.CSSProperties),
    tab: (active: boolean) => ({ padding:'0 18px', height:36, display:'flex', alignItems:'center', fontSize:10, letterSpacing:'0.06em', color: active ? '#00FF41' : '#666', cursor:'pointer', borderBottom:`2px solid ${active ? '#00FF41' : 'transparent'}`, whiteSpace:'nowrap' as const }),
    sectionHdr: { padding:'10px 14px', fontSize:9, letterSpacing:'0.1em', color:'#666', textTransform:'uppercase' as const, display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #222' },
    tag: (c: string, bg: string) => ({ display:'inline-block', fontSize:8, padding:'2px 6px', letterSpacing:'0.06em', color:c, background:bg, border:`1px solid ${c}44` } as React.CSSProperties),
    ctBtn: (active: boolean) => ({ fontSize:9, padding:'3px 8px', border:`1px solid ${active ? '#00FF41' : '#222'}`, color: active ? '#00FF41' : '#666', cursor:'pointer', background: active ? 'rgba(0,255,65,0.08)' : 'transparent', letterSpacing:'0.04em' } as React.CSSProperties),
  }

  const topSetup = setups[0]
  const bullSetups = setups.filter(s => s.direction === 'bull').length
  const bestScore = setups.length > 0 ? setups[0].confluence_score : 0

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
        <div style={{width:1,height:22,background:'#222',margin:'0 4px'}} />
        <div style={{display:'flex',gap:20,flex:1,overflow:'hidden'}}>
          {[{sym:'ES1!',price:prices.ES.toFixed(2),ch:'+12.75',up:true},{sym:'NQ1!',price:prices.NQ.toFixed(2),ch:'+48.25',up:true},{sym:'DXY',price:'104.23',ch:'-0.18',up:false},{sym:'VIX',price:'13.42',ch:'-0.38',up:false}].map(t=>(
            <div key={t.sym} style={{display:'flex',gap:6,fontSize:10,alignItems:'center'}}>
              <span style={{color:'#555'}}>{t.sym}</span>
              <span style={{fontWeight:600}}>{t.price}</span>
              <span style={{color:t.up?'#00FF41':'#EF4444'}}>{t.ch}</span>
            </div>
          ))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12,marginLeft:'auto'}}>
          <div style={{fontSize:9,padding:'2px 8px',border:'1px solid #F59E0B',color:'#F59E0B',letterSpacing:'0.06em'}}>{session}</div>
          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,color:'#00FF41',letterSpacing:'0.1em'}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:'#00FF41'}} className="animate-pulse-dot"/>LIVE
          </div>
          <div style={{fontSize:10,color:'#555'}}>{time}</div>
        </div>
      </div>

      {/* SIDEBAR */}
      <div style={S.sidebar}>
        <div style={{borderBottom:'1px solid #222'}}>
          <div style={{fontSize:9,letterSpacing:'0.12em',color:'#333',padding:'10px 14px 6px',textTransform:'uppercase'}}>Navigation</div>
          {(['dashboard','chart','scanner','knowledge','backtest'] as View[]).map(v=>(
            <div key={v} style={S.navItem(view===v)} onClick={()=>setView(v)}>
              {v.charAt(0).toUpperCase()+v.slice(1)}
              {v==='scanner'&&<span style={{marginLeft:'auto',fontSize:9,padding:'1px 5px',background:'rgba(245,158,11,0.15)',color:'#F59E0B',border:'1px solid rgba(245,158,11,0.3)'}}>{setups.length}</span>}
              {v==='dashboard'&&<span style={{marginLeft:'auto',fontSize:9,padding:'1px 5px',background:'rgba(239,68,68,0.12)',color:'#EF4444',border:'1px solid rgba(239,68,68,0.3)'}}>{alerts.length}</span>}
              {v==='chart'&&<span style={{marginLeft:'auto',fontSize:9,padding:'1px 5px',background:'rgba(0,255,65,0.08)',color:'#00FF41',border:'1px solid rgba(0,255,65,0.2)'}}>LIVE</span>}
            </div>
          ))}
        </div>
        {[{sym:'ES1! · E-MINI S&P',k:'ES',price:prices.ES,dol:'5,920'},{sym:'NQ1! · E-MINI NQ',k:'NQ',price:prices.NQ,dol:'20,750'}].map(m=>(
          <div key={m.k} style={{margin:10,background:'#111',border:'1px solid #222',padding:10}}>
            <div style={{fontSize:10,color:'#555',marginBottom:4}}>{m.sym}</div>
            <div style={{fontSize:18,fontWeight:700,lineHeight:1}}>{m.price.toFixed(2)}</div>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <span style={S.tag('#00FF41','rgba(0,255,65,0.1)')}>BULLISH</span>
              <span style={{fontSize:9,color:'#555'}}>DOL: {m.dol}</span>
            </div>
          </div>
        ))}
        <div style={{padding:'0 10px 10px'}}>
          <div style={{fontSize:9,color:'#333',letterSpacing:'0.1em',textTransform:'uppercase',padding:'8px 4px'}}>Active Alerts</div>
          {alerts.length > 0 ? alerts.slice(0,3).map((a,i)=>(
            <div key={a.id} style={{padding:8,marginBottom:4,borderLeft:`2px solid ${a.severity==='critical'?'#EF4444':a.severity==='warning'?'#F59E0B':'#00FF41'}`,background:a.severity==='critical'?'rgba(239,68,68,0.06)':a.severity==='warning'?'rgba(245,158,11,0.08)':'rgba(0,255,65,0.05)'}}>
              <div style={{fontSize:9,color:'#555'}}>{a.symbol} {a.timeframe}</div>
              <div style={{fontSize:10,color:'#ccc',marginTop:2}}>{a.message}</div>
              <div style={{fontSize:9,color:'#333',marginTop:3}}>{new Date(a.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false})} ET</div>
            </div>
          )) : (
            <div style={{fontSize:10,color:'#444',padding:'4px'}}>No active alerts</div>
          )}
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

          {/* DASHBOARD */}
          {view==='dashboard'&&(
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:1,background:'#222'}}>
                {[
                  {label:'Active Setups',value:setups.length.toString(),sub:`ES(${setups.filter(s=>s.symbol==='ES').length}) · NQ(${setups.filter(s=>s.symbol==='NQ').length}) · ${Array.from(new Set(setups.map(s=>s.timeframe))).length} TFs`,color:'#F59E0B'},
                  {label:'Best Confluence',value:`${bestScore}/100`,sub:`${topSetup?.symbol??'—'} ${topSetup?.timeframe??''} · ${topSetup?.setup_type??'Loading...'}`,color:'#00FF41'},
                  {label:'HTF Bias',value:'BULLISH',sub:'Daily · 4H · 1H aligned',color:'#00FF41'},
                ].map((k,i)=>(
                  <div key={i} style={{background:'#0a0a0a',padding:'16px 18px'}}>
                    <div style={{fontSize:9,letterSpacing:'0.1em',color:'#555',textTransform:'uppercase',marginBottom:8}}>{k.label}</div>
                    <div style={{fontSize:24,fontWeight:700,fontFamily:'Syne,sans-serif',color:k.color}}>{k.value}</div>
                    <div style={{fontSize:10,color:'#555',marginTop:4}}>{k.sub}</div>
                  </div>
                ))}
              </div>

              <div style={{padding:'12px 14px',borderBottom:'1px solid #222',fontSize:9,letterSpacing:'0.1em',color:'#555',textTransform:'uppercase',background:'#0a0a0a'}}>
                Active Setups — Live from Supabase
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                <thead>
                  <tr>{['Symbol','TF','Setup Type','Dir','Confluence','DOL Target','Status'].map(h=>(
                    <th key={h} style={{textAlign:'left',fontSize:9,color:'#444',letterSpacing:'0.08em',padding:'8px 14px',borderBottom:'1px solid #1a1a1a',fontWeight:500,textTransform:'uppercase'}}>{h}</th>
                  ))}</tr>
                </thead>
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
                          <div style={{width:60,height:3,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}><div style={{width:`${s.confluence_score}%`,height:'100%',background:scoreColor(s.confluence_score),borderRadius:1}}/></div>
                          <span style={{fontSize:9,color:scoreColor(s.confluence_score)}}>{s.confluence_score}</span>
                        </div>
                      </td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a',color:s.direction==='bull'?'#00FF41':'#EF4444'}}>{s.dol_target}</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1a1a'}}><span style={S.tag(s.confluence_score>=75?'#00FF41':'#F59E0B',s.confluence_score>=75?'rgba(0,255,65,0.08)':'rgba(245,158,11,0.08)')}>{s.confluence_score>=75?'ENTRY ZONE':'WATCHING'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{padding:'12px 14px',borderBottom:'1px solid #222',fontSize:9,letterSpacing:'0.1em',color:'#555',textTransform:'uppercase',background:'#0a0a0a',marginTop:1}}>
                {topSetup?`5-Question DOL — ${topSetup.symbol} ${topSetup.timeframe} (top setup)`:'DOL Framework'}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:'#222'}}>
                <div style={{background:'#0a0a0a',padding:16}}>
                  {topSetup?[
                    ['Q1','Delivering FROM:',`${topSetup.direction==='bull'?'Discount':'Premium'} PD Array zone`],
                    ['Q2','CISD occurred at:',`${topSetup.timeframe} — ${topSetup.direction} confirmed`],
                    ['Q3','Price currently:',`${prices[topSetup.symbol as keyof typeof prices]?.toFixed(2)} — retracing to entry`],
                    ['Q4','Arrays respected:',`${topSetup.setup_type.split('+').map(s=>s.trim()).join(', ')}`],
                    ['Q5','Delivering TO:',topSetup.dol_target],
                  ].map(([n,q,a])=>(
                    <div key={n as string} style={{display:'flex',gap:10,marginBottom:6,fontSize:9}}>
                      <span style={{color:'#00FF41',minWidth:20}}>{n}</span>
                      <span style={{color:'#555'}}>{q}</span>
                      <span style={{color:'#ccc',fontWeight:500}}>{a}</span>
                    </div>
                  )):(
                    <div style={{fontSize:10,color:'#444'}}>Loading DOL analysis...</div>
                  )}
                </div>
                <div style={{background:'#0a0a0a',padding:16}}>
                  <div style={{fontSize:9,color:'#555',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:10}}>MMXM Phase</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:10}}>
                    {[{label:'ACCUMULATE',done:true,active:false},{label:'MANIPULATE',done:true,active:false},{label:'DISTRIBUTE',done:false,active:true}].map(p=>(
                      <div key={p.label} style={{padding:8,border:`1px solid ${p.active?'#F59E0B':'#222'}`,background:p.active?'rgba(245,158,11,0.08)':'#111',textAlign:'center'}}>
                        <div style={{fontSize:8,color:p.active?'#F59E0B':'#444',marginBottom:4}}>{p.label}</div>
                        <div style={{fontSize:10,color:p.active?'#F59E0B':'#555'}}>{p.active?'NOW ↑':'✓ Done'}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:9,color:'#555',lineHeight:1.7}}>
                    {topSetup?`SSL sweep at ${topSetup.stop_loss.toFixed(2)} complete. ${topSetup.direction==='bull'?'Bullish':'Bearish'} CISD confirmed. Targeting ${topSetup.dol_target}.`:'Loading analysis...'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CHART */}
          {view==='chart'&&(
            <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',borderBottom:'1px solid #222',background:'#0a0a0a',flexWrap:'wrap'}}>
                <span style={{fontSize:9,color:'#444'}}>SYMBOL</span>
                {['ES','NQ'].map(s=><button key={s} style={S.ctBtn(activeAsset===s)} onClick={()=>{setActiveAsset(s);chartData.current=[];setTimeout(drawChart,80)}}>{s}</button>)}
                <div style={{width:1,height:16,background:'#222'}}/>
                <span style={{fontSize:9,color:'#444'}}>TF</span>
                {['5m','15m','1H','4H','D'].map(t=><button key={t} style={S.ctBtn(t==='1H')}>{t}</button>)}
                <div style={{width:1,height:16,background:'#222'}}/>
                <span style={{fontSize:9,color:'#444',fontStyle:'italic'}}>
                  {selectedSetup?`${selectedSetup.symbol} ${selectedSetup.timeframe} · ${selectedSetup.setup_type}`:'Select a setup from dashboard'}
                </span>
                <button style={{...S.ctBtn(false),color:'#00FF41',borderColor:'rgba(0,255,65,0.4)',marginLeft:'auto'}} onClick={()=>{chartData.current=[];setTimeout(drawChart,80)}}>↺ REFRESH</button>
              </div>
              <div style={{flex:1,position:'relative',background:'#000',overflow:'hidden'}}>
                <canvas ref={chartRef} style={{display:'block',width:'100%',height:'100%'}}/>
                <div style={{position:'absolute',top:8,left:75,fontSize:10,color:'#444',fontFamily:'JetBrains Mono,monospace'}}>
                  {activeAsset} · 1H · {new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                </div>
                {selectedSetup&&(
                  <div style={{position:'absolute',top:8,right:85,fontSize:9,fontFamily:'JetBrains Mono,monospace',textAlign:'right',lineHeight:1.8}}>
                    <div style={{color:'#F59E0B'}}>ENTRY {selectedSetup.entry_low.toFixed(0)}–{selectedSetup.entry_high.toFixed(0)}</div>
                    <div style={{color:'#EF4444'}}>SL {selectedSetup.stop_loss.toFixed(0)}</div>
                    <div style={{color:'#00FF41'}}>DOL {selectedSetup.target.toFixed(0)}</div>
                    <div style={{color:'#00FF41'}}>{selectedSetup.rr_ratio.toFixed(1)}R</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SCANNER */}
          {view==='scanner'&&(
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{display:'flex',gap:8,padding:'12px 14px',borderBottom:'1px solid #222',flexWrap:'wrap'}}>
                {[['all','ALL'],['bull','BULLISH'],['bear','BEARISH'],['inversion','INVERSION'],['high','HIGH CONF 75+']].map(([f,l])=>(
                  <button key={f} style={S.ctBtn(scannerFilter===f)} onClick={()=>setScannerFilter(f)}>{l}</button>
                ))}
                <span style={{marginLeft:'auto',fontSize:9,color:'#444',padding:'3px 0'}}>{filteredSetups.length} setups · Supabase live</span>
              </div>
              {filteredSetups.length===0?(
                <div style={{padding:'24px 14px',color:'#444',fontSize:10}}>No setups match this filter. Live data from Supabase.</div>
              ):filteredSetups.map(s=>(
                <div key={s.id} style={{padding:'12px 14px',borderBottom:'1px solid #1a1a1a',cursor:'pointer'}} onClick={()=>{setSelectedSetup(s)}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <span style={{fontSize:13,fontWeight:700,fontFamily:'Syne,sans-serif'}}>{s.symbol}</span>
                    <span style={{fontSize:9,color:'#555'}}>{s.timeframe}</span>
                    <span style={S.tag(dirColor(s.direction),dirBg(s.direction))}>{s.direction.toUpperCase()}</span>
                    <span style={{marginLeft:'auto',fontSize:9,color:'#444'}}>{new Date(s.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false})}</span>
                  </div>
                  <div style={{fontSize:11,color:'#ccc',marginBottom:4}}>{s.setup_type}</div>
                  <div style={{fontSize:9,color:'#555',marginBottom:8,lineHeight:1.7}}>
                    Entry: {s.entry_low.toFixed(2)}–{s.entry_high.toFixed(2)} · SL: {s.stop_loss.toFixed(2)} · TP: {s.target.toFixed(2)} · R:R {s.rr_ratio.toFixed(1)}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={S.tag('#F59E0B','rgba(245,158,11,0.1)')}>DOL: {s.dol_target}</span>
                    <span style={{fontSize:9,color:'#555'}}>Confluence: <span style={{color:scoreColor(s.confluence_score)}}>{s.confluence_score}/100</span></span>
                    <div style={{width:60,height:3,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}>
                      <div style={{width:`${s.confluence_score}%`,height:'100%',background:scoreColor(s.confluence_score)}}/>
                    </div>
                    {s.ai_analysis&&<span style={{fontSize:9,padding:'1px 5px',background:'rgba(0,255,65,0.08)',color:'#00FF41',border:'1px solid rgba(0,255,65,0.2)'}}>AI ✓</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* KNOWLEDGE */}
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
              <div style={{padding:'12px 14px',borderTop:'1px solid #222',fontSize:9,letterSpacing:'0.1em',color:'#555',textTransform:'uppercase',background:'#0a0a0a'}}>Critical Trading Rules — From Videos</div>
              {RULES.map(r=>(
                <div key={r.num} style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid #1a1a1a'}}>
                  <span style={{fontSize:9,color:'#00FF41',minWidth:24}}>{r.num}</span>
                  <span style={{fontSize:10,color:'#666',lineHeight:1.6}} dangerouslySetInnerHTML={{__html:r.text}}/>
                </div>
              ))}
            </div>
          )}

          {/* BACKTEST */}
          {view==='backtest'&&(
            <div style={{height:'100%',overflowY:'auto'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:1,background:'#222'}}>
                {[{label:'Win Rate',val:'68.4%',color:'#00FF41'},{label:'Avg R:R',val:'2.87',color:'#00FF41'},{label:'Profit Factor',val:'2.14',color:'#00FF41'},{label:'Max Drawdown',val:'-8.3%',color:'#EF4444'}].map(s=>(
                  <div key={s.label} style={{background:'#0a0a0a',padding:14}}>
                    <div style={{fontSize:9,color:'#444',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:6}}>{s.label}</div>
                    <div style={{fontSize:22,fontWeight:700,fontFamily:'Syne,sans-serif',color:s.color}}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{padding:'12px 14px',borderBottom:'1px solid #222',fontSize:9,color:'#555',textTransform:'uppercase',letterSpacing:'0.1em',background:'#0a0a0a'}}>Trade History</div>
              {TRADES.map((t,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderBottom:'1px solid #1a1a1a',fontSize:10}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:t.result==='win'?'#00FF41':'#EF4444',flexShrink:0}}/>
                  <span style={{fontSize:9,color:'#444',minWidth:80}}>{t.date}</span>
                  <span style={{fontWeight:700,color:'#e8e8e8',minWidth:30}}>{t.sym}</span>
                  <span style={{color:'#666',flex:1}}>{t.type}</span>
                  <span style={{color:'#555',fontSize:9}}>In: {t.entry}</span>
                  <span style={{color:'#EF4444',fontSize:9,margin:'0 8px'}}>SL: {t.sl}</span>
                  <span style={{color:'#00FF41',fontSize:9}}>TP: {t.tp}</span>
                  <span style={{fontWeight:700,fontSize:11,minWidth:40,textAlign:'right',color:t.result==='win'?'#00FF41':'#EF4444'}}>{t.rr}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* RIGHT PANEL */}
      <div style={S.right}>
        <div style={{borderBottom:'1px solid #222'}}>
          <div style={S.sectionHdr}><span>Asset Focus</span></div>
          <div style={{display:'flex',gap:6,padding:'8px 14px'}}>
            {['NQ','ES'].map(a=>(
              <button key={a} style={{flex:1,padding:6,border:`1px solid ${activeAsset===a?'#00FF41':'#222'}`,background:activeAsset===a?'rgba(0,255,65,0.08)':'transparent',color:activeAsset===a?'#00FF41':'#555',fontFamily:'JetBrains Mono,monospace',fontSize:10,cursor:'pointer'}} onClick={()=>setActiveAsset(a)}>{a}</button>
            ))}
          </div>
        </div>

        <div style={{borderBottom:'1px solid #222'}}>
          <div style={S.sectionHdr}><span>Multi-TF Bias</span></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,padding:'10px 14px'}}>
            {[{tf:'DAILY',bias:'BULLISH',note:'Above 4H OB',bull:true},{tf:'4 HOUR',bias:'BULLISH',note:'CISD confirmed',bull:true},{tf:'1 HOUR',bias:'BULLISH',note:'OB entry forming',bull:true},{tf:'15 MIN',bias:'PULLBACK',note:'Into discount',bull:false}].map(m=>(
              <div key={m.tf} style={{border:'1px solid #222',padding:8,background:'#111'}}>
                <div style={{fontSize:9,color:'#555',letterSpacing:'0.06em'}}>{m.tf}</div>
                <div style={{fontSize:11,fontWeight:600,color:m.bull?'#00FF41':'#F59E0B',marginTop:3}}>{m.bias}</div>
                <div style={{fontSize:9,color:'#444',marginTop:3}}>{m.note}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{borderBottom:'1px solid #222'}}>
          <div style={S.sectionHdr}><span>Confluence Score</span></div>
          <div style={{padding:'10px 14px'}}>
            {[{name:'HTF Bias',pct:100,score:20},{name:'CISD Confirm',pct:100,score:20},{name:'PD Array',pct:85,score:17},{name:'DOL Clarity',pct:75,score:15},{name:'SSL Swept',pct:100,score:15}].map(c=>(
              <div key={c.name} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,fontSize:9}}>
                <span style={{color:'#555',minWidth:85}}>{c.name}</span>
                <div style={{flex:1,height:4,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}>
                  <div style={{width:`${c.pct}%`,height:'100%',background:c.pct>=80?'#00FF41':'#F59E0B',borderRadius:1}}/>
                </div>
                <span style={{color:'#ccc',minWidth:20,textAlign:'right'}}>{c.score}</span>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',marginTop:10,paddingTop:8,borderTop:'1px solid #222'}}>
              <span style={{fontSize:9,color:'#555',letterSpacing:'0.08em'}}>TOTAL CONFLUENCE</span>
              <span style={{fontSize:22,fontWeight:700,color:'#00FF41',fontFamily:'Syne,sans-serif'}}>{topSetup?.confluence_score??87}</span>
            </div>
          </div>
        </div>

        <div style={{borderBottom:'1px solid #222'}}>
          <div style={S.sectionHdr}><span>Trade Parameters</span></div>
          <div style={{padding:'10px 14px'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
              {[
                {label:'Entry Zone',val:selectedSetup?`${selectedSetup.entry_low.toFixed(0)}–${selectedSetup.entry_high.toFixed(0)}`:(topSetup?`${topSetup.entry_low.toFixed(0)}–${topSetup.entry_high.toFixed(0)}`:'Loading...'),color:'#F59E0B'},
                {label:'Stop Loss',val:selectedSetup?selectedSetup.stop_loss.toFixed(0):(topSetup?.stop_loss.toFixed(0)??'—'),color:'#EF4444'},
                {label:'Target (DOL)',val:selectedSetup?selectedSetup.target.toFixed(0):(topSetup?.target.toFixed(0)??'—'),color:'#00FF41'},
                {label:'Risk : Reward',val:selectedSetup?`${selectedSetup.rr_ratio.toFixed(1)}R`:(topSetup?`${topSetup.rr_ratio.toFixed(1)}R`:'—'),color:'#00FF41'},
                {label:'Setup Type',val:selectedSetup?.setup_type.split(' ').slice(0,2).join(' ')??(topSetup?.setup_type.split(' ').slice(0,2).join(' ')??'—'),color:'#888'},
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
          <div style={S.sectionHdr}>
            <span>AI Analyst</span>
            <span style={{color:aiLoading?'#F59E0B':aiOutput?'#00FF41':'#555',fontSize:9}}>{aiLoading?'Generating...':aiOutput?'Complete':'Ready'}</span>
          </div>
          <div style={{flex:1,padding:'12px 14px',fontSize:10,lineHeight:1.8,color:'#666',overflowY:'auto'}}>
            {aiLoading?(
              <span>Analyzing {selectedSetup?.symbol??topSetup?.symbol??'NQ'} {selectedSetup?.timeframe??topSetup?.timeframe??'15m'}...<span className="animate-blink" style={{display:'inline-block',width:8,height:12,background:'#00FF41',verticalAlign:'middle',marginLeft:4}}/></span>
            ):aiOutput?(
              formatAI(aiOutput)
            ):(
              <span style={{color:'#444'}}>Select a setup from Dashboard or Scanner, then click Run Analysis for full SMC reasoning.</span>
            )}
          </div>
          <button onClick={runAnalysis} disabled={aiLoading||setups.length===0}
            style={{margin:'12px 14px',padding:10,background:'transparent',border:'1px solid #00FF41',color:'#00FF41',fontFamily:'JetBrains Mono,monospace',fontSize:10,letterSpacing:'0.1em',cursor:aiLoading?'not-allowed':'pointer',opacity:aiLoading||setups.length===0?0.4:1,textTransform:'uppercase',transition:'all .2s'}}>
            ⬡ RUN AI ANALYSIS
          </button>
        </div>
      </div>

      {/* STATUS BAR */}
      <div style={S.statusBar}>
        {[{l:'Data Feed OK',c:'#00FF41'},{l:'AI Engine Online',c:'#00FF41'},{l:'Scanner Running',c:'#F59E0B'},{l:dbStatus,c:dbStatus==='DB Connected'?'#00FF41':dbStatus==='Connecting...'?'#F59E0B':'#EF4444'}].map(s=>(
          <div key={s.l} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:4,height:4,borderRadius:'50%',background:s.c}}/>
            {s.l}
          </div>
        ))}
        <div style={{marginLeft:'auto',display:'flex',gap:16}}>
          <span>ES: {prices.ES.toFixed(2)}</span>
          <span>NQ: {prices.NQ.toFixed(2)}</span>
          <span>Supabase: {setups.length} setups</span>
          <span>{time}</span>
        </div>
      </div>

    </div>
  )
}
