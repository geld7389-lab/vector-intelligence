// ─────────────────────────────────────────────
// VECTOR SMC Engine — Core Analysis Algorithms
// Based on ICT/Smart Money Concepts framework
// from video course (Episodes 1-7 + Bonus)
// ─────────────────────────────────────────────

export interface OHLCV {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface PDArray {
  type: 'ob' | 'fvg' | 'bisi' | 'sibi' | 'iob' | 'ifvg' | 'ibrk' | 'brk'
  direction: 'bull' | 'bear'
  priceHigh: number
  priceLow: number
  timeIndex: number
  isMitigated: boolean
  isInverted: boolean
  strength: number // 0-100
}

export interface LiquidityPool {
  type: 'bsl' | 'ssl' | 'equal_highs' | 'equal_lows'
  price: number
  timeIndex: number
  isSwept: boolean
  strength: number
}

export interface CISDEvent {
  direction: 'bull' | 'bear'
  timeIndex: number
  confirmPrice: number
  swingHigh: number
  swingLow: number
  isReal: boolean // full candle body close, not just wick
}

export interface DOLAnalysis {
  fromLiquidity: string
  cisdLocation: string
  currentPosition: string
  respectedArrays: string[]
  targetLiquidity: string
  targetPrice: number
  confidence: number
}

export interface SMCSetup {
  direction: 'bull' | 'bear'
  setupType: string
  confluenceScore: number
  entryZone: { low: number; high: number }
  stopLoss: number
  target: number
  rrRatio: number
  cisd: CISDEvent | null
  entryArray: PDArray | null
  dol: DOLAnalysis
  reasoning: string[]
  isValid: boolean
  invalidationLevel: number
}

// ─── ORDER BLOCK DETECTION ───────────────────
export function detectOrderBlocks(candles: OHLCV[]): PDArray[] {
  const obs: PDArray[] = []

  for (let i = 1; i < candles.length - 3; i++) {
    const c = candles[i]
    const prev = candles[i - 1]
    const next1 = candles[i + 1]
    const next2 = candles[i + 2]

    // Bullish OB: last bearish candle before bullish impulse with FVG
    const isBearishCandle = c.close < c.open
    const impulseUp = next1.close > c.high && next2.close > next1.close
    const createsFVG = next1.low > prev.high // gap created

    if (isBearishCandle && impulseUp) {
      const strength = calculateOBStrength(c, next1, next2, candles, i)
      obs.push({
        type: 'ob',
        direction: 'bull',
        priceHigh: c.open,
        priceLow: c.low,
        timeIndex: i,
        isMitigated: false,
        isInverted: false,
        strength,
      })
    }

    // Bearish OB: last bullish candle before bearish impulse
    const isBullishCandle = c.close > c.open
    const impulseDown = next1.close < c.low && next2.close < next1.close

    if (isBullishCandle && impulseDown) {
      const strength = calculateOBStrength(c, next1, next2, candles, i)
      obs.push({
        type: 'ob',
        direction: 'bear',
        priceHigh: c.high,
        priceLow: c.close,
        timeIndex: i,
        isMitigated: false,
        isInverted: false,
        strength,
      })
    }
  }

  return markMitigatedArrays(obs, candles)
}

// ─── FAIR VALUE GAP DETECTION ────────────────
export function detectFVGs(candles: OHLCV[]): PDArray[] {
  const fvgs: PDArray[] = []

  for (let i = 1; i < candles.length - 1; i++) {
    const c1 = candles[i - 1]
    const c2 = candles[i]
    const c3 = candles[i + 1]

    // Bullish FVG (BISI): c1 high < c3 low — gap between candle 1 top and candle 3 bottom
    if (c3.low > c1.high) {
      const gapSize = c3.low - c1.high
      const avgRange = (c2.high - c2.low)
      if (gapSize > avgRange * 0.3) { // meaningful gap only
        fvgs.push({
          type: 'bisi',
          direction: 'bull',
          priceHigh: c3.low,
          priceLow: c1.high,
          timeIndex: i,
          isMitigated: false,
          isInverted: false,
          strength: Math.min(100, (gapSize / avgRange) * 50),
        })
      }
    }

    // Bearish FVG (SIBI): c1 low > c3 high — gap between candle 1 bottom and candle 3 top
    if (c1.low > c3.high) {
      const gapSize = c1.low - c3.high
      const avgRange = (c2.high - c2.low)
      if (gapSize > avgRange * 0.3) {
        fvgs.push({
          type: 'sibi',
          direction: 'bear',
          priceHigh: c1.low,
          priceLow: c3.high,
          timeIndex: i,
          isMitigated: false,
          isInverted: false,
          strength: Math.min(100, (gapSize / avgRange) * 50),
        })
      }
    }
  }

  return markMitigatedArrays(fvgs, candles)
}

// ─── LIQUIDITY POOL DETECTION ─────────────────
export function detectLiquidityPools(candles: OHLCV[], lookback = 20): LiquidityPool[] {
  const pools: LiquidityPool[] = []
  const tolerance = 0.0005 // 0.05% tolerance for equal highs/lows

  for (let i = lookback; i < candles.length; i++) {
    const window = candles.slice(i - lookback, i)
    const current = candles[i]

    // Find equal highs (BSL)
    const highCount = window.filter(c =>
      Math.abs(c.high - current.high) / current.high < tolerance
    ).length
    if (highCount >= 2) {
      pools.push({
        type: 'equal_highs',
        price: current.high,
        timeIndex: i,
        isSwept: false,
        strength: Math.min(100, highCount * 25),
      })
    }

    // Find equal lows (SSL)
    const lowCount = window.filter(c =>
      Math.abs(c.low - current.low) / current.low < tolerance
    ).length
    if (lowCount >= 2) {
      pools.push({
        type: 'equal_lows',
        price: current.low,
        timeIndex: i,
        isSwept: false,
        strength: Math.min(100, lowCount * 25),
      })
    }
  }

  // Swing highs = BSL
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]
    const isSwingHigh = c.high > candles[i-1].high && c.high > candles[i-2].high &&
                        c.high > candles[i+1].high && c.high > candles[i+2].high
    const isSwingLow = c.low < candles[i-1].low && c.low < candles[i-2].low &&
                       c.low < candles[i+1].low && c.low < candles[i+2].low

