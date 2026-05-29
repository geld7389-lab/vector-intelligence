import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

export async function POST(req: NextRequest) {
  try {
    const { setup, prices, market } = await req.json();
    if (!setup) return NextResponse.json({ error: 'No setup' }, { status: 400 });

    const price = prices?.[setup.symbol] ?? null;
    const isBull = setup.direction === 'bull' || setup.direction === 'long';
    const slBreached = price !== null && (isBull ? price < setup.stop_loss : price > setup.stop_loss);
    const isExpired = setup.expires_at && new Date(setup.expires_at) < new Date();

    // Auto-expire setup in DB if SL breached or expired
    if (isExpired || slBreached) {
      await sb.from('setups').update({ status: slBreached ? 'lost' : 'expired' }).eq('id', setup.id);
      return NextResponse.json({ analysis: `INVALIDATED — ${slBreached ? `SL at ${setup.stop_loss} breached (now ${price?.toFixed(1)})` : 'setup expired'}.\n\nDo not trade this. Archive it.` });
    }

    // Auto-mark as won if price hit target
    if (price !== null && (isBull ? price >= setup.target : price <= setup.target)) {
      await sb.from('setups').update({ status: 'won' }).eq('id', setup.id);
      return NextResponse.json({ analysis: `TARGET HIT ✅ — ${setup.symbol} reached ${setup.target}.\n\nSetup closed as WIN. Log this trade in your journal.` });
    }

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
      : market === 'stocks' ? 'This is a STOCKS/ETF market. Only trade during market hours. Earnings dates are binary event risk.'
      : market === 'institutional' ? 'This is an INSTITUTIONAL/MACRO setup. COT positioning, fund flows, and institutional narratives override technicals.'
      : 'This is a FUTURES market (NQ/ES). Apply full ICT killzone and session timing rules.';

    const prompt = `You are an ICT/SMC analyst trained on this exact methodology from these video lessons:\n\n${kbContext}\n\n${marketCtx}\n\nSETUP:\nSymbol: ${setup.symbol} ${setup.timeframe} | Direction: ${setup.direction.toUpperCase()} | Type: ${setup.setup_type}\nEntry: ${setup.entry_low}–${setup.entry_high} | SL: ${setup.stop_loss} (${slPts}pts) | TP: ${setup.target} (${tpPts}pts)\nR:R: ${setup.rr_ratio} | HTF Bias: ${setup.htf_bias} | CISD: ${setup.cisd_confirmed ? 'CONFIRMED' : 'PENDING'}\nVolume: ${setup.volume_context} | DOL: ${setup.dol_target} | Confluences: ${setup.confluence_score}/100\nPrice now: ${price?.toFixed(1) ?? '—'} | Location: ${priceLocation}\n\nUsing the ICT methodology from the episodes above, answer these 5 questions:\n\n1. DOL VALID? Is ${setup.dol_target} still untapped and reachable? Reference Episode 6 liquidity sequencing.\n2. PRICE LOCATION? Discount or premium? Reference Episode 1 premium/discount rules.\n3. CISD STATUS? ${setup.cisd_confirmed ? 'Confirmed — which PD array for entry?' : 'Not confirmed — what exact action confirms it? Reference Episode 2.'}\n4. RISK FACTORS? Two specific reasons this setup could fail.\n5. VERDICT: WAIT / WATCH / READY — one sentence with exact trigger condition.`;

    const apiKey = process.env.GROQ_API_KEY ?? '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';

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.1-70b-versatile',
        max_tokens: 600,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'You are an expert ICT/SMC trading analyst. Be direct, specific, and concise. Reference ICT methodology exactly as described in the context.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? data.error?.message ?? 'No response from Groq';
    return NextResponse.json({ analysis: text });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
