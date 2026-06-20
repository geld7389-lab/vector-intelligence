"""
VECTOR AI Trading Hedge Fund — main.py
Single entry point. Launches all 10 agents + dashboard.
Usage: python main.py
Stop:  CTRL+C (graceful shutdown — closes positions, saves state)
"""
import asyncio
import logging
import signal
import sys
import threading
from pathlib import Path

# ── LOGGING ────────────────────────────────────────────────────────────────
Path("logs").mkdir(exist_ok=True)
Path("data").mkdir(exist_ok=True)
Path("reports").mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)-18s] %(levelname)s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.handlers.RotatingFileHandler(
            "logs/main.log", maxBytes=10_000_000, backupCount=5
        ),
    ],
)
import logging.handlers
logger = logging.getLogger("main")

# ── IMPORTS ────────────────────────────────────────────────────────────────
from config.settings import (
    MT5_LOGIN, MT5_PASSWORD, MT5_SERVER,
    GROQ_API_KEY, OPENAI_API_KEY, AI_PROVIDER,
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
    ALL_SYMBOLS, SCAN_TIMEFRAMES, DB_PATH, PERF_DB_PATH,
)
from utils.mt5_connector import MT5Connector
from utils.telegram_bot import TelegramBot
from utils.news_scraper import NewsScraper

from agents.market_structure import MarketStructureAgent
from agents.smc_agent import SMCAgent
from agents.technical_confluence import TechnicalConfluenceAgent
from agents.macro_sentiment import MacroSentimentAgent
from agents.ai_brain import AIBrainAgent
from agents.risk_manager import RiskManagerAgent
from agents.executor import ExecutionAgent
from agents.self_learning import SelfLearningAgent
from agents.alert_agent import AlertAgent

from orchestrator.master_agent import MasterOrchestratorAgent
from dashboard.server import init_dashboard, run_server


async def main():
    logger.info("=" * 60)
    logger.info("  VECTOR AI Trading System v5 — Starting")
    logger.info("=" * 60)

    # ── MESSAGE BUS ────────────────────────────────────────────────
    bus = asyncio.Queue(maxsize=10000)

    # ── CONNECT MT5 ────────────────────────────────────────────────
    mt5 = MT5Connector(MT5_LOGIN, MT5_PASSWORD, MT5_SERVER)
    if not mt5.connect():
        logger.error("MT5 connection failed — running in MOCK mode")
    else:
        account = mt5.get_account_info()
        logger.info(f"MT5 connected — balance=${account.get('balance',0):,.2f}")

    # ── INIT UTILITIES ─────────────────────────────────────────────
    tg      = TelegramBot(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
    scraper = NewsScraper()

    # ── INIT AGENTS ─────────────────────────────────────────────────
    structure = MarketStructureAgent(mt5, bus)
    smc       = SMCAgent(mt5, bus)
    technical = TechnicalConfluenceAgent(mt5, bus)
    macro     = MacroSentimentAgent(scraper, bus, tg)
    brain     = AIBrainAgent(GROQ_API_KEY, OPENAI_API_KEY, AI_PROVIDER)
    risk      = RiskManagerAgent(mt5, tg)
    executor  = ExecutionAgent(mt5, risk, tg)
    learning  = SelfLearningAgent(DB_PATH, PERF_DB_PATH, tg, risk)
    alert     = AlertAgent(tg, structure, macro, risk, learning, mt5)

    agents = {
        "structure": structure,
        "smc":       smc,
        "technical": technical,
        "macro":     macro,
        "ai_brain":  brain,
        "risk":      risk,
        "executor":  executor,
        "learning":  learning,
        "alert":     alert,
    }

    orchestrator = MasterOrchestratorAgent(agents, bus)

    # ── INIT DASHBOARD ─────────────────────────────────────────────
    init_dashboard(agents, mt5, PERF_DB_PATH, DB_PATH)

    # ── STARTUP ALERT ──────────────────────────────────────────────
    await tg.send("🚀 <b>VECTOR AI System Started</b>\n10 agents online · Dashboard: port 8000")
    logger.info("All agents initialized — starting async tasks")

    # ── GRACEFUL SHUTDOWN ──────────────────────────────────────────
    shutdown_event = asyncio.Event()

    def _handle_signal(signum, frame):
        logger.info("Shutdown signal received")
        asyncio.get_event_loop().call_soon_threadsafe(shutdown_event.set)

    signal.signal(signal.SIGINT,  _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    # ── DASHBOARD IN THREAD ────────────────────────────────────────
    dash_thread = threading.Thread(
        target=run_server, kwargs={"host": "0.0.0.0", "port": 8000}, daemon=True
    )
    dash_thread.start()
    logger.info("Dashboard running at http://0.0.0.0:8000")

    # ── RUN ALL AGENTS ─────────────────────────────────────────────
    tasks = [
        asyncio.create_task(orchestrator.run(), name="orchestrator"),
        asyncio.create_task(structure.run(ALL_SYMBOLS, SCAN_TIMEFRAMES, interval=60), name="structure"),
        asyncio.create_task(smc.run(ALL_SYMBOLS, SCAN_TIMEFRAMES, interval=60), name="smc"),
        asyncio.create_task(technical.run(ALL_SYMBOLS, ["M15", "H1", "H4"], interval=60), name="technical"),
        asyncio.create_task(macro.run(interval=1800), name="macro"),
        asyncio.create_task(risk.run(interval=30), name="risk"),
        asyncio.create_task(executor.run(interval=15), name="executor"),
        asyncio.create_task(learning.run(interval=3600), name="learning"),
        asyncio.create_task(alert.run(), name="alert"),
    ]

    logger.info(f"✅ All {len(tasks)} agent tasks running")
    logger.info("System ready — press CTRL+C to stop")

    # Wait for shutdown
    await shutdown_event.wait()

    # ── CLEANUP ────────────────────────────────────────────────────
    logger.info("Shutting down gracefully...")
    for agent_name, agent in agents.items():
        if hasattr(agent, "stop"):
            agent.stop()

    # Cancel tasks
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)

    # Close positions on exit? Ask user or check config
    import os
    if os.getenv("CLOSE_ON_EXIT", "false").lower() == "true":
        logger.info("CLOSE_ON_EXIT=true — closing all positions")
        await executor.close_all_positions("system_shutdown")

    mt5.disconnect()
    await tg.send("⏹ <b>VECTOR AI System Stopped</b>")
    logger.info("Shutdown complete")


if __name__ == "__main__":
    asyncio.run(main())
