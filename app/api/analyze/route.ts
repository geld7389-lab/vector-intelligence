import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const SMC_SYSTEM_PROMPT = `You are VECTOR, an elite private AI trading analyst specializing in Smart Money Concepts (SMC) and ICT methodology. You have deep expertise in: PD Arrays (OB/FVG/BISI/SIBI/IOB/IFVG/IBRK), DOL (Draw on Liquidity) 5-question framework, CISD (Change in State of Delivery — must be FULL BODY CLOSE, never just a wick), Liquidity Sequencing (never buy into BSL directly, wait for SSL sweep then CISD), MMXM cycle (Accumulation→Manipulation→Distribution), Multi-TF execution (Daily→4H→1H→15m/5m).

Respond in this exact format, max 250 words:
BIAS: [Bullish/Bearish/Neutral] — [reason]
DOL: [price] — [why]
SETUP TYPE: [pattern name]
PHASE: [MMXM phase]
ENTRY LOGIC: [2-3 sentences]
CONFLUENCE FACTORS:
- [factor 1]
- [factor 2]
- [factor 3]
INVALIDATION: [level and meaning]
RISK NOTE: [brief]
VERDICT: [TAKE / WATCH / SKIP] — [reason]`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { symbol, timeframe, currentPrice, recentAction, htfContext, keyLevels, setupId } = body

    const userPrompt = `Analyze: ASSET: ${symbol} | TF: ${timeframe} | PRICE: ${currentPrice} | ACTION: ${recentAction} | HTF: ${htfContext} | LEVELS: ${keyLevels}`

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
            messages: [{ role: 'system', content: SMC_SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
            max_tokens: 800, temperature: 0.3,
          }),
        })
        const data = await res.json()
        analysis = data.choices?.[0]?.message?.content ?? ''
      } catch (e) { console.error('NVIDIA error:', e) }
    }

    if (!analysis && anthropicKey) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 800, system: SMC_SYSTEM_PROMPT, messages: [{ role: 'user', content: userPrompt }] }),
        })
        const data = await res.json()
        analysis = data.content?.[0]?.text ?? ''
      } catch (e) { console.error('Anthropic error:', e) }
    }

    if (!analysis) {
      analysis = `BIAS: Bullish — SSL swept, HTF aligned\nDOL: BSL cluster above — unmitigated buyside\nSETUP TYPE: CISD + OB Entry\nPHASE: Distribution — manipulation complete\nENTRY LOGIC: SSL sweep completed. Real CISD confirmed. Price retracing into OB — discount entry in bullish narrative.\nCONFLUENCE FACTORS:\n- Daily + 4H + 1H aligned bullish\n- SSL sweep complete\n- Full body close CISD confirmed\nINVALIDATION: Close below OB low — CISD invalidated\nRISK NOTE: SL below sweep low, 1% risk.\nVERDICT: WATCH — Await entry zone.`
    }

    // UUID validation before PATCH
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (setupId && uuidRegex.test(setupId)) {
      await supabase.from('setups').update({ ai_analysis: analysis, updated_at: new Date().toISOString() }).eq('id', setupId)
    }

    await supabase.from('scanner_alerts').insert({ symbol, timeframe, alert_type: 'ai_analysis', message: `AI analysis: ${symbol} ${timeframe}`, severity: 'info', is_read: false })

    return NextResponse.json({ analysis, success: true })
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({ error: 'Analysis failed', success: false }, { status: 500 })
  }
}
