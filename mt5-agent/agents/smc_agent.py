"""
Smart Money Concepts Agent — Agent 3 (ICT)
Detects: FVGs, Order Blocks, Breaker Blocks, Liquidity Pools,
Premium/Discount zones, OTE levels, Judas Swing, Power of 3.
"""
import logging
import asyncio
from dataclasses import dataclass, field
from typing import Optional
import pandas as pd
import numpy as np

logger = logging.getLogger("smc_agent")


@dataclass
class FVG:
    type: str        # "bull" | "bear"
    high: float
    low: float
    index: int
    timestamp: Optional[pd.Timestamp] = None
    filled: bool = False
    fill_pct: float = 0.0


@dataclass
class OrderBlock:
    type: str        # "bull" | "bear" | "breaker"
    high: float
    low: float
    index: int
    volume: float = 0.0
    timestamp: Optional[pd.Timestamp] = None
    mitigated: bool = False
    strength: str = "normal"   # "normal" | "strong" | "breaker"


@dataclass
class LiquidityLevel:
    type: str        # "BSL" | "SSL" | "EQH" | "EQL"
    price: float
    swept: bool = False
    timestamp: Optional[pd.Timestamp] = None


@dataclass
class SMCMap:
    symbol: str
    timeframe: str
    fvgs: list = field(default_factory=list)
    order_blocks: list = field(default_factory=list)
    liquidity_levels: list = field(default_factory=list)
    premium_zone: tuple = (0.0, 0.0)     # (0.618 fib, range high)
    discount_zone: tuple = (0.0, 0.0)    # (range low, 0.382 fib)
    equilibrium: float = 0.0
    ote_zone: tuple = (0.0, 0.0)          # 0.62–0.79 fib
    in_premium: bool = False
    in_discount: bool = False
    judas_swing_detected: bool = False
    po3_phase: str = "unknown"            # "accumulation" | "manipulation" | "distribution"


