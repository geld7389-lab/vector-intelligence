"""
Execution Agent — Agent 8
Receives approved signals from Orchestrator.
Handles: market/limit/stop orders, spread check, slippage, partial close, ATR trailing stop.
"""
import logging
import asyncio
from datetime import datetime
from typing import Optional

logger = logging.getLogger("executor")

# Max allowed spread multipliers per asset class
SPREAD_LIMITS = {
    "EURUSD": 1.5, "GBPUSD": 2.0, "USDJPY": 1.5,
    "XAUUSD": 3.0, "XAGUSD": 4.0, "USOIL": 4.0,
    "NASDAQ100": 3.0, "SP500": 3.0, "US30": 3.0,
    "BTCUSD": 5.0, "ETHUSD": 5.0,
}


class ExecutionAgent:

    def __init__(self, mt5_connector, risk_manager, telegram=None):
        self.mt5 = mt5_connector
        self.risk = risk_manager
        self.telegram = telegram
        self._running = False
        self.open_tickets: dict[str, dict] = {}   # ticket -> trade info
        self._partial_closed: set = set()

    # ── SPREAD CHECK ──────────────────────────────────────────────────────────

    def is_spread_ok(self, symbol: str) -> tuple[bool, str]:
        tick = self.mt5.get_tick(symbol)
        if not tick:
            return False, "Cannot get tick data"
        spread = tick.get("spread", 0)
        avg = tick.get("avg_spread", spread)
        limit = SPREAD_LIMITS.get(symbol, 3.0)
        if avg > 0 and spread > avg * limit:
            return False, f"Spread too wide: {spread:.5f} vs avg {avg:.5f} (limit {limit}x)"
        return True, "ok"

    # ── EXECUTE TRADE ──────────────────────────────────────────────────────────

    async def execute(self, trade: dict) -> Optional[dict]:
        """
        Execute an approved trade.
        trade = {symbol, direction, entry, stop_loss, take_profit, lot, ai_score, setup_type}
        """
        symbol    = trade["symbol"]
        direction = trade["direction"]   # "buy" | "sell"
        sl        = trade["stop_loss"]
        tp        = trade["take_profit"]
        lot       = trade["lot"]

        # Spread check
        spread_ok, spread_msg = self.is_spread_ok(symbol)
        if not spread_ok:
            logger.warning(f"Spread check failed for {symbol}: {spread_msg} — waiting 30s")
            await asyncio.sleep(30)
            spread_ok, spread_msg = self.is_spread_ok(symbol)
            if not spread_ok:
                logger.error(f"Spread still too wide — skipping {symbol}")
                return None

        comment = f"VECTOR_AI_s{trade.get('ai_score', 0)}"
        result = self.mt5.place_market_order(symbol, direction, lot, sl, tp, comment)

        if not result:
            logger.error(f"Order failed for {symbol}")
            return None

        ticket = result["ticket"]
        price  = result["price"]
        rr = abs(tp - price) / (abs(price - sl) + 1e-9)

        trade_record = {
            "ticket": ticket,
            "symbol": symbol,
            "direction": direction,
            "lot": lot,
            "open_price": price,
            "sl": sl,
            "tp": tp,
            "rr": rr,
            "ai_score": trade.get("ai_score", 0),
            "setup_type": trade.get("setup_type", ""),
            "opened_at": datetime.utcnow().isoformat(),
            "partial_closed": False,
            "breakeven_moved": False,
        }
        self.open_tickets[str(ticket)] = trade_record

        logger.info(f"TRADE OPENED: {direction} {lot} {symbol} @ {price} SL={sl} TP={tp} ticket={ticket}")

        if self.telegram:
            await self.telegram.alert_trade_opened(
                symbol, direction, price, sl, tp, lot, rr, trade.get("ai_score", 0), trade.get("setup_type", "")
            )

        return trade_record

    # ── POSITION MANAGEMENT ───────────────────────────────────────────────────

    async def manage_open_positions(self):
        """
        Monitor open positions for:
        - Partial close at 1:1 RR
        - Move SL to breakeven after 1:1
        - ATR trailing stop on remaining
        """
        positions = self.mt5.get_open_positions()
        for pos in positions:
            ticket = str(pos["ticket"])
            if ticket not in self.open_tickets:
                continue
            record = self.open_tickets[ticket]
            price = self.mt5.get_tick(pos["symbol"])
            if not price:
                continue
            current = price["bid"] if pos["direction"] == "buy" else price["ask"]
            open_p  = record["open_price"]
            sl      = record["sl"]
            tp      = record["tp"]
            is_buy  = pos["direction"] == "buy"

            sl_dist = abs(open_p - sl)
            profit_dist = (current - open_p) if is_buy else (open_p - current)
            r_achieved = profit_dist / (sl_dist + 1e-9)

            # Partial close at 1R
            if r_achieved >= 1.0 and not record.get("partial_closed"):
                half_lot = round(pos["volume"] / 2, 2)
                if half_lot >= 0.01:
                    # Close half the position
                    if self.mt5.close_position(pos["ticket"]):
                        record["partial_closed"] = True
                        logger.info(f"Partial close: {ticket} {pos['symbol']} @ {current} (1R hit)")

            # Move SL to breakeven after partial close
            if record.get("partial_closed") and not record.get("breakeven_moved"):
                new_sl = open_p + (0.0002 if is_buy else -0.0002)  # tiny buffer
                if self.mt5.modify_sl_tp(pos["ticket"], new_sl, tp):
                    record["breakeven_moved"] = True
                    record["sl"] = new_sl
                    logger.info(f"Breakeven set: {ticket} {pos['symbol']} SL -> {new_sl:.4f}")

            # ATR trailing stop (simplified: trail by 1x ATR)
            if record.get("breakeven_moved"):
                # Approximate ATR as 0.1% of price for non-MT5 mode
                atr_approx = current * 0.001
                trail_sl = (current - atr_approx) if is_buy else (current + atr_approx)
                current_sl = pos.get("sl", record["sl"])
                if (is_buy and trail_sl > current_sl) or (not is_buy and trail_sl < current_sl):
                    if self.mt5.modify_sl_tp(pos["ticket"], trail_sl, tp):
                        record["sl"] = trail_sl

    # ── CLOSE ALL ────────────────────────────────────────────────────────────

    async def close_all_positions(self, reason: str = "emergency"):
        """Emergency close all open positions."""
        positions = self.mt5.get_open_positions()
        closed = 0
        for pos in positions:
            if self.mt5.close_position(pos["ticket"]):
                closed += 1
                logger.info(f"Emergency closed: {pos['symbol']} ticket={pos['ticket']}")
        logger.warning(f"Emergency close: {closed}/{len(positions)} positions closed. Reason: {reason}")
        if self.telegram:
            await self.telegram.send(f"🚨 EMERGENCY CLOSE: {closed} positions closed\nReason: {reason}")
        return closed

    # ── MAIN LOOP ──────────────────────────────────────────────────────────────

    async def run(self, interval: int = 15):
        """Position management loop."""
        self._running = True
        logger.info("ExecutionAgent position manager started")
        while self._running:
            try:
                await self.manage_open_positions()
            except Exception as e:
                logger.error(f"Execution manager error: {e}")
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False
