# VECTOR AI Trading System v5

> A 10-agent autonomous AI hedge fund engine running on your PC via MetaTrader 5.

---

## Architecture

```
main.py
├── Orchestrator (master_agent.py) — coordinates everything
├── Agent 1: Market Structure     — BOS, CHoCH, swing levels
├── Agent 2: SMC / ICT            — FVGs, OBs, liquidity, PD arrays
├── Agent 3: Technical Confluence — RSI, EMA, VWAP, ATR, patterns
├── Agent 4: Macro & Sentiment    — news calendar, DXY, Fear&Greed
├── Agent 5: AI Brain             — LLM scores every trade (min 8/10)
├── Agent 6: Risk Manager         — hard risk rules, drawdown limits
├── Agent 7: Executor             — MT5 orders, partial close, trailing
├── Agent 8: Self-Learning        — trade analysis, ML, weekly reports
├── Agent 9: Alert Agent          — Telegram briefings + summaries
└── Dashboard (FastAPI + WS)      — real-time web UI on port 8000
```

---

## Quick Setup (5 minutes)

### 1. Install Python 3.11+
Download from python.org. Check "Add to PATH" during install.

### 2. Install MetaTrader 5
Download MT5 from your broker. Log in with your demo or live account.

### 3. Clone / download this folder
```bash
cd ai-trading-hedge-fund
```

### 4. Install dependencies
```bash
pip install -r requirements.txt
```

### 5. Configure .env
```bash
cp .env.example .env
```
Open `.env` and fill in:
- `MT5_LOGIN` — your MT5 account number
- `MT5_PASSWORD` — your MT5 password  
- `MT5_SERVER` — your broker server (shown in MT5 → File → Open Account)
- `GROQ_API_KEY` — free at console.groq.com (or use OpenAI)
- `TELEGRAM_BOT_TOKEN` — create a bot at @BotFather on Telegram
- `TELEGRAM_CHAT_ID` — your chat ID (message @userinfobot)

### 6. Start the system
```bash
python main.py
```

### 7. Open the dashboard
```
http://localhost:8000
```
Or from another device on your network: `http://YOUR_PC_IP:8000`

---

## Configuration

### Risk Mode
In `.env`:
```
RISK_MODE=conservative     # 0.5% per trade, 3% daily max
RISK_MODE=normal           # 1% per trade, 5% daily max
```

### Switch Demo → Live
Change `MT5_SERVER` in `.env` to your live account server.
Set `MT5_DEMO=false`.

### Add new assets
In `config/settings.py`, add the symbol to the appropriate list:
```python
FOREX = ["EURUSD", "GBPUSD", ..., "NZDUSD"]  # add here
```
Then add to `SYMBOL_MAP` if your broker uses a different name.

### Adjust risk parameters
In `.env`:
```
MAX_RISK_PER_TRADE=0.005    # 0.5% per trade
MAX_PORTFOLIO_HEAT=0.03     # 3% max total open risk
MAX_DAILY_LOSS=0.03         # 3% daily stop
MAX_WEEKLY_LOSS=0.06        # 6% weekly stop
MAX_CONSECUTIVE_LOSSES=4    # pause after 4 losses in a row
```

---

## Running Backtests

From the dashboard → Analytics tab → Run Backtest:
- Select symbol, timeframe, direction
- Includes Monte Carlo (1000 simulations) and walk-forward validation

Or from Python:
```python
from backtester.engine import BacktestEngine
from utils.mt5_connector import MT5Connector

mt5 = MT5Connector(login, password, server)
mt5.connect()
engine = BacktestEngine(mt5)
result = engine.run("XAUUSD", "H1", direction="bull")
print(f"Win Rate: {result['win_rate']}%")
print(f"Sharpe: {result['sharpe_ratio']}")
print(f"Monte Carlo P(profit): {result['monte_carlo']['probability_of_profit']}%")
```

---

## Dashboard Sections

| Tab | Shows |
|---|---|
| **Overview** | Balance, equity, P&L, portfolio heat, news blackout |
| **Live Trades** | All open positions with live P&L, SL/TP, AI score |
| **Analytics** | Win rate, profit factor, Sharpe — run backtests |
| **Agents** | Status of all 10 agents (green/yellow/red) |
| **Market Intel** | H4 bias per asset, upcoming news events |
| **AI Logs** | Every trade the AI evaluated — approved or rejected with reasoning |

---

## Weekly Reports

Every Sunday at 08:00 UTC, the Self-Learning Agent:
1. Generates a performance report for the week
2. Sends it to your Telegram
3. Saves it to `data/performance.db`
4. Auto-pauses any asset with win rate < 40% over 20 trades
5. Runs sklearn ML analysis to find winning patterns

Reports saved to: `reports/`

---

## Known Limitations

1. **MT5 is Windows-only** — the MT5 Python library only runs on Windows. The dashboard and all other code works on Mac/Linux but without live MT5 data (mock mode).

2. **Broker symbol names vary** — your broker may call NASDAQ100 "NAS100" or "US100". Update `SYMBOL_MAP` in `config/settings.py`.

3. **Spread varies by broker** — the default spread limits may be too tight for some brokers. Adjust `SPREAD_LIMITS` in `agents/executor.py`.

4. **Free Groq API has rate limits** — for production, use OpenAI GPT-4o or a paid Groq plan. Set `AI_PROVIDER=openai` in `.env`.

5. **Supabase tables** — if using the VECTOR web platform, ensure Supabase is not paused (free tier pauses after 7 days of inactivity).

6. **Not financial advice** — this system is for educational purposes. Always test on demo before live. Past backtested performance does not guarantee future results.

---

## Graceful Shutdown

Press `CTRL+C` — the system will:
1. Stop all agents
2. Optionally close all positions (set `CLOSE_ON_EXIT=true` in `.env`)
3. Send Telegram notification
4. Disconnect from MT5

---

## Folder Structure

```
mt5-agent/
├── main.py                    # Start here
├── config/settings.py         # All configuration
├── agents/
│   ├── market_structure.py    # Agent 1 — BOS, CHoCH
│   ├── smc_agent.py           # Agent 2 — FVG, OB, liquidity
│   ├── technical_confluence.py # Agent 3 — RSI, EMA, VWAP
│   ├── macro_sentiment.py     # Agent 4 — news, DXY, fear/greed
│   ├── ai_brain.py            # Agent 5 — LLM trade scoring
│   ├── risk_manager.py        # Agent 6 — hard risk rules
│   ├── executor.py            # Agent 7 — MT5 order execution
│   ├── self_learning.py       # Agent 8 — ML + weekly reports
│   └── alert_agent.py         # Agent 9 — Telegram alerts
├── orchestrator/master_agent.py # Coordinates all agents
├── backtester/engine.py       # Full backtest engine
├── dashboard/server.py        # FastAPI + WebSocket dashboard
├── utils/
│   ├── mt5_connector.py       # MT5 connection wrapper
│   ├── lot_calculator.py      # Dynamic lot sizing
│   ├── news_scraper.py        # Economic calendar
│   └── telegram_bot.py        # Telegram alerts
├── data/                      # SQLite databases
├── logs/                      # Per-agent rotating logs
├── reports/                   # Backtest + weekly PDF reports
├── requirements.txt
└── .env.example
```