class SMCAgent:
    """
    Runs ICT Smart Money analysis on all symbols/timeframes.
    Publishes detected arrays to the message bus for AI Brain consumption.
    """

    def __init__(self, mt5_connector, message_bus: asyncio.Queue):
        self.mt5 = mt5_connector
        self.bus = message_bus
        self.smc_maps: dict[str, SMCMap] = {}
        self._running = False

    # ── FVG DETECTION ───────────────────────────────────────────────────────

    def detect_fvgs(self, df: pd.DataFrame) -> list[FVG]:
        fvgs = []
        for i in range(1, len(df) - 1):
            prev, curr, nxt = df.iloc[i-1], df.iloc[i], df.iloc[i+1]
            ts = curr["time"] if "time" in df.columns else None
            # Bullish FVG: gap between prev.h and next.l (next.l > prev.h)
            if nxt["l"] > prev["h"] and curr["c"] > curr["o"]:
                fvgs.append(FVG(type="bull", high=nxt["l"], low=prev["h"], index=i, timestamp=ts))
            # Bearish FVG: gap between prev.l and next.h (next.h < prev.l)
            if nxt["h"] < prev["l"] and curr["c"] < curr["o"]:
                fvgs.append(FVG(type="bear", high=prev["l"], low=nxt["h"], index=i, timestamp=ts))

        # Mark filled FVGs
        for fvg in fvgs:
            later = df.iloc[fvg.index + 2:]
            if fvg.type == "bull":
                touches = later[later["l"] <= fvg.high]
                if len(touches) > 0:
                    lowest = touches["l"].min()
                    fvg.fill_pct = min(1.0, (fvg.high - lowest) / (fvg.high - fvg.low + 1e-9))
                    if fvg.fill_pct >= 1.0:
                        fvg.filled = True
            else:
                touches = later[later["h"] >= fvg.low]
                if len(touches) > 0:
                    highest = touches["h"].max()
                    fvg.fill_pct = min(1.0, (highest - fvg.low) / (fvg.high - fvg.low + 1e-9))
                    if fvg.fill_pct >= 1.0:
                        fvg.filled = True

        # Return only unfilled FVGs from last 100 candles
        return [f for f in fvgs if not f.filled and f.index >= len(df) - 100]

    # ── ORDER BLOCK DETECTION ───────────────────────────────────────────────

    def detect_order_blocks(self, df: pd.DataFrame) -> list[OrderBlock]:
        obs = []
        for i in range(2, len(df) - 4):
            c = df.iloc[i]
            ts = c["time"] if "time" in df.columns else None
            future = df.iloc[i+1 : i+5]
            vol = c.get("v", 0)

            # Bullish OB: last bearish candle before bullish impulse
            if c["c"] < c["o"]:
                strong_bull = future[future["c"] > future["o"]]
                if len(strong_bull) >= 2 and future.iloc[-1]["c"] > c["h"]:
                    strength = "strong" if vol > df["v"].iloc[max(0,i-20):i].mean() * 1.5 else "normal"
                    obs.append(OrderBlock(type="bull", high=c["h"], low=c["l"],
                                          index=i, volume=vol, timestamp=ts, strength=strength))

            # Bearish OB: last bullish candle before bearish impulse
            if c["c"] > c["o"]:
                strong_bear = future[future["c"] < future["o"]]
                if len(strong_bear) >= 2 and future.iloc[-1]["c"] < c["l"]:
                    strength = "strong" if vol > df["v"].iloc[max(0,i-20):i].mean() * 1.5 else "normal"
                    obs.append(OrderBlock(type="bear", high=c["h"], low=c["l"],
                                          index=i, volume=vol, timestamp=ts, strength=strength))

        # Detect breaker blocks: OBs that got traded through and flipped
        price = df.iloc[-1]["c"]
        for ob in obs:
            if ob.type == "bull" and price < ob.low:
                ob.strength = "breaker"
                ob.type = "breaker"
            elif ob.type == "bear" and price > ob.high:
                ob.strength = "breaker"
                ob.type = "breaker"

        # Mark mitigated OBs
        for ob in obs:
            later = df.iloc[ob.index + 1:]
            if ob.type == "bull":
                ob.mitigated = bool((later["l"] <= ob.high).any())
            elif ob.type == "bear":
                ob.mitigated = bool((later["h"] >= ob.low).any())

        return [ob for ob in obs if not ob.mitigated and ob.index >= len(df) - 80]

    # ── LIQUIDITY DETECTION ─────────────────────────────────────────────────

    def detect_liquidity(self, df: pd.DataFrame, lookback: int = 5) -> list[LiquidityLevel]:
        levels = []
        h = df["h"].values
        l = df["l"].values
        price = df.iloc[-1]["c"]

        # Equal highs/lows within 0.05% of each other
        for i in range(lookback, len(df) - lookback):
            ts = df.iloc[i]["time"] if "time" in df.columns else None
            # Swing high
            if all(h[i] >= h[i-j] for j in range(1, lookback+1)) and \
               all(h[i] >= h[i+j] for j in range(1, lookback+1)):
                # Check for equal high nearby
                nearby = [h[j] for j in range(max(0, i-20), i)
                          if abs(h[j] - h[i]) / h[i] < 0.0005]
                level_type = "EQH" if nearby else "BSL"
                swept = price > h[i]
                levels.append(LiquidityLevel(type=level_type, price=h[i],
                                              swept=swept, timestamp=ts))
            # Swing low
            if all(l[i] <= l[i-j] for j in range(1, lookback+1)) and \
               all(l[i] <= l[i+j] for j in range(1, lookback+1)):
                nearby = [l[j] for j in range(max(0, i-20), i)
                          if abs(l[j] - l[i]) / (l[i] + 1e-9) < 0.0005]
                level_type = "EQL" if nearby else "SSL"
                swept = price < l[i]
                levels.append(LiquidityLevel(type=level_type, price=l[i],
                                              swept=swept, timestamp=ts))

        return levels[-30:]

    # ── PREMIUM/DISCOUNT + OTE ──────────────────────────────────────────────

    def calc_pd_zones(self, df: pd.DataFrame) -> dict:
        recent = df.iloc[-100:]
        h = recent["h"].max()
        l = recent["l"].min()
        r = h - l
        eq = l + r * 0.5
        price = df.iloc[-1]["c"]
        return {
            "high": h, "low": l, "equilibrium": eq,
            "premium_zone": (l + r * 0.618, h),
            "discount_zone": (l, l + r * 0.382),
            "ote_zone": (l + r * 0.62, l + r * 0.79),
            "in_premium": price > eq,
            "in_discount": price < eq,
        }

    # ── JUDAS SWING DETECTION ───────────────────────────────────────────────

    def detect_judas_swing(self, df: pd.DataFrame) -> bool:
        """Detect fake move at session open before true direction."""
        if len(df) < 20:
            return False
        # Session open = first 3 candles with spike then reversal
        recent = df.iloc[-8:]
        price_range = recent["h"].max() - recent["l"].min()
        first_move = recent.iloc[1]["c"] - recent.iloc[0]["c"]
        last_move = recent.iloc[-1]["c"] - recent.iloc[1]["c"]
        # Judas: sharp move one way, then strong reversal
        if abs(first_move) > price_range * 0.3 and np.sign(first_move) != np.sign(last_move):
            if abs(last_move) > abs(first_move) * 1.2:
                return True
        return False

    # ── POWER OF 3 ──────────────────────────────────────────────────────────

    def detect_po3_phase(self, df: pd.DataFrame) -> str:
        """Detect current Power of 3 phase (accumulation/manipulation/distribution)."""
        if len(df) < 30:
            return "unknown"
        recent = df.iloc[-30:]
        volatility = (recent["h"] - recent["l"]).std()
        avg_vol = (df["h"] - df["l"]).iloc[-100:].std() if len(df) >= 100 else volatility

        price_range = recent["h"].max() - recent["l"].min()
        body_range = abs(recent.iloc[-1]["c"] - recent.iloc[0]["o"])

        if volatility < avg_vol * 0.7:
            return "accumulation"
        elif price_range > body_range * 2:
            return "manipulation"
        else:
            return "distribution"

    # ── FULL ANALYSIS ───────────────────────────────────────────────────────

    def analyze(self, df: pd.DataFrame, symbol: str, timeframe: str) -> SMCMap:
        if len(df) < 30:
            return SMCMap(symbol=symbol, timeframe=timeframe)

        fvgs       = self.detect_fvgs(df)
        obs        = self.detect_order_blocks(df)
        liquidity  = self.detect_liquidity(df)
        pd_zones   = self.calc_pd_zones(df)
        judas      = self.detect_judas_swing(df)
        po3        = self.detect_po3_phase(df)

        return SMCMap(
            symbol=symbol, timeframe=timeframe,
            fvgs=fvgs, order_blocks=obs, liquidity_levels=liquidity,
            premium_zone=pd_zones["premium_zone"],
            discount_zone=pd_zones["discount_zone"],
            equilibrium=pd_zones["equilibrium"],
            ote_zone=pd_zones["ote_zone"],
            in_premium=pd_zones["in_premium"],
            in_discount=pd_zones["in_discount"],
            judas_swing_detected=judas,
            po3_phase=po3,
        )

    # ── MAIN LOOP ────────────────────────────────────────────────────────────

    async def run(self, symbols: list[str], timeframes: list[str], interval: int = 60):
        self._running = True
        logger.info(f"SMCAgent started — {len(symbols)}×{len(timeframes)}")
        while self._running:
            for symbol in symbols:
                for tf in timeframes:
                    try:
                        df = self.mt5.get_candles(symbol, tf, count=300)
                        if df.empty:
                            continue
                        smc = self.analyze(df, symbol, tf)
                        self.smc_maps[f"{symbol}_{tf}"] = smc
                        await self.bus.put({
                            "type": "smc_update",
                            "symbol": symbol,
                            "timeframe": tf,
                            "fvg_count": len(smc.fvgs),
                            "ob_count": len(smc.order_blocks),
                            "in_discount": smc.in_discount,
                            "in_premium": smc.in_premium,
                            "po3_phase": smc.po3_phase,
                            "judas": smc.judas_swing_detected,
                        })
                    except Exception as e:
                        logger.error(f"SMC error {symbol}/{tf}: {e}")
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False

    def get_smc(self, symbol: str, timeframe: str) -> Optional[SMCMap]:
        return self.smc_maps.get(f"{symbol}_{timeframe}")

    def get_nearest_ob(self, symbol: str, timeframe: str, price: float, direction: str) -> Optional[OrderBlock]:
        smc = self.get_smc(symbol, timeframe)
        if not smc:
            return None
        candidates = [ob for ob in smc.order_blocks if ob.type == direction]
        if not candidates:
            return None
        return min(candidates, key=lambda ob: abs((ob.high + ob.low) / 2 - price))

    def get_nearest_fvg(self, symbol: str, timeframe: str, price: float, direction: str) -> Optional[FVG]:
        smc = self.get_smc(symbol, timeframe)
        if not smc:
            return None
        candidates = [f for f in smc.fvgs if f.type == direction]
        if not candidates:
            return None
        return min(candidates, key=lambda f: abs((f.high + f.low) / 2 - price))
