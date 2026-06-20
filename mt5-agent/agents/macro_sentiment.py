"""
Macro & Sentiment Agent — Agent 5
Economic calendar, news blackouts, DXY trend, sentiment indices.
"""
import logging
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional
import httpx

logger = logging.getLogger("macro_sentiment")


class MacroSentimentAgent:

    def __init__(self, news_scraper, message_bus: asyncio.Queue, telegram=None):
        self.news = news_scraper
        self.bus = message_bus
        self.telegram = telegram
        self._running = False
        self.dxy_trend: str = "neutral"
        self.fear_greed: Optional[int] = None
        self.current_blackout: Optional[str] = None

    # ── DXY TREND ────────────────────────────────────────────────────────────

    async def fetch_dxy_trend(self) -> str:
        """Fetch DXY trend from Yahoo Finance."""
        try:
            url = "https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=1mo"
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                if r.status_code != 200:
                    return "neutral"
                data = r.json()
                result = data.get("chart", {}).get("result", [{}])[0]
                closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
                closes = [c for c in closes if c is not None]
                if len(closes) < 10:
                    return "neutral"
                ema9  = sum(closes[-9:]) / 9
                ema21 = sum(closes[-21:]) / 21 if len(closes) >= 21 else ema9
                if ema9 > ema21:
                    return "bullish"   # DXY up = USD strong = bearish pressure on assets
                return "bearish"       # DXY down = USD weak = bullish for gold/stocks
        except Exception as e:
            logger.warning(f"DXY fetch error: {e}")
            return "neutral"

    # ── CNN FEAR & GREED ─────────────────────────────────────────────────────

    async def fetch_fear_greed(self) -> Optional[int]:
        """Fetch CNN Fear & Greed index (0=extreme fear, 100=extreme greed)."""
        try:
            url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                if r.status_code != 200:
                    return None
                data = r.json()
                score = data.get("fear_and_greed", {}).get("score")
                return int(score) if score is not None else None
        except Exception as e:
            logger.warning(f"Fear & Greed fetch error: {e}")
            return None

    def interpret_fear_greed(self, score: Optional[int]) -> str:
        if score is None:
            return "unknown"
        if score <= 20:   return "extreme_fear"
        if score <= 40:   return "fear"
        if score <= 60:   return "neutral"
        if score <= 80:   return "greed"
        return "extreme_greed"

    # ── MACRO FILTER FOR TRADE DIRECTION ─────────────────────────────────────

    def get_macro_bias(self, symbol: str) -> dict:
        """
        Returns macro context for a given symbol to inform trade direction.
        DXY bullish = bearish for EUR, GBP, Gold, Stocks
        """
        dxy_bearish_assets = ["EURUSD", "GBPUSD", "AUDUSD", "XAUUSD", "XAGUSD",
                               "NASDAQ100", "SP500", "US30", "BTCUSD", "ETHUSD"]
        dxy_bullish_assets = ["USDJPY", "USDCAD", "USDCHF", "USOIL"]

        macro_bias = "neutral"
        if symbol in dxy_bearish_assets:
            macro_bias = "bearish" if self.dxy_trend == "bullish" else "bullish"
        elif symbol in dxy_bullish_assets:
            macro_bias = "bullish" if self.dxy_trend == "bullish" else "bearish"

        fg = self.interpret_fear_greed(self.fear_greed)
        risk_on = fg in ("greed", "extreme_greed")
        risk_off = fg in ("fear", "extreme_fear")

        return {
            "dxy_trend": self.dxy_trend,
            "macro_bias": macro_bias,
            "fear_greed_score": self.fear_greed,
            "fear_greed_label": fg,
            "risk_on": risk_on,
            "risk_off": risk_off,
            "blackout_active": self.current_blackout is not None,
            "blackout_reason": self.current_blackout,
        }

    # ── MAIN LOOP ─────────────────────────────────────────────────────────────

    async def run(self, interval: int = 1800):  # every 30 min
        self._running = True
        logger.info("MacroSentimentAgent started")
        last_dxy_fetch = 0
        last_fg_fetch = 0

        while self._running:
            now = datetime.utcnow().timestamp()

            # Fetch news events (30 min cache built into scraper)
            try:
                events = await self.news.fetch_events()
                blackout, reason = self.news.is_blackout_now()
                self.current_blackout = reason if blackout else None
                if blackout:
                    logger.warning(f"NEWS BLACKOUT: {reason}")
            except Exception as e:
                logger.error(f"News fetch error: {e}")

            # Fetch DXY every 60 min
            if now - last_dxy_fetch > 3600:
                self.dxy_trend = await self.fetch_dxy_trend()
                last_dxy_fetch = now
                logger.info(f"DXY trend: {self.dxy_trend}")

            # Fetch Fear & Greed every 60 min
            if now - last_fg_fetch > 3600:
                self.fear_greed = await self.fetch_fear_greed()
                last_fg_fetch = now
                logger.info(f"Fear & Greed: {self.fear_greed}")

            await self.bus.put({
                "type": "macro_update",
                "dxy_trend": self.dxy_trend,
                "fear_greed": self.fear_greed,
                "blackout": self.current_blackout is not None,
                "blackout_reason": self.current_blackout,
            })

            await asyncio.sleep(interval)

    def stop(self):
        self._running = False

    def is_safe_to_trade(self) -> tuple[bool, str]:
        """Returns (safe, reason) — False if blackout active."""
        if self.current_blackout:
            return False, f"News blackout: {self.current_blackout}"
        return True, "ok"
