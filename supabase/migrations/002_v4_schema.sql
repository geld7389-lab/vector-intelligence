-- VECTOR Intelligence — Migration 002
-- Adds all missing columns and tables for v4.0

-- ─── FIX SETUPS TABLE ────────────────────────
-- Add missing columns
alter table public.setups add column if not exists htf_bias text;
alter table public.setups add column if not exists cisd_confirmed boolean default false;
alter table public.setups add column if not exists volume_context text default 'normal';
alter table public.setups add column if not exists killzone_valid text;
alter table public.setups add column if not exists correlated_align boolean default false;
alter table public.setups add column if not exists market_section text default 'futures';
alter table public.setups add column if not exists expires_at timestamptz;
alter table public.setups add column if not exists bos_level numeric(12,2);
alter table public.setups add column if not exists choch_level numeric(12,2);
alter table public.setups add column if not exists invalidated_reason text;

-- Fix status constraint to include 'expired'
alter table public.setups drop constraint if exists setups_status_check;
alter table public.setups add constraint setups_status_check 
  check (status in ('active','watching','triggered','invalidated','expired','won','lost'));

-- Fix direction constraint to allow 'long' and 'bear'
alter table public.setups drop constraint if exists setups_direction_check;
alter table public.setups add constraint setups_direction_check
  check (direction in ('bull','bear','long','short','inversion'));

-- Remove the unique constraint that prevents multiple setups per symbol+tf+type
alter table public.setups drop constraint if exists setups_symbol_timeframe_setup_type_key;

-- ─── TRADE LOG TABLE ─────────────────────────
create table if not exists public.trade_log (
  id uuid primary key default uuid_generate_v4(),
  symbol text not null,
  direction text not null,
  entry_price numeric(12,2) not null,
  stop_loss numeric(12,2),
  target numeric(12,2),
  exit_price numeric(12,2),
  entry_time timestamptz not null default now(),
  exit_time timestamptz,
  r_multiple numeric(8,2),
  pnl_dollars numeric(10,2),
  risk_dollars numeric(10,2) default 100,
  risk_pct numeric(6,2) default 1,
  planned_rr numeric(6,2),
  result text default 'open' check (result in ('open','win','loss','be','breakeven')),
  setup_id uuid,
  setup_type text,
  timeframe text,
  session text,
  notes text,
  mistakes text[] default '{}',
  created_at timestamptz not null default now()
);

alter table public.trade_log enable row level security;
create policy if not exists "Private access" on public.trade_log for all using (true);
create index if not exists idx_trade_log_symbol on public.trade_log(symbol);
create index if not exists idx_trade_log_result on public.trade_log(result);
create index if not exists idx_trade_log_entry on public.trade_log(entry_time desc);

-- ─── JOURNAL TABLE ───────────────────────────
create table if not exists public.journal (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  title text not null,
  body text,
  emotion text,
  result text,
  trade_id uuid,
  created_at timestamptz not null default now()
);

alter table public.journal enable row level security;
create policy if not exists "Private access" on public.journal for all using (true);
create index if not exists idx_journal_date on public.journal(date desc);

-- ─── WEEKLY BIAS TABLE ───────────────────────
create table if not exists public.weekly_bias (
  id uuid primary key default uuid_generate_v4(),
  symbol text not null,
  bias text not null check (bias in ('bullish','bearish','neutral')),
  reasoning text,
  key_levels text,
  created_at timestamptz not null default now()
);

alter table public.weekly_bias enable row level security;
create policy if not exists "Private access" on public.weekly_bias for all using (true);
create index if not exists idx_weekly_bias_sym on public.weekly_bias(symbol, created_at desc);

-- ─── TELEGRAM CONFIG TABLE ───────────────────
create table if not exists public.telegram_config (
  id integer primary key default 1,
  bot_token text,
  chat_id text,
  active boolean default true,
  alert_sl boolean default true,
  alert_entry boolean default true,
  alert_tp boolean default true,
  alert_scan boolean default false,
  alert_types jsonb default '{}',
  updated_at timestamptz default now(),
  constraint telegram_config_singleton check (id = 1)
);

alter table public.telegram_config enable row level security;
create policy if not exists "Private access" on public.telegram_config for all using (true);

-- ─── SMT SIGNALS TABLE ───────────────────────
create table if not exists public.smt_signals (
  id uuid primary key default uuid_generate_v4(),
  nq_price numeric(12,2),
  es_price numeric(12,2),
  nq_swing text,
  es_swing text,
  divergence_type text,
  timeframe text default '15m',
  notes text,
  detected_at timestamptz not null default now()
);

alter table public.smt_signals enable row level security;
create policy if not exists "Private access" on public.smt_signals for all using (true);
create index if not exists idx_smt_detected on public.smt_signals(detected_at desc);

-- ─── COT DATA TABLE ──────────────────────────
create table if not exists public.cot_data (
  id uuid primary key default uuid_generate_v4(),
  symbol text not null,
  report_date date not null,
  comm_long integer,
  comm_short integer,
  comm_net integer,
  large_long integer,
  large_short integer,
  large_net integer,
  small_net integer,
  oi integer,
  date text,
  unique (report_date, symbol)
);

alter table public.cot_data enable row level security;
create policy if not exists "Private access" on public.cot_data for all using (true);
create index if not exists idx_cot_sym_date on public.cot_data(symbol, report_date desc);

-- ─── BACKTEST RUNS TABLE ─────────────────────
create table if not exists public.backtest_runs (
  id uuid primary key default uuid_generate_v4(),
  name text,
  symbol text not null,
  timeframe text not null,
  start_date date,
  end_date date,
  total_trades integer,
  wins integer,
  losses integer,
  win_rate numeric(6,2),
  total_pnl numeric(12,2),
  max_drawdown numeric(12,2),
  sharpe_ratio numeric(8,2),
  profit_factor numeric(8,2),
  expectancy numeric(10,2),
  avg_rr numeric(6,2),
  max_consecutive_losses integer,
  parameters jsonb,
  created_at timestamptz not null default now()
);

alter table public.backtest_runs enable row level security;
create policy if not exists "Private access" on public.backtest_runs for all using (true);
create index if not exists idx_backtest_created on public.backtest_runs(created_at desc);

