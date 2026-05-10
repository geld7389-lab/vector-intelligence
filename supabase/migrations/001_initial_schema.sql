-- VECTOR Intelligence System — Database Schema
-- Supabase Migration 001

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── SETUPS TABLE ────────────────────────────
create table if not exists public.setups (
  id uuid primary key default uuid_generate_v4(),
  symbol text not null,
  timeframe text not null,
  setup_type text not null,
  direction text not null check (direction in ('bull', 'bear', 'inversion')),
  confluence_score integer not null default 0 check (confluence_score between 0 and 100),
  entry_low numeric(10,2) not null,
  entry_high numeric(10,2) not null,
  stop_loss numeric(10,2) not null,
  target numeric(10,2) not null,
  rr_ratio numeric(5,2) not null default 0,
  status text not null default 'watching' check (status in ('active','watching','triggered','invalidated','won','lost')),
  dol_target text,
  ai_analysis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (symbol, timeframe, setup_type)
);

-- ─── PD ARRAYS TABLE ─────────────────────────
create table if not exists public.pd_arrays (
  id uuid primary key default uuid_generate_v4(),
  symbol text not null,
  timeframe text not null,
  type text not null check (type in ('ob','fvg','bisi','sibi','iob','ifvg','ibrk','brk')),
  direction text not null check (direction in ('bull','bear')),
  price_high numeric(10,2) not null,
  price_low numeric(10,2) not null,
  is_mitigated boolean not null default false,
  is_inverted boolean not null default false,
  strength integer default 50 check (strength between 0 and 100),
  created_at timestamptz not null default now()
);