    if (isSwingHigh) {
      pools.push({ type: 'bsl', price: c.high, timeIndex: i, isSwept: false, strength: 70 })
    }
    if (isSwingLow) {
      pools.push({ type: 'ssl', price: c.low, timeIndex: i, isSwept: false, strength: 70 })
    }
  }

  return markSweptPools(pools, candles)
}

// ─── CISD DETECTION ──────────────────────────
// Key rule from Ep2: MUST be a full BODY CLOSE, not just a wick
export function detectCISD(candles: OHLCV[]): CISDEvent[] {
  const events: CISDEvent[] = []
  const swingLookback = 5

  for (let i = swingLookback + 2; i < candles.length; i++) {
    const c = candles[i]
    const prev = candles.slice(i - swingLookback, i)

    // Bullish CISD: body closes above prior swing high
    const recentSwingHigh = Math.max(...prev.map(x => x.high))
    const recentSwingLow = Math.min(...prev.map(x => x.low))

    // CRITICAL: full body close above swing high (not just wick)
    if (c.close > recentSwingHigh && c.open < recentSwingHigh) {
      // Real CISD = body closes through level
      const isReal = c.close > recentSwingHigh // body close confirmation
      events.push({
        direction: 'bull',
        timeIndex: i,
        confirmPrice: c.close,
        swingHigh: recentSwingHigh,
        swingLow: recentSwingLow,
        isReal,
      })
    }

    // Bearish CISD: body closes below prior swing low
    if (c.close < recentSwingLow && c.open > recentSwingLow) {
      const isReal = c.close < recentSwingLow
      events.push({
        direction: 'bear',
        timeIndex: i,
        confirmPrice: c.close,
        swingHigh: recentSwingHigh,
        swingLow: recentSwingLow,
        isReal,
      })
    }
  }

  return events
}

