"""
AI Reasoning & Scoring Agent — Agent 6 (The Brain)
Every potential trade gets scored by an LLM before execution.
Returns: score 1-10, confidence, reasoning, invalidation, trade_approved.
Only score >= 8 + high confidence = execute.
"""
import logging
import asyncio
import json
from typing import Optional
import httpx

logger = logging.getLogger("ai_brain")


class AIBrainAgent:

    def __init__(self, groq_api_key: str = "", openai_api_key: str = "", provider: str = "groq"):
        self.groq_key = groq_api_key
        self.openai_key = openai_api_key
        self.provider = provider
        self.reasoning_log: list[dict] = []
        self.min_score = 8
        self.min_confidence = "high"

    # ── LLM CALL ──────────────────────────────────────────────────────────────

    async def call_llm(self, prompt: str) -> str:
        if self.provider == "groq" and self.groq_key:
            return await self._call_groq(prompt)
        elif self.openai_key:
            return await self._call_openai(prompt)
        else:
            logger.warning("No AI API key configured — returning mock response")
            return json.dumps({
                "setup_score": 5,
                "confidence": "low",
                "primary_reason": "No AI key configured",
                "invalidation": "N/A",
                "risk_adjustment": 0.5,
                "trade_approved": False,
            })

    async def _call_groq(self, prompt: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.groq_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "llama-3.3-70b-versatile",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,
                        "max_tokens": 600,
                    },
                )
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            logger.error(f"Groq API error: {e}")
            return json.dumps({"setup_score": 0, "confidence": "low", "trade_approved": False,
                               "primary_reason": str(e), "invalidation": "API error", "risk_adjustment": 0.0})

    async def _call_openai(self, prompt: str) -> str:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.openai_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "gpt-4o-mini",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,
                        "max_tokens": 600,
                    },
                )
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            logger.error(f"OpenAI API error: {e}")
            return json.dumps({"setup_score": 0, "confidence": "low", "trade_approved": False,
                               "primary_reason": str(e), "invalidation": "API error", "risk_adjustment": 0.0})

    # ── PROMPT BUILDER ────────────────────────────────────────────────────────

    def build_prompt(self, trade_candidate: dict, structure: dict,
                     smc: dict, technical: dict, macro: dict) -> str:
        return f"""You are an expert ICT (Inner Circle Trader) algorithmic trading AI.
Analyze this trade candidate and return ONLY a valid JSON object, no other text.

TRADE CANDIDATE:
Symbol: {trade_candidate.get('symbol')}
Direction: {trade_candidate.get('direction', '').upper()}
Setup Type: {trade_candidate.get('setup_type')}
Timeframe: {trade_candidate.get('timeframe')}
Entry Zone: {trade_candidate.get('entry_low')} – {trade_candidate.get('entry_high')}
Stop Loss: {trade_candidate.get('stop_loss')}
Take Profit: {trade_candidate.get('take_profit')}
RR Ratio: {trade_candidate.get('rr_ratio')}R

MARKET STRUCTURE (from Agent 2):
HTF Bias: {structure.get('htf_bias', 'unknown')}
LTF Bias: {structure.get('ltf_bias', 'unknown')}
Last CHoCH: {structure.get('last_choch', 'none')}
Last BOS: {structure.get('last_bos', 'none')}

SMART MONEY CONCEPTS (from Agent 3):
In Discount: {smc.get('in_discount', False)}
In Premium: {smc.get('in_premium', False)}
FVGs present: {smc.get('fvg_count', 0)}
Order Blocks present: {smc.get('ob_count', 0)}
Power of 3 Phase: {smc.get('po3_phase', 'unknown')}
Judas Swing detected: {smc.get('judas', False)}

TECHNICAL CONFLUENCE (from Agent 4):
RSI: {technical.get('rsi', 50)}
RSI Divergence: {technical.get('rsi_divergence', 'none')}
EMA Stack: {technical.get('ema_stack', 'neutral')}
Above VWAP: {technical.get('above_vwap', False)}
Volatility OK: {technical.get('volatility_ok', True)}
Candle Pattern: {technical.get('candle_pattern', 'none')}
Volume Confirmation: {technical.get('volume_confirmation', False)}

MACRO & SENTIMENT (from Agent 5):
DXY Trend: {macro.get('dxy_trend', 'neutral')}
Macro Bias: {macro.get('macro_bias', 'neutral')}
Fear & Greed: {macro.get('fear_greed_score', 'N/A')} ({macro.get('fear_greed_label', 'unknown')})
News Blackout: {macro.get('blackout_active', False)}

Evaluate this trade on all ICT principles:
1. Is price in the correct zone (discount for longs, premium for shorts)?
2. Does HTF bias confirm LTF direction?
3. Is there a valid PD array (FVG/OB) at the entry?
4. Is there a liquidity sweep confirming smart money intent?
5. Is macro aligned? Is DXY confirming?
6. Would an experienced ICT trader take this?

Return ONLY this JSON (no markdown, no explanation):
{{
  "setup_score": <integer 1-10>,
  "confidence": "<low|medium|high>",
  "primary_reason": "<one sentence why to take or skip>",
  "invalidation": "<what price action would invalidate this setup>",
  "risk_adjustment": <0.25|0.5|0.75|1.0>,
  "trade_approved": <true|false>,
  "key_levels_to_watch": "<brief>",
  "session_note": "<any session timing concern>"
}}"""

    # ── EVALUATE ──────────────────────────────────────────────────────────────

    async def evaluate_trade(self, trade_candidate: dict, structure: dict,
                              smc: dict, technical: dict, macro: dict) -> dict:
        """
        Evaluates a trade candidate. Returns approval dict.
        Only approved if score >= 8 AND confidence == high.
        """
        # Hard block: news blackout
        if macro.get("blackout_active"):
            result = {
                "setup_score": 0, "confidence": "low",
                "primary_reason": f"NEWS BLACKOUT: {macro.get('blackout_reason')}",
                "invalidation": "Wait for news to pass",
                "risk_adjustment": 0.0, "trade_approved": False,
            }
            self._log(trade_candidate, result)
            return result

        # Hard block: wrong zone
        direction = trade_candidate.get("direction", "")
        if direction == "buy" and smc.get("in_premium"):
            result = {
                "setup_score": 2, "confidence": "low",
                "primary_reason": "Price in premium — never buy premium (ICT rule)",
                "invalidation": "Price must return to discount", "risk_adjustment": 0.0,
                "trade_approved": False,
            }
            self._log(trade_candidate, result)
            return result
        if direction == "sell" and smc.get("in_discount"):
            result = {
                "setup_score": 2, "confidence": "low",
                "primary_reason": "Price in discount — never sell discount (ICT rule)",
                "invalidation": "Price must return to premium", "risk_adjustment": 0.0,
                "trade_approved": False,
            }
            self._log(trade_candidate, result)
            return result

        # Call LLM
        prompt = self.build_prompt(trade_candidate, structure, smc, technical, macro)
        raw = await self.call_llm(prompt)

        try:
            # Strip any markdown code fences
            clean = raw.strip()
            if clean.startswith("```"):
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            result = json.loads(clean.strip())
        except Exception as e:
            logger.error(f"AI response parse error: {e} | raw: {raw[:200]}")
            result = {
                "setup_score": 0, "confidence": "low",
                "primary_reason": f"AI parse error: {e}",
                "invalidation": "N/A", "risk_adjustment": 0.0, "trade_approved": False,
            }

        # Final approval gate
        score = result.get("setup_score", 0)
        conf  = result.get("confidence", "low")
        result["trade_approved"] = (score >= self.min_score and conf == self.min_confidence)

        self._log(trade_candidate, result)
        logger.info(
            f"AI eval: {trade_candidate.get('symbol')} {direction} | "
            f"score={score} conf={conf} approved={result['trade_approved']} | "
            f"{result.get('primary_reason', '')[:80]}"
        )
        return result

    def _log(self, candidate: dict, result: dict):
        self.reasoning_log.append({
            "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
            "symbol": candidate.get("symbol"),
            "direction": candidate.get("direction"),
            "setup_type": candidate.get("setup_type"),
            **result,
        })
        if len(self.reasoning_log) > 500:
            self.reasoning_log = self.reasoning_log[-500:]

    def get_recent_logs(self, n: int = 20) -> list:
        return self.reasoning_log[-n:]
