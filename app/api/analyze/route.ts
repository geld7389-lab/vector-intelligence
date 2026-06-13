import { NextRequest, NextResponse } from 'next/server';
import { sb as supabase } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';



const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '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';

export async function POST(req: NextRequest) {
  try {
    const { setup, prices } = await req.json();

    // 1. Pull ICT knowledge base context
    const { data: kbRows } = await sb.from('knowledge_base').select('title,content').limit(12);
    const kbContext = (kbRows ?? []).map((r: any) => `[${r.title}] ${r.content?.slice(0,220)}`).join('\n');

    // 2. Pull COT data for symbol
    const cotSym = ['NQ','ES','EURUSD','GBPUSD','GC','CL'].includes(setup.symbol?.split('-')[0]) ? setup.symbol : null;
    let cotContext = '';
    if (cotSym) {
      const { data: cotRows } = await sb.from('cot_data').select('*').eq('symbol', cotSym.replace('USD','').replace('EURUSD','EUR').replace('GBPUSD','GBP')).order('report_date',{ascending:false}).limit(1);
      if (cotRows && cotRows[0]) {
        const c = cotRows[0];
        const commAligned = (setup.direction==='bull'&&c.comm_net>0)||(setup.direction==='bear'&&c.comm_net<0);
        cotContext = `\nCOT DATA (latest CFTC report): Commercials net ${c.comm_net>0?'+':''}${Math.round(c.comm_net/1000)}k | Large Specs net ${c.large_net>0?'+':''}${Math.round(c.large_net/1000)}k\nInstitutional alignment: ${commAligned?'✅ ALIGNED — Commercials confirm this direction':'⚠️ OPPOSED — Commercials are positioned against this trade'}\n`;
      }
    }

    // 3. Pull SMT signals (last 4 hours)
    const { data: smtRows } = await sb.from('smt_signals').select('*').gte('detected_at', new Date(Date.now()-4*60*60*1000).toISOString()).order('detected_at',{ascending:false}).limit(3);
    let smtContext = '';
    if (smtRows && smtRows.length > 0) {
      smtContext = `\nSMT DIVERGENCE (recent): ${smtRows.map((s:any)=>`${s.divergence_type} (NQ vs ES, ${new Date(s.detected_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} NY)`).join('; ')}\n`;
    }

    // 4. Pull weekly bias
    const { data: biasRow } = await sb.from('weekly_bias').select('*').eq('symbol', setup.symbol).order('created_at',{ascending:false}).limit(1).single();
    const biasContext = biasRow ? `\nWEEKLY BIAS: ${setup.symbol} ${biasRow.bias?.toUpperCase()} | Key levels: ${biasRow.key_levels ?? 'not set'} | Reasoning: ${biasRow.reasoning ?? ''}\n` : '';

    // 5. Current prices context
    const priceCtx = prices ? `\nCURRENT PRICES: NQ ${prices.NQ ?? '—'} | ES ${prices.ES ?? '—'} | GC ${prices.GC ?? '—'} | DXY ${prices.DXY ?? '—'}\n` : '';

    const prompt = `You are an expert ICT (Inner Circle Trader) trading analyst. Analyze this setup using Smart Money Concepts from ICT's methodology.
${priceCtx}${cotContext}${smtContext}${biasContext}
SETUP:
Symbol: ${setup.symbol} | TF: ${setup.timeframe} | Direction: ${setup.direction?.toUpperCase()} | Type: ${setup.setup_type}
Entry zone: ${setup.entry_low}–${setup.entry_high} | SL: ${setup.stop_loss} | TP: ${setup.target} | RR: ${setup.rr_ratio}R
Confluence score: ${setup.confluence_score}/100 | HTF bias: ${setup.htf_bias}
CISD confirmed: ${setup.cisd_confirmed ? 'YES' : 'No'} | Volume: ${setup.volume_context}
${setup.bos_level ? `BOS level: ${setup.bos_level}` : ''} ${setup.choch_level ? `| CHoCH level: ${setup.choch_level}` : ''}
Draw on Liquidity: ${setup.dol_target}

ICT KNOWLEDGE CONTEXT:
${kbContext}

Provide a concise analysis (200–280 words) covering:
1. ALIGNMENT — does HTF bias, COT, and SMT all confirm this trade direction?
2. SETUP QUALITY — is the PD array valid? Is CISD real? Is price in the right zone (discount for longs, premium for shorts)?
3. EXECUTION — when to enter, what to watch for confirmation
4. RISK — what invalidates this setup, key levels to watch
5. VERDICT — Take it / Wait / Skip, with 1-line reason

Be direct and specific. Use ICT terminology.`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 900, temperature: 0.4, messages: [{ role:'user', content: prompt }] })
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Groq error: ${err}` }, { status: 500 });
    }

    const data = await res.json();
    const analysis = data.choices?.[0]?.message?.content ?? 'No analysis returned';

    // Cache the analysis on the setup
    await sb.from('setups').update({ ai_analysis: analysis }).eq('id', setup.id);

    return NextResponse.json({ analysis });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status:500 });
  }
}
