import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

// Uses service_role-level operations via Supabase's stored procedure approach
// Since we only have anon key, we use it to test what exists and report status
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

const TABLES = ['setups','trades','knowledge_base','weekly_bias','smt_signals','cot_data','backtest_runs','telegram_config','journal','trade_log'];

export async function GET() {
  const status: Record<string,string> = {};
  for (const t of TABLES) {
    const { error } = await sb.from(t).select('id').limit(1);
    status[t] = error ? `MISSING: ${error.message}` : 'OK';
  }
  const missing = Object.entries(status).filter(([,v])=>v!=='OK').map(([k])=>k);
  return NextResponse.json({
    status,
    missing,
    message: missing.length === 0
      ? 'All tables exist ✓'
      : `Missing ${missing.length} tables: ${missing.join(', ')}. Run the SQL below in Supabase SQL Editor.`,
    sql: missing.length > 0 ? getMigrationSQL() : null
  });
}

function getMigrationSQL(): string {
  return `
-- VECTOR Intelligence v4 — Run this in Supabase SQL Editor
-- Go to: supabase.com → your project → SQL Editor → paste and run

-- Fix setups table constraints
ALTER TABLE public.setups DROP CONSTRAINT IF EXISTS setups_status_check;
ALTER TABLE public.setups ADD CONSTRAINT setups_status_check CHECK (status IN ('active','watching','triggered','invalidated','expired','won','lost'));
ALTER TABLE public.setups DROP CONSTRAINT IF EXISTS setups_direction_check;
ALTER TABLE public.setups ADD CONSTRAINT setups_direction_check CHECK (direction IN ('bull','bear','long','short','inversion'));
ALTER TABLE public.setups DROP CONSTRAINT IF EXISTS setups_symbol_timeframe_setup_type_key;

-- Weekly bias
CREATE TABLE IF NOT EXISTS public.weekly_bias (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol text NOT NULL,
  bias text NOT NULL CHECK (bias IN ('bullish','bearish','neutral')),
  reasoning text, key_levels text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.weekly_bias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Private access" ON public.weekly_bias;
CREATE POLICY "Private access" ON public.weekly_bias FOR ALL USING (true);

-- SMT signals
CREATE TABLE IF NOT EXISTS public.smt_signals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nq_price numeric(12,2), es_price numeric(12,2),
  nq_swing text, es_swing text,
  divergence_type text, timeframe text DEFAULT '15m', notes text,
  detected_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.smt_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Private access" ON public.smt_signals;
CREATE POLICY "Private access" ON public.smt_signals FOR ALL USING (true);

-- COT data
CREATE TABLE IF NOT EXISTS public.cot_data (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol text NOT NULL, report_date date NOT NULL,
  comm_long integer, comm_short integer, comm_net integer,
  large_long integer, large_short integer, large_net integer,
  small_net integer, oi integer, date text,
  UNIQUE (report_date, symbol)
);
ALTER TABLE public.cot_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Private access" ON public.cot_data;
CREATE POLICY "Private access" ON public.cot_data FOR ALL USING (true);

-- Backtest runs
CREATE TABLE IF NOT EXISTS public.backtest_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol text NOT NULL, timeframe text NOT NULL,
  start_date date, end_date date,
  total_trades integer, wins integer, losses integer,
  win_rate numeric(6,2), total_pnl numeric(12,2),
  max_drawdown numeric(12,2), sharpe_ratio numeric(8,2),
  profit_factor numeric(8,2), expectancy numeric(10,2),
  avg_rr numeric(6,2), max_consecutive_losses integer,
  parameters jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Private access" ON public.backtest_runs;
CREATE POLICY "Private access" ON public.backtest_runs FOR ALL USING (true);

-- Telegram config
CREATE TABLE IF NOT EXISTS public.telegram_config (
  id integer PRIMARY KEY DEFAULT 1,
  bot_token text, chat_id text, active boolean DEFAULT true,
  alert_sl boolean DEFAULT true, alert_entry boolean DEFAULT true,
  alert_tp boolean DEFAULT true, alert_scan boolean DEFAULT false,
  alert_types jsonb DEFAULT '{}', updated_at timestamptz DEFAULT now(),
  CONSTRAINT telegram_config_singleton CHECK (id = 1)
);
ALTER TABLE public.telegram_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Private access" ON public.telegram_config;
CREATE POLICY "Private access" ON public.telegram_config FOR ALL USING (true);

-- Journal
CREATE TABLE IF NOT EXISTS public.journal (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date date NOT NULL, title text NOT NULL,
  body text, emotion text, result text, trade_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.journal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Private access" ON public.journal;
CREATE POLICY "Private access" ON public.journal FOR ALL USING (true);

SELECT 'Migration complete' as status;
`.trim();
}
