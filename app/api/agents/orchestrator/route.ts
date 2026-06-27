import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://vector-intelligence-five.vercel.app';

const GROQ_KEY = process.env.GROQ_API_KEY ?? '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';

const SYMBOLS = ['NQ','ES','GC','EURUSD','GBPUSD','USDJPY','BTC','ETH','CL'];

async function callAgent(path: string, body: any) {
  try {
    const r = await fetch(`${BASE}/api/agents/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function saveAgentStatus(agent: string, status: string, last_action: string, data: any = null) {
  await sb.from('agent_status').upsert({
    agent,
    status,
    last_action,
    data: data ? JSON.stringify(data) : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'agent' });
}

export async function POST(req: NextRequest) {
  const { symbols = SYMBOLS } = await req.json().catch(() => ({}));
  const results: Record<string, any> = {};
  const started = Date.now();

  await saveAgentStatus('orchestrator', 'running', 'Starting full agent cycle');

  // 1. Market Structure
  await saveAgentStatus('market_structure', 'running', 'Scanning market structure...');
  const msResult = await callAgent('market-structure', { symbols });
  results.market_structure = msResult;
  await saveAgentStatus('market_structure', 'running',
    msResult ? `${Object.keys(msResult.biases ?? {}).length} symbols scanned` : 'Error', msResult);

  // 2. SMC / ICT
  await saveAgentStatus('smc', 'running', 'Detecting FVGs, OBs, liquidity...');
  const smcResult = await callAgent('smc', { symbols });
  results.smc = smcResult;
  await saveAgentStatus('smc', 'running',
    smcResult ? `${smcResult.fvgs?.length ?? 0} FVGs, ${smcResult.order_blocks?.length ?? 0} OBs` : 'Error', smcResult);

  // 3. Technical Confluence
  await saveAgentStatus('technical', 'running', 'Running RSI, EMA, VWAP...');
  const techResult = await callAgent('technical', { symbols });
  results.technical = techResult;
  await saveAgentStatus('technical', 'running',
    techResult ? 'Confluence calculated' : 'Error', techResult);

  // 4. Macro & Sentiment
  await saveAgentStatus('macro', 'running', 'Fetching news & sentiment...');
  const macroResult = await callAgent('macro', {});
  results.macro = macroResult;
  await saveAgentStatus('macro', 'running',
    macroResult ? `${macroResult.news?.length ?? 0} events, DXY ${macroResult.dxy_trend ?? '—'}` : 'Error', macroResult);

  // 5. Risk check
  await saveAgentStatus('risk', 'running', 'Checking portfolio risk...');
  const riskResult = await callAgent('risk', {});
  results.risk = riskResult;
  await saveAgentStatus('risk', 'running',
    riskResult ? `Heat: ${riskResult.portfolio_heat?.toFixed(2) ?? 0}%` : 'Error', riskResult);

  // 6. AI Brain — score top setups
  await saveAgentStatus('ai_brain', 'running', 'Scoring setups with Groq AI...');
  const brainResult = await callAgent('ai-brain', {
    biases: msResult?.biases ?? {},
    fvgs: smcResult?.fvgs ?? [],
    order_blocks: smcResult?.order_blocks ?? [],
    confluence: techResult?.confluence ?? {},
    macro: macroResult ?? {},
    risk: riskResult ?? {},
  });
  results.ai_brain = brainResult;
  await saveAgentStatus('ai_brain', 'running',
    brainResult ? `${brainResult.approved?.length ?? 0} trades approved (score ≥8)` : 'Error', brainResult);

  // 7. Executor — place real MT5 trades
  await saveAgentStatus('executor', 'running', 'Executing approved trades on MT5...');
  // Get stored MT5 token
  const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent','mt5_session').single();
  const mt5Token = mt5Session?.data ? JSON.parse(mt5Session.data)?.token : null;
  const execResult = await callAgent('executor', {
    approved_trades: brainResult?.approved ?? [],
    risk: riskResult ?? {},
    mt5_token: mt5Token,
  });
  results.executor = execResult;
  await saveAgentStatus('executor', 'running',
    execResult
      ? execResult.trades_executed > 0
        ? `✓ ${execResult.trades_executed} trade(s) executed — ${execResult.executed?.map((e:any)=>`${e.direction.toUpperCase()} ${e.symbol}`).join(', ')}`
        : execResult.blocked
          ? `Blocked: ${execResult.reason}`
          : execResult.error ?? 'No trades to execute'
      : 'Error', execResult);

  // 8. Self-learning
  await saveAgentStatus('self_learning', 'running', 'Updating performance model...');
  const learnResult = await callAgent('self-learning', {});
  results.self_learning = learnResult;
  await saveAgentStatus('self_learning', 'running',
    learnResult ? `Win rate: ${learnResult.overall_win_rate?.toFixed(1) ?? 0}%` : 'Error', learnResult);

  // 9. Alerts
  await saveAgentStatus('alerts', 'running', 'Sending Telegram alerts...');
  const alertResult = await callAgent('alerts', {
    approved_trades: brainResult?.approved ?? [],
    executed_trades: execResult?.executed ?? [],
    biases: msResult?.biases ?? {},
    risk: riskResult ?? {},
  });
  results.alerts = alertResult;
  await saveAgentStatus('alerts', 'running',
    alertResult ? `${alertResult.sent ?? 0} alerts sent` : 'Error');

  // Final orchestrator status
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const executedCount = execResult?.trades_executed ?? 0;
  await saveAgentStatus('orchestrator', 'running',
    `Cycle complete in ${elapsed}s — ${brainResult?.approved?.length ?? 0} approved, ${executedCount} executed on MT5`);

  return NextResponse.json({
    ok: true,
    elapsed_s: parseFloat(elapsed),
    symbols_scanned: symbols.length,
    approved_trades: brainResult?.approved?.length ?? 0,
    executed_trades: execResult?.trades_executed ?? 0,
    results,
  });
}

export async function GET() {
  const { data } = await sb.from('agent_status').select('*').order('agent');
  return NextResponse.json({ agents: data ?? [] });
}
