import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://vector-intelligence-five.vercel.app';

const GROQ_KEY = process.env.GROQ_API_KEY ?? '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';

const SYMBOLS = ['NQ','ES','GC','EURUSD','GBPUSD','USDJPY','BTC','ETH','CL'];

async function callAgent(path: string, body: any, timeoutMs = 25000) {
  try {
    const r = await fetch(`${BASE}/api/agents/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
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

  // ── Run-lock: prevent overlapping cycles ──────────────────────────────
  // There was previously NO protection against two orchestrator runs firing
  // at once (e.g. a fast external cron on top of a manual trigger, or a slow
  // MT5/Yahoo response causing one cycle to still be mid-flight when the next
  // starts). Two overlapping cycles both evaluating risk and executing trades
  // against a not-yet-updated DB state could double-fire orders or blow past
  // intended risk limits. Lock is considered stale after 3 minutes (well
  // beyond the ~18-20s a normal cycle takes, but short enough that a genuinely
  // crashed run doesn't block the system indefinitely).
  const LOCK_STALE_MS = 3 * 60 * 1000;
  const { data: lockRow } = await sb.from('agent_status').select('status, updated_at').eq('agent', 'orchestrator_lock').single();
  if (lockRow?.status === 'running' && (Date.now() - new Date(lockRow.updated_at).getTime()) < LOCK_STALE_MS) {
    return NextResponse.json({ ok: false, skipped: 'orchestrator already running', locked_since: lockRow.updated_at });
  }
  await sb.from('agent_status').upsert({
    agent: 'orchestrator_lock', status: 'running', last_action: 'Cycle in progress',
    data: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'agent' });

  try {

  await saveAgentStatus('orchestrator', 'running', 'Starting full agent cycle');

  // 0. Position Monitor — client-side SL/TP enforcement (broker strips stops on this account)
  // Runs FIRST so closed positions are reflected in risk before new trades are considered.
  // NOTE: uses full path because monitor is at /api/trades/monitor, NOT /api/agents/trades/monitor
  // NOTE: monitor route saves its own detailed agent_status (with watching[] data) — do NOT
  // call saveAgentStatus('position_monitor', ...) here again, it was silently overwriting
  // that detailed status with data:null on every single cycle.
  let monitorResult: any = null;
  try {
    const monRes = await fetch(`${BASE}/api/trades/monitor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(25000),
    });
    monitorResult = await monRes.json();
  } catch (e: any) {
    monitorResult = { ok: false, error: 'fetch_failed: ' + e.message };
    // Only write here if the monitor route itself never ran (network/fetch failure)
    await saveAgentStatus('position_monitor', 'running', `⚠ Error: ${monitorResult.error}`);
  }

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
  }, 55000);
  results.executor = execResult;
  await saveAgentStatus('executor', 'running',
    execResult
      ? execResult.trades_executed > 0
        ? `✓ ${execResult.trades_executed} trade(s) executed — ${execResult.executed?.map((e:any)=>`${e.direction.toUpperCase()} ${e.symbol}`).join(', ')}`
        : execResult.blocked
          ? `Blocked: ${execResult.reason}`
          : execResult.failed?.length
            ? `${execResult.failed.length} failed: ${execResult.failed.map((f:any)=>`${f.symbol} — ${f.reason}`).join(' | ')}`
            : execResult.error ?? execResult.message ?? 'No trades to execute'
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

  } catch (e: any) {
    await saveAgentStatus('orchestrator', 'error', `⚠ Cycle crashed: ${e.message}`);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  } finally {
    // Always release the lock, success or failure, so a single crashed cycle
    // can't permanently block every future run.
    await sb.from('agent_status').upsert({
      agent: 'orchestrator_lock', status: 'idle', last_action: 'Cycle finished',
      data: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'agent' });
  }
}

export async function GET() {
  const { data } = await sb.from('agent_status').select('*').order('agent');
  return NextResponse.json({ agents: data ?? [] });
}
