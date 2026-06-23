"""
Monte Carlo Simulation — stress tests strategy by running 1000 random
permutations of the trade sequence to expose real distribution of outcomes.
"""
import logging
import random
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
import numpy as np

logger = logging.getLogger("monte_carlo")


@dataclass
class MCResult:
    n_simulations: int
    median_return: float
    mean_return: float
    best_return: float
    worst_return: float
    median_max_drawdown: float
    worst_max_drawdown: float
    prob_profit: float          # % sims that ended profitable
    prob_ruin: float            # % sims that hit -20% (ruin threshold)
    var_95: float               # Value at Risk at 95% confidence
    cvar_95: float              # Conditional VaR (expected loss beyond VaR)
    sharpe_distribution: list   # Sharpe ratios across sims
    equity_percentiles: dict    # 10th/25th/50th/75th/90th equity curves


def _max_drawdown(equity: list[float]) -> float:
    peak = equity[0]
    mdd = 0.0
    for v in equity:
        if v > peak:
            peak = v
        dd = (peak - v) / peak if peak > 0 else 0
        if dd > mdd:
            mdd = dd
    return mdd


def _sharpe(returns: list[float], risk_free: float = 0.0) -> float:
    if len(returns) < 2:
        return 0.0
    arr = np.array(returns)
    excess = arr - risk_free / 252
    std = np.std(excess)
    if std == 0:
        return 0.0
    return float(np.mean(excess) / std * np.sqrt(252))


def run_monte_carlo(
    trade_returns: list[float],       # list of per-trade % returns (e.g. [0.01, -0.005, ...])
    initial_balance: float = 10_000,
    n_simulations: int = 1_000,
    ruin_threshold: float = 0.20,     # 20% drawdown = ruin
    seed: Optional[int] = 42,
) -> MCResult:
    """
    Shuffle the trade sequence 1000 times and simulate each.
    Returns distribution of outcomes.
    """
    if seed is not None:
        random.seed(seed)
        np.random.seed(seed)

    n_trades = len(trade_returns)
    if n_trades == 0:
        logger.warning("No trades to simulate")
        return MCResult(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, [], {})

    final_returns: list[float] = []
    max_drawdowns: list[float] = []
    sharpes: list[float] = []
    ruin_count = 0
    profit_count = 0
    all_equity_curves: list[list[float]] = []

    for _ in range(n_simulations):
        shuffled = random.sample(trade_returns, n_trades)
        equity = initial_balance
        equity_curve = [equity]
        per_trade_rets = []

        for r in shuffled:
            equity *= (1 + r)
            equity_curve.append(equity)
            per_trade_rets.append(r)

        total_return = (equity - initial_balance) / initial_balance
        mdd = _max_drawdown(equity_curve)
        sr = _sharpe(per_trade_rets)

        final_returns.append(total_return)
        max_drawdowns.append(mdd)
        sharpes.append(sr)
        all_equity_curves.append(equity_curve)

        if mdd >= ruin_threshold:
            ruin_count += 1
        if total_return > 0:
            profit_count += 1

    # VaR / CVaR at 95%
    sorted_returns = sorted(final_returns)
    var_idx = int(0.05 * n_simulations)
    var_95 = sorted_returns[var_idx]
    cvar_95 = float(np.mean(sorted_returns[:var_idx])) if var_idx > 0 else var_95

    # Equity curve percentiles (normalize to length of first curve)
    curve_len = len(all_equity_curves[0])
    # Pad/trim all curves to same length
    normalized = []
    for c in all_equity_curves:
        if len(c) >= curve_len:
            normalized.append(c[:curve_len])
        else:
            normalized.append(c + [c[-1]] * (curve_len - len(c)))

    arr = np.array(normalized)
    percentiles = {}
    for p in [10, 25, 50, 75, 90]:
        percentiles[str(p)] = np.percentile(arr, p, axis=0).tolist()

    result = MCResult(
        n_simulations=n_simulations,
        median_return=float(np.median(final_returns)),
        mean_return=float(np.mean(final_returns)),
        best_return=float(max(final_returns)),
        worst_return=float(min(final_returns)),
        median_max_drawdown=float(np.median(max_drawdowns)),
        worst_max_drawdown=float(max(max_drawdowns)),
        prob_profit=profit_count / n_simulations,
        prob_ruin=ruin_count / n_simulations,
        var_95=var_95,
        cvar_95=cvar_95,
        sharpe_distribution=sharpes,
        equity_percentiles=percentiles,
    )

    logger.info(
        f"Monte Carlo ({n_simulations} sims): median={result.median_return:.1%} "
        f"mdd={result.median_max_drawdown:.1%} prob_profit={result.prob_profit:.1%} "
        f"prob_ruin={result.prob_ruin:.1%}"
    )
    return result


def mc_to_dict(result: MCResult) -> dict:
    return {
        "n_simulations": result.n_simulations,
        "median_return_pct": round(result.median_return * 100, 2),
        "mean_return_pct": round(result.mean_return * 100, 2),
        "best_return_pct": round(result.best_return * 100, 2),
        "worst_return_pct": round(result.worst_return * 100, 2),
        "median_max_drawdown_pct": round(result.median_max_drawdown * 100, 2),
        "worst_max_drawdown_pct": round(result.worst_max_drawdown * 100, 2),
        "prob_profit_pct": round(result.prob_profit * 100, 1),
        "prob_ruin_pct": round(result.prob_ruin * 100, 1),
        "var_95_pct": round(result.var_95 * 100, 2),
        "cvar_95_pct": round(result.cvar_95 * 100, 2),
        "median_sharpe": round(float(np.median(result.sharpe_distribution)), 2),
        "equity_percentiles": result.equity_percentiles,
    }
