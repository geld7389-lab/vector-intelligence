import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.GJgxNwP6LfphbHTijGhrHK5DMpDcarJin2bVmoxU4bo'
);

// TradingView webhook receiver
// In TradingView: set alert webhook URL to https://vector-intelligence-five.vercel.app/api/tv-webhook
// Alert message JSON format:
// {"symbol":"NQ1!","timeframe":"15","direction":"bull","setup_type":"FVG Retest","entry_low":21000,"entry_high":21050,"stop_loss":20900,"target":21300,"htf_bias":"bullish","note":"SSL swept, in discount, CISD pending"}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      symbol = 'UNKNOWN',
      timeframe = '15m',
      direction = 'bull',
      setup_type = 'TV Alert',
      entry_low,
      entry_high,
      stop_loss,
      target,
      htf_bias = 'unknown',
      note = '',
      price = null,
    } = body;

    if (!entry_low || !entry_high || !stop_loss || !target) {
      return NextResponse.json({ error: 'Missing required fields: entry_low, entry_high, stop_loss, target' }, { status: 400 });
    }

    const entryMid = (entry_low + entry_high) / 2;
    const rrRatio = Math.abs(target - entryMid) / Math.abs(entryMid - stop_loss);

    const expires = new Date();
    expires.setDate(expires.getDate() + 2);

    const setup = {
      symbol: symbol.replace('1!', '').replace('PERP', '').toUpperCase(),
      timeframe,
      direction,
      setup_type,
      entry_low: Number(entry_low),
      entry_high: Number(entry_high),
      stop_loss: Number(stop_loss),
      target: Number(target),
      rr_ratio: Number(rrRatio.toFixed(2)),
      confluence_score: 70,
      status: 'watching',
      dol_target: target > entryMid ? `BSL at ${target}` : `SSL at ${target}`,
      htf_bias,
      cisd_confirmed: false,
      volume_context: note || 'TV alert — verify volume manually',
      killzone_valid: 'verify',
      correlated_align: false,
      expires_at: expires.toISOString(),
      market_section: symbol.includes('BTC') || symbol.includes('ETH') ? 'crypto'
        : symbol.includes('EUR') || symbol.includes('GBP') || symbol.includes('JPY') ? 'forex'
        : ['SPY','QQQ','IWM','AAPL','NVDA','MSFT','AMZN','GOOGL','META','TSLA'].some(s => symbol.includes(s)) ? 'stocks'
        : 'futures',
      tv_alert_price: price ? Number(price) : null,
    };

    const { data, error } = await sb.from('setups').insert(setup).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, setup: data, message: `Setup created: ${symbol} ${direction.toUpperCase()} R:R ${rrRatio.toFixed(2)}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// GET — return webhook URL instructions
export async function GET() {
  return NextResponse.json({
    webhook_url: 'https://vector-intelligence-five.vercel.app/api/tv-webhook',
    method: 'POST',
    content_type: 'application/json',
    example_payload: {
      symbol: 'NQ1!',
      timeframe: '15',
      direction: 'bull',
      setup_type: 'FVG Retest',
      entry_low: 21000,
      entry_high: 21050,
      stop_loss: 20900,
      target: 21300,
      htf_bias: 'bullish',
      note: 'SSL swept, in discount, CISD pending'
    },
    instructions: [
      '1. Open TradingView and set up your alert',
      '2. In "Notifications", enable Webhook URL',
      '3. Paste the webhook_url above',
      '4. Set alert message to JSON format shown in example_payload',
      '5. Alert will auto-create a setup in VECTOR'
    ]
  });
}
