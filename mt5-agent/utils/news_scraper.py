"""
Economic calendar scraper — fetches and parses upcoming high-impact news events.
Source: ForexFactory JSON API (public, no auth required)
"""
import logging
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional
import httpx

logger = logging.getLogger("news_scraper")


class NewsScraper:
    """Fetches economic calendar events and detects blackout windows."""

    HIGH_IMPACT_KEYWORDS = [
        "NFP", "Non-Farm", "CPI", "FOMC", "Federal Funds", "GDP",
        "PMI", "ECB", "BOE", "BOJ", "RBA", "Interest Rate",
        "Unemployment", "Inflation", "Retail Sales",
    ]

    def __init__(self):
        self._events_cache: list = []
        self._last_fetch: Optional[datetime] = None
        self._cache_ttl = 30 * 60  # 30 minutes

    async def fetch_events(self, days_ahead: int = 2) -> list:
        """Fetch events from ForexFactory and return structured list."""
        # Return cache if fresh
        if self._last_fetch and (datetime.utcnow() - self._last_fetch).seconds < self._cache_ttl:
            return self._events_cache

        events = []
        try:
            # ForexFactory public JSON API
            url = "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json"
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
                if r.status_code == 200:
                    raw = r.json()
                    for item in raw:
                        impact = item.get("impact", "").lower()
                        if impact not in ("high", "medium"):
                            continue
                        try:
                            dt_str = item.get("date", "") + " " + item.get("time", "")
                            dt = datetime.strptime(dt_str.strip(), "%m-%d-%Y %I:%M%p")
                            dt = dt.replace(tzinfo=timezone.utc)
                        except Exception:
                            continue
                        events.append({
                            "title": item.get("title", ""),
                            "country": item.get("country", ""),
                            "impact": impact,
                            "datetime_utc": dt,
                            "forecast": item.get("forecast", ""),
                            "previous": item.get("previous", ""),
                            "is_high": impact == "high" or any(
                                kw.lower() in item.get("title", "").lower()
                                for kw in self.HIGH_IMPACT_KEYWORDS
                            ),
                        })
        except Exception as e:
            logger.warning(f"News scraper failed: {e}")

        self._events_cache = sorted(events, key=lambda e: e["datetime_utc"])
        self._last_fetch = datetime.utcnow()
        logger.info(f"Fetched {len(events)} news events")
        return self._events_cache

    def is_blackout_now(self, blackout_minutes: int = 30) -> tuple[bool, Optional[str]]:
        """Check if currently in a news blackout window. Returns (is_blackout, reason)."""
        now = datetime.utcnow().replace(tzinfo=timezone.utc)
        for event in self._events_cache:
            if not event.get("is_high"):
                continue
            event_dt = event["datetime_utc"]
            diff = (event_dt - now).total_seconds() / 60
            if -blackout_minutes <= diff <= blackout_minutes:
                return True, f"{event['title']} ({event['country']}) in {diff:.0f} min"
        return False, None

    def get_upcoming_high_impact(self, hours: int = 24) -> list:
        """Return high-impact events in next N hours."""
        now = datetime.utcnow().replace(tzinfo=timezone.utc)
        cutoff = now + timedelta(hours=hours)
        return [
            e for e in self._events_cache
            if e.get("is_high") and now <= e["datetime_utc"] <= cutoff
        ]

    def format_for_telegram(self, events: list) -> str:
        lines = []
        for e in events[:8]:
            dt = e["datetime_utc"].strftime("%H:%M UTC")
            lines.append(f"⚡ {dt} — {e['title']} ({e['country']})")
        return "\n".join(lines) if lines else "No high-impact events"
