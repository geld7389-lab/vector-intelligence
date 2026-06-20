import os
from dotenv import load_dotenv
load_dotenv()

# ── MT5 CONNECTION ──────────────────────────────
MT5_LOGIN      = int(os.getenv("MT5_LOGIN", "0"))
MT5_PASSWORD   = os.getenv("MT5_PASSWORD", "")
MT5_SERVER     = os.getenv("MT5_SERVER", "")
MT5_DEMO       = os.getenv("MT5_DEMO", "true").lower() == "true"

# ── AI ──────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GROQ_API_KEY   = os.getenv("GROQ_API_KEY", "")
AI_PROVIDER    = os.getenv("AI_PROVIDER", "groq")  # "openai" or "groq"
AI_MIN_SCORE   = 8   # minimum setup score (1-10) to approve trade
AI_MIN_CONF    = "high"  # minimum confidence level

# ── TELEGRAM ────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID", "")

# ── RISK MANAGEMENT ─────────────────────────────
RISK_MODE             = os.getenv("RISK_MODE", "conservative")
MAX_RISK_PER_TRADE    = float(os.getenv("MAX_RISK_PER_TRADE", "0.005"))   # 0.5%
MAX_PORTFOLIO_HEAT    = float(os.getenv("MAX_PORTFOLIO_HEAT", "0.03"))    # 3%
MAX_DAILY_LOSS        = float(os.getenv("MAX_DAILY_LOSS", "0.03"))        # 3%
MAX_WEEKLY_LOSS       = float(os.getenv("MAX_WEEKLY_LOSS", "0.06"))       # 6%
MAX_CONSECUTIVE_LOSSES= int(os.getenv("MAX_CONSECUTIVE_LOSSES", "4"))
MAX_MARGIN_PCT        = 0.20    # max 20% of available margin
PARTIAL_CLOSE_RR      = 1.0     # close 50% at 1R
BREAKEVEN_RR          = 1.0     # move SL to breakeven at 1R
MAX_SPREAD_MULTIPLIER = 2.0     # skip entry if spread > 2x average

# ── ASSETS ──────────────────────────────────────
INDICES     = ["NASDAQ100", "US30", "SP500", "GER40", "UK100"]
FOREX       = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF"]
COMMODITIES = ["XAUUSD", "XAGUSD", "USOIL"]
CRYPTO      = ["BTCUSD", "ETHUSD"]
ALL_SYMBOLS = INDICES + FOREX + COMMODITIES + CRYPTO

# Broker symbol mapping (some brokers use different names)
SYMBOL_MAP = {
    "NASDAQ100": "NASDAQ100", "US30": "US30", "SP500": "SP500",
    "GER40": "GER40", "UK100": "UK100",
}

# Correlation groups — never full size in same direction
CORRELATION_GROUPS = [
    ["NASDAQ100", "SP500", "US30"],
    ["EURUSD", "GBPUSD", "AUDUSD"],
    ["XAUUSD", "XAGUSD"],
    ["BTCUSD", "ETHUSD"],
]

# ── TIMEFRAMES ──────────────────────────────────
SCAN_TIMEFRAMES = ["M5", "M15", "H1", "H4", "D1", "W1"]
HTF_MAP = {"M5": "M15", "M15": "H1", "H1": "H4", "H4": "D1", "D1": "W1"}

# ── KILLZONES (UTC hours) ────────────────────────
KILLZONES = {
    "London":       (7, 10),
    "New York AM":  (13, 16),
    "New York PM":  (18, 20),
}
NEWS_BLACKOUT_MINUTES = 30  # pause before/after HIGH impact news

# ── DATABASES ───────────────────────────────────
DB_PATH      = os.getenv("DB_PATH", "data/trade_history.db")
PERF_DB_PATH = "data/performance.db"
LOG_DIR      = "logs"
REPORT_DIR   = "reports"

# ── SELF-LEARNING ────────────────────────────────
MIN_TRADES_FOR_PAUSE = 20      # min trades before auto-pause evaluation
WIN_RATE_PAUSE_THRESHOLD = 0.40 # pause asset if WR drops below 40%