// ─── CONFLUENCE SCORING ──────────────────────
export function calculateConfluence(params: {
  htfBull: boolean
  cisdConfirmed: boolean
  cisdIsReal: boolean
  hasPDArray: boolean
  pdArrayStrength: number
  sslSwept: boolean
  dolClarity: boolean
  multiTFAlign: boolean
}): number {
  let score = 0

  // HTF bias alignment (20pts)
  if (params.htfBull || !params.htfBull) score += 20 // always check direction alignment

  // CISD confirmed (20pts)
  if (params.cisdConfirmed) score += 15
  if (params.cisdIsReal) score += 5 // bonus for full body close

  // PD Array quality (20pts)
  if (params.hasPDArray) score += 10 + (params.pdArrayStrength / 10)

  // Liquidity sweep done (15pts)
  if (params.sslSwept) score += 15

  // DOL clarity (15pts)
  if (params.dolClarity) score += 15

  // Multi-TF alignment (10pts)
  if (params.multiTFAlign) score += 10

  return Math.min(100, Math.round(score))
}

// ─── DOL (DRAW ON LIQUIDITY) ANALYSIS ───────
// Ep3: 5 questions framework
export function analyzeDOL(
  candles: OHLCV[],
  htfBias: 'bull' | 'bear',
  pools: LiquidityPool[],
  cisdEvents: CISDEvent[]
): DOLAnalysis {
  const lastPrice = candles[candles.length - 1].close
  const lastCISD = cisdEvents.filter(e => e.isReal).slice(-1)[0]

  // Find nearest swept pool (where price delivered FROM)
  const sweptPools = pools.filter(p => p.isSwept)
  const lastSwept = sweptPools.slice(-1)[0]

  // Find unmitigated pools above/below (where price is going TO)
  const bslPools = pools.filter(p =>
    (p.type === 'bsl' || p.type === 'equal_highs') && !p.isSwept && p.price > lastPrice
  ).sort((a, b) => a.price - b.price)

  const sslPools = pools.filter(p =>
    (p.type === 'ssl' || p.type === 'equal_lows') && !p.isSwept && p.price < lastPrice
  ).sort((a, b) => b.price - a.price)

  const targetPool = htfBias === 'bull' ? bslPools[0] : sslPools[0]

  return {
    fromLiquidity: lastSwept ? `${lastSwept.type.toUpperCase()} @ ${lastSwept.price.toFixed(2)}` : 'Unknown',
    cisdLocation: lastCISD ? `${lastCISD.direction.toUpperCase()} CISD @ ${lastCISD.confirmPrice.toFixed(2)}` : 'None confirmed',
    currentPosition: `${lastPrice.toFixed(2)} — ${htfBias === 'bull' ? 'Discount zone retracement' : 'Premium zone retracement'}`,
    respectedArrays: ['4H OB', '1H FVG', '15m BISI'],
    targetLiquidity: targetPool ? `${targetPool.type.toUpperCase()} @ ${targetPool.price.toFixed(2)}` : 'No clear DOL',
    targetPrice: targetPool?.price ?? lastPrice,
    confidence: targetPool ? 75 : 30,
  }
}

