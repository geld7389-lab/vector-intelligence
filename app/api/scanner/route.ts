import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { detectSetup, detectOrderBlocks, detectFVGs, detectLiquidityPools, detectCISD } from '@/lib/smc-engine'

// Simulated market data fetcher
// In production: replace with Polygon.io / Databento / Alpaca WebSocket
async function fetchOHLCV(symbol: string, timeframe: string) {
  // Mock realistic data — replace with real API call
  const base = symbol === 'NQ' ? 20415 : 5847
  const candles = []
  let price = base * 0.97

  for (let i = 0; i < 100; i++) {
    const open = price
    const change = (Math.random() - 0.47) * (symbol === 'NQ' ? 15 : 5)
    const close = open + change
    const high = Math.max(open, close) + Math.random() * (symbol === 'NQ' ? 8 : 3)
    const low = Math.min(open, close) - Math.random() * (symbol === 'NQ' ? 8 : 3)
    candles.push({
      time: Date.now() - (100 - i) * 60000,
      open, high, low, close,
    })
    price = close
  }
  return candles
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbols = (searchParams.get('symbols') ?? 'NQ,ES').split(',')
  const timeframes = (searchParams.get('timeframes') ?? '15m,1H,4H').split(',')

  const detectedSetups = []
  const alerts = []

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      const candles = await fetchOHLCV(symbol, timeframe)

      // Run full SMC detection
      const obs = detectOrderBlocks(candles)
      const fvgs = detectFVGs(candles)
      const pools = detectLiquidityPools(candles)
      const cisdEvents = detectCISD(candles)

      // Try bullish setup
      const bullSetup = detectSetup(candles, 'bull')
      if (bullSetup && bullSetup.confluenceScore >= 55) {
        const setupRecord = {
          symbol,
          timeframe,
          setup_type: bullSetup.setupType,
          direction: 'bull' as const,
          confluence_score: bullSetup.confluenceScore,
          entry_low: bullSetup.entryZone.low,
          entry_high: bullSetup.entryZone.high,
          stop_loss: bullSetup.stopLoss,
          target: bullSetup.target,
          rr_ratio: bullSetup.rrRatio,
          status: 'active' as const,
          dol_target: bullSetup.dol.targetLiquidity,
          ai_analysis: null,
        }

        // Upsert to Supabase
        const { data } = await supabase
          .from('setups')
          .upsert(setupRecord, { onConflict: 'symbol,timeframe,setup_type' })
          .select()

        detectedSetups.push({ ...setupRecord, id: data?.[0]?.id })

        if (bullSetup.confluenceScore >= 75) {
          alerts.push({
            symbol,
            timeframe,
            alert_type: 'high_confluence_setup',
            message: `HIGH CONF (${bullSetup.confluenceScore}/100): ${bullSetup.setupType} on ${symbol} ${timeframe}`,
            severity: 'critical' as const,
            is_read: false,
          })
        }
      }

      // Try bearish setup
      const bearSetup = detectSetup(candles, 'bear')
      if (bearSetup && bearSetup.confluenceScore >= 55) {
        detectedSetups.push({
          symbol,
          timeframe,
          setup_type: bearSetup.setupType,
          direction: 'bear',
          confluence_score: bearSetup.confluenceScore,
          entry_low: bearSetup.entryZone.low,
          entry_high: bearSetup.entryZone.high,
          stop_loss: bearSetup.stopLoss,
          target: bearSetup.target,
          rr_ratio: bearSetup.rrRatio,
          dol_target: bearSetup.dol.targetLiquidity,
        })
      }
    }
  }

  // Insert alerts
  if (alerts.length > 0) {
    await supabase.from('scanner_alerts').insert(alerts)
  }

  return NextResponse.json({
    setups: detectedSetups,
    scanned: symbols.length * timeframes.length,
    timestamp: new Date().toISOString(),
  })
}