-- ─── TRADES TABLE ────────────────────────────
create table if not exists public.trades (
  id uuid primary key default uuid_generate_v4(),
  setup_id uuid references public.setups(id) on delete set null,
  symbol text not null,
  direction text not null check (direction in ('long','short')),
  entry_price numeric(10,2) not null,
  stop_loss numeric(10,2) not null,
  take_profit numeric(10,2) not null,
  result text check (result in ('win','loss','breakeven','open')),
  rr_achieved numeric(5,2),
  notes text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

-- ─── KNOWLEDGE BASE TABLE ────────────────────
create table if not exists public.knowledge_base (
  id uuid primary key default uuid_generate_v4(),
  category text not null,
  title text not null,
  content text not null,
  source_episode text,
  tags text[] default '{}',
  created_at timestamptz not null default now()
);

-- ─── SCANNER ALERTS TABLE ────────────────────
create table if not exists public.scanner_alerts (
  id uuid primary key default uuid_generate_v4(),
  symbol text not null,
  timeframe text,
  alert_type text not null,
  message text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─── INDEXES ─────────────────────────────────
create index if not exists idx_setups_symbol on public.setups(symbol);
create index if not exists idx_setups_direction on public.setups(direction);
create index if not exists idx_setups_confluence on public.setups(confluence_score desc);
create index if not exists idx_setups_status on public.setups(status);
create index if not exists idx_pd_arrays_symbol on public.pd_arrays(symbol, timeframe);
create index if not exists idx_trades_symbol on public.trades(symbol);
create index if not exists idx_alerts_unread on public.scanner_alerts(is_read, created_at desc);

-- ─── ROW LEVEL SECURITY ──────────────────────
alter table public.setups enable row level security;
alter table public.pd_arrays enable row level security;
alter table public.trades enable row level security;
alter table public.knowledge_base enable row level security;
alter table public.scanner_alerts enable row level security;

-- Allow all operations for authenticated users (single-user private system)
create policy "Private access only" on public.setups for all using (true);
create policy "Private access only" on public.pd_arrays for all using (true);
create policy "Private access only" on public.trades for all using (true);
create policy "Private access only" on public.knowledge_base for all using (true);
create policy "Private access only" on public.scanner_alerts for all using (true);

-- ─── SEED KNOWLEDGE BASE ─────────────────────
insert into public.knowledge_base (category, title, content, source_episode, tags) values
(
  'PD Arrays',
  'Order Block (OB)',
  'The last bearish candle before a bullish impulse move (for bullish OB) or last bullish candle before a bearish impulse. Price returns to fill the imbalance created. Key: the candle must precede a significant move leaving an FVG. OBs are the highest-probability entry zones in this model. Only valid when in correct premium/discount zone aligned with HTF bias.',
  'Episode 1',
  ARRAY['OB', 'Order Block', 'PD Array', 'Entry', 'Discount', 'Premium']
),
(
  'PD Arrays',
  'Fair Value Gap (FVG / BISI / SIBI)',
  'A 3-candle imbalance where the middle candle moves so strongly that the wicks of candles 1 and 3 do not overlap. Creates a gap in price delivery. BISI = Buy Side Imbalance Sell Side Inefficiency (bullish, buy from). SIBI = Sell Side Imbalance Buy Side Inefficiency (bearish, sell from). Both visible in Ep1 on weekly SPX as green and red shaded zones.',
  'Episode 1',
  ARRAY['FVG', 'BISI', 'SIBI', 'Imbalance', 'PD Array', 'Fair Value Gap']
),
(
  'PD Arrays',
  'Inversion PD Arrays (IOB / IFVG / IBRK)',
  'When an OB, FVG, or BRK is broken through with a full candle body close, it inverts. The formerly bullish OB becomes a bearish IOB — price returns to test it from below as resistance. IOB = Inversion Order Block, IFVG = Inversion Fair Value Gap, IBRK = Inversion Breaker. Stacked inversions create strongest levels. Visible on ES 15m in Ep4.',
  'Episode 4',
  ARRAY['IOB', 'IFVG', 'IBRK', 'Inversion', 'PD Array']
),
(
  'Core Model',
  'Change in State of Delivery (CISD)',
  'The real market structure shift. A bullish CISD = price sweeps SSL, then a strong move up creates a new higher swing point confirmed by a FULL CANDLE BODY CLOSE above the prior swing high. CRITICAL: a wick through a level is NOT a real MSS. Only a full body close counts. The CISD is the trade trigger, not the sweep itself. Shown on SPX daily in Ep2 as Bearish Change in State of Delivery.',
  'Episode 2',
  ARRAY['CISD', 'MSS', 'Market Structure Shift', 'Entry Trigger', 'Real MSS']
),
(
  'DOL Framework',
  'Draw On Liquidity (DOL)',
  'Where price is magnetically drawn to next. Always a liquidity pool: equal highs, equal lows, prior HTF highs/lows, BSL/SSL clusters. The 5 questions: (1) Where is price delivering FROM (which liquidity)? (2) Where did CISD occur? (3) Where is price now? (4) Which PD arrays are being respected? (5) Where is price delivering TO? All 5 must be answered before entry.',
  'Episode 3',
  ARRAY['DOL', 'Draw on Liquidity', 'Liquidity', 'BSL', 'SSL', 'Target', '5 Questions']
),
(
  'Refinement',
  'Liquidity Sequencing Rule',
  'Critical rule from Ep6: "When bullish and price hits buyside liquidity — wait for a run on sell stops before looking long." Never buy directly into BSL. Wait for the sweep (SSL run), then CISD confirmation, then entry from the discount PD array. This rule alone eliminates most losing trades by preventing chasing into exhausted liquidity.',
  'Episode 6',
  ARRAY['BSL', 'SSL', 'Sequencing', 'Key Rule', 'Stop Hunt', 'Liquidity Sweep']
),
(
  'MMXM',
  'Market Maker Model (MMXM)',
  'The full institutional cycle: Accumulation (range/consolidation, smart money building positions) → Manipulation (engineered stop hunt against retail bias to collect liquidity) → Distribution (true directional delivery to opposing pool). Multi-TF DOL mapping: 1H DOL sets macro target, 5m MMMB DOL pinpoints micro entry. Shown on SPX weekly in Bonus episode.',
  'Bonus Episode',
  ARRAY['MMXM', 'Market Maker', 'Accumulation', 'Manipulation', 'Distribution', 'Institutional']
),
(
  'Execution',
  'Multi-Timeframe Execution Model',
  'Daily/Weekly: establish directional bias and identify HTF PD arrays. 4H: confirm CISD and major structure. 1H: identify DOL and confirm CISD. 15m/5m: find the entry-level PD array (OB, FVG, BISI) left behind by the CISD impulse move. Live NQ execution in Ep5 shows this entire top-down process from BRK on daily to IOB on 15m.',
  'Episode 5',
  ARRAY['MTF', 'Multi-Timeframe', 'Execution', 'Top-Down', 'Confluence', 'NQ']
)
on conflict do nothing;

-- ─── SEED INITIAL SETUPS ─────────────────────
insert into public.setups (symbol, timeframe, setup_type, direction, confluence_score, entry_low, entry_high, stop_loss, target, rr_ratio, status, dol_target) values
('NQ', '15m', 'Bullish CISD + OB', 'bull', 87, 20315, 20380, 20180, 20750, 2.6, 'active', '20,750 BSL'),
('ES', '1H', 'BISI + SSL Swept', 'bull', 79, 5830, 5855, 5800, 5920, 2.3, 'watching', '5,920 BSL'),
('NQ', '4H', 'IOB Retest', 'inversion', 64, 20540, 20620, 20700, 20180, 2.2, 'watching', '20,200 SSL'),
('ES', '4H', 'BRK Retest Long', 'bull', 72, 5820, 5840, 5790, 5900, 2.0, 'watching', '5,900 BSL'),
('NQ', '1H', 'IOB + IFVG Stack', 'inversion', 68, 20490, 20550, 20400, 20750, 2.5, 'watching', '20,600 BSL')
on conflict (symbol, timeframe, setup_type) do update
  set confluence_score = excluded.confluence_score,
      updated_at = now();
