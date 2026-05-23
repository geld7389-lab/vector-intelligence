import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { setup, prices } = await req.json();
    if (!setup) return NextResponse.json({ error: 'No setup provided' }, { status: 400 });

    const isExpired = setup.expires_at && new Date(setup.expires_at) < new Date();
    const price = prices?.[setup.symbol] ?? null;
    const isBull = setup.direction === 'bull' || setup.direction === 'long';
    const slBreached = price !== null && (isBull ? price < setup.stop_loss : price > setup.stop_loss);

    if (isExpired || slBreached) {
      return NextResponse.json({
        analysis: `INVALIDATED — ${slBreached ? `price (${price?.toFixed(1)}) broke SL (${setup.stop_loss})` : 'setup expired'}.\n\nDo not trade this. Archive it.`
      });
    }

    const entry = ((setup.entry_low ?? 0) + (setup.entry_high ?? 0)) / 2;
    const slDist = Math.abs(entry - setup.stop_loss).toFixed(1);
    const tpDist = Math.abs(setup.target - entry).toFixed(1);
    const currentStr = price ? `Current price: ${price.toFixed(1)}` : 'Price unavailable';
    const priceLocation = price
      ? price < setup.entry_low ? `Below entry zone — ${(setup.entry_low - price).toFixed(1)} pts away`
      : price > setup.entry_high ? `Above entry zone — ${(price - setup.entry_high).toFixed(1)} pts away`
      : `INSIDE entry zone (${price.toFixed(1)})`
      : 'Unknown';

    const prompt = `You are an ICT/SMC trading analyst. Be direct, specific, and brief. No fluff.

SETUP:
Symbol: ${setup.symbol} ${setup.timeframe}
Direction: ${setup.direction.toUpperCase()}
Type: ${setup.setup_type}
Entry zone: ${setup.entry_low} – ${setup.entry_high}
Stop loss: ${setup.stop_loss} (${slDist} pts risk)
Target: ${setup.target} (${tpDist} pts reward)
R:R: ${setup.rr_ratio}
DOL: ${setup.dol_target}
HTF bias: ${setup.htf_bias}
CISD confirmed: ${setup.cisd_confirmed ? 'YES' : 'NO — PENDING'}
Volume: ${setup.volume_context}
Killzone: ${setup.killzone_valid}
Confluence score: ${setup.confluence_score}

MARKET NOW:
${currentStr}
NQ: ${prices?.NQ?.toFixed(1) ?? '—'} | ES: ${prices?.ES?.toFixed(1) ?? '—'} | VIX: ${prices?.VIX?.toFixed(2) ?? '—'} | DXY: ${prices?.DXY?.toFixed(3) ?? '—'}
Price location: ${priceLocation}

Answer these 5 questions in order, one line each:
1. Is the DOL (${setup.dol_target}) still intact and reachable from current price?
2. Is price in a valid location to consider entry — discount/premium zone check?
3. CISD status: ${setup.cisd_confirmed ? 'confirmed' : 'NOT confirmed — what needs to happen?'}
4. What are the two main reasons this trade could fail right now?
5. Final verdict: WAIT, WATCH, or READY — and exactly why in one sentence.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    const text = data.content?.[0]?.text ?? 'No response';
    return NextResponse.json({ analysis: text });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
