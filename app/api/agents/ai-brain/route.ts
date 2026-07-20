import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

// Key lives in Supabase (agent_status: 'groq_key'), never committed to this
// public repo — same reason the run-trigger secret moved there instead of
// vercel.json, which anyone can read directly on GitHub. The previous
// hardcoded key here was dead ("Invalid API Key"), which is the real reason
// every trade's score has come from the rule-based fallback so far.
async function getGroqKey(): Promise<string | null> {
  const { data } = await sb.from('agent_status').select('data').eq('agent', 'groq_key').single();
  const parsed = typeof data?.data === 'string' ? JSON.parse(data.data) : data?.data;
  return parsed?.key ?? null;
}

// Pulls the same rich context /api/analyze already proved is better-built than
// the plain technical-indicator prompt this route used to send — real ICT
// knowledge base excerpts, actual COT institutional positioning, SMT
// divergence signals, and weekly bias reasoning. The automated approval path
// had never used any of this; it was scoring on bias/EMA/RSI/VWAP/FVG-count
// alone. Output stays a single structured JSON object (unlike /api/analyze's
// free-text report) so the executor/risk pipeline downstream needs zero
// changes — this only replaces HOW the score gets decided, not the contract.
//
// Knowledge base content is symbol-agnostic — it was previously being
// re-fetched AND re-sent to Groq inside every single candidate's prompt
// (up to 6 per cycle), multiplying token usage 6x for zero benefit. Confirmed
// live: this burned through Groq's 100k tokens/day limit and fell back to the
// rule-based path mid-cycle. Now fetched once per cycle and shared.
let cachedKbContext: { text: string; fetchedAt: number } | null = null;
async function getKnowledgeBaseContext(): Promise<string> {
  const FIVE_MIN = 5 * 60 * 1000;
  if (cachedKbContext && Date.now() - cachedKbContext.fetchedAt < FIVE_MIN) {
    return cachedKbContext.text;
  }
  const { data: kbRows } = await sb.from('knowledge_base').select('title,content').limit(12);
  const text = (kbRows ?? []).map((r: any) => `[${r.title}] ${r.content?.slice(0, 220)}`).join('\n');
  cachedKbContext = { text, fetchedAt: Date.now() };
  return text;
}

