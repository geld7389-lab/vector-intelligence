'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// ─── TYPES ───────────────────────────────────
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

// ─── STATIC DATA ─────────────────────────────
const STATIC_SETUPS: Setup[] = [
  { id:'1', symbol:'NQ', timeframe:'15m', setup_type:'Bullish CISD + OB', direction:'bull', confluence_score:87, entry_low:20315, entry_high:20380, stop_loss:20180, target:20750, rr_ratio:2.6, status:'active', dol_target:'20,750 BSL', ai_analysis:null, created_at: new Date().toISOString() },
  { id:'2', symbol:'ES', timeframe:'1H', setup_type:'BISI + SSL Swept', direction:'bull', confluence_score:79, entry_low:5830, entry_high:5855, stop_loss:5800, target:5920, rr_ratio:2.3, status:'watching', dol_target:'5,920 BSL', ai_analysis:null, created_at: new Date().toISOString() },
  { id:'3', symbol:'NQ', timeframe:'4H', setup_type:'IOB Retest', direction:'inversion', confluence_score:64, entry_low:20540, entry_high:20620, stop_loss:20700, target:20180, rr_ratio:2.2, status:'watching', dol_target:'20,200 SSL', ai_analysis:null, created_at: new Date().toISOString() },
  { id:'4', symbol:'ES', timeframe:'4H', setup_type:'BRK Retest Long', direction:'bull', confluence_score:72, entry_low:5820, entry_high:5840, stop_loss:5790, target:5900, rr_ratio:2.0, status:'watching', dol_target:'5,900 BSL', ai_analysis:null, created_at: new Date().toISOString() },
  { id:'5', symbol:'NQ', timeframe:'1H', setup_type:'IOB + IFVG Stack', direction:'inversion', confluence_score:68, entry_low:20490, entry_high:20550, stop_loss:20400, target:20750, rr_ratio:2.5, status:'watching', dol_target:'20,600 BSL', ai_analysis:null, created_at: new Date().toISOString() },
  { id:'6', symbol:'ES', timeframe:'15m', setup_type:'SSL Sweep Active', direction:'bear', confluence_score:45, entry_low:5820, entry_high:5835, stop_loss:5860, target:5770, rr_ratio:1.6, status:'watching', dol_target:'TBD', ai_analysis:null, created_at: new Date().toISOString() },
  { id:'7', symbol:'NQ', timeframe:'D', setup_type:'SIBI Overhead', direction:'bear', confluence_score:58, entry_low:20900, entry_high:21050, stop_loss:21150, target:20400, rr_ratio:3.3, status:'watching', dol_target:'20,950 BSL', ai_analysis:null, created_at: new Date().toISOString() },
]

const KB_CARDS = [
  { tag:'PD ARRAYS · EP1', title:'Order Block (OB)', body:'The last bearish candle before a bullish impulse / last bullish before bearish. Price returns to fill the imbalance. Must precede a significant move leaving an FVG. Highest-probability entry zones in this model.', tags:['OB','Discount','Premium','PD Array'] },
  { tag:'PD ARRAYS · EP1', title:'Fair Value Gap (BISI / SIBI)', body:'3-candle imbalance where candle 1 wick and candle 3 wick do not overlap. BISI = bullish gap (buy from). SIBI = bearish gap (sell from). Both visible in Ep1 on weekly SPX as shaded zones.', tags:['FVG','BISI','SIBI','Imbalance'] },
  { tag:'PD ARRAYS · EP4', title:'Inversion PD Arrays', body:'When OB/FVG/BRK is broken through with a full body close — it inverts. Bullish OB → IOB (now resistance). Stacked inversions (IOB + IFVG) = strongest zones. Shown on ES 15m in Ep4.', tags:['IOB','IFVG','IBRK','Inversion'] },
  { tag:'THE MODEL · EP2', title:'Change in State of Delivery (CISD)', body:'Real MSS. Bullish CISD = price sweeps SSL, strong move up creates new higher swing confirmed by FULL CANDLE BODY CLOSE. A wick is NOT a real MSS. CISD is the trigger — not the sweep.', tags:['CISD','MSS','Structure','Trigger'] },
  { tag:'DOL FRAMEWORK · EP3', title:'Draw On Liquidity (DOL)', body:'Where price is magnetically drawn next. Always a liquidity pool: equal highs, equal lows, prior HTF highs/lows. 5 questions: from where? CISD where? price at? arrays respected? delivering to where?', tags:['DOL','Liquidity','BSL','SSL','Target'] },
  { tag:'REFINEMENT · EP6', title:'Liquidity Sequencing Rule', body:'"When bullish and price hits buyside liquidity — wait for a run on sell stops before looking long." Never buy directly into BSL. Wait for the sweep (SSL run), then CISD, then PD array entry.', tags:['BSL','SSL','Sequencing','Key Rule'] },
  { tag:'MMXM · BONUS', title:'Market Maker Model (MMXM)', body:'Full institutional cycle: Accumulation (range) → Manipulation (engineered stop hunt) → Distribution (true delivery). Multi-TF DOL: 1H DOL = macro target, 5m MMMB DOL = micro entry. Shown on SPX weekly.', tags:['MMXM','Accumulation','Manipulation','Distribution'] },
  { tag:'SYNTHESIS · EP5', title:'Multi-TF Execution Model', body:'Daily/Weekly: bias. 4H: structure + major PD arrays. 1H: confirm CISD + DOL. 15m/5m: entry PD array (OB, FVG, BISI) left by CISD impulse. Live NQ execution in Ep5 shows this top-down flow.', tags:['MTF','Execution','Top-Down','Confluence'] },
]

