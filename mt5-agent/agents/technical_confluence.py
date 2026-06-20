"""
Technical Confluence Agent — Agent 4
RSI divergence, VWAP, Volume Profile, EMA stack, ATR filter,
candlestick patterns at key zones.
"""
import logging
import asyncio
from dataclasses import dataclass, field
from typing import Optional
import pandas as pd
import numpy as np

logger = logging.getLogger("technical_confluence")


@dataclass
class TechnicalSignal:
    symbol: str
    timeframe: str
    rsi: float = 50.0
    rsi_divergence: Optional[str] = None  # "bull" | "bear"
    ema_stack: str = "neutral"            # "bullish" | "bearish" | "neutral"
    above_vwap: bool = True
    vwap: float = 0.0
    atr: float = 0.0
    volatility_ok: bool = True            # False if ATR too low or too high
    candle_pattern: Optional[str] = None  # "engulfing_bull" | "pinbar_bull" | etc.
    volume_confirmation: bool = False
    hvn_nearby: bool = False              # High Volume Node nearby
    lvn_nearby: bool = False              # Low Volume Node nearby
    confluence_score: int = 0            # 0-100


class TechnicalConfluenceAgent:

    def __init__(self, mt5_connector, message_bus: asyncio.Queue):
        self.mt5 = mt5_connector
        self.bus = message_bus
        self.signals: dict[str, TechnicalSignal] = {}
        self._running = False

    # ── RSI ─────────────────────────────────────────────────────────────────

    def calc_rsi(self, closes: pd.Series, period: int = 14) -> pd.Series:
        delta = closes.diff()
        gain = delta.clip(lower=0).rolling(period).mean()
        loss = (-delta.clip(upper=0)).rolling(period).mean()
        rs = gain / (loss + 1e-9)
        return 100 - (100 / (1 + rs))

    def detect_rsi_divergence(self, df: pd.DataFrame, rsi: pd.Series, lookback: int = 20) -> Optional[str]:
        if len(df) < lookback + 5:
            return None
        recent_price = df["c"].iloc[-lookback:]
        recent_rsi = rsi.iloc[-lookback:]
        if recent_price.isna().any() or recent_rsi.isna().any():
            return None
        price_trend = recent_price.iloc[-1] - recent_price.iloc[0]
        rsi_trend = recent_rsi.iloc[-1] - recent_rsi.iloc[0]
        # Bullish divergence: price falling, RSI rising
        if price_trend < 0 and rsi_trend > 0:
            return "bull"
        # Bearish divergence: price rising, RSI falling
        if price_trend > 0 and rsi_trend < 0:
            return "bear"
        return None

    # ── EMA STACK ────────────────────────────────────────────────────────────

    def calc_ema_stack(self, closes: pd.Series) -> str:
        if len(closes) < 200:
            return "neutral"
        ema9   = closes.ewm(span=9,   adjust=False).mean().iloc[-1]
        ema21  = closes.ewm(span=21,  adjust=False).mean().iloc[-1]
        ema50  = closes.ewm(span=50,  adjust=False).mean().iloc[-1]
        ema200 = closes.ewm(span=200, adjust=False).mean().iloc[-1]
        if ema9 > ema21 > ema50 > ema200:
            return "bullish"
        if ema9 < ema21 < ema50 < ema200:
            return "bearish"
        return "neutral"

    # ── VWAP ─────────────────────────────────────────────────────────────────

    def calc_vwap(self, df: pd.DataFrame) -> float:
        if "v" not in df.columns or df["v"].sum() == 0:
            return df["c"].iloc[-1]
        typical = (df["h"] + df["l"] + df["c"]) / 3
        return (typical * df["v"]).sum() / df["v"].sum()

    # ── ATR ──────────────────────────────────────────────────────────────────

    def calc_atr(self, df: pd.DataFrame, period: int = 14) -> float:
        tr = pd.concat([
            df["h"] - df["l"],
            (df["h"] - df["c"].shift()).abs(),
            (df["l"] - df["c"].shift()).abs(),
        ], axis=1).max(axis=1)
        return tr.rolling(period).mean().iloc[-1]

    def check_volatility(self, df: pd.DataFrame, atr: float) -> bool:
        """Return True if ATR is in acceptable range (not too low or too high)."""
        recent_atrs = [
            pd.concat([df["h"] - df["l"],
                       (df["h"] - df["c"].shift()).abs(),
                       (df["l"] - df["c"].shift()).abs()], axis=1)
            .max(axis=1).rolling(14).mean().iloc[-i]
            for i in range(1, 21) if i < len(df)
        ]
        if not recent_atrs:
            return True
        avg_atr = np.mean(recent_atrs)
        # Too quiet (< 40% avg) or too wild (> 300% avg) = avoid
        return avg_atr * 0.4 <= atr <= avg_atr * 3.0

    # ── VOLUME PROFILE ───────────────────────────────────────────────────────

    def detect_volume_nodes(self, df: pd.DataFrame, price: float) -> tuple[bool, bool]:
        """Returns (hvn_nearby, lvn_nearby)."""
        if "v" not in df.columns or len(df) < 30:
            return False, False
        bins = pd.cut(df["c"], bins=20, labels=False)
        vol_by_bin = df.groupby(bins)["v"].sum()
        if vol_by_bin.empty:
            return False, False
        price_bin = pd.cut([price], bins=pd.cut(df["c"], bins=20).cat.categories, labels=False)
        if len(price_bin) == 0 or pd.isna(price_bin[0]):
            return False, False
        b = int(price_bin[0]) if not pd.isna(price_bin[0]) else -1
        if b < 0 or b not in vol_by_bin.index:
            return False, False
        v = vol_by_bin[b]
        hvn = bool(v > vol_by_bin.mean() * 1.5)
        lvn = bool(v < vol_by_bin.mean() * 0.5)
        return hvn, lvn

    # ── CANDLESTICK PATTERNS ─────────────────────────────────────────────────

    def detect_candle_pattern(self, df: pd.DataFrame) -> Optional[str]:
        if len(df) < 3:
            return None
        c1, c2, c3 = df.iloc[-3], df.iloc[-2], df.iloc[-1]
        body3 = abs(c3["c"] - c3["o"])
        range3 = c3["h"] - c3["l"]
        if range3 == 0:
            return None

        # Pin bar (rejection wick)
        upper_wick = c3["h"] - max(c3["c"], c3["o"])
        lower_wick = min(c3["c"], c3["o"]) - c3["l"]
        if lower_wick > body3 * 2 and lower_wick > upper_wick * 2:
            return "pinbar_bull"
        if upper_wick > body3 * 2 and upper_wick > lower_wick * 2:
            return "pinbar_bear"

        # Engulfing
        body2 = abs(c2["c"] - c2["o"])
        if c2["c"] < c2["o"] and c3["c"] > c3["o"] and c3["c"] > c2["o"] and c3["o"] < c2["c"]:
            return "engulfing_bull"
        if c2["c"] > c2["o"] and c3["c"] < c3["o"] and c3["c"] < c2["o"] and c3["o"] > c2["c"]:
            return "engulfing_bear"

        # Inside bar
        if c3["h"] < c2["h"] and c3["l"] > c2["l"]:
            return "inside_bar"

        return None

    # ── FULL ANALYSIS ─────────────────────────────────────────────────────────

    def analyze(self, df: pd.DataFrame, symbol: str, timeframe: str) -> TechnicalSignal:
        if len(df) < 30:
            return TechnicalSignal(symbol=symbol, timeframe=timeframe)

        closes = df["c"]
        price  = closes.iloc[-1]

        rsi_series = self.calc_rsi(closes)
        rsi_val    = rsi_series.iloc[-1]
        rsi_div    = self.detect_rsi_divergence(df, rsi_series)
        ema_stack  = self.calc_ema_stack(closes)
        vwap       = self.calc_vwap(df)
        atr        = self.calc_atr(df)
        vol_ok     = self.check_volatility(df, atr)
        pattern    = self.detect_candle_pattern(df)
        hvn, lvn   = self.detect_volume_nodes(df, price)
        above_vwap = price > vwap

        # Volume confirmation: last candle volume > 20-bar average
        vol_confirm = False
        if "v" in df.columns and len(df) >= 20:
            avg_v = df["v"].iloc[-20:].mean()
            vol_confirm = bool(df["v"].iloc[-1] > avg_v * 1.2)

        # Score (0-100)
        score = 50
        if ema_stack == "bullish":     score += 10
        elif ema_stack == "bearish":   score -= 10
        if above_vwap:                 score += 5
        else:                          score -= 5
        if rsi_div == "bull":          score += 12
        elif rsi_div == "bear":        score -= 12
        if vol_ok:                     score += 5
        else:                          score -= 20
        if vol_confirm:                score += 8
        if hvn:                        score += 5
        if pattern and "bull" in (pattern or ""): score += 10
        if pattern and "bear" in (pattern or ""): score -= 10
        score = max(0, min(100, score))

        return TechnicalSignal(
            symbol=symbol, timeframe=timeframe,
            rsi=round(rsi_val, 1),
            rsi_divergence=rsi_div,
            ema_stack=ema_stack,
            above_vwap=above_vwap,
            vwap=round(vwap, 4),
            atr=round(atr, 4),
            volatility_ok=vol_ok,
            candle_pattern=pattern,
            volume_confirmation=vol_confirm,
            hvn_nearby=hvn,
            lvn_nearby=lvn,
            confluence_score=score,
        )

    # ── MAIN LOOP ─────────────────────────────────────────────────────────────

    async def run(self, symbols: list[str], timeframes: list[str], interval: int = 60):
        self._running = True
        logger.info(f"TechnicalConfluenceAgent started")
        while self._running:
            for symbol in symbols:
                for tf in timeframes:
                    try:
                        df = self.mt5.get_candles(symbol, tf, count=300)
                        if df.empty:
                            continue
                        sig = self.analyze(df, symbol, tf)
                        self.signals[f"{symbol}_{tf}"] = sig
                        await self.bus.put({
                            "type": "technical_update",
                            "symbol": symbol,
                            "timeframe": tf,
                            "rsi": sig.rsi,
                            "ema_stack": sig.ema_stack,
                            "volatility_ok": sig.volatility_ok,
                            "confluence_score": sig.confluence_score,
                        })
                    except Exception as e:
                        logger.error(f"Technical error {symbol}/{tf}: {e}")
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False

    def get_signal(self, symbol: str, timeframe: str) -> Optional[TechnicalSignal]:
        return self.signals.get(f"{symbol}_{tf}")
