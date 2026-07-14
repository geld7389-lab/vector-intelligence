import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { agent, token, broker, login, password, server } = body;
    if (agent === 'mt5_session' && token) {
      await sb.from('agent_status').upsert({
        agent: 'mt5_session',
        status: 'connected',
        last_action: `Connected to ${broker ?? 'MT5'}`,
        data: JSON.stringify({ 
          token, broker, login, password, server,
          connected_at: new Date().toISOString() 
        }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent' });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  const { data } = await sb.from('agent_status').select('*');
  const agentMap: Record<string,any> = {};
  // Fields that must NEVER leave this server in an API response — this route
  // was returning agent_status rows completely raw, which meant the real MT5
  // broker password (and now the internal run-trigger secret) were sitting in
  // plaintext in a public, unauthenticated JSON response the frontend polls
  // every few seconds. Redact per-agent rather than just excluding whole rows,
  // since e.g. mt5_session.status is legitimately needed by the UI even though
  // mt5_session.data.password is not.
  const SENSITIVE_AGENTS = new Set(['run_secret']);
  const SENSITIVE_FIELDS = new Set(['password', 'token']);
  const redact = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(redact);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SENSITIVE_FIELDS.has(k) ? '[redacted]' : redact(v);
    }
    return out;
  };
  for (const row of (data ?? [])) {
    if (SENSITIVE_AGENTS.has(row.agent)) continue;
    agentMap[row.agent] = {
      status:      row.status,
      last_action: row.last_action,
      data:        row.data ? redact(JSON.parse(row.data)) : null,
      updated_at:  row.updated_at,
    };
  }

  // Get latest scan results
  const { data: biasData } = await sb.from('agent_status').select('data').eq('agent','market_structure').single();
  const { data: smcData   } = await sb.from('agent_status').select('data').eq('agent','smc').single();
  const { data: macroData } = await sb.from('agent_status').select('data').eq('agent','macro').single();
  const { data: learnData } = await sb.from('agent_status').select('data').eq('agent','self_learning').single();
  const { data: riskData  } = await sb.from('agent_status').select('data').eq('agent','risk').single();
  const { data: brainData } = await sb.from('agent_status').select('data').eq('agent','ai_brain').single();

  const parse = (d: any) => { try { return d?.data ? JSON.parse(d.data) : null; } catch { return null; } };

  const ms     = parse(biasData);
  const smc    = parse(smcData);
  const macro  = parse(macroData);
  const learn  = parse(learnData);
  const risk   = parse(riskData);
  const brain  = parse(brainData);

  return NextResponse.json({
    agents:          agentMap,
    biases:          ms?.biases ?? {},
    fvgs:            smc?.fvgs ?? [],
    order_blocks:    smc?.order_blocks ?? [],
    news:            macro?.news ?? [],
    dxy_trend:       macro?.dxy_trend ?? 'neutral',
    fear_greed:      macro?.fear_greed ?? null,
    blackout_active: macro?.blackout_active ?? false,
    learning:        learn ?? {},
    risk:            risk ?? {},
    approved_trades: brain?.approved ?? [],
    portfolio_heat:  risk?.portfolio_heat ?? 0,
    daily_pnl:       risk?.daily_pnl ?? 0,
  });
}
