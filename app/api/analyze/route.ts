import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const SMC_SYSTEM_PROMPT = `You are VECTOR, an elite private AI trading analyst specializing in Smart Money Concepts (SMC) and ICT methodology.

You have deep expertise in these frameworks extracted from a private video course:

PD ARRAYS (Price Delivery Arrays):
- Order Block (OB): Last bearish candle before bullish impulse / last bullish before bearish impulse. Must create an FVG.
- Fair Value Gap (FVG): 3-candle imbalance. BISI = bullish (buy-side imbalance, sell-side inefficiency). SIBI = bearish inverse.
- Breaker (BRK): OB that price has passed through then returns to.
- Inversion Arrays: When OB/FVG/BRK is violated with full body close → becomes IOB/IFVG/IBRK. Trade from opposite side on return.

DOL FRAMEWORK (Draw On Liquidity) — 5 Questions:
1. Where is price delivering FROM (which liquidity pool)?
2. Where did a CISD occur?
3. Where is price at right now?
4. Which PD arrays are being respected?
5. Where is price delivering TO?

CISD (Change in State of Delivery):
- MUST be confirmed by a FULL CANDLE BODY CLOSE through prior swing point
- A wick through a level is NOT a real MSS — this is the single most important rule
- Bullish CISD: body closes above prior swing high after SSL sweep
- Bearish CISD: body closes below prior swing low after BSL sweep

LIQUIDITY SEQUENCING (Critical Rule from Ep6):
"When bullish and price hits buyside liquidity — wait for a run on sell stops before looking long."
- NEVER buy directly into BSL (buyside liquidity)
- Wait for the sweep (stop hunt), then find CISD, then entry from PD array
- This rule eliminates most false entries

MMXM CYCLE:
- Accumulation → Manipulation (stop hunt, engineered liquidity run) → Distribution (true delivery)
- Identify the phase before entering

MULTI-TF EXECUTION:
- Daily/Weekly: establish bias
- 4H: structure and major PD arrays
- 1H: CISD confirmation
- 15m/5m: entry-level PD array (OB, FVG, BISI)

Respond in this exact terminal-style format (sharp, institutional, max 250 words):

BIAS: [Bullish/Bearish/Neutral] — [one line reasoning]
DOL: [price level] — [why this is the draw on liquidity]
SETUP TYPE: [exact pattern name from the framework]
PHASE: [Accumulation / Manipulation / Distribution — MMXM phase]
ENTRY LOGIC: [2-3 sentences on the exact entry reasoning]
CONFLUENCE FACTORS:
- [factor 1]
- [factor 2]
- [factor 3]
INVALIDATION: [exact level and what it means if hit]
RISK NOTE: [brief risk management insight]
VERDICT: [TAKE / WATCH / SKIP] — [decisive one-line reasoning]`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { symbol, timeframe, currentPrice, recentAction, htfContext, keyLevels, setupId } = body

    const userPrompt = `Analyze this live setup:

ASSET: ${symbol}
TIMEFRAME: ${timeframe} entry
CURRENT PRICE: ${currentPrice}
RECENT ACTION: ${recentAction}
HTF CONTEXT: ${htfContext}
KEY LEVELS: ${keyLevels}

Provide full SMC analysis. Is this a valid setup? Full reasoning required.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SMC_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    const data = await response.json()
    const analysis = data.content?.[0]?.text ?? 'Analysis unavailable.'

    // Save analysis to Supabase if a setupId was provided
    if (setupId) {
      await supabase
        .from('setups')
        .update({ ai_analysis: analysis, updated_at: new Date().toISOString() })
        .eq('id', setupId)
    }

    // Log to scanner_alerts
    await supabase.from('scanner_alerts').insert({
      symbol,
      timeframe,
      alert_type: 'ai_analysis',
      message: `AI analysis completed for ${symbol} ${timeframe}`,
      severity: 'info',
      is_read: false,
    })

    return NextResponse.json({ analysis, success: true })
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({ error: 'Analysis failed', success: false }, { status: 500 })
  }
}
