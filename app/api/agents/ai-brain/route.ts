import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const GROQ_KEY = process.env.GROQ_API_KEY ?? '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';

async function scoreSetup(setup: any): Promise<any> {
  const prompt = `You are an expert ICT/SMC trader scoring a potential trade setup.

SETUP DATA:
Symbol: ${setup.symbol}
Direction: ${setup.direction}
HTF Bias (H4): ${setup.bias_h4}
H1 Bias: ${setup.bias_h1}
RSI: ${setup.rsi} (${setup.rsi_signal})
RSI Divergence: ${setup.rsi_divergence}
EMA Stack: ${setup.ema_stack}
Price vs VWAP: ${setup.price_vs_vwap}
Volatility: ${setup.volatility}
Active FVGs near price: ${JSON.stringify(setup.fvgs?.slice(0,2) ?? [])}
Active Order Blocks: ${JSON.stringify(setup.obs?.slice(0,2) ?? [])}
Liquidity nearby: ${JSON.stringify(setup.liquidity ?? {})}
Macro: DXY ${setup.dxy_trend}, Sentiment ${setup.sentiment_score}/100
News blackout: ${setup.blackout_active}

Respond ONLY with this exact JSON (no markdown, no explanation):
{
  "setup_score": <1-10>,
  "confidence": "<low|medium|high>",
  "primary_reason": "<one sentence>",
  "invalidation": "<what would make this trade wrong>",
  "risk_adjustment": "<normal|reduce_half|skip>",
  "trade_approved": <true|false>,
  "entry_zone": "<description>",
  "target": "<description>"
}

Only approve (trade_approved: true) if score >= 8 AND confidence = high AND no news blackout AND HTF bias aligns with direction.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 300,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content ?? '{}';
    const clean = text.replace(/```json|```/g,'').trim();
    return { ...JSON.parse(clean), symbol: setup.symbol, direction: setup.direction };
  } catch (e) {
    // Fallback: rule-based scoring
    const score = [
      setup.bias_h4 === setup.direction ? 3 : 0,
      setup.ema_stack === (setup.direction==='buy'?'bullish':'bearish') ? 2 : 0,
      setup.rsi_signal === 'oversold' && setup.direction==='buy' ? 1 :
        setup.rsi_signal === 'overbought' && setup.direction==='sell' ? 1 : 0,
      setup.price_vs_vwap === 'above' && setup.direction==='buy' ? 1 :
        setup.price_vs_vwap === 'below' && setup.direction==='sell' ? 1 : 0,
      (setup.fvgs?.length ?? 0) > 0 ? 1 : 0,
      (setup.obs?.length ?? 0) > 0 ? 1 : 0,
      !setup.blackout_active ? 1 : 0,
    ].reduce((a:number,b:number)=>a+b, 0);

    return {
      symbol: setup.symbol,
      direction: setup.direction,
      setup_score: score,
      confidence: score>=7?'high':score>=5?'medium':'low',
      primary_reason: `Rule-based: ${setup.ema_stack} EMA stack, ${setup.bias_h4} H4 bias`,
      invalidation: `Bias shifts to ${setup.direction==='buy'?'bearish':'bullish'}`,
      risk_adjustment: score>=7?'normal':'reduce_half',
      trade_approved: score>=8 && !setup.blackout_active,
      entry_zone: 'Near FVG/OB zone',
      target: 'Next liquidity pool',
    };
  }
}

export async function POST(req: NextRequest) {
  const { biases={}, fvgs=[], order_blocks=[], confluence={}, macro={}, risk={} } = await req.json().catch(()=>({}));

  // Build candidate setups from confluence data
  const candidates: any[] = [];
  for (const [sym, tech] of Object.entries(confluence) as [string,any][]) {
    const bias = biases[sym];
    if (!bias || bias === 'neutral') continue;

    const direction = bias === 'bullish' ? 'buy' : 'sell';
    const symFvgs = fvgs.filter((f:any)=>f.symbol===sym);
    const symObs  = order_blocks.filter((o:any)=>o.symbol===sym);

    candidates.push({
      symbol: sym, direction,
      bias_h4: bias,
      bias_h1: tech.ema_stack === 'bullish' ? 'bullish' : tech.ema_stack === 'bearish' ? 'bearish' : 'neutral',
      rsi: tech.rsi,
      rsi_signal: tech.rsi_signal,
      rsi_divergence: tech.rsi_divergence,
      ema_stack: tech.ema_stack,
      price_vs_vwap: tech.price_vs_vwap,
      volatility: tech.volatility,
      fvgs: symFvgs,
      obs: symObs,
      liquidity: {},
      dxy_trend: macro.dxy_trend ?? 'neutral',
      sentiment_score: macro.sentiment_score ?? 50,
      blackout_active: macro.blackout_active ?? false,
    });
  }

  // Score all candidates (max 6 to avoid rate limits)
  const toScore = candidates.slice(0, 6);
  const scored = await Promise.all(toScore.map(scoreSetup));

  const approved = scored.filter((s:any) => s.trade_approved === true);

  // Save to Supabase knowledge base as trade signals
  // (done via orchestrator)

  return NextResponse.json({
    candidates_evaluated: toScore.length,
    approved_count: approved.length,
    approved,
    all_scores: scored,
    ts: new Date().toISOString(),
  });
}
