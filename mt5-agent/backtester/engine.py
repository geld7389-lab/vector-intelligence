"""
Backtesting Engine — runs exact same strategy logic on historical MT5 data.
Produces full performance report with Sharpe, Sortino, Monte Carlo, walk-forward.
"""
import logging
import sqlite3
import json
import random
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd
import numpy as np

logger = logging.getLogger("backtester")


class BacktestEngine:

    def __init__(self, mt5_connector, output_dir: str = "reports"):
        self.mt5 = mt5_connector
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    # ── DATA ──────────────────────────────────────────────────────────────────

    def fetch_historical(self, symbol: str, timeframe: str, count: int = 2000) -> pd.DataFrame:
        df = self.mt5.get_candles(symbol, timeframe, count)
        if df.empty:
            raise ValueError(f"No data for {symbol}/{timeframe}")
        return df

    # ── STRATEGY (mirrors live agents) ───────────────────────────────────────

    def _detect_fvgs(self, df: pd.DataFrame) -> list:
        fvgs = []
        for i in range(1, len(df) - 1):
            prev, curr, nxt = df.iloc[i-1], df.iloc[i], df.iloc[i+1]
            if nxt["l"] > prev["h"] and curr["c"] > curr["o"]:
                fvgs.append({"type": "bull", "high": nxt["l"], "low": prev["h"], "idx": i})
            if nxt["h"] < prev["l"] and curr["c"] < curr["o"]:
                fvgs.append({"type": "bear", "high": prev["l"], "low": nxt["h"], "idx": i})
        return fvgs

    def _detect_obs(self, df: pd.DataFrame) -> list:
        obs = []
        for i in range(2, len(df) - 4):
            c = df.iloc[i]
            future = df.iloc[i+1:i+5]
            if c["c"] < c["o"]:
                bull_future = future[future["c"] > future["o"]]
                if len(bull_future) >= 2 and future.iloc[-1]["c"] > c["h"]:
                    obs.append({"type": "bull", "high": c["h"], "low": c["l"], "idx": i})
            if c["c"] > c["o"]:
                bear_future = future[future["c"] < future["o"]]
                if len(bear_future) >= 2 and future.iloc[-1]["c"] < c["l"]:
                    obs.append({"type": "bear", "high": c["h"], "low": c["l"], "idx": i})
        return obs

    def _get_swing_levels(self, df: pd.DataFrame, lookback: int = 5):
        highs, lows = [], []
        for i in range(lookback, len(df) - lookback):
            if all(df.iloc[i]["h"] > df.iloc[i-j]["h"] for j in range(1, lookback+1)) and \
               all(df.iloc[i]["h"] > df.iloc[i+j]["h"] for j in range(1, lookback+1)):
                highs.append(df.iloc[i]["h"])
            if all(df.iloc[i]["l"] < df.iloc[i-j]["l"] for j in range(1, lookback+1)) and \
               all(df.iloc[i]["l"] < df.iloc[i+j]["l"] for j in range(1, lookback+1)):
                lows.append(df.iloc[i]["l"])
        return highs, lows

    def run_strategy(self, df: pd.DataFrame, direction: str = "bull") -> list:
        """Run ICT strategy on historical data. Returns list of trade results."""
        trades = []
        window = 50

        for i in range(window, len(df) - 10):
            slice_df = df.iloc[i-window:i]
            price = df.iloc[i]["c"]
            highs, lows = self._get_swing_levels(slice_df)

            if not highs or not lows:
                continue

            bsl = max(highs[-3:]) if len(highs) >= 3 else max(highs)
            ssl = min(lows[-3:])  if len(lows)  >= 3 else min(lows)
            mid = (bsl + ssl) / 2
            in_discount = price < mid
            in_premium  = price > mid

            fvgs = self._detect_fvgs(slice_df)
            obs  = self._detect_obs(slice_df)

            # Bull setup in discount with FVG
            if direction == "bull" and in_discount:
                bull_fvgs = [f for f in fvgs if f["type"] == "bull" and f["high"] < price]
                if bull_fvgs:
                    fvg = bull_fvgs[-1]
                    entry = fvg["high"]
                    sl    = fvg["low"] * 0.998
                    tp    = bsl
                    rr    = abs(tp - entry) / (abs(entry - sl) + 1e-9)
                    if rr < 2.0:
                        continue
                    # Simulate execution on next candles
                    result, exit_price = self._simulate_trade(df, i, "buy", entry, sl, tp)
                    trades.append({
                        "entry": entry, "sl": sl, "tp": tp, "rr": rr,
                        "result": result, "exit": exit_price,
                        "pnl": rr * 100 if result == "win" else -100,
                        "setup": "FVG_BULL", "idx": i,
                        "date": df.iloc[i]["time"].isoformat() if "time" in df.columns else str(i),
                    })

            # Bear setup in premium with FVG
            elif direction == "bear" and in_premium:
                bear_fvgs = [f for f in fvgs if f["type"] == "bear" and f["low"] > price]
                if bear_fvgs:
                    fvg = bear_fvgs[-1]
                    entry = fvg["low"]
                    sl    = fvg["high"] * 1.002
                    tp    = ssl
                    rr    = abs(tp - entry) / (abs(entry - sl) + 1e-9)
                    if rr < 2.0:
                        continue
                    result, exit_price = self._simulate_trade(df, i, "sell", entry, sl, tp)
                    trades.append({
                        "entry": entry, "sl": sl, "tp": tp, "rr": rr,
                        "result": result, "exit": exit_price,
                        "pnl": rr * 100 if result == "win" else -100,
                        "setup": "FVG_BEAR", "idx": i,
                        "date": df.iloc[i]["time"].isoformat() if "time" in df.columns else str(i),
                    })

        return trades

    def _simulate_trade(self, df, start_idx, direction, entry, sl, tp, max_bars=20):
        for i in range(start_idx + 1, min(start_idx + max_bars + 1, len(df))):
            c = df.iloc[i]
            if direction == "buy":
                if c["l"] <= sl:
                    return "loss", sl
                if c["h"] >= tp:
                    return "win", tp
            else:
                if c["h"] >= sl:
                    return "loss", sl
                if c["l"] <= tp:
                    return "win", tp
        # Timeout: close at last price
        last = df.iloc[min(start_idx + max_bars, len(df)-1)]["c"]
        return ("win" if (direction == "buy" and last > entry) or (direction == "sell" and last < entry) else "loss"), last

    # ── STATISTICS ────────────────────────────────────────────────────────────

    def calc_stats(self, trades: list, symbol: str, timeframe: str) -> dict:
        if not trades:
            return {"error": "No trades"}

        wins   = [t for t in trades if t["result"] == "win"]
        losses = [t for t in trades if t["result"] == "loss"]
        pnls   = [t["pnl"] for t in trades]
        win_r  = sum(t["rr"] for t in wins)
        loss_r = sum(abs(t["pnl"]) for t in losses) / 100

        # Equity curve
        curve = list(np.cumsum(pnls))
        peak = max(curve) if curve else 0
        max_dd = max(
            (peak - curve[i] for i in range(len(curve)) if curve[i] < max(curve[:i+1] or [0])),
            default=0
        )

        # Sharpe (annualized, assuming 252 trading days)
        if len(pnls) > 1:
            std = np.std(pnls, ddof=1)
            sharpe = (np.mean(pnls) / (std + 1e-9)) * np.sqrt(252)
        else:
            sharpe = 0.0

        # Sortino (only downside deviation)
        neg_pnls = [p for p in pnls if p < 0]
        if neg_pnls:
            down_std = np.std(neg_pnls, ddof=1)
            sortino = (np.mean(pnls) / (down_std + 1e-9)) * np.sqrt(252)
        else:
            sortino = sharpe

        # Consecutive losses
        max_consec = 0
        cur = 0
        for t in trades:
            if t["result"] == "loss":
                cur += 1
                max_consec = max(max_consec, cur)
            else:
                cur = 0

        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "total_trades": len(trades),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / len(trades) * 100, 1),
            "total_return": round(sum(pnls), 2),
            "max_drawdown": round(max_dd, 2),
            "profit_factor": round(win_r / (loss_r + 1e-9), 2),
            "sharpe_ratio": round(sharpe, 3),
            "sortino_ratio": round(sortino, 3),
            "avg_rr": round(sum(t["rr"] for t in trades) / len(trades), 2),
            "expectancy": round(sum(pnls) / len(trades), 2),
            "max_consecutive_losses": max_consec,
            "equity_curve": curve,
            "first_trade": trades[0]["date"],
            "last_trade": trades[-1]["date"],
        }

    # ── MONTE CARLO ───────────────────────────────────────────────────────────

    def monte_carlo(self, trades: list, n_sims: int = 1000) -> dict:
        """Run N random permutations of trade sequence."""
        if not trades:
            return {}
        pnls = [t["pnl"] for t in trades]
        all_final = []
        all_max_dd = []

        for _ in range(n_sims):
            shuffled = random.sample(pnls, len(pnls))
            curve = list(np.cumsum(shuffled))
            all_final.append(curve[-1])
            peak = 0
            max_dd = 0
            for v in curve:
                if v > peak:
                    peak = v
                dd = peak - v
                if dd > max_dd:
                    max_dd = dd
            all_max_dd.append(max_dd)

        return {
            "simulations": n_sims,
            "median_return": round(float(np.median(all_final)), 2),
            "p10_return": round(float(np.percentile(all_final, 10)), 2),
            "p90_return": round(float(np.percentile(all_final, 90)), 2),
            "median_max_dd": round(float(np.median(all_max_dd)), 2),
            "worst_max_dd": round(float(np.percentile(all_max_dd, 95)), 2),
            "probability_of_profit": round(sum(1 for r in all_final if r > 0) / n_sims * 100, 1),
        }

    # ── WALK-FORWARD ──────────────────────────────────────────────────────────

    def walk_forward(self, df: pd.DataFrame, direction: str = "bull", folds: int = 5) -> dict:
        """Walk-forward validation on rolling windows."""
        fold_size = len(df) // (folds + 1)
        results = []
        for i in range(folds):
            train_end = (i + 1) * fold_size
            test_start = train_end
            test_end = test_start + fold_size
            if test_end > len(df):
                break
            test_df = df.iloc[test_start:test_end]
            trades = self.run_strategy(test_df, direction)
            if trades:
                stats = self.calc_stats(trades, "", "")
                results.append({
                    "fold": i + 1,
                    "win_rate": stats.get("win_rate", 0),
                    "profit_factor": stats.get("profit_factor", 0),
                    "total_return": stats.get("total_return", 0),
                })
        return {
            "folds": results,
            "avg_win_rate": round(np.mean([r["win_rate"] for r in results]), 1) if results else 0,
            "avg_profit_factor": round(np.mean([r["profit_factor"] for r in results]), 2) if results else 0,
            "consistency": round(sum(1 for r in results if r["profit_factor"] > 1) / max(1, len(results)) * 100, 1),
        }

    # ── FULL RUN ──────────────────────────────────────────────────────────────

    def run(self, symbol: str, timeframe: str, direction: str = "bull",
            monte_carlo_sims: int = 1000, walk_forward_folds: int = 5) -> dict:
        """Full backtest with all analytics."""
        logger.info(f"Running backtest: {symbol}/{timeframe}/{direction}")
        df = self.fetch_historical(symbol, timeframe)
        trades = self.run_strategy(df, direction)
        if not trades:
            return {"error": f"No setups found in {len(df)} candles"}

        stats    = self.calc_stats(trades, symbol, timeframe)
        mc       = self.monte_carlo(trades, monte_carlo_sims)
        wf       = self.walk_forward(df, direction, walk_forward_folds)

        result = {**stats, "monte_carlo": mc, "walk_forward": wf, "direction": direction}

        # Save report JSON
        fname = self.output_dir / f"backtest_{symbol}_{timeframe}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        with open(fname, "w") as f:
            json.dump({k: v for k, v in result.items() if k != "equity_curve"}, f, indent=2)

        logger.info(f"Backtest complete: {stats['win_rate']}% WR | PF={stats['profit_factor']} | Sharpe={stats['sharpe_ratio']}")
        return result
