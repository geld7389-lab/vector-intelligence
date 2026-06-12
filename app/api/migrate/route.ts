import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const SQL = `
-- ============================================
-- VECTOR Intelligence v4 — DB Migration
-- Run this in Supabase SQL Editor
-- supabase.com → your project → SQL Editor
-- ============================================

-- Fix setups table
ALTER TABLE public.setups DROP CONSTRAINT IF EXISTS setups_status_check;
ALTER TABLE public.setups ADD CONSTRAINT setups_status_check 
  CHECK (status IN ('active','watching','triggered','invalidated','expired','won','lost'));
ALTER TABLE public.setups DROP CONSTRAINT IF EXISTS setups_direction_check;
ALTER TABLE public.setups ADD CONSTRAINT setups_direction_check 
  CHECK (direction IN ('bull','bear','long','short','inversion'));
ALTER TABLE public.setups DROP CONSTRAINT IF EXISTS setups_symbol_timeframe_setup_type_key;

-- Weekly bias
CREATE TABLE IF NOT EXISTS public.weekly_bias (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol text NOT NULL,
  bias text NOT NULL CHECK (bias IN ('bullish','bearish','neutral')),
  reasoning text,
  key_levels text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.weekly_bias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON public.weekly_bias;
CREATE POLICY "allow_all" ON public.weekly_bias FOR ALL USING (true);

-- SMT signals
CREATE TABLE IF NOT EXISTS public.smt_signals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nq_price numeric(12,2),
  es_price numeric(12,2),
  nq_swing text,
  es_swing text,
  divergence_type text,
  timeframe text DEFAULT '15m',
  notes text,
  detected_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.smt_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON public.smt_signals;
CREATE POLICY "allow_all" ON public.smt_signals FOR ALL USING (true);

-- COT data
CREATE TABLE IF NOT EXISTS public.cot_data (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol text NOT NULL,
  report_date date NOT NULL,
  comm_long integer, comm_short integer, comm_net integer,
  large_long integer, large_short integer, large_net integer,
  small_net integer, oi integer, date text,
  UNIQUE (report_date, symbol)
);
ALTER TABLE public.cot_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON public.cot_data;
CREATE POLICY "allow_all" ON public.cot_data FOR ALL USING (true);

-- Backtest runs
CREATE TABLE IF NOT EXISTS public.backtest_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  start_date date, end_date date,
  total_trades integer, wins integer, losses integer,
  win_rate numeric(6,2), total_pnl numeric(12,2),
  max_drawdown numeric(12,2), sharpe_ratio numeric(8,2),
  profit_factor numeric(8,2), expectancy numeric(10,2),
  avg_rr numeric(6,2), max_consecutive_losses integer,
  parameters jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON public.backtest_runs;
CREATE POLICY "allow_all" ON public.backtest_runs FOR ALL USING (true);

-- Telegram config
CREATE TABLE IF NOT EXISTS public.telegram_config (
  id integer PRIMARY KEY DEFAULT 1,
  bot_token text, chat_id text,
  active boolean DEFAULT true,
  alert_sl boolean DEFAULT true,
  alert_entry boolean DEFAULT true,
  alert_tp boolean DEFAULT true,
  alert_scan boolean DEFAULT false,
  alert_types jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT telegram_config_singleton CHECK (id = 1)
);
ALTER TABLE public.telegram_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON public.telegram_config;
CREATE POLICY "allow_all" ON public.telegram_config FOR ALL USING (true);

-- Journal
CREATE TABLE IF NOT EXISTS public.journal (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date date NOT NULL,
  title text NOT NULL,
  body text, emotion text, result text, trade_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.journal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON public.journal;
CREATE POLICY "allow_all" ON public.journal FOR ALL USING (true);

SELECT 'Migration complete ✓' as status;
`.trim();

export async function GET() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>VECTOR — DB Migration</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #09090b; color: #e4e4e7; font-family: ui-monospace, monospace; padding: 32px 24px; }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #fff; }
    p { font-size: 13px; color: #71717a; margin-bottom: 20px; line-height: 1.6; }
    .steps { margin-bottom: 20px; }
    .step { font-size: 13px; color: #a1a1aa; padding: 4px 0; }
    .step span { color: #22c55e; font-weight: 600; }
    .sql-box { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 20px; position: relative; }
    pre { font-size: 11px; color: #a1a1aa; white-space: pre-wrap; line-height: 1.6; max-height: 400px; overflow-y: auto; }
    .copy-btn { position: absolute; top: 12px; right: 12px; background: #3f3f46; border: 1px solid #52525b; color: #e4e4e7; padding: 6px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; font-family: inherit; }
    .copy-btn:hover { background: #52525b; }
    .copy-btn.copied { background: #166534; border-color: #16a34a; color: #86efac; }
    .link { color: #60a5fa; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .tag { display: inline-block; background: #1e3a5f; color: #60a5fa; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-right: 4px; }
  </style>
</head>
<body>
  <h1>VECTOR — Database Migration Required</h1>
  <p>Run this SQL once in Supabase to create all missing tables. Takes 5 seconds.</p>
  
  <div class="steps">
    <div class="step"><span>1.</span> Go to <a class="link" href="https://supabase.com" target="_blank">supabase.com</a> → your project</div>
    <div class="step"><span>2.</span> Click <strong style="color:#e4e4e7">SQL Editor</strong> in the left sidebar</div>
    <div class="step"><span>3.</span> Click <strong style="color:#e4e4e7">+ New query</strong></div>
    <div class="step"><span>4.</span> Copy the SQL below → paste → click <strong style="color:#22c55e">Run</strong></div>
    <div class="step"><span>5.</span> Done — reload the app and everything works</div>
  </div>

  <p>Creates: <span class="tag">weekly_bias</span><span class="tag">smt_signals</span><span class="tag">cot_data</span><span class="tag">backtest_runs</span><span class="tag">telegram_config</span><span class="tag">journal</span></p>

  <div class="sql-box">
    <button class="copy-btn" onclick="copySQL()">Copy SQL</button>
    <pre id="sql">${SQL.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
  </div>

  <script>
    function copySQL() {
      const sql = document.getElementById('sql').innerText;
      navigator.clipboard.writeText(sql).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = 'Copied ✓';
        btn.className = 'copy-btn copied';
        setTimeout(() => { btn.textContent = 'Copy SQL'; btn.className = 'copy-btn'; }, 3000);
      });
    }
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}
