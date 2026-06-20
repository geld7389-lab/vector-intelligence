"""
Alert & Notification Agent — Agent 10
Daily morning briefing (08:00 UTC), evening summary (20:00 UTC),
real-time alerts for all events via Telegram.
"""
import logging
import asyncio
from datetime import datetime, timezone

logger = logging.getLogger("alert_agent")


class AlertAgent:

    def __init__(self, telegram, market_structure_agent, macro_agent,
                 risk_manager, self_learning_agent, mt5_connector):
        self.tg = telegram
        self.structure = market_structure_agent
        self.macro = macro_agent
        self.risk = risk_manager
        self.learning = self_learning_agent
        self.mt5 = mt5_connector
        self._running = False
        self._morning_sent_today = False
        self._evening_sent_today = False

    async def send_morning_briefing(self):
        """08:00 UTC — send daily market briefing."""
        try:
            # Get biases from structure agent
            all_biases = self.structure.get_all_biases() if self.structure else {}
            # Filter to main symbols only
            main_symbols = ["NASDAQ100_H4", "XAUUSD_H4", "EURUSD_H4", "BTCUSD_H4", "GER40_H4"]
            biases = {k.replace("_H4", ""): v for k, v in all_biases.items() if k in main_symbols}

            # Get news events
            events = []
            if self.macro and self.macro.news:
                raw = await self.macro.news.fetch_events()
                events = [
                    {"time": e["datetime_utc"].strftime("%H:%M"), "name": e["title"],
                     "impact": e["impact"].upper()}
                    for e in raw
                    if e.get("is_high")
                ]

            account = self.mt5.get_account_info()
            await self.tg.send_morning_briefing(biases, events, account, {})
            logger.info("Morning briefing sent")
        except Exception as e:
            logger.error(f"Morning briefing error: {e}")

    async def send_evening_summary(self):
        """20:00 UTC — send daily performance summary."""
        try:
            stats = self.learning.get_performance_stats(days=1)
            account = self.mt5.get_account_info()
            # Build today's trades list
            from datetime import date
            today = date.today().isoformat()
            trades_today = []  # Would pull from DB in full implementation
            await self.tg.send_evening_summary(
                trades_today=trades_today,
                daily_pnl=stats.get("total_pnl", 0),
                win_rate=stats.get("win_rate", 0) / 100,
                account=account,
            )
            logger.info("Evening summary sent")
        except Exception as e:
            logger.error(f"Evening summary error: {e}")

    async def send_system_status(self):
        """Send current system status."""
        try:
            risk_status = self.risk.get_status() if self.risk else {}
            account = self.mt5.get_account_info()
            positions = self.mt5.get_open_positions()
            blackout = self.macro.current_blackout if self.macro else None

            status_text = (
                f"🤖 <b>VECTOR System Status</b>\n\n"
                f"<b>Account</b>\n"
                f"Balance: ${account.get('balance', 0):,.2f}\n"
                f"Equity: ${account.get('equity', 0):,.2f}\n"
                f"Open Positions: {len(positions)}\n\n"
                f"<b>Risk</b>\n"
                f"Trading Paused: {'⛔ YES — ' + risk_status.get('pause_reason','') if risk_status.get('paused') else '✅ No'}\n"
                f"Daily Loss: ${risk_status.get('daily_loss', 0):.2f}\n"
                f"Consecutive Losses: {risk_status.get('consecutive_losses', 0)}\n\n"
                f"<b>News</b>\n"
                f"Blackout: {'⚠️ ' + blackout if blackout else '✅ Clear'}"
            )
            await self.tg.send(status_text)
        except Exception as e:
            logger.error(f"Status alert error: {e}")

    # ── MAIN LOOP ──────────────────────────────────────────────────────────────

    async def run(self):
        self._running = True
        logger.info("AlertAgent started")

        while self._running:
            now = datetime.now(timezone.utc)
            hour, minute = now.hour, now.minute

            # Morning briefing at 08:00 UTC
            if hour == 8 and minute == 0 and not self._morning_sent_today:
                await self.send_morning_briefing()
                self._morning_sent_today = True

            # Evening summary at 20:00 UTC
            if hour == 20 and minute == 0 and not self._evening_sent_today:
                await self.send_evening_summary()
                self._evening_sent_today = True

            # Reset daily flags at midnight
            if hour == 0 and minute == 0:
                self._morning_sent_today = False
                self._evening_sent_today = False

            await asyncio.sleep(55)  # check every ~1 min

    def stop(self):
        self._running = False
