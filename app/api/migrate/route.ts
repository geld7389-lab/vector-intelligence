import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const SQL = `
-- ============================================
-- VECTOR Intelligence v5 — Full DB Migration
-- Run in Supabase SQL Editor
-- ============================================

-- 1. Fix setups table: add all missing columns
ALTER TABLE public.setups DROP CONSTRAINT IF EXISTS setups_status_check;
ALTER TABLE public.setups ADD CONSTRAINT setups_status_check 
  CHECK (status IN ('active','watching','triggered','invalidated','expired','won','lost'));
ALTER TABLE public.setups DROP CONSTRAINT IF EXISTS setups_direction_check;
ALTER TABLE public.setups DROP CONSTRAINT IF EXISTS setups_symbol_timeframe_setup_type_key;

ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS ai_analysis text DEFAULT '';
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS dol_target text DEFAULT '';
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS htf_bias text DEFAULT 'neutral';
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS cisd_confirmed boolean DEFAULT false;
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS volume_context text DEFAULT 'normal';
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS bos_level numeric(14,4);
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS bos_direction text;
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS choch_level numeric(14,4);
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS killzone_valid text DEFAULT '';
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS correlated_align boolean DEFAULT false;
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS market_section text DEFAULT '';
ALTER TABLE public.setups ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2. Weekly bias
CREATE TABLE IF NOT EXISTS public.weekly_bias (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  symbol text NOT NULL,
  bias text NOT NULL,
  reasoning text,
  key_levels text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.weekly_bias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON public.weekly_bias;
CREATE POLICY "allow_all" ON public.weekly_bias FOR ALL USING (true);

-- 3. SMT signals
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

-- 4. COT data
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

-- 5. Backtest runs
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

-- 6. Telegram config
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
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS alert_scan boolean DEFAULT false;
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS alert_types jsonb DEFAULT '{}';

-- 7. Journal
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

-- 8. Knowledge base (if missing)
CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  content text,
  tags text[],
  source_episode text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON public.knowledge_base;
CREATE POLICY "allow_all" ON public.knowledge_base FOR ALL USING (true);

-- 9. Seed knowledge base with ICT core concepts (skip if already has data)
INSERT INTO public.knowledge_base (title, content, tags, source_episode) 
SELECT * FROM (VALUES
  ('Order Block (OB)', 'An Order Block is the last down-candle before a bullish impulse move, or the last up-candle before a bearish impulse. It represents institutional order flow. Bullish OBs form in discount (below 50% of range). Price often returns to fill these blocks before continuing. Look for OBs with high volume, followed by a strong impulse away from the level.', ARRAY['OB','entry','SMC'], 'Episode 1'),
  ('Fair Value Gap (FVG)', 'A Fair Value Gap (imbalance) forms when there is a 3-candle move where candle 1 high and candle 3 low do not overlap (bullish FVG) or candle 1 low and candle 3 high do not overlap (bearish FVG). Price is drawn to fill these inefficiencies. Unfilled FVGs in the direction of bias are high-probability entry zones.', ARRAY['FVG','imbalance','entry'], 'Episode 2'),
  ('Change of Character (CHoCH)', 'CHoCH marks the first sign of a trend reversal. In a downtrend: CHoCH occurs when price closes above a prior swing high for the first time. In an uptrend: CHoCH occurs when price closes below a prior swing low. CHoCH is the earliest signal of Smart Money repositioning. It is more powerful than BOS because it signals intent before the trend changes.', ARRAY['CHoCH','reversal','structure'], 'Episode 3'),
  ('Break of Structure (BOS)', 'BOS confirms trend continuation. In a bullish structure: each swing high getting broken to the upside is a BOS, confirming higher highs and higher lows. BOS after CHoCH confirms the new trend. Trade in the direction of BOS with pullbacks to OBs or FVGs in discount.', ARRAY['BOS','structure','trend'], 'Episode 3'),
  ('Inducement & SSL/BSL', 'SSL (Sell Side Liquidity) sits below swing lows where retail stops cluster. BSL (Buy Side Liquidity) sits above swing highs. Smart money runs these levels to fill large orders — called inducement. After SSL is swept, look for bullish reversal from discount. After BSL is swept, look for bearish reversal from premium. The sweep of liquidity is the trigger.', ARRAY['liquidity','SSL','BSL','inducement'], 'Episode 4'),
  ('CISD — Change in State of Delivery', 'CISD is a shift from bearish to bullish delivery (or vice versa). Signs: a bearish candle followed by a strong bullish candle that closes above recent highs, showing that smart money has switched from selling to buying. CISD in a discount zone after SSL sweep + OB = maximum confluence entry.', ARRAY['CISD','delivery','entry'], 'Episode 5'),
  ('Killzones', 'ICT Killzones are the highest probability trading windows: London Open (2–5am NY), New York AM (9:30–11am NY), New York PM (2–4pm NY). These windows align with institutional order flow. Best setups form at the open of these sessions when liquidity is highest and manipulation is most predictable.', ARRAY['killzone','session','timing'], 'Episode 6'),
  ('Premium vs Discount', 'The range is defined by the most recent swing high to swing low. The 50% level is equilibrium. Above 50% is premium (sell zone). Below 50% is discount (buy zone). ICT: always buy in discount, sell in premium. Never buy at premium or sell at discount. Use Fibonacci 61.8%–79% as the optimal entry zone within discount/premium.', ARRAY['premium','discount','fibonacci'], 'Episode 1'),
  ('SMT Divergence', 'SMT (Smart Money Technique) divergence occurs when correlated pairs diverge. If NQ makes a higher high but ES makes a lower high — bearish SMT. If NQ makes a lower low but ES makes a higher low — bullish SMT. SMT signals institutional distribution or accumulation before the move. Strongest when it occurs in a killzone at a key PD array.', ARRAY['SMT','divergence','correlation'], 'Episode 7'),
  ('COT Report — Commercial Positioning', 'CFTC COT (Commitment of Traders) report shows commercial hedger positioning. Commercials (smart money) are WRONG in the short term but RIGHT long term. When commercials are extremely net long at a low — expect a major bottom. When extremely net short at a high — expect a major top. Use COT to determine weekly/monthly bias, not for timing entries.', ARRAY['COT','institutional','CFTC'], 'Episode 8')
) AS v(title, content, tags, source_episode)
WHERE NOT EXISTS (SELECT 1 FROM public.knowledge_base LIMIT 1);

SELECT 'Migration complete ✓ — ' || COUNT(*)::text || ' tables ready' as status FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('setups','trades','weekly_bias','smt_signals','cot_data','backtest_runs','telegram_config','journal','knowledge_base');
`.trim();

