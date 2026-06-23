import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { data } = await sb.from('agent_status').select('*');
  const agentMap: Record<string,any> = {};
  for (const row of (data ?? [])) {
    agentMap[row.agent] = {
      status:      row.status,
      last_action: row.last_action,
      data:        row.data ? JSON.parse(row.data) : null,
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
