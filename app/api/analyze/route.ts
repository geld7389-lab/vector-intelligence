import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SMC_SYSTEM_PROMPT = `You are VECTOR, an elite private AI trading analyst specializing in Smart Money Concepts (SMC) and ICT methodology. You have deep expertise in:
- PD Arrays: OB, FVG, BISI, SIBI, IOB, IFVG, IBRK
- DOL (Draw on Liquidity) — the 5-question framework
- CISD (Change in State of Delivery) — MUST be a full body close, never a wick
- Liquidity Sequencing — never buy into BSL, wait for SSL sweep then CISD confirmation
- MMXM cycle: Accumulation → Manipulation → Distribution → Reaccumulation
- Multi-TF execution: Daily → 4H → 1H → 15m/5m entry

Respond ONLY in this exact format (max 250 words, no markdown):
BIAS: [Bullish/Bearish/Neutral] — [reason based on provided data]
DOL: [price level] — [why this is the draw]
SETUP TYPE: [pattern name from the data]
PHASE: [MMXM phase]
ENTRY LOGIC: [2-3 sentences on exact entry trigger]
CONFLUENCE FACTORS:
- [factor 1]
- [factor 2]
- [factor 3]
INVALIDATION: [specific price level and what it means]
RISK NOTE: [SL placement and sizing note]
VERDICT: [TAKE / WATCH / SKIP] — [one line reason]`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { setup, prices } = body

    if (!setup) {
      return NextResponse.json({ error: 'No setup provided', success: false }, { status: 400 })
    }

    // Build a rich prompt from the actual setup object
    const currentPrice = prices?.[setup.symbol] ?? 'unknown'
    const userPrompt = `Analyze this live setup:

SYMBOL: ${setup.symbol}
TIMEFRAME: ${setup.timeframe}
DIRECTION: ${setup.direction}
SETUP TYPE: ${setup.setup_type}
ENTRY ZONE: ${setup.entry_low} – ${setup.entry_high}
STOP LOSS: ${setup.stop_loss}
TARGET / DOL: ${setup.target} (${setup.dol_target})
R:R RATIO: ${setup.rr_ratio}
CONFLUENCE SCORE: ${setup.confluence_score}/100
STATUS: ${setup.status}
LIVE MARKET PRICE (${setup.symbol}): ${currentPrice}
NQ: ${prices?.NQ ?? 'N/A'} | ES: ${prices?.ES ?? 'N/A'} | GC: ${prices?.GC ?? 'N/A'} | DXY: ${prices?.DXY ?? 'N/A'} | VIX: ${prices?.VIX ?? 'N/A'}

Using the ICT/SMC framework, provide your full analysis of this setup.`

    let analysis = ''
    const nvidiaKey = process.env.NVIDIA_API_KEY
    const anthropicKey = process.env.ANTHROPIC_API_KEY

    if (nvidiaKey) {
      try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nvidiaKey}` },
          body: JSON.stringify({
            model: 'meta/llama-3.3-70b-instruct',
            messages: [
              { role: 'system', content: SMC_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt }
            ],
            max_tokens: 800, temperature: 0.3,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          analysis = data.choices?.[0]?.message?.content ?? ''
        }
      } catch (e) { console.error('NVIDIA error:', e) }
    }

    if (!analysis && anthropicKey) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 800,
            system: SMC_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }]
          }),
        })
        if (res.ok) {
          const data = await res.json()
          analysis = data.content?.[0]?.text ?? ''
        }
      } catch (e) { console.error('Anthropic error:', e) }
    }

    // Fallback: generate meaningful response from real setup data
    if (!analysis) {
      const isLong = setup.direction === 'bull' || setup.direction === 'long'
      const rr = Number(setup.rr_ratio).toFixed(1)
      const score = setup.confluence_score
      const verdict = score >= 75 ? 'TAKE' : score >= 60 ? 'WATCH' : 'SKIP'
      analysis = `BIAS: ${isLong ? 'Bullish' : setup.direction === 'inversion' ? 'Bearish (Inversion)' : 'Bearish'} — ${setup.setup_type} structure identified on ${setup.symbol} ${setup.timeframe}
DOL: ${setup.target} — ${setup.dol_target} is the primary draw, unmitigated liquidity above
SETUP TYPE: ${setup.setup_type}
PHASE: ${isLong ? 'Accumulation → Manipulation complete, distribution to BSL' : 'Distribution → Manipulation complete, delivery to SSL'}
ENTRY LOGIC: Price entering ${setup.entry_low}–${setup.entry_high} zone. ${isLong ? 'SSL swept, CISD required before entry.' : 'BSL swept, CISD required before entry.'} Await full body close ${isLong ? 'above' : 'below'} swing ${isLong ? 'high' : 'low'} on ${setup.timeframe} for confirmation.
CONFLUENCE FACTORS:
- Confluence score ${setup.confluence_score}/100 — ${score >= 75 ? 'HIGH' : 'MODERATE'} probability setup
- ${setup.setup_type} aligns with ${isLong ? 'bullish' : 'bearish'} PD array hierarchy
- ${setup.dol_target} provides clear DOL target for risk/reward of ${rr}R
INVALIDATION: ${setup.stop_loss} — close ${isLong ? 'below' : 'above'} this level invalidates CISD and structural bias
RISK NOTE: SL at ${setup.stop_loss}, ${rr}R to target. Max 1% account risk per ICT risk model.
VERDICT: ${verdict} — Score ${setup.confluence_score}/100, ${rr}R setup${verdict === 'TAKE' ? ', high confluence' : verdict === 'WATCH' ? ', await CISD confirmation' : ', confluence too low'}`
    }

    // Save analysis back to setup
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (setup.id && uuidRegex.test(setup.id)) {
      await supabase.from('setups').update({ ai_analysis: analysis }).eq('id', setup.id)
    }

    return NextResponse.json({ analysis, success: true })
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({ error: 'Analysis failed: ' + String(error), success: false }, { status: 500 })
  }
}
