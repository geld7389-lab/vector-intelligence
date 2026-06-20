"""
Master Orchestrator Agent — Agent 1
Receives signals from all sub-agents via message bus.
Applies portfolio-level rules, calls AI Brain, sends to Executor.
Has final veto on every single trade.
"""
import logging
import asyncio
from datetime import datetime
from typing import Optional

from config.settings import SCAN_TIMEFRAMES, HTF_MAP, ALL_SYMBOLS

logger = logging.getLogger("orchestrator")


class MasterOrchestratorAgent:

    def __init__(self, agents: dict, message_bus: asyncio.Queue):
        """
        agents = {
            "structure": MarketStructureAgent,
            "smc": SMCAgent,
            "technical": TechnicalConfluenceAgent,
            "macro": MacroSentimentAgent,
            "ai_brain": AIBrainAgent,
            "risk": RiskManagerAgent,
            "executor": ExecutionAgent,
            "learning": SelfLearningAgent,
            "alert": AlertAgent,
        }
        """
        self.agents = agents
        self.bus = message_bus
        self._running = False
        self.pending_signals: dict = {}  # "symbol_tf" -> aggregated signal data
        self.trade_history: list = []

    # ── SIGNAL AGGREGATION ───────────────────────────────────────────────────

    async def process_bus(self):
        """Consume messages from the bus and aggregate signals."""
        while self._running:
            try:
                msg = await asyncio.wait_for(self.bus.get(), timeout=1.0)
                msg_type = msg.get("type")
                symbol   = msg.get("symbol")
                tf       = msg.get("timeframe")

                if not symbol:
                    continue

                key = f"{symbol}_{tf}"
                if key not in self.pending_signals:
                    self.pending_signals[key] = {"symbol": symbol, "timeframe": tf}

                if msg_type == "structure_update":
                    self.pending_signals[key].update({
                        "htf_bias": msg.get("bias"),
                        "last_choch": str(msg.get("last_choch")),
                        "last_bos": str(msg.get("last_bos")),
                    })
                elif msg_type == "smc_update":
                    self.pending_signals[key].update({
                        "in_discount": msg.get("in_discount"),
                        "in_premium": msg.get("in_premium"),
                        "fvg_count": msg.get("fvg_count"),
                        "ob_count": msg.get("ob_count"),
                        "po3_phase": msg.get("po3_phase"),
                        "judas": msg.get("judas"),
                    })
                elif msg_type == "technical_update":
                    self.pending_signals[key].update({
                        "rsi": msg.get("rsi"),
                        "ema_stack": msg.get("ema_stack"),
                        "volatility_ok": msg.get("volatility_ok"),
                        "tech_score": msg.get("confluence_score"),
                    })
                elif msg_type == "macro_update":
                    # Apply macro to all pending signals
                    for k in self.pending_signals:
                        self.pending_signals[k].update({
                            "blackout": msg.get("blackout"),
                            "blackout_reason": msg.get("blackout_reason"),
                            "dxy_trend": msg.get("dxy_trend"),
                        })

                # Once a signal has enough data, evaluate it
                await self._maybe_evaluate(key)

            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Bus processing error: {e}")

    async def _maybe_evaluate(self, key: str):
        """Evaluate a signal if it has enough context from all agents."""
        sig = self.pending_signals.get(key, {})
        # Need structure + SMC + technical data
        required = ["htf_bias", "in_discount", "rsi", "ema_stack"]
        if not all(k in sig for k in required):
            return

        symbol = sig["symbol"]
        tf     = sig["timeframe"]

        # 1. Macro check
        if sig.get("blackout"):
            logger.debug(f"Skipping {symbol}/{tf}: news blackout")
            return

        # 2. Check if asset is paused by self-learning
        learning = self.agents.get("learning")
        if learning and learning.is_paused(symbol):
            logger.debug(f"Skipping {symbol}: auto-paused by self-learning agent")
            return

        # 3. Volatility check
        if not sig.get("volatility_ok", True):
            logger.debug(f"Skipping {symbol}/{tf}: volatility out of range")
            return

        # 4. Build trade candidates based on ICT logic
        candidates = self._build_candidates(sig)
        if not candidates:
            return

        # 5. Evaluate each candidate
        for candidate in candidates:
            await self._evaluate_and_execute(candidate, sig)

        # Clear the pending signal to avoid re-evaluating
        self.pending_signals.pop(key, None)

    def _build_candidates(self, sig: dict) -> list:
        """
        Build trade candidate dict(s) from aggregated signal data.
        Uses SMC + structure to determine entry, SL, TP.
        """
        candidates = []
        symbol = sig["symbol"]
        tf     = sig["timeframe"]

        smc_agent = self.agents.get("smc")
        if not smc_agent:
            return []

        smc_map = smc_agent.get_smc(symbol, tf)
        if not smc_map:
            return []

        htf_bias = sig.get("htf_bias", "neutral")
        in_disc  = sig.get("in_discount", False)
        in_prem  = sig.get("in_premium", False)

        # ICT Rule: only buy in discount, only sell in premium
        if htf_bias == "bullish" and in_disc and smc_map.fvgs:
            fvg = smc_agent.get_nearest_fvg(symbol, tf, smc_map.equilibrium, "bull")
            if fvg:
                entry = (fvg.low + fvg.high) / 2
                sl    = fvg.low * 0.999
                bsl   = max((lv.price for lv in smc_map.liquidity_levels if lv.type == "BSL"), default=entry * 1.01)
                tp    = bsl
                rr    = abs(tp - entry) / (abs(entry - sl) + 1e-9)
                if rr >= 2.0:
                    candidates.append({
                        "symbol": symbol, "timeframe": tf,
                        "direction": "buy", "setup_type": "FVG_BULL",
                        "entry": entry, "entry_low": fvg.low, "entry_high": fvg.high,
                        "stop_loss": round(sl, 4), "take_profit": round(tp, 4),
                        "rr_ratio": round(rr, 2),
                    })

        if htf_bias == "bearish" and in_prem and smc_map.fvgs:
            fvg = smc_agent.get_nearest_fvg(symbol, tf, smc_map.equilibrium, "bear")
            if fvg:
                entry = (fvg.low + fvg.high) / 2
                sl    = fvg.high * 1.001
                ssl   = min((lv.price for lv in smc_map.liquidity_levels if lv.type == "SSL"), default=entry * 0.99)
                tp    = ssl
                rr    = abs(tp - entry) / (abs(entry - sl) + 1e-9)
                if rr >= 2.0:
                    candidates.append({
                        "symbol": symbol, "timeframe": tf,
                        "direction": "sell", "setup_type": "FVG_BEAR",
                        "entry": entry, "entry_low": fvg.low, "entry_high": fvg.high,
                        "stop_loss": round(sl, 4), "take_profit": round(tp, 4),
                        "rr_ratio": round(rr, 2),
                    })

        return candidates

    async def _evaluate_and_execute(self, candidate: dict, sig: dict):
        """Run full evaluation pipeline: AI Brain → Risk → Executor."""
        symbol = candidate["symbol"]

        # Build context for AI Brain
        structure_ctx = {
            "htf_bias": sig.get("htf_bias"),
            "ltf_bias": sig.get("ema_stack"),
            "last_choch": sig.get("last_choch"),
            "last_bos": sig.get("last_bos"),
        }
        smc_ctx = {
            "in_discount": sig.get("in_discount"),
            "in_premium": sig.get("in_premium"),
            "fvg_count": sig.get("fvg_count"),
            "ob_count": sig.get("ob_count"),
            "po3_phase": sig.get("po3_phase"),
            "judas": sig.get("judas"),
        }
        technical_ctx = {
            "rsi": sig.get("rsi"),
            "rsi_divergence": None,
            "ema_stack": sig.get("ema_stack"),
            "above_vwap": sig.get("above_vwap", True),
            "volatility_ok": sig.get("volatility_ok", True),
            "candle_pattern": sig.get("candle_pattern"),
            "volume_confirmation": sig.get("vol_confirm", False),
        }
        macro_ctx = {
            "dxy_trend": sig.get("dxy_trend", "neutral"),
            "macro_bias": "neutral",
            "fear_greed_score": None,
            "fear_greed_label": "unknown",
            "blackout_active": sig.get("blackout", False),
            "blackout_reason": sig.get("blackout_reason"),
        }

        # AI Brain evaluation
        brain = self.agents.get("ai_brain")
        if not brain:
            logger.error("AI Brain agent not available")
            return

        ai_result = await brain.evaluate_trade(candidate, structure_ctx, smc_ctx, technical_ctx, macro_ctx)

        if not ai_result.get("trade_approved"):
            logger.info(
                f"REJECTED by AI Brain: {symbol} {candidate['direction']} | "
                f"score={ai_result.get('setup_score')} | {ai_result.get('primary_reason', '')[:80]}"
            )
            return

        # Risk Management approval
        risk = self.agents.get("risk")
        if not risk:
            return

        risk_result = risk.approve_trade(
            symbol, candidate["direction"],
            candidate["entry"], candidate["stop_loss"], candidate["take_profit"],
            ai_risk_adj=ai_result.get("risk_adjustment", 1.0),
        )

        if not risk_result["approved"]:
            logger.info(f"REJECTED by Risk Manager: {symbol} | {risk_result['reason']}")
            return

        # All checks passed — execute
        executor = self.agents.get("executor")
        if not executor:
            return

        full_trade = {
            **candidate,
            "lot": risk_result["lot"],
            "ai_score": ai_result.get("setup_score", 0),
            "ai_reasoning": ai_result.get("primary_reason", ""),
        }

        trade_record = await executor.execute(full_trade)
        if trade_record:
            self.trade_history.append({**trade_record, "ai_result": ai_result})
            logger.info(
                f"✅ TRADE EXECUTED: {symbol} {candidate['direction']} "
                f"lot={risk_result['lot']} score={ai_result['setup_score']}"
            )

    # ── MAIN LOOP ─────────────────────────────────────────────────────────────

    async def run(self):
        self._running = True
        logger.info("MasterOrchestratorAgent started")
        await self.process_bus()

    def stop(self):
        self._running = False
