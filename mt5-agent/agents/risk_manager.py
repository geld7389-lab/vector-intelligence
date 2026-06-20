"""
Risk Management Agent — Agent 7
Hard rules: per-trade risk, portfolio heat, correlation, drawdown, consecutive losses.
Runs independently and has final veto on every trade.
"""
import logging
import asyncio
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Optional

from config.settings import (
    MAX_RISK_PER_TRADE, MAX_PORTFOLIO_HEAT, MAX_DAILY_LOSS,
    MAX_WEEKLY_LOSS, MAX_CONSECUTIVE_LOSSES, MAX_MARGIN_PCT,
    CORRELATION_GROUPS, DB_PATH,
)
from utils.lot_calculator import calculate_lot_size, check_margin

logger = logging.getLogger("risk_manager")


class RiskManagerAgent:

    def __init__(self, mt5_connector, telegram=None):
        self.mt5 = mt5_connector
        self.telegram = telegram
        self._running = False
        self.trading_paused = False
        self.pause_reason: Optional[str] = None
        self.pause_until: Optional[datetime] = None
        self.daily_loss = 0.0
        self.weekly_loss = 0.0
        self.consecutive_losses = 0
        self._db = DB_PATH

    # ── DRAWDOWN TRACKING ────────────────────────────────────────────────────

    def update_daily_loss(self, pnl: float):
        """Call this after every closed trade."""
        if pnl < 0:
            self.daily_loss += abs(pnl)
            self.weekly_loss += abs(pnl)
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

    def reset_daily(self):
        self.daily_loss = 0.0
        if self.trading_paused and self.pause_reason == "daily_limit":
            self.trading_paused = False
            self.pause_reason = None
            logger.info("Daily limit reset — trading resumed")

    def reset_weekly(self):
        self.weekly_loss = 0.0
        if self.trading_paused and self.pause_reason == "weekly_limit":
            self.trading_paused = False
            self.pause_reason = None
            logger.info("Weekly limit reset — trading resumed")

    # ── CORRELATION CHECK ────────────────────────────────────────────────────

    def check_correlation(self, symbol: str, direction: str, open_positions: list) -> tuple[bool, str]:
        """Returns (allowed, reason). Blocks correlated trades at full size."""
        for group in CORRELATION_GROUPS:
            if symbol not in group:
                continue
            for pos in open_positions:
                if pos["symbol"] in group and pos["symbol"] != symbol:
                    if pos["direction"] == direction:
                        return False, (
                            f"Correlation block: {symbol} and {pos['symbol']} "
                            f"are correlated — both {direction}"
                        )
        return True, "ok"

    # ── PER-TRADE RISK ───────────────────────────────────────────────────────

    def calc_position_size(self, symbol: str, entry: float, sl: float,
                            account_balance: float, risk_override: float = 1.0) -> float:
        """Calculate lot size respecting per-trade risk and margin limits."""
        risk_pct = MAX_RISK_PER_TRADE * risk_override
        lot = calculate_lot_size(symbol, entry, sl, account_balance, risk_pct)
        account_info = self.mt5.get_account_info()
        if not check_margin(symbol, lot, account_info):
            logger.warning(f"Margin check failed for {lot} lots {symbol} — reducing to 0.01")
            lot = 0.01
        return lot

    # ── PORTFOLIO HEAT ───────────────────────────────────────────────────────

    def calc_portfolio_heat(self, open_positions: list, account_balance: float) -> float:
        """Total open risk as % of account."""
        total_risk = 0.0
        for pos in open_positions:
            if pos.get("sl") and pos.get("open_price"):
                sl_dist = abs(pos["open_price"] - pos["sl"])
                if sl_dist > 0:
                    total_risk += sl_dist * pos.get("volume", 0.01) * 10  # rough estimate
        return total_risk / (account_balance + 1e-9)

    # ── FULL TRADE APPROVAL ──────────────────────────────────────────────────

    def approve_trade(self, symbol: str, direction: str, entry: float,
                      sl: float, tp: float, ai_risk_adj: float = 1.0) -> dict:
        """
        Full risk check before trade execution.
        Returns: {"approved": bool, "reason": str, "lot": float}
        """
        # Check if trading is paused
        if self.trading_paused:
            if self.pause_until and datetime.utcnow() > self.pause_until:
                self.trading_paused = False
                self.pause_reason = None
                logger.info("Pause expired — trading resumed")
            else:
                return {"approved": False, "reason": f"Trading paused: {self.pause_reason}", "lot": 0}

        account = self.mt5.get_account_info()
        balance = account.get("balance", 0)
        if balance <= 0:
            return {"approved": False, "reason": "Cannot get account balance", "lot": 0}

        # Daily drawdown check
        daily_loss_pct = self.daily_loss / balance
        if daily_loss_pct >= MAX_DAILY_LOSS:
            self._pause("daily_limit", hours=24)
            return {"approved": False, "reason": f"Daily loss limit hit ({daily_loss_pct:.1%})", "lot": 0}

        # Weekly drawdown check
        weekly_loss_pct = self.weekly_loss / balance
        if weekly_loss_pct >= MAX_WEEKLY_LOSS:
            self._pause("weekly_limit", hours=168)
            return {"approved": False, "reason": f"Weekly loss limit hit ({weekly_loss_pct:.1%})", "lot": 0}

        # Consecutive losses check
        if self.consecutive_losses >= MAX_CONSECUTIVE_LOSSES:
            self._pause("consecutive_losses", hours=24)
            return {"approved": False, "reason": f"{self.consecutive_losses} consecutive losses", "lot": 0}

        # Portfolio heat check
        open_pos = self.mt5.get_open_positions()
        heat = self.calc_portfolio_heat(open_pos, balance)
        if heat >= MAX_PORTFOLIO_HEAT:
            return {"approved": False, "reason": f"Portfolio heat at {heat:.1%} (max {MAX_PORTFOLIO_HEAT:.0%})", "lot": 0}

        # Correlation check
        corr_ok, corr_reason = self.check_correlation(symbol, direction, open_pos)
        if not corr_ok:
            return {"approved": False, "reason": corr_reason, "lot": 0}

        # Calculate lot size
        lot = self.calc_position_size(symbol, entry, sl, balance, ai_risk_adj)
        if lot < 0.01:
            return {"approved": False, "reason": "Lot size too small", "lot": 0}

        # RR check: minimum 2:1
        rr = abs(tp - entry) / (abs(entry - sl) + 1e-9)
        if rr < 2.0:
            return {"approved": False, "reason": f"RR {rr:.2f} below minimum 2.0", "lot": 0}

        return {
            "approved": True,
            "reason": f"All checks passed — heat={heat:.1%} daily_loss={daily_loss_pct:.1%}",
            "lot": lot,
            "portfolio_heat": heat,
            "daily_loss_pct": daily_loss_pct,
        }

    def _pause(self, reason: str, hours: int = 24):
        self.trading_paused = True
        self.pause_reason = reason
        self.pause_until = datetime.utcnow() + timedelta(hours=hours)
        logger.warning(f"Trading PAUSED: {reason} until {self.pause_until.strftime('%Y-%m-%d %H:%M UTC')}")
        if self.telegram:
            if reason == "daily_limit":
                asyncio.ensure_future(self.telegram.alert_daily_limit_hit(self.daily_loss))
            elif reason == "consecutive_losses":
                asyncio.ensure_future(self.telegram.alert_consecutive_losses(self.consecutive_losses))

    # ── MONITOR LOOP ──────────────────────────────────────────────────────────

    async def run(self, interval: int = 30):
        """Continuously monitor open positions and enforce risk rules."""
        self._running = True
        logger.info("RiskManagerAgent started")
        while self._running:
            try:
                account = self.mt5.get_account_info()
                balance = account.get("balance", 1)
                open_pos = self.mt5.get_open_positions()
                heat = self.calc_portfolio_heat(open_pos, balance)

                if heat >= MAX_PORTFOLIO_HEAT:
                    logger.warning(f"Portfolio heat CRITICAL: {heat:.1%}")

                # Reset daily at midnight UTC
                now = datetime.utcnow()
                if now.hour == 0 and now.minute < 1:
                    self.reset_daily()
                if now.weekday() == 0 and now.hour == 0 and now.minute < 1:
                    self.reset_weekly()

            except Exception as e:
                logger.error(f"Risk monitor error: {e}")
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False

    def get_status(self) -> dict:
        return {
            "paused": self.trading_paused,
            "pause_reason": self.pause_reason,
            "pause_until": self.pause_until.isoformat() if self.pause_until else None,
            "daily_loss": self.daily_loss,
            "weekly_loss": self.weekly_loss,
            "consecutive_losses": self.consecutive_losses,
        }