async function getSymbolContext(symbol: string, direction: string) {
  const [{ data: cotRows }, { data: smtRows }, { data: biasRow }] = await Promise.all([
    sb.from('cot_data').select('*')
      .eq('symbol', symbol.replace('USD', '').replace('EURUSD', 'EUR').replace('GBPUSD', 'GBP'))
      .order('report_date', { ascending: false }).limit(1),
    sb.from('smt_signals').select('*').gte('detected_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
      .order('detected_at', { ascending: false }).limit(3),
    sb.from('weekly_bias').select('*').eq('symbol', symbol).order('created_at', { ascending: false }).limit(1).single(),
  ]);

  let cotContext = '';
  const c = cotRows?.[0];
  if (c) {
    const commAligned = (direction === 'buy' && c.comm_net > 0) || (direction === 'sell' && c.comm_net < 0);
    cotContext = `COT (latest CFTC): Commercials net ${c.comm_net > 0 ? '+' : ''}${Math.round(c.comm_net / 1000)}k | Large Specs net ${c.large_net > 0 ? '+' : ''}${Math.round(c.large_net / 1000)}k | ${commAligned ? 'ALIGNED — commercials confirm this direction' : 'OPPOSED — commercials positioned against this trade'}`;
  }

  let smtContext = '';
  if (smtRows?.length) {
    smtContext = `SMT divergence (last 4h): ${smtRows.map((s: any) => `${s.divergence_type} (${new Date(s.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} NY)`).join('; ')}`;
  }

  const biasContext = biasRow
    ? `Weekly bias: ${biasRow.bias?.toUpperCase()} | Key levels: ${biasRow.key_levels ?? 'not set'} | Reasoning: ${biasRow.reasoning ?? ''}`
    : '';

  return { cotContext, smtContext, biasContext };
}

async function scoreSetup(setup: any, sharedKbContext: string): Promise<any> {
  const ctx = { kbContext: sharedKbContext, ...(await getSymbolContext(setup.symbol, setup.direction)) };

  const prompt = `You are an expert ICT/SMC prop trader. Score this trade setup honestly, grounded in the ICT knowledge base provided — do not just pattern-match on raw indicator values, actually reason about whether this setup matches the concepts described.

Symbol: ${setup.symbol} | Direction: ${setup.direction.toUpperCase()}
HTF Bias (D1): ${setup.bias_h4} | LTF Bias (H1): ${setup.bias_h1}
EMA Stack: ${setup.ema_stack} | RSI: ${setup.rsi?.toFixed(1)} (${setup.rsi_signal})
Price vs VWAP: ${setup.price_vs_vwap} | Volatility: ${setup.volatility}
Active FVGs: ${setup.fvgs?.length ?? 0} | Order Blocks: ${setup.obs?.length ?? 0}
DXY: ${setup.dxy_trend} | Sentiment: ${setup.sentiment_score}/100 | News blackout: ${setup.blackout_active}

${ctx.cotContext}
${ctx.smtContext}
${ctx.biasContext}

ICT KNOWLEDGE BASE CONTEXT:
${ctx.kbContext}

Score 1-10 where:
8-10 = Strong confluence per ICT concepts above, institutional alignment (COT/SMT), high conviction
6-7 = Good setup, acceptable risk, minor conflicts
4-5 = Marginal, borderline, or conflicts with COT/SMT/weekly bias
1-3 = Weak, skip, or contradicts the knowledge base concepts

Respond ONLY with JSON:
{"setup_score":<1-10>,"confidence":"<low|medium|high>","primary_reason":"<one sentence citing specific ICT concept or institutional data used>","invalidation":"<key level>","risk_adjustment":"<normal|reduce_half|skip>","trade_approved":<true|false>,"entry_zone":"<brief>","target":"<brief>"}

Approve if score >= 7 AND medium/high confidence AND bias aligns AND not directly opposed by COT/SMT.`;

  try {
    const GROQ_KEY = await getGroqKey();
    if (!GROQ_KEY) throw new Error('no Groq key configured in Supabase (agent_status: groq_key)');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 300,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content ?? '{}';
    const clean = text.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(clean);
    // knowledge_grounded lets us verify (via trade notes) that a given
    // approval actually came from the KB-aware LLM path, not the fallback —
    // exactly the distinction that was invisible before ("Rule-based:" was
    // silently on every single trade because the API key was dead).
    // Don't trust the LLM's own trade_approved boolean at face value —
    // confirmed live it doesn't always self-enforce the threshold it was
    // given (a GC setup scored 6 but the model set trade_approved: true
    // anyway, directly contradicting the ">=7" rule in its own prompt).
    // Compute it deterministically instead, same policy as the rule-based
    // fallback already uses, so the stated threshold is actually enforced
    // regardless of what the model's own boolean says.
    const scoreNum = Number(parsed.setup_score) || 0;
    const deterministicApproved = scoreNum >= 7
      && parsed.confidence !== 'low'
      && !setup.blackout_active;
    return {
      ...parsed,
      trade_approved: deterministicApproved,
      symbol: setup.symbol,
      direction: setup.direction,
      knowledge_grounded: true,
    };
  } catch (e: any) {
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
      primary_reason: `Rule-based (LLM unavailable: ${e?.message ?? 'unknown error'}): ${emaAligned?'EMA aligned,':''} ${biasMatch?'HTF bias match,':''} ${setup.fvgs?.length??0} FVGs, ${setup.obs?.length??0} OBs`,
      invalidation: `Bias flips to ${setup.direction==='buy'?'bearish':'bullish'}`,
      risk_adjustment: score >= 7 ? 'normal' : 'reduce_half',
      trade_approved: approved,
      entry_zone: 'Near FVG/OB zone',
      target: 'Next liquidity pool',
      knowledge_grounded: false,
    };
  }
}

export async function POST(req: NextRequest) {
  const { biases={}, fvgs=[], order_blocks=[], confluence={}, macro={}, risk={} } = await req.json().catch(()=>({}));

  const candidates: any[] = [];
  const openSymbols: string[] = risk.open_symbols ?? [];
  // Symbols self-learning has flagged as >=20 trades with <40% win rate.
  // This data existed every cycle already — it just went straight to a
  // display panel and nothing ever actually avoided trading these symbols.
  const pausedSymbols: string[] = risk.paused_symbols ?? [];

  for (const [sym, tech] of Object.entries(confluence) as [string,any][]) {
    if (openSymbols.includes(sym)) continue; // already have an open position on this symbol
    if (pausedSymbols.includes(sym)) continue; // self-learning: this symbol has been a chronic loser
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
  const sharedKb = await getKnowledgeBaseContext();
  const scored = await Promise.all(toScore.map((s: any) => scoreSetup(s, sharedKb)));

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