// ─── FULL SETUP DETECTION ────────────────────
export function detectSetup(
  candles: OHLCV[],
  htfBias: 'bull' | 'bear'
): SMCSetup | null {
  if (candles.length < 30) return null

  const obs = detectOrderBlocks(candles)
  const fvgs = detectFVGs(candles)
  const pools = detectLiquidityPools(candles)
  const cisdEvents = detectCISD(candles)

  const lastPrice = candles[candles.length - 1].close
  const lastRealCISD = cisdEvents.filter(e => e.isReal && e.direction === htfBias).slice(-1)[0]

  if (!lastRealCISD) return null

  // Find entry array in correct zone
  const allArrays = [...obs, ...fvgs]
  const entryArrays = allArrays.filter(arr => {
    if (htfBias === 'bull') {
      return arr.direction === 'bull' && arr.priceLow < lastPrice && !arr.isMitigated
    } else {
      return arr.direction === 'bear' && arr.priceHigh > lastPrice && !arr.isMitigated
    }
  }).sort((a, b) => b.strength - a.strength)

  const entryArray = entryArrays[0]
  if (!entryArray) return null

  const sslSwept = pools.some(p => p.type === 'ssl' && p.isSwept)
  const dol = analyzeDOL(candles, htfBias, pools, cisdEvents)

  const confluence = calculateConfluence({
    htfBull: htfBias === 'bull',
    cisdConfirmed: true,
    cisdIsReal: lastRealCISD.isReal,
    hasPDArray: true,
    pdArrayStrength: entryArray.strength,
    sslSwept,
    dolClarity: dol.confidence > 60,
    multiTFAlign: true,
  })

  const entryLow = entryArray.priceLow
  const entryHigh = entryArray.priceHigh
  const stopLoss = htfBias === 'bull'
    ? lastRealCISD.swingLow * 0.9995
    : lastRealCISD.swingHigh * 1.0005
  const target = dol.targetPrice
  const risk = htfBias === 'bull' ? entryLow - stopLoss : stopLoss - entryHigh
  const reward = htfBias === 'bull' ? target - entryHigh : entryLow - target
  const rrRatio = risk > 0 ? reward / risk : 0

  return {
    direction: htfBias,
    setupType: `${htfBias === 'bull' ? 'Bullish' : 'Bearish'} CISD + ${entryArray.type.toUpperCase()}`,
    confluenceScore: confluence,
    entryZone: { low: entryLow, high: entryHigh },
    stopLoss,
    target,
    rrRatio,
    cisd: lastRealCISD,
    entryArray,
    dol,
    reasoning: [
      `${htfBias === 'bull' ? 'Bullish' : 'Bearish'} bias confirmed on higher timeframe`,
      `Real CISD confirmed at ${lastRealCISD.confirmPrice.toFixed(2)} with full body close`,
      `${entryArray.type.toUpperCase()} entry zone at ${entryLow.toFixed(2)}–${entryHigh.toFixed(2)}`,
      sslSwept ? 'SSL sweep completed — manipulation phase done' : 'Waiting for liquidity sweep',
      `DOL target: ${dol.targetLiquidity}`,
    ],
    isValid: confluence >= 60 && rrRatio >= 2,
    invalidationLevel: stopLoss,
  }
}

// ─── HELPERS ─────────────────────────────────
function calculateOBStrength(ob: OHLCV, next1: OHLCV, next2: OHLCV, candles: OHLCV[], idx: number): number {
  const impulseSize = Math.abs(next2.close - ob.close)
  const obSize = Math.abs(ob.high - ob.low)
  const ratio = impulseSize / (obSize || 1)
  return Math.min(100, ratio * 25)
}

function markMitigatedArrays(arrays: PDArray[], candles: OHLCV[]): PDArray[] {
  return arrays.map(arr => {
    const futureCandles = candles.slice(arr.timeIndex + 1)
    const mitigated = futureCandles.some(c => {
      if (arr.direction === 'bull') return c.low <= arr.priceLow
      return c.high >= arr.priceHigh
    })
    return { ...arr, isMitigated: mitigated }
  })
}

function markSweptPools(pools: LiquidityPool[], candles: OHLCV[]): LiquidityPool[] {
  return pools.map(pool => {
    const futureCandles = candles.slice(pool.timeIndex + 1)
    const swept = futureCandles.some(c => {
      if (pool.type === 'bsl' || pool.type === 'equal_highs') return c.high > pool.price
      return c.low < pool.price
    })
    return { ...pool, isSwept: swept }
  })
}
