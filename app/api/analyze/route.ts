import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { setup, prices, market } = await req.json();
    if (!setup) return NextResponse.json({ error: 'No setup' }, { status: 400 });

    const price = prices?.[setup.symbol] ?? null;
    const isBull = setup.direction === 'bull' || setup.direction === 'long';
    const slBreached = price !== null && (isBull ? price < setup.stop_loss : price > setup.stop_loss);
    const isExpired = setup.expires_at && new Date(setup.expires_at) < new Date();

    if (isExpired || slBreached) {
      return NextResponse.json({ analysis: `INVALIDATED — ${slBreached ? `SL at ${setup.stop_loss} breached (now ${price?.toFixed(1)})` : 'setup expired'}.\n\nDo not trade this. Archive it.` });
    }

    // Load relevant knowledge base articles
    const { data: kb } = await sb.from('knowledge_base').select('title,content,source_episode,tags').limit(14);
    const kbContext = (kb ?? []).map(a => `[${a.source_episode}] ${a.title}: ${a.content}`).join('\n\n');

    const entry = ((setup.entry_low ?? 0) + (setup.entry_high ?? 0)) / 2;
    const slPts = Math.abs(entry - setup.stop_loss).toFixed(1);
    const tpPts = Math.abs(setup.target - entry).toFixed(1);
    const priceLocation = price
      ? price < setup.entry_low ? `Below entry zone — ${(setup.entry_low - price).toFixed(1)} pts away`
        : price > setup.entry_high ? `Above entry zone — ${(price - setup.entry_high).toFixed(1)} pts away`
        : `INSIDE entry zone (${price.toFixed(1)})`
      : 'Unknown';

    const marketCtx = market === 'crypto' ? 'This is a CRYPTO market. Note: 24/7 market, no killzones, liquidity sweeps happen during low-volume hours (weekends, 2-4am UTC).'
      : market === 'forex' ? 'This is a FOREX/COMMODITIES market. Key sessions: London (2-5am NY), NY (8:30-11am NY). DXY correlation critical.'
      : market === 'stocks' ? 'This is a STOCKS/ETF market. Only trade during market hours. Earnings dates are binary event risk — check before entry.'
      : market === 'institutional' ? 'This is an INSTITUTIONAL/MACRO setup. COT positioning, fund flows, and institutional narratives override technical setups.'
      : 'This is a FUTURES market (NQ/ES). Apply full ICT killzone and session timing rules.';

    const prompt = `You are an ICT/SMC analyst trained on this exact methodology from these video lessons:

${kbContext}

${marketCtx}

SETUP TO ANALYSE:
Symbol: ${setup.symbol} ${setup.timeframe} | Direction: ${setup.direction.toUpperCase()} | Type: ${setup.setup_type}
Entry: ${setup.entry_low}–${setup.entry_high} | SL: ${setup.stop_loss} (${slPts}pts) | TP: ${setup.target} (${tpPts}pts)
R:R: ${setup.rr_ratio} | HTF Bias: ${setup.htf_bias} | CISD: ${setup.cisd_confirmed ? 'CONFIRMED' : 'PENDING'}
Volume: ${setup.volume_context} | DOL: ${setup.dol_target} | Confluences: ${setup.confluence_score}/100
Price now: ${price?.toFixed(1) ?? '—'} | Location: ${priceLocation}

Using the ICT methodology from the episodes above, answer these 5 questions directly:

1. DOL VALID? Is the Draw on Liquidity (${setup.dol_target}) still untapped and reachable? Reference the liquidity sequencing rule from Episode 6.

2. PRICE LOCATION? Is price currently in a discount (for longs) or premium (for shorts)? Reference Episode 1 premium/discount rules.

3. CISD STATUS? ${setup.cisd_confirmed ? 'CISD is confirmed — which PD array does this setup use for entry and is it valid?' : 'CISD is NOT yet confirmed — what exact price action needs to happen for confirmation? Reference Episode 2.'}

4. RISK FACTORS? Two specific reasons this setup could fail based on the current market context.

5. VERDICT: WAIT / WATCH / READY — one sentence with the exact condition needed to act.`;

    const apiKey = process.env.GROQ_API_KEY ?? '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';
    if (!apiKey) {
      // Generate analysis from knowledge base without AI when no key available
      const verdict = isExpired ? 'INVALIDATED' : !setup.cisd_confirmed ? 'WAIT — CISD not yet confirmed. Await full body close through prior swing.' : price && price >= setup.entry_low && price <= setup.entry_high ? 'READY — Price is inside entry zone. Confirm CISD and enter on PD array.' : 'WATCH — Price not yet in entry zone. Wait for price to return to ' + setup.entry_low + '-' + setup.entry_high + '.';
      return NextResponse.json({ analysis: `Analysis (AI key not configured):

1. DOL: ${setup.dol_target} — target at ${setup.target}
2. Location: ${priceLocation}
3. CISD: ${setup.cisd_confirmed ? 'Confirmed' : 'PENDING — full body close needed'}
4. Risk: HTF bias conflict (${setup.htf_bias} vs ${setup.direction}) and volume context (${setup.volume_context})
5. VERDICT: ${verdict}

Set ANTHROPIC_API_KEY in Vercel environment variables for full AI analysis.` });
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.1-70b-versatile',
        max_tokens: 600,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'You are an expert ICT/SMC trading analyst. Be direct, specific, and concise. Reference the ICT methodology exactly as described in the context provided.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? data.error?.message ?? 'No response';
    return NextResponse.json({ analysis: text });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