export async function GET() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>VECTOR — DB Migration</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #09090b; color: #e4e4e7; font-family: ui-monospace, monospace; padding: 32px 24px; max-width: 860px; margin: 0 auto; }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #fff; }
    p { font-size: 13px; color: #71717a; margin-bottom: 20px; line-height: 1.6; }
    .steps { margin-bottom: 20px; }
    .step { font-size: 13px; color: #a1a1aa; padding: 4px 0; }
    .step span { color: #22c55e; font-weight: 600; margin-right: 6px; }
    .sql-box { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 20px; position: relative; }
    pre { font-size: 11px; color: #a1a1aa; white-space: pre-wrap; line-height: 1.6; max-height: 500px; overflow-y: auto; }
    .copy-btn { position: absolute; top: 12px; right: 12px; background: #3f3f46; border: 1px solid #52525b; color: #e4e4e7; padding: 6px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; font-family: inherit; }
    .copy-btn:hover { background: #52525b; }
    .copy-btn.copied { background: #166534; border-color: #16a34a; color: #86efac; }
    .link { color: #60a5fa; text-decoration: none; }
    .tag { display: inline-block; background: #1e3a5f; color: #60a5fa; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-right: 4px; margin-bottom: 4px; }
    .badge { display: inline-block; background: #14532d; color: #86efac; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-right: 4px; margin-bottom: 4px; }
  </style>
</head>
<body>
  <h1>VECTOR v5 — Database Migration</h1>
  <p>Run this SQL once in Supabase. Adds all missing columns and creates all tables.</p>
  
  <div class="steps">
    <div class="step"><span>1</span>Go to <a class="link" href="https://supabase.com" target="_blank">supabase.com</a> → your project → SQL Editor → + New query</div>
    <div class="step"><span>2</span>Click "Copy SQL" below → paste → click Run</div>
    <div class="step"><span>3</span>Done. Reload the app.</div>
  </div>

  <p>
    Tables: <span class="tag">setups (columns added)</span><span class="tag">weekly_bias</span><span class="tag">smt_signals</span><span class="tag">cot_data</span><span class="tag">backtest_runs</span><span class="tag">telegram_config</span><span class="tag">journal</span><span class="tag">knowledge_base</span>
    <br/><br/>Also seeds: <span class="badge">10 ICT knowledge articles</span>
  </p>

  <div class="sql-box">
    <button class="copy-btn" onclick="copySQL()">Copy SQL</button>
    <pre id="sql">${SQL.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
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
