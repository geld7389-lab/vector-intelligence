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

    if (isExpired || slBreached) {
      await sb.from('setups').update({ status: slBreached ? 'lost' : 'expired' }).eq('id', setup.id);
      return NextResponse.json({ analysis: `INVALIDATED — ${slBreached ? `SL at ${setup.stop_loss} breached (now ${price?.toFixed(1)})` : 'setup expired'}.\n\nDo not trade this. Archive it.` });
    }
    if (price !== null && (isBull ? price >= setup.target : price <= setup.target)) {
      await sb.from('setups').update({ status: 'won' }).eq('id', setup.id);
      return NextResponse.json({ analysis: `TARGET HIT ✅ — ${setup.symbol} reached ${setup.target}.\n\nSetup closed as WIN. Log this trade in your journal.` });
    }

    // Fetch KB articles (most relevant by keyword match)
    const { data: kb } = await sb.from('knowledge_base').select('title,content,source_episode,tags').limit(16);
    const kbContext = (kb ?? []).map(a => `[${a.source_episode}] ${a.title}: ${a.content}`).join('\n\n');

    // Fetch COT data for this symbol's market
    const cotSymMap: Record<string,string> = { NQ:'NQ', ES:'ES', GC:'GC', CL:'CL', EURUSD:'EUR', GBPUSD:'GBP', BTC:'', ETH:'' };
    const cotSym = cotSymMap[setup.symbol] ?? '';
    let cotContext = '';
    if (cotSym) {
      try {
        const { data: cot } = await sb.from('cot_cache').select('*').eq('symbol', cotSym).order('date', { ascending: false }).limit(2);
        if (cot && cot.length > 0) {
          const latest = cot[0], prev = cot[1];
          const weekChg = prev ? latest.comm_net - prev.comm_net : 0;
          cotContext = `\nCOT POSITIONING (${cotSym} — as of ${latest.date}): Commercials ${latest.comm_net > 0 ? 'NET LONG' : 'NET SHORT'} ${Math.abs(latest.comm_net).toLocaleString()} | Week change: ${weekChg > 0 ? '+' : ''}${weekChg.toLocaleString()} | Large Specs: ${latest.large_net > 0 ? 'NET LONG' : 'NET SHORT'} ${Math.abs(latest.large_net).toLocaleString()}. ${latest.comm_net > 0 && isBull ? 'Commercials ALIGNED with bullish bias.' : latest.comm_net < 0 && !isBull ? 'Commercials ALIGNED with bearish bias.' : 'WARNING: COT positioning OPPOSES this trade direction.'}`;
        }
      } catch {}
    }

    // Fetch SMT signals for this symbol
    let smtContext = '';
    try {
      const { data: smt } = await sb.from('smt_signals').select('*').order('detected_at', { ascending: false }).limit(3);
      if (smt && smt.length > 0) {
        const relevant = smt.filter(s => s.detected_at && new Date(s.detected_at) > new Date(Date.now() - 4*60*60*1000));
        if (relevant.length > 0) smtContext = `\nSMT DIVERGENCE (last 4h): ${relevant.map(s => s.divergence_type + ' — ' + s.notes).join(' | ')}`;
      }
    } catch {}

    const entry = ((setup.entry_low ?? 0) + (setup.entry_high ?? 0)) / 2;
    const slPts = Math.abs(entry - setup.stop_loss).toFixed(1);
    const tpPts = Math.abs(setup.target - entry).toFixed(1);
    const priceLocation = price
      ? price < setup.entry_low ? `Below entry zone — ${(setup.entry_low - price).toFixed(1)} pts away`
        : price > setup.entry_high ? `Above entry zone — ${(price - setup.entry_high).toFixed(1)} pts away`
        : `INSIDE entry zone (${price.toFixed(1)})`
      : 'Unknown';

    const marketCtx = market === 'crypto' ? 'CRYPTO market. 24/7, no killzones, sweeps during low-volume windows.'
      : market === 'forex' ? 'FOREX market. Key sessions: London (2-5am NY), NY (8:30-11am NY). DXY correlation critical.'
      : market === 'stocks' ? 'STOCKS market. Only trade market hours. Earnings = binary risk.'
      : 'FUTURES market (NQ/ES). Apply ICT killzone and session timing rules.';

    const prompt = `You are an ICT/SMC analyst trained on this exact methodology:\n\n${kbContext}\n\n${marketCtx}${cotContext}${smtContext}\n\nSETUP:\nSymbol: ${setup.symbol} ${setup.timeframe} | Direction: ${setup.direction.toUpperCase()} | Type: ${setup.setup_type}\nEntry: ${setup.entry_low}–${setup.entry_high} | SL: ${setup.stop_loss} (${slPts}pts) | TP: ${setup.target} (${tpPts}pts)\nR:R: ${setup.rr_ratio} | HTF Bias: ${setup.htf_bias} | CISD: ${setup.cisd_confirmed ? 'CONFIRMED' : 'PENDING'}\nVolume: ${setup.volume_context} | DOL: ${setup.dol_target} | Score: ${setup.confluence_score}/100\nPrice now: ${price?.toFixed(1) ?? '—'} | Location: ${priceLocation}\n\nAnswer these 5 questions using the ICT methodology above:\n\n1. DOL VALID? Is ${setup.dol_target} still untapped and reachable?\n2. PRICE LOCATION? Discount or premium? Is this an optimal entry zone?\n3. CISD STATUS? ${setup.cisd_confirmed ? 'Confirmed — which PD array for entry?' : 'Not confirmed — what exact price action confirms it?'}\n4. INSTITUTIONAL CONTEXT? What do the COT and SMT signals say about institutional positioning?${!cotContext && !smtContext ? ' (No live data — reason from price structure only.)' : ''}\n5. VERDICT: WAIT / WATCH / READY — one sentence with exact trigger condition.`;

    const apiKey = process.env.GROQ_API_KEY ?? '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';
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 800,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'You are an expert ICT/SMC trading analyst. Be direct, specific, concise. Reference ICT concepts exactly. Format with numbered answers.' },
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
