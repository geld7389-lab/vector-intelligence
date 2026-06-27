import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const GROQ_KEY = process.env.GROQ_API_KEY ?? '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';

async function scoreSetup(setup: any): Promise<any> {
  const prompt = `You are an expert ICT/SMC prop trader. Score this trade setup honestly.

Symbol: ${setup.symbol} | Direction: ${setup.direction.toUpperCase()}
HTF Bias (D1): ${setup.bias_h4} | LTF Bias (H1): ${setup.bias_h1}
EMA Stack: ${setup.ema_stack} | RSI: ${setup.rsi?.toFixed(1)} (${setup.rsi_signal})
Price vs VWAP: ${setup.price_vs_vwap} | Volatility: ${setup.volatility}
Active FVGs: ${setup.fvgs?.length ?? 0} | Order Blocks: ${setup.obs?.length ?? 0}
DXY: ${setup.dxy_trend} | Sentiment: ${setup.sentiment_score}/100 | News blackout: ${setup.blackout_active}

Score 1-10 where:
8-10 = Strong confluence, high conviction trade
6-7 = Good setup, acceptable risk
4-5 = Marginal, borderline
1-3 = Weak, skip

Respond ONLY with JSON:
{"setup_score":<1-10>,"confidence":"<low|medium|high>","primary_reason":"<one sentence>","invalidation":"<key level>","risk_adjustment":"<normal|reduce_half|skip>","trade_approved":<true|false>,"entry_zone":"<brief>","target":"<brief>"}

Approve if score >= 7 AND medium/high confidence AND bias aligns.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 200,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content ?? '{}';
    const clean = text.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(clean);
    return { ...parsed, symbol: setup.symbol, direction: setup.direction };
  } catch {
    // Rule-based fallback — smarter scoring
    let score = 0;

    // Bias alignment (0-3 pts)
    const biasMatch = setup.bias_h4 === setup.direction || setup.bias_h4 === (setup.direction==='buy'?'bullish':'bearish');
    const h1Match = setup.bias_h1 === setup.direction || setup.bias_h1 === (setup.direction==='buy'?'bullish':'bearish');
    if (biasMatch) score += 2;
    if (h1Match) score += 1;

    // EMA confluence (0-2 pts)
    const emaAligned = (setup.direction==='buy' && setup.ema_stack==='bullish') ||
                       (setup.direction==='sell' && setup.ema_stack==='bearish');
    if (emaAligned) score += 2;

    // RSI (0-1 pt)
    if ((setup.direction==='buy' && (setup.rsi_signal==='oversold' || (setup.rsi > 40 && setup.rsi < 65))) ||
        (setup.direction==='sell' && (setup.rsi_signal==='overbought' || (setup.rsi > 50 && setup.rsi < 75)))) {
      score += 1;
    }

    // SMC confluence (0-2 pts)
    if ((setup.fvgs?.length ?? 0) > 0) score += 1;
    if ((setup.obs?.length ?? 0) > 0) score += 1;

    // VWAP (0-1 pt)
    if ((setup.direction==='buy' && setup.price_vs_vwap==='above') ||
        (setup.direction==='sell' && setup.price_vs_vwap==='below')) score += 1;

    // News blackout penalty
    if (setup.blackout_active) score = Math.max(0, score - 2);

    const approved = score >= 7 && !setup.blackout_active;
    return {
      symbol: setup.symbol,
      direction: setup.direction,
      setup_score: score,
      confidence: score >= 7 ? 'high' : score >= 5 ? 'medium' : 'low',
      primary_reason: `Rule-based: ${emaAligned?'EMA aligned,':''} ${biasMatch?'HTF bias match,':''} ${setup.fvgs?.length??0} FVGs, ${setup.obs?.length??0} OBs`,
      invalidation: `Bias flips to ${setup.direction==='buy'?'bearish':'bullish'}`,
      risk_adjustment: score >= 7 ? 'normal' : 'reduce_half',
      trade_approved: approved,
      entry_zone: 'Near FVG/OB zone',
      target: 'Next liquidity pool',
    };
  }
}

export async function POST(req: NextRequest) {
  const { biases={}, fvgs=[], order_blocks=[], confluence={}, macro={}, risk={} } = await req.json().catch(()=>({}));

  const candidates: any[] = [];

  for (const [sym, tech] of Object.entries(confluence) as [string,any][]) {
    const bias = biases[sym] ?? 'neutral';

    // Determine best direction from all signals
    let bullishPoints = 0, bearishPoints = 0;
    if (bias === 'bullish') bullishPoints += 2;
    if (bias === 'bearish') bearishPoints += 2;
    if (tech.ema_stack === 'bullish') bullishPoints += 1;
    if (tech.ema_stack === 'bearish') bearishPoints += 1;
    if (tech.price_vs_vwap === 'above') bullishPoints += 1;
    if (tech.price_vs_vwap === 'below') bearishPoints += 1;
    if (tech.rsi_signal === 'oversold') bullishPoints += 1;
    if (tech.rsi_signal === 'overbought') bearishPoints += 1;

    const direction = bullishPoints >= bearishPoints ? 'buy' : 'sell';

    const symFvgs = fvgs.filter((f:any) => f.symbol === sym);
    const symObs  = order_blocks.filter((o:any) => o.symbol === sym);

    candidates.push({
      symbol: sym, direction,
      bias_h4: bias,
      bias_h1: tech.ema_stack === 'bullish' ? 'bullish' : tech.ema_stack === 'bearish' ? 'bearish' : 'neutral',
      rsi: tech.rsi,
      rsi_signal: tech.rsi_signal,
      ema_stack: tech.ema_stack,
      price_vs_vwap: tech.price_vs_vwap,
      volatility: tech.volatility,
      fvgs: symFvgs,
      obs: symObs,
      dxy_trend: macro.dxy_trend ?? 'neutral',
      sentiment_score: macro.sentiment_score ?? 50,
      blackout_active: macro.blackout_active ?? false,
    });
  }

  // Score all candidates in parallel (max 6)
  const toScore = candidates.slice(0, 6);
  const scored = await Promise.all(toScore.map(scoreSetup));

  const approved = scored.filter((s:any) => s.trade_approved === true || s.setup_score >= 7);

  // Save to Supabase
  await sb.from('agent_status').upsert({
    agent: 'ai_brain',
    status: 'running',
    last_action: `${approved.length} trades approved (score ≥7) from ${toScore.length} candidates`,
    data: JSON.stringify({ approved, all_scores: scored }),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'agent' });

  return NextResponse.json({
    candidates_evaluated: toScore.length,
    approved_count: approved.length,
    approved,
    all_scores: scored,
    ts: new Date().toISOString(),
  });
}
