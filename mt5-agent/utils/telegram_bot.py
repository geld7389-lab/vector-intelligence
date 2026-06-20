"""
Telegram Alert Bot — sends real-time alerts and daily summaries.
All notifications go through this module.
"""
import logging
import asyncio
from datetime import datetime
import httpx

logger = logging.getLogger("telegram")


class TelegramBot:
    def __init__(self, token: str, chat_id: str):
        self.token = token
        self.chat_id = chat_id
        self.base_url = f"https://api.telegram.org/bot{token}"
        self._enabled = bool(token and chat_id)

    async def send(self, text: str, parse_mode: str = "HTML") -> bool:
        if not self._enabled:
            logger.debug(f"Telegram disabled. Message: {text[:80]}")
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(f"{self.base_url}/sendMessage", json={
                    "chat_id": self.chat_id,
                    "text": text,
                    "parse_mode": parse_mode,
                })
                if r.status_code != 200:
                    logger.warning(f"Telegram send failed: {r.status_code} {r.text[:100]}")
                    return False
                return True
        except Exception as e:
            logger.warning(f"Telegram error: {e}")
            return False

    def send_sync(self, text: str) -> bool:
        """Synchronous wrapper for use in non-async contexts."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(self.send(text))
                return True
            return loop.run_until_complete(self.send(text))
        except Exception:
            return False

    # ── ALERT FORMATTERS ────────────────────────────────────────────────────

    async def alert_trade_opened(self, symbol: str, direction: str, entry: float,
                                  sl: float, tp: float, lot: float, rr: float,
                                  ai_score: int, setup_type: str):
        emoji = "🟢" if direction == "buy" else "🔴"
        arrow = "📈 LONG" if direction == "buy" else "📉 SHORT"
        await self.send(
            f"{emoji} <b>TRADE OPENED</b>\n"
            f"<b>{symbol}</b> — {arrow}\n"
            f"Entry: <code>{entry}</code> | Lot: <code>{lot}</code>\n"
            f"SL: <code>{sl}</code> | TP: <code>{tp}</code>\n"
            f"RR: <b>{rr:.1f}R</b> | AI Score: <b>{ai_score}/10</b>\n"
            f"Setup: {setup_type}\n"
            f"<i>{datetime.utcnow().strftime('%H:%M UTC')}</i>"
        )

    async def alert_trade_closed(self, symbol: str, direction: str, entry: float,
                                  exit_price: float, rr: float, pnl: float, reason: str):
        emoji = "✅" if pnl > 0 else "❌"
        await self.send(
            f"{emoji} <b>TRADE CLOSED</b>\n"
            f"<b>{symbol}</b> — {reason}\n"
            f"Entry: <code>{entry}</code> → Exit: <code>{exit_price}</code>\n"
            f"Result: <b>{'+' if rr > 0 else ''}{rr:.2f}R</b> | P&L: <b>${pnl:+.2f}</b>"
        )

    async def alert_daily_limit_hit(self, loss_pct: float):
        await self.send(
            f"🚨 <b>DAILY LOSS LIMIT HIT</b>\n"
            f"Loss: <b>{loss_pct:.1%}</b>\n"
            f"All trading stopped. All positions closed.\n"
            f"System will resume tomorrow at 00:00 UTC."
        )

    async def alert_consecutive_losses(self, count: int, pause_hours: int = 24):
        await self.send(
            f"⚠️ <b>{count} CONSECUTIVE LOSSES</b>\n"
            f"Risk management pause activated.\n"
            f"Trading suspended for <b>{pause_hours} hours</b>."
        )

    async def alert_asset_paused(self, symbol: str, win_rate: float, trades: int):
        await self.send(
            f"⏸ <b>ASSET PAUSED</b> — {symbol}\n"
            f"Win rate: <b>{win_rate:.0%}</b> over {trades} trades\n"
            f"Below 40% threshold. Flagged for manual review."
        )

    async def send_morning_briefing(self, biases: dict, news_events: list,
                                     account: dict, key_levels: dict):
        events_str = "\n".join(
            f"  • {e['time']} — {e['name']} ({e['impact']})"
            for e in news_events[:5]
        ) or "  No high-impact events"
        bias_str = "\n".join(
            f"  {sym}: {'📈' if b=='bullish' else '📉' if b=='bearish' else '➡️'} {b.upper()}"
            for sym, b in biases.items()
        )
        await self.send(
            f"☀️ <b>MORNING BRIEFING</b> — {datetime.utcnow().strftime('%A %d %b')}\n\n"
            f"<b>Account</b>\n"
            f"  Balance: ${account.get('balance',0):,.2f} | Equity: ${account.get('equity',0):,.2f}\n\n"
            f"<b>Market Bias</b>\n{bias_str}\n\n"
            f"<b>News Events Today</b>\n{events_str}"
        )

    async def send_evening_summary(self, trades_today: list, daily_pnl: float,
                                    win_rate: float, account: dict):
        wins = sum(1 for t in trades_today if t.get("result") == "win")
        losses = sum(1 for t in trades_today if t.get("result") == "loss")
        emoji = "✅" if daily_pnl >= 0 else "❌"
        await self.send(
            f"{emoji} <b>DAILY SUMMARY</b>\n\n"
            f"Trades: {len(trades_today)} ({wins}W / {losses}L)\n"
            f"Win Rate: <b>{win_rate:.0%}</b>\n"
            f"Daily P&L: <b>${daily_pnl:+.2f}</b>\n"
            f"Balance: ${account.get('balance', 0):,.2f}"
        )
