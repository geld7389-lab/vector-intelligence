"""
Market Structure Agent — Agent 2
Runs on every asset, every timeframe from M5 to W1.
Detects: BOS, CHoCH, Internal BOS, Swing Highs/Lows.
Builds multi-timeframe structure map updated every candle.
"""
import logging
import asyncio
from dataclasses import dataclass, field
from typing import Optional
import pandas as pd
import numpy as np

logger = logging.getLogger("market_structure")


@dataclass
class StructurePoint:
    price: float
    type: str  # "SH" (swing high) | "SL" (swing low)
    index: int
    timestamp: Optional[pd.Timestamp] = None


@dataclass
class StructureSignal:
    type: str          # "BOS_BULL" | "BOS_BEAR" | "CHoCH_BULL" | "CHoCH_BEAR" | "IBOS_BULL" | "IBOS_BEAR"
    level: float
    timestamp: Optional[pd.Timestamp]
    symbol: str
    timeframe: str
    strength: str      # "strong" | "weak"


@dataclass
class SymbolBias:
    symbol: str
    timeframe: str
    bias: str          # "bullish" | "bearish" | "ranging"
    last_bos: Optional[StructureSignal] = None
    last_choch: Optional[StructureSignal] = None
    swing_highs: list = field(default_factory=list)
    swing_lows: list = field(default_factory=list)
    last_updated: Optional[pd.Timestamp] = None