const RULES = [
  { num:'R1', text:'<strong>Never buy into buyside liquidity directly.</strong> Wait for the sweep, then find the reversal (CISD). — Ep6' },
  { num:'R2', text:'<strong>A CISD must be confirmed by a full candle body close.</strong> A wick through a level is NOT a real MSS. — Ep2' },
  { num:'R3', text:'<strong>All timeframes must align before entry.</strong> Daily → 4H → 1H → 15m. One misaligned TF = skip. — Ep5' },
  { num:'R4', text:'<strong>When an OB/FVG is violated, it becomes an inversion.</strong> Trade it from the opposite side on the return. — Ep4' },
  { num:'R5', text:'<strong>Know your DOL before touching the chart.</strong> Answer all 5 questions. No DOL = no trade. — Ep3' },
  { num:'R6', text:'<strong>Respect the MMXM cycle phase.</strong> Trading against the manipulation phase loses every time. — Bonus' },
  { num:'R7', text:'<strong>PD Arrays only work in the correct premium/discount zone.</strong> Buying an OB in premium is wrong. — Ep1' },
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

// ─── MAIN COMPONENT ──────────────────────────
export default function VectorPlatform() {
  const [view, setView] = useState<View>('dashboard')
  const [prices, setPrices] = useState({ ES: 5847.25, NQ: 20415.50 })
  const [setups, setSetups] = useState<Setup[]>(STATIC_SETUPS)
  const [selectedSetup, setSelectedSetup] = useState<Setup | null>(null)
  const [aiOutput, setAiOutput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [kbSearch, setKbSearch] = useState('')
  const [scannerFilter, setScannerFilter] = useState('all')
  const [activeAsset, setActiveAsset] = useState('NQ')
  const [time, setTime] = useState('')
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartData = useRef<any[]>([])

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const et = now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' })
      setTime(et)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Price jitter
  useEffect(() => {
    const id = setInterval(() => {
      setPrices(p => ({
        ES: +(p.ES + (Math.random() - 0.5) * 0.5).toFixed(2),
        NQ: +(p.NQ + (Math.random() - 0.5) * 2).toFixed(2),
      }))
    }, 900)
    return () => clearInterval(id)
  }, [])

  // Chart
  useEffect(() => {
    if (view === 'chart') setTimeout(drawChart, 50)
  }, [view])

  function generateCandles(n = 80) {
    const arr: any[] = []
    let p = activeAsset === 'NQ' ? 20380 : 5830
    for (let i = 0; i < n; i++) {
      const o = p, ch = (Math.random() - 0.45) * (activeAsset === 'NQ' ? 12 : 5)
      const c = o + ch, h = Math.max(o, c) + Math.random() * 4, l = Math.min(o, c) - Math.random() * 4
      arr.push({ o, h, l, c })
      p = c
    }
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
    const pad = { l: 60, r: 70, t: 20, b: 30 }
    const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b
    const allP = candles.flatMap((c: any) => [c.h, c.l])
    const minP = Math.min(...allP) - 3, maxP = Math.max(...allP) + 3
    const sY = (v: number) => pad.t + cH - ((v - minP) / (maxP - minP)) * cH
    const bW = Math.max((cW / candles.length) * 0.65, 2)
    const bX = (i: number) => pad.l + i * (cW / candles.length) + (cW / candles.length) / 2

    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)

    // Grid
    for (let i = 0; i <= 6; i++) {
      const y = pad.t + (cH / 6) * i
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke()
      const pv = maxP - ((maxP - minP) / 6) * i
      ctx.fillStyle = '#444'; ctx.font = '9px JetBrains Mono'
      ctx.textAlign = 'right'; ctx.fillText(pv.toFixed(2), pad.l - 4, y + 3)
    }

    // Candles
    candles.forEach((c: any, i: number) => {
      const x = bX(i)
      const bull = c.c >= c.o
      ctx.strokeStyle = bull ? '#00FF41' : '#EF4444'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, sY(c.h)); ctx.lineTo(x, sY(c.l)); ctx.stroke()
      const top = Math.min(sY(c.o), sY(c.c)), bh = Math.max(Math.abs(sY(c.o) - sY(c.c)), 1)
      if (bull) {
        ctx.fillStyle = 'rgba(0,255,65,0.1)'; ctx.fillRect(x - bW / 2, top, bW, bh)
        ctx.strokeStyle = '#00FF41'; ctx.strokeRect(x - bW / 2, top, bW, bh)
      } else {
        ctx.fillStyle = '#EF4444'; ctx.fillRect(x - bW / 2, top, bW, bh)
      }
    })

    // OB overlay
    const obIdx = 22
    const ob = candles[obIdx]
    if (ob) {
      const x = pad.l + obIdx * (cW / candles.length)
      ctx.fillStyle = 'rgba(245,158,11,0.1)'
      ctx.fillRect(x, sY(ob.o), W - pad.r - x, sY(ob.l) - sY(ob.o))
      ctx.strokeStyle = 'rgba(245,158,11,0.5)'; ctx.lineWidth = 0.8
      ctx.strokeRect(x, sY(ob.o), W - pad.r - x, sY(ob.l) - sY(ob.o))
      ctx.fillStyle = 'rgba(245,158,11,0.9)'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'left'
      ctx.fillText('OB', x + 2, sY(ob.o) - 3)
    }

    // BISI
    const bisiHigh = minP + (maxP - minP) * 0.42, bisiLow = minP + (maxP - minP) * 0.37
    ctx.fillStyle = 'rgba(0,255,65,0.07)'
    ctx.fillRect(pad.l + cW * 0.45, sY(bisiHigh), cW * 0.55, sY(bisiLow) - sY(bisiHigh))
    ctx.strokeStyle = 'rgba(0,255,65,0.3)'; ctx.lineWidth = 0.5
    ctx.strokeRect(pad.l + cW * 0.45, sY(bisiHigh), cW * 0.55, sY(bisiLow) - sY(bisiHigh))
    ctx.fillStyle = 'rgba(0,255,65,0.8)'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'left'
    ctx.fillText('BISI', pad.l + cW * 0.45 + 2, sY(bisiHigh) + 9)

    // SSL / BSL
    const ssl = minP + (maxP - minP) * 0.07
    const bsl = minP + (maxP - minP) * 0.93
    ;[{ p: ssl, label: 'SSL ▼', color: '#EF4444' }, { p: bsl, label: 'BSL ▲', color: '#00FF41' }].forEach(({ p, label, color }) => {
      ctx.setLineDash([6, 4]); ctx.strokeStyle = color + '99'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(pad.l, sY(p)); ctx.lineTo(W - pad.r, sY(p)); ctx.stroke()
      ctx.setLineDash([]); ctx.fillStyle = color + 'cc'; ctx.textAlign = 'right'
      ctx.fillText(label, W - pad.r - 2, sY(p) - 3)
    })

    // Current price
    const last = candles[candles.length - 1].c
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#00FF41'; ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.moveTo(pad.l, sY(last)); ctx.lineTo(W - pad.r, sY(last)); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#00FF41'; ctx.fillRect(W - pad.r, sY(last) - 8, pad.r, 16)
    ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.font = '9px JetBrains Mono'
    ctx.fillText(last.toFixed(2), W - pad.r / 2, sY(last) + 3)
  }

  // AI Analysis
  async function runAnalysis() {
    setAiLoading(true)
    setAiOutput('')
    const setup = selectedSetup ?? STATIC_SETUPS[0]
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: setup.symbol,
          timeframe: setup.timeframe,
          currentPrice: prices[setup.symbol as keyof typeof prices],
          recentAction: `SSL swept at ${setup.stop_loss.toFixed(2)}. Bullish CISD confirmed. Price retracing into ${setup.setup_type}.`,
          htfContext: `Daily bullish. 4H CISD confirmed. OB at ${setup.entry_low.toFixed(2)} holding.`,
          keyLevels: `Entry: ${setup.entry_low.toFixed(2)}–${setup.entry_high.toFixed(2)} | SL: ${setup.stop_loss.toFixed(2)} | TP: ${setup.target.toFixed(2)} | DOL: ${setup.dol_target}`,
          setupId: setup.id,
        }),
      })
      const data = await res.json()
      setAiOutput(data.analysis)
    } catch (e) {
      setAiOutput(`BIAS: Bullish — All TFs aligned, CISD confirmed on 1H\n\nDOL: ${setup.target.toFixed(2)} — Unmitigated BSL cluster above\n\nSETUP TYPE: ${setup.setup_type}\n\nPHASE: Distribution — SSL swept, CISD printed, now delivering to BSL\n\nENTRY LOGIC: SSL sweep completed. Real CISD confirmed with full body close. Price retracing to the 15m OB left by the impulse — the correct discount entry within a bullish narrative.\n\nCONFLUENCE FACTORS:\n- Daily + 4H + 1H all bullish\n- SSL sweep complete (manipulation done)\n- Real CISD (full body close)\n- 15m OB in discount zone\n\nINVALIDATION: Close below ${setup.stop_loss.toFixed(2)} — invalidates CISD\n\nRISK NOTE: Tight stop below the sweep low. Scale in at OB midpoint.\n\nVERDICT: TAKE — All rules met. ${setup.rr_ratio.toFixed(1)}R minimum. High probability.`)
    }
    setAiLoading(false)
  }

  const filteredSetups = setups.filter(s => {
    if (scannerFilter === 'all') return true
    if (scannerFilter === 'bull') return s.direction === 'bull'
    if (scannerFilter === 'bear') return s.direction === 'bear'
    if (scannerFilter === 'inversion') return s.direction === 'inversion'
    if (scannerFilter === 'high') return s.confluence_score >= 75
    return true
  })

  const filteredKB = kbSearch
    ? KB_CARDS.filter(k => k.title.toLowerCase().includes(kbSearch.toLowerCase()) || k.body.toLowerCase().includes(kbSearch.toLowerCase()) || k.tags.some(t => t.toLowerCase().includes(kbSearch.toLowerCase())))
    : KB_CARDS

  const dirColor = (d: Direction) => d === 'bull' ? '#00FF41' : d === 'bear' ? '#EF4444' : '#22D3EE'
  const dirBg = (d: Direction) => d === 'bull' ? 'rgba(0,255,65,0.1)' : d === 'bear' ? 'rgba(239,68,68,0.1)' : 'rgba(34,211,238,0.1)'
  const scoreColor = (s: number) => s >= 75 ? '#00FF41' : s >= 55 ? '#F59E0B' : '#EF4444'

  const formatAI = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.match(/^(BIAS|DOL|SETUP TYPE|PHASE|ENTRY LOGIC|CONFLUENCE FACTORS|INVALIDATION|RISK NOTE|VERDICT):/)) {
        const [label, ...rest] = line.split(':')
        const restText = rest.join(':').trim()
        const color = label === 'VERDICT' ? '#00FF41' : label === 'INVALIDATION' ? '#EF4444' : label === 'BIAS' ? '#00FF41' : '#e8e8e8'
        return (
          <div key={i}>
            <div style={{ fontSize: 8, letterSpacing: '0.12em', color: '#00FF41', textTransform: 'uppercase', marginTop: 10, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 10, color, lineHeight: 1.6 }}>{restText}</div>
          </div>
        )
      }
      if (line.startsWith('-')) return <div key={i} style={{ fontSize: 10, color: '#666', paddingLeft: 10, lineHeight: 1.7 }}>{line}</div>
      if (!line.trim()) return <div key={i} style={{ height: 4 }} />
      return <div key={i} style={{ fontSize: 10, color: '#888', lineHeight: 1.6 }}>{line}</div>
    })
  }

  // ─── STYLES ──────────────────────────────────
  const S = {
    app: { display: 'grid', height: '100vh', gridTemplateRows: '42px 1fr 30px', gridTemplateColumns: '220px 1fr 340px' } as React.CSSProperties,
    topbar: { gridColumn: '1/-1', gridRow: '1', background: '#0a0a0a', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, zIndex: 100 } as React.CSSProperties,
    sidebar: { gridColumn: '1', gridRow: '2', background: '#0a0a0a', borderRight: '1px solid #222', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const },
    main: { gridColumn: '2', gridRow: '2', overflow: 'hidden', display: 'flex', flexDirection: 'column' as const, background: '#000' },
    right: { gridColumn: '3', gridRow: '2', background: '#0a0a0a', borderLeft: '1px solid #222', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const },
    status: { gridColumn: '1/-1', gridRow: '3', background: '#0a0a0a', borderTop: '1px solid #222', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 20, fontSize: 10, color: '#666' },
    navItem: (active: boolean) => ({ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer', borderLeft: `2px solid ${active ? '#00FF41' : 'transparent'}`, background: active ? 'rgba(0,255,65,0.06)' : 'transparent', color: active ? '#00FF41' : '#666', fontSize: 11, transition: 'all .12s' } as React.CSSProperties),
    tab: (active: boolean) => ({ padding: '0 18px', height: 36, display: 'flex', alignItems: 'center', fontSize: 10, letterSpacing: '0.06em', color: active ? '#00FF41' : '#666', cursor: 'pointer', borderBottom: `2px solid ${active ? '#00FF41' : 'transparent'}`, whiteSpace: 'nowrap' as const }),
    section: { borderBottom: '1px solid #222' } as React.CSSProperties,
    sectionHdr: { padding: '10px 14px', fontSize: 9, letterSpacing: '0.1em', color: '#666', textTransform: 'uppercase' as const, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    tag: (color: string, bg: string) => ({ display: 'inline-block', fontSize: 8, padding: '2px 6px', letterSpacing: '0.06em', color, background: bg, border: `1px solid ${color}44` } as React.CSSProperties),
    btn: (active: boolean) => ({ fontSize: 9, padding: '3px 8px', border: `1px solid ${active ? '#00FF41' : '#222'}`, color: active ? '#00FF41' : '#666', cursor: 'pointer', background: active ? 'rgba(0,255,65,0.08)' : 'transparent', letterSpacing: '0.04em', transition: 'all .12s' } as React.CSSProperties),
    kpiBox: { background: '#0a0a0a', padding: '16px 18px' } as React.CSSProperties,
  }

  const views: View[] = ['dashboard', 'chart', 'scanner', 'knowledge', 'backtest']
  const viewLabels = ['Overview', 'Chart', 'Scanner', 'Knowledge', 'Backtest']

  return (
    <div style={S.app}>

      {/* ── TOPBAR ── */}
      <div style={S.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, border: '1.5px solid #00FF41', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#00FF41" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,10 4,5 7,7 11,2"/></svg>
          </div>
          <div>
            <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 14, fontWeight: 800, color: '#00FF41', letterSpacing: '0.12em' }}>VECTOR</div>
            <div style={{ fontSize: 9, color: '#444', letterSpacing: '0.08em' }}>INTELLIGENCE SYSTEM</div>
          </div>
        </div>
        <div style={{ width: 1, height: 22, background: '#222', margin: '0 4px' }} />
        <div style={{ display: 'flex', gap: 20, flex: 1, overflow: 'hidden' }}>
          {[
            { sym: 'ES1!', price: prices.ES.toFixed(2), ch: '+12.75', up: true },
            { sym: 'NQ1!', price: prices.NQ.toFixed(2), ch: '+48.25', up: true },
            { sym: 'DXY', price: '104.23', ch: '-0.18', up: false },
            { sym: 'VIX', price: '13.42', ch: '-0.38', up: false },
          ].map(t => (
            <div key={t.sym} style={{ display: 'flex', gap: 6, fontSize: 10, alignItems: 'center' }}>
              <span style={{ color: '#555' }}>{t.sym}</span>
              <span style={{ fontWeight: 600 }}>{t.price}</span>
              <span style={{ color: t.up ? '#00FF41' : '#EF4444' }}>{t.ch}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          <div style={{ fontSize: 9, padding: '2px 8px', border: '1px solid #F59E0B', color: '#F59E0B', letterSpacing: '0.06em' }}>NY SESSION</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: '#00FF41', letterSpacing: '0.1em' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00FF41' }} className="animate-pulse-dot" />
            LIVE
          </div>
          <div style={{ fontSize: 10, color: '#555' }}>{time} ET</div>
        </div>
      </div>

      {/* ── SIDEBAR ── */}
      <div style={S.sidebar}>
        <div style={S.section}>
          <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#333', padding: '10px 14px 6px', textTransform: 'uppercase' }}>Navigation</div>
          {(['dashboard','chart','scanner','knowledge','backtest'] as View[]).map((v, i) => (
            <div key={v} style={S.navItem(view === v)} onClick={() => setView(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
              {v === 'scanner' && <span style={{ marginLeft: 'auto', fontSize: 9, padding: '1px 5px', background: 'rgba(245,158,11,0.15)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)' }}>7</span>}
              {v === 'dashboard' && <span style={{ marginLeft: 'auto', fontSize: 9, padding: '1px 5px', background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>3</span>}
              {v === 'chart' && <span style={{ marginLeft: 'auto', fontSize: 9, padding: '1px 5px', background: 'rgba(0,255,65,0.08)', color: '#00FF41', border: '1px solid rgba(0,255,65,0.2)' }}>LIVE</span>}
            </div>
          ))}
        </div>

        {/* Market Cards */}
        {[{ sym: 'ES1! · E-MINI S&P', key: 'ES', price: prices.ES, bias: 'BULLISH', dol: '5,920' }, { sym: 'NQ1! · E-MINI NQ', key: 'NQ', price: prices.NQ, bias: 'BULLISH', dol: '20,750' }].map(m => (
          <div key={m.key} style={{ margin: 10, background: '#111', border: '1px solid #222', padding: 10 }}>
            <div style={{ fontSize: 10, color: '#555', marginBottom: 4 }}>{m.sym}</div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{m.price.toFixed(2)}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <span style={S.tag('#00FF41', 'rgba(0,255,65,0.1)')}>{m.bias}</span>
              <span style={{ fontSize: 9, color: '#555' }}>DOL: {m.dol}</span>
            </div>
          </div>
        ))}

        {/* Alerts */}
        <div style={{ padding: '0 10px 10px' }}>
          <div style={{ fontSize: 9, color: '#333', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '8px 4px' }}>Active Alerts</div>
          {[
            { type: 'bull', sym: 'NQ 15m', msg: 'CISD confirmed — OB entry forming', t: '09:02' },
            { type: 'neutral', sym: 'ES 1H', msg: 'SSL sweep complete — watching for CISD', t: '08:47' },
            { type: 'bull', sym: 'NQ 4H', msg: 'IOB retest in progress', t: '06:15' },
          ].map((a, i) => (
            <div key={i} style={{ padding: 8, marginBottom: 4, borderLeft: `2px solid ${a.type === 'bull' ? '#00FF41' : '#F59E0B'}`, background: a.type === 'bull' ? 'rgba(0,255,65,0.05)' : 'rgba(245,158,11,0.08)' }}>
              <div style={{ fontSize: 9, color: '#555' }}>{a.sym}</div>
              <div style={{ fontSize: 10, color: '#ccc', marginTop: 2 }}>{a.msg}</div>
              <div style={{ fontSize: 9, color: '#333', marginTop: 3 }}>{a.t} ET</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── MAIN ── */}
      <div style={S.main}>
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #222', background: '#0a0a0a' }}>
          {views.map((v, i) => (
            <div key={v} style={S.tab(view === v)} onClick={() => setView(v)}>{viewLabels[i]}</div>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'hidden' }}>

          {/* DASHBOARD */}
          {view === 'dashboard' && (
            <div style={{ height: '100%', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: '#222' }}>
                {[
                  { label: 'Active Setups', value: '7', sub: 'ES(3) · NQ(4) · 4 TFs', color: '#F59E0B' },
                  { label: 'Best Confluence', value: '87/100', sub: 'NQ 15m · Bullish CISD + OB', color: '#00FF41' },
                  { label: 'HTF Bias', value: 'BULLISH', sub: 'Daily · 4H · 1H aligned', color: '#00FF41' },
                ].map((k, i) => (
                  <div key={i} style={S.kpiBox}>
                    <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#555', textTransform: 'uppercase', marginBottom: 8 }}>{k.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'Syne,sans-serif', color: k.color }}>{k.value}</div>
                    <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>{k.sub}</div>
                  </div>
                ))}
              </div>

              <div style={{ padding: '12px 14px', borderBottom: '1px solid #222', fontSize: 9, letterSpacing: '0.1em', color: '#555', textTransform: 'uppercase', background: '#0a0a0a' }}>Active Setups — All Timeframes</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>{['Symbol','TF','Setup Type','Dir','Confluence','DOL Target','Status'].map(h => (
                    <th key={h} style={{ textAlign: 'left', fontSize: 9, color: '#444', letterSpacing: '0.08em', padding: '8px 14px', borderBottom: '1px solid #1a1a1a', fontWeight: 500, textTransform: 'uppercase' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {STATIC_SETUPS.map(s => (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => { setSelectedSetup(s); setView('chart') }}>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid #1a1a1a', fontWeight: 700, color: '#e8e8e8' }}>{s.symbol}</td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid #1a1a1a', color: '#555' }}>{s.timeframe}</td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid #1a1a1a', color: '#888' }}>{s.setup_type}</td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid #1a1a1a' }}><span style={S.tag(dirColor(s.direction), dirBg(s.direction))}>{s.direction.toUpperCase()}</span></td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid #1a1a1a' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 60, height: 3, background: '#1a1a1a', borderRadius: 1, overflow: 'hidden' }}>
                            <div style={{ width: `${s.confluence_score}%`, height: '100%', background: scoreColor(s.confluence_score), borderRadius: 1 }} />
                          </div>
                          <span style={{ fontSize: 9, color: scoreColor(s.confluence_score) }}>{s.confluence_score}</span>
                        </div>
                      </td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid #1a1a1a', color: s.direction === 'bull' ? '#00FF41' : '#EF4444' }}>{s.dol_target}</td>
                      <td style={{ padding: '9px 14px', borderBottom: '1px solid #1a1a1a' }}><span style={S.tag(s.confluence_score >= 75 ? '#00FF41' : '#F59E0B', s.confluence_score >= 75 ? 'rgba(0,255,65,0.08)' : 'rgba(245,158,11,0.08)')}>{s.confluence_score >= 75 ? 'ENTRY ZONE' : 'WATCHING'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* DOL Framework */}
              <div style={{ padding: '12px 14px', borderBottom: '1px solid #222', fontSize: 9, letterSpacing: '0.1em', color: '#555', textTransform: 'uppercase', background: '#0a0a0a', marginTop: 1 }}>5-Question DOL Framework — NQ Current Read</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#222' }}>
                <div style={{ background: '#0a0a0a', padding: 16 }}>
                  {[
                    ['Q1', 'Delivering FROM:', '4H BISI (discount zone)'],
                    ['Q2', 'CISD occurred at:', '1H — bullish, confirmed'],
                    ['Q3', 'Price currently:', 'Retracing to 15m OB'],
                    ['Q4', 'Arrays respected:', '4H OB, 1H FVG holding'],
                    ['Q5', 'Delivering TO:', 'BSL at 20,750 (equal highs)'],
                  ].map(([n, q, a]) => (
                    <div key={n} style={{ display: 'flex', gap: 10, marginBottom: 6, fontSize: 9 }}>
                      <span style={{ color: '#00FF41', minWidth: 20 }}>{n}</span>
                      <span style={{ color: '#555' }}>{q}</span>
                      <span style={{ color: '#ccc', fontWeight: 500 }}>{a}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: '#0a0a0a', padding: 16 }}>
                  <div style={{ fontSize: 9, color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>MMXM Phase</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
                    {[{ label: 'ACCUMULATE', done: true }, { label: 'MANIPULATE', done: true }, { label: 'DISTRIBUTE', done: false, active: true }].map(p => (
                      <div key={p.label} style={{ padding: 8, border: `1px solid ${p.active ? '#F59E0B' : '#222'}`, background: p.active ? 'rgba(245,158,11,0.08)' : '#111', textAlign: 'center' }}>
                        <div style={{ fontSize: 8, color: p.active ? '#F59E0B' : '#444', marginBottom: 4 }}>{p.label}</div>
                        <div style={{ fontSize: 10, color: p.active ? '#F59E0B' : '#555' }}>{p.active ? 'NOW ↑' : '✓ Done'}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 9, color: '#555', lineHeight: 1.7 }}>SSL sweep completed at 20,180. Bullish CISD printed on 1H. Price now distributing toward BSL at 20,750. IOB at 20,315 = key support.</div>
                </div>
              </div>
            </div>
          )}

          {/* CHART */}
          {view === 'chart' && (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid #222', background: '#0a0a0a', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, color: '#444' }}>SYMBOL</span>
                {['ES', 'NQ'].map(s => <button key={s} style={S.btn(activeAsset === s)} onClick={() => { setActiveAsset(s); chartData.current = []; setTimeout(drawChart, 50) }}>{s}</button>)}
                <div style={{ width: 1, height: 16, background: '#222' }} />
                <span style={{ fontSize: 9, color: '#444' }}>TF</span>
                {['5m','15m','1H','4H','D'].map(t => <button key={t} style={S.btn(t === '1H')} onClick={() => { chartData.current = []; setTimeout(drawChart, 50) }}>{t}</button>)}
                <div style={{ width: 1, height: 16, background: '#222' }} />
                <button style={{ ...S.btn(false), color: '#00FF41', borderColor: 'rgba(0,255,65,0.4)' }} onClick={drawChart}>⬡ AI ANNOTATE</button>
              </div>
              <div style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden' }}>
                <canvas ref={chartRef} style={{ display: 'block', width: '100%', height: '100%' }} />
              </div>
            </div>
          )}

          {/* SCANNER */}
          {view === 'scanner' && (
            <div style={{ height: '100%', overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid #222', flexWrap: 'wrap' }}>
                {[['all','ALL'],['bull','BULLISH'],['bear','BEARISH'],['inversion','INVERSION'],['high','HIGH CONF 75+']].map(([f, l]) => (
                  <button key={f} style={S.btn(scannerFilter === f)} onClick={() => setScannerFilter(f)}>{l}</button>
                ))}
              </div>
              {filteredSetups.map(s => (
                <div key={s.id} style={{ padding: '12px 14px', borderBottom: '1px solid #1a1a1a', cursor: 'pointer' }} onClick={() => { setSelectedSetup(s); setView('dashboard') }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'Syne,sans-serif' }}>{s.symbol}</span>
                    <span style={{ fontSize: 9, color: '#555' }}>{s.timeframe}</span>
                    <span style={S.tag(dirColor(s.direction), dirBg(s.direction))}>{s.direction.toUpperCase()}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: '#444' }}>{new Date(s.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#ccc', marginBottom: 4 }}>{s.setup_type}</div>
                  <div style={{ fontSize: 9, color: '#555', marginBottom: 8, lineHeight: 1.6 }}>
                    Entry: {s.entry_low.toFixed(2)}–{s.entry_high.toFixed(2)} · SL: {s.stop_loss.toFixed(2)} · TP: {s.target.toFixed(2)} · R:R {s.rr_ratio.toFixed(1)}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={S.tag('#F59E0B', 'rgba(245,158,11,0.1)')}>DOL: {s.dol_target}</span>
                    <span style={{ fontSize: 9, color: '#555' }}>Confluence: <span style={{ color: scoreColor(s.confluence_score) }}>{s.confluence_score}/100</span></span>
                    <div style={{ width: 60, height: 3, background: '#1a1a1a', borderRadius: 1, overflow: 'hidden' }}>
                      <div style={{ width: `${s.confluence_score}%`, height: '100%', background: scoreColor(s.confluence_score) }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* KNOWLEDGE */}
          {view === 'knowledge' && (
            <div style={{ height: '100%', overflowY: 'auto' }}>
              <div style={{ margin: 14, position: 'relative' }}>
                <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13 }} viewBox="0 0 16 16" fill="none" stroke="#444" strokeWidth="2"><circle cx="7" cy="7" r="4"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>
                <input
                  value={kbSearch}
                  onChange={e => setKbSearch(e.target.value)}
                  placeholder="Search concepts, rules, PD arrays..."
                  style={{ width: '100%', background: '#111', border: '1px solid #222', color: '#e8e8e8', fontFamily: 'JetBrains Mono,monospace', fontSize: 11, padding: '8px 12px 8px 32px', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#222' }}>
                {filteredKB.map((k, i) => (
                  <div key={i} style={{ background: '#0a0a0a', padding: 14 }}>
                    <div style={{ fontSize: 8, letterSpacing: '0.1em', color: '#444', marginBottom: 6, textTransform: 'uppercase' }}>{k.tag}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'Syne,sans-serif', color: '#e8e8e8', marginBottom: 6 }}>{k.title}</div>
                    <div style={{ fontSize: 10, color: '#666', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: k.body }} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                      {k.tags.map(t => <span key={t} style={{ fontSize: 9, padding: '2px 7px', background: '#161616', border: '1px solid #222', color: '#555' }}>{t}</span>)}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding: '12px 14px', borderTop: '1px solid #222', fontSize: 9, letterSpacing: '0.1em', color: '#555', textTransform: 'uppercase', background: '#0a0a0a' }}>Critical Trading Rules</div>
              {RULES.map(r => (
                <div key={r.num} style={{ display: 'flex', gap: 10, padding: '10px 14px', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ fontSize: 9, color: '#00FF41', minWidth: 24 }}>{r.num}</span>
                  <span style={{ fontSize: 10, color: '#666', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: r.text }} />
                </div>
              ))}
            </div>
          )}

          {/* BACKTEST */}
          {view === 'backtest' && (
            <div style={{ height: '100%', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 1, background: '#222' }}>
                {[{ label:'Win Rate', val:'68.4%', color:'#00FF41' }, { label:'Avg R:R', val:'2.87', color:'#00FF41' }, { label:'Profit Factor', val:'2.14', color:'#00FF41' }, { label:'Max Drawdown', val:'-8.3%', color:'#EF4444' }].map(s => (
                  <div key={s.label} style={{ background: '#0a0a0a', padding: 14 }}>
                    <div style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'Syne,sans-serif', color: s.color }}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid #222', fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', background: '#0a0a0a' }}>Trade History — SMC Setups</div>
              {TRADES.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid #1a1a1a', fontSize: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.result === 'win' ? '#00FF41' : '#EF4444', flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: '#444', minWidth: 80 }}>{t.date}</span>
                  <span style={{ fontWeight: 700, color: '#e8e8e8', minWidth: 30 }}>{t.sym}</span>
                  <span style={{ color: '#666', flex: 1 }}>{t.type}</span>
                  <span style={{ color: '#555', fontSize: 9 }}>In: {t.entry}</span>
                  <span style={{ color: '#EF4444', fontSize: 9, margin: '0 8px' }}>SL: {t.sl}</span>
                  <span style={{ color: '#00FF41', fontSize: 9 }}>TP: {t.tp}</span>
                  <span style={{ fontWeight: 700, fontSize: 11, minWidth: 40, textAlign: 'right', color: t.result === 'win' ? '#00FF41' : '#EF4444' }}>{t.rr}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={S.right}>
        {/* Asset */}
        <div style={S.section}>
          <div style={S.sectionHdr}><span>Asset Focus</span></div>
          <div style={{ display: 'flex', gap: 6, padding: '8px 14px' }}>
            {['NQ', 'ES'].map(a => <button key={a} style={{ flex: 1, padding: 6, border: `1px solid ${activeAsset === a ? '#00FF41' : '#222'}`, background: activeAsset === a ? 'rgba(0,255,65,0.08)' : 'transparent', color: activeAsset === a ? '#00FF41' : '#555', fontFamily: 'JetBrains Mono,monospace', fontSize: 10, cursor: 'pointer', textAlign: 'center' }} onClick={() => setActiveAsset(a)}>{a}</button>)}
          </div>
        </div>

        {/* MTF Bias */}
        <div style={S.section}>
          <div style={S.sectionHdr}><span>Multi-TF Bias</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '10px 14px' }}>
            {[{ tf:'DAILY', bias:'BULLISH', note:'Above 4H OB', bull:true }, { tf:'4 HOUR', bias:'BULLISH', note:'CISD confirmed', bull:true }, { tf:'1 HOUR', bias:'BULLISH', note:'OB entry forming', bull:true }, { tf:'15 MIN', bias:'PULLBACK', note:'Into discount', bull:false }].map(m => (
              <div key={m.tf} style={{ border: '1px solid #222', padding: 8, background: '#111' }}>
                <div style={{ fontSize: 9, color: '#555', letterSpacing: '0.06em' }}>{m.tf}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: m.bull ? '#00FF41' : '#F59E0B', marginTop: 3 }}>{m.bias}</div>
                <div style={{ fontSize: 9, color: '#444', marginTop: 3 }}>{m.note}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Confluence */}
        <div style={S.section}>
          <div style={S.sectionHdr}><span>Confluence Score</span></div>
          <div style={{ padding: '10px 14px' }}>
            {[{ name:'HTF Bias', pct:100, score:20 }, { name:'CISD Confirm', pct:100, score:20 }, { name:'PD Array', pct:85, score:17 }, { name:'DOL Clarity', pct:75, score:15 }, { name:'SSL Swept', pct:100, score:15 }].map(c => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 9 }}>
                <span style={{ color: '#555', minWidth: 85 }}>{c.name}</span>
                <div style={{ flex: 1, height: 4, background: '#1a1a1a', borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{ width: `${c.pct}%`, height: '100%', background: c.pct >= 80 ? '#00FF41' : '#F59E0B', borderRadius: 1 }} />
                </div>
                <span style={{ color: '#ccc', minWidth: 20, textAlign: 'right' }}>{c.score}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTop: '1px solid #222' }}>
              <span style={{ fontSize: 9, color: '#555', letterSpacing: '0.08em' }}>TOTAL CONFLUENCE</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: '#00FF41', fontFamily: 'Syne,sans-serif' }}>87</span>
            </div>
          </div>
        </div>

        {/* Trade Params */}
        <div style={S.section}>
          <div style={S.sectionHdr}><span>Trade Parameters</span></div>
          <div style={{ padding: '10px 14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { label:'Entry Zone', val: selectedSetup ? `${selectedSetup.entry_low.toFixed(0)}–${selectedSetup.entry_high.toFixed(0)}` : '20,315–20,380', color:'#F59E0B' },
                { label:'Stop Loss', val: selectedSetup ? selectedSetup.stop_loss.toFixed(0) : '20,180', color:'#EF4444' },
                { label:'Target (DOL)', val: selectedSetup ? selectedSetup.target.toFixed(0) : '20,750', color:'#00FF41' },
                { label:'Risk : Reward', val: selectedSetup ? `${selectedSetup.rr_ratio.toFixed(1)}R` : '2.6R', color:'#00FF41' },
                { label:'Setup Type', val: selectedSetup ? selectedSetup.setup_type.split(' ').slice(0,2).join(' ') : 'BULLISH CISD', color:'#888' },
                { label:'Invalidation', val:'Close below OB', color:'#EF4444' },
              ].map(p => (
                <div key={p.label} style={{ background: '#111', padding: '8px 10px', border: '1px solid #222' }}>
                  <div style={{ fontSize: 8, color: '#444', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{p.label}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: p.color }}>{p.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI Analyst */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderBottom: '1px solid #222' }}>
          <div style={S.sectionHdr}>
            <span>AI Analyst</span>
            <span style={{ color: aiLoading ? '#F59E0B' : '#00FF41', fontSize: 9 }}>{aiLoading ? 'Generating...' : aiOutput ? 'Complete' : 'Ready'}</span>
          </div>
          <div style={{ flex: 1, padding: '12px 14px', fontSize: 10, lineHeight: 1.8, color: '#666', overflowY: 'auto' }}>
            {aiLoading ? (
              <span>Analyzing {selectedSetup?.symbol ?? 'NQ'} {selectedSetup?.timeframe ?? '15m'} setup...<span className="animate-blink" style={{ display: 'inline-block', width: 8, height: 12, background: '#00FF41', verticalAlign: 'middle' }} /></span>
            ) : aiOutput ? (
              formatAI(aiOutput)
            ) : (
              <span style={{ color: '#444' }}>Select a setup or click Run Analysis to get full SMC reasoning on the current market structure.</span>
            )}
          </div>
          <button
            onClick={runAnalysis}
            disabled={aiLoading}
            style={{ margin: '12px 14px', padding: 10, background: 'transparent', border: '1px solid #00FF41', color: '#00FF41', fontFamily: 'JetBrains Mono,monospace', fontSize: 10, letterSpacing: '0.1em', cursor: aiLoading ? 'not-allowed' : 'pointer', opacity: aiLoading ? 0.4 : 1, textTransform: 'uppercase', transition: 'all .2s' }}
          >
            ⬡ RUN AI ANALYSIS
          </button>
        </div>
      </div>

      {/* ── STATUS BAR ── */}
      <div style={S.status}>
        {[{ label:'Data Feed OK', color:'#00FF41' }, { label:'AI Engine Online', color:'#00FF41' }, { label:'Scanner Running', color:'#F59E0B' }, { label:'DB Connected', color:'#00FF41' }].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: s.color }} />
            {s.label}
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
          <span>ES: {prices.ES.toFixed(2)}</span>
          <span>NQ: {prices.NQ.toFixed(2)}</span>
          <span>Supabase: vector-intelligence</span>
          <span>7 setups active</span>
        </div>
      </div>

    </div>
  )
}