class MarketStructureAgent:
    """
    Detects market structure on all timeframes for all symbols.
    Outputs bias and structure signals via the message bus queue.
    """

    def __init__(self, mt5_connector, message_bus: asyncio.Queue):
        self.mt5 = mt5_connector
        self.bus = message_bus
        self.structure_map: dict[str, SymbolBias] = {}  # "SYMBOL_TF" -> SymbolBias
        self._running = False

    # ── SWING DETECTION ─────────────────────────────────────────────────────

    def find_swings(self, df: pd.DataFrame, lookback: int = 5) -> tuple[list, list]:
        """Identify swing highs and swing lows with given lookback."""
        highs, lows = [], []
        h = df["h"].values
        l = df["l"].values
        for i in range(lookback, len(df) - lookback):
            if all(h[i] > h[i-j] for j in range(1, lookback+1)) and \
               all(h[i] > h[i+j] for j in range(1, lookback+1)):
                ts = df.iloc[i]["time"] if "time" in df.columns else None
                highs.append(StructurePoint(price=h[i], type="SH", index=i, timestamp=ts))
            if all(l[i] < l[i-j] for j in range(1, lookback+1)) and \
               all(l[i] < l[i+j] for j in range(1, lookback+1)):
                ts = df.iloc[i]["time"] if "time" in df.columns else None
                lows.append(StructurePoint(price=l[i], type="SL", index=i, timestamp=ts))
        return highs, lows

    # ── STRUCTURE ANALYSIS ──────────────────────────────────────────────────

    def analyze(self, df: pd.DataFrame, symbol: str, timeframe: str) -> SymbolBias:
        if len(df) < 50:
            return SymbolBias(symbol=symbol, timeframe=timeframe, bias="ranging")

        swing_highs, swing_lows = self.find_swings(df, lookback=5)
        if len(swing_highs) < 2 or len(swing_lows) < 2:
            return SymbolBias(symbol=symbol, timeframe=timeframe, bias="ranging",
                              swing_highs=swing_highs, swing_lows=swing_lows)

        # Compare last 2 swing highs and lows
        sh = swing_highs[-2:]
        sl = swing_lows[-2:]
        hh = sh[1].price > sh[0].price   # Higher High
        hl = sl[1].price > sl[0].price   # Higher Low
        lh = sh[1].price < sh[0].price   # Lower High
        ll = sl[1].price < sl[0].price   # Lower Low

        signals: list[StructureSignal] = []
        current = df.iloc[-1]["c"]
        trend: Optional[str] = None

        # Detect structure shifts on rolling window
        for i in range(10, len(df)):
            slice_highs = [s for s in swing_highs if s.index <= i]
            slice_lows = [s for s in swing_lows if s.index <= i]
            if len(slice_highs) < 2 or len(slice_lows) < 2:
                continue
            sh2 = slice_highs[-2:]
            sl2 = slice_lows[-2:]
            prev_trend = trend

            if sh2[1].price > sh2[0].price and sl2[1].price > sl2[0].price:
                trend = "bull"
            elif sh2[1].price < sh2[0].price and sl2[1].price < sl2[0].price:
                trend = "bear"

            if prev_trend and trend != prev_trend:
                # CHoCH
                sig_type = "CHoCH_BULL" if trend == "bull" else "CHoCH_BEAR"
                level = sl2[-1].price if trend == "bull" else sh2[-1].price
                ts = df.iloc[i]["time"] if "time" in df.columns else None
                signals.append(StructureSignal(type=sig_type, level=level,
                                               timestamp=ts, symbol=symbol,
                                               timeframe=timeframe, strength="strong"))
            elif trend == "bull" and sh2[1].price > sh2[0].price:
                ts = df.iloc[i]["time"] if "time" in df.columns else None
                signals.append(StructureSignal(type="BOS_BULL", level=sh2[-1].price,
                                               timestamp=ts, symbol=symbol,
                                               timeframe=timeframe, strength="weak"))
            elif trend == "bear" and sl2[1].price < sl2[0].price:
                ts = df.iloc[i]["time"] if "time" in df.columns else None
                signals.append(StructureSignal(type="BOS_BEAR", level=sl2[-1].price,
                                               timestamp=ts, symbol=symbol,
                                               timeframe=timeframe, strength="weak"))

        # Determine bias
        if hh and hl:
            bias = "bullish"
        elif lh and ll:
            bias = "bearish"
        else:
            # Tie-break by price vs range midpoint
            recent = df.iloc[-50:]
            mid = (recent["h"].max() + recent["l"].min()) / 2
            bias = "bullish" if current > mid else "bearish" if current < mid else "ranging"

        last_choch = next((s for s in reversed(signals) if "CHoCH" in s.type), None)
        last_bos   = next((s for s in reversed(signals) if "BOS" in s.type), None)

        return SymbolBias(
            symbol=symbol, timeframe=timeframe, bias=bias,
            last_bos=last_bos, last_choch=last_choch,
            swing_highs=swing_highs[-10:], swing_lows=swing_lows[-10:],
            last_updated=df.iloc[-1]["time"] if "time" in df.columns else None,
        )

    # ── MAIN LOOP ────────────────────────────────────────────────────────────

    async def run(self, symbols: list[str], timeframes: list[str], interval: int = 60):
        """Continuously scan all symbols/timeframes and publish to bus."""
        self._running = True
        logger.info(f"MarketStructureAgent started — {len(symbols)} symbols × {len(timeframes)} timeframes")
        while self._running:
            for symbol in symbols:
                for tf in timeframes:
                    try:
                        df = self.mt5.get_candles(symbol, tf, count=300)
                        if df.empty:
                            continue
                        result = self.analyze(df, symbol, tf)
                        key = f"{symbol}_{tf}"
                        self.structure_map[key] = result
                        # Publish to bus
                        await self.bus.put({
                            "type": "structure_update",
                            "symbol": symbol,
                            "timeframe": tf,
                            "bias": result.bias,
                            "last_choch": result.last_choch,
                            "last_bos": result.last_bos,
                        })
                    except Exception as e:
                        logger.error(f"Structure analysis error {symbol}/{tf}: {e}")
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False

    def get_bias(self, symbol: str, timeframe: str) -> str:
        return self.structure_map.get(f"{symbol}_{timeframe}", SymbolBias(symbol, timeframe, "neutral")).bias

    def get_all_biases(self) -> dict:
        return {k: v.bias for k, v in self.structure_map.items()}
