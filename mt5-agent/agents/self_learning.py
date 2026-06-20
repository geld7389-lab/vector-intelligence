"""
Self-Learning Agent — Agent 9
Analyzes closed trades, updates performance DB, generates weekly reports,
auto-pauses underperforming assets, uses sklearn to find patterns.
"""
import logging
import sqlite3
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger("self_learning")


class SelfLearningAgent:

    def __init__(self, db_path: str, perf_db_path: str, telegram=None, risk_manager=None):
        self.db_path = db_path
        self.perf_db_path = perf_db_path
        self.telegram = telegram
        self.risk = risk_manager
        self.paused_assets: set[str] = set()
        self._running = False
        self._init_db()

    def _init_db(self):
        Path(self.perf_db_path).parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.perf_db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trade_outcomes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT, direction TEXT, setup_type TEXT, timeframe TEXT,
                    session TEXT, ai_score INTEGER, rr_planned REAL, rr_achieved REAL,
                    result TEXT, pnl REAL, opened_at TEXT, closed_at TEXT,
                    structure_bias TEXT, smc_zone TEXT, macro_bias TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS weekly_reports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start TEXT, week_end TEXT,
                    total_trades INTEGER, wins INTEGER, losses INTEGER,
                    win_rate REAL, total_pnl REAL, profit_factor REAL,
                    best_asset TEXT, worst_asset TEXT, best_session TEXT,
                    summary TEXT, recommendations TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS asset_performance (
                    symbol TEXT PRIMARY KEY,
                    total_trades INTEGER DEFAULT 0,
                    wins INTEGER DEFAULT 0,
                    losses INTEGER DEFAULT 0,
                    win_rate REAL DEFAULT 0,
                    total_pnl REAL DEFAULT 0,
                    paused INTEGER DEFAULT 0,
                    last_updated TEXT
                )
            """)
            conn.commit()

    # ── RECORD TRADE ──────────────────────────────────────────────────────────

    def record_trade(self, trade: dict, ai_eval: dict, structure: dict,
                     smc: dict, macro: dict):
        """Call this after every closed trade."""
        with sqlite3.connect(self.perf_db_path) as conn:
            conn.execute("""
                INSERT INTO trade_outcomes
                (symbol, direction, setup_type, timeframe, session, ai_score,
                 rr_planned, rr_achieved, result, pnl, opened_at, closed_at,
                 structure_bias, smc_zone, macro_bias)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                trade.get("symbol"), trade.get("direction"),
                trade.get("setup_type"), trade.get("timeframe"),
                trade.get("session"), ai_eval.get("setup_score", 0),
                trade.get("rr_planned", 2.5), trade.get("rr_achieved", 0),
                trade.get("result"), trade.get("pnl", 0),
                trade.get("opened_at"), trade.get("closed_at"),
                structure.get("htf_bias"), "discount" if smc.get("in_discount") else "premium",
                macro.get("macro_bias"),
            ))
            conn.commit()
        self._update_asset_performance(trade.get("symbol", ""), trade.get("result", ""), trade.get("pnl", 0))
        self._check_asset_health(trade.get("symbol", ""))

    def _update_asset_performance(self, symbol: str, result: str, pnl: float):
        with sqlite3.connect(self.perf_db_path) as conn:
            conn.execute("""
                INSERT INTO asset_performance (symbol, total_trades, wins, losses, total_pnl, last_updated)
                VALUES (?,1,?,?,?,?)
                ON CONFLICT(symbol) DO UPDATE SET
                    total_trades = total_trades + 1,
                    wins = wins + ?,
                    losses = losses + ?,
                    total_pnl = total_pnl + ?,
                    win_rate = CAST(wins AS REAL) / CAST(total_trades AS REAL),
                    last_updated = ?
            """, (
                symbol, 1 if result == "win" else 0, 1 if result == "loss" else 0, pnl,
                datetime.utcnow().isoformat(),
                1 if result == "win" else 0, 1 if result == "loss" else 0, pnl,
                datetime.utcnow().isoformat(),
            ))
            conn.commit()

    def _check_asset_health(self, symbol: str):
        """Auto-pause asset if win rate drops below threshold."""
        from config.settings import MIN_TRADES_FOR_PAUSE, WIN_RATE_PAUSE_THRESHOLD
        with sqlite3.connect(self.perf_db_path) as conn:
            row = conn.execute(
                "SELECT total_trades, win_rate FROM asset_performance WHERE symbol=?", (symbol,)
            ).fetchone()
        if not row:
            return
        total, wr = row
        if total >= MIN_TRADES_FOR_PAUSE and wr < WIN_RATE_PAUSE_THRESHOLD:
            self.paused_assets.add(symbol)
            logger.warning(f"AUTO-PAUSED {symbol}: win rate {wr:.0%} over {total} trades")
            if self.telegram:
                import asyncio
                asyncio.ensure_future(self.telegram.alert_asset_paused(symbol, wr, total))

    def is_paused(self, symbol: str) -> bool:
        return symbol in self.paused_assets

    # ── ANALYTICS ─────────────────────────────────────────────────────────────

    def get_performance_stats(self, days: int = 30) -> dict:
        since = (datetime.utcnow() - timedelta(days=days)).isoformat()
        with sqlite3.connect(self.perf_db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM trade_outcomes WHERE closed_at >= ? ORDER BY closed_at",
                (since,)
            ).fetchall()
            cols = [d[0] for d in conn.execute("SELECT * FROM trade_outcomes LIMIT 0").description]

        if not rows:
            return {"total": 0}

        trades = [dict(zip(cols, r)) for r in rows]
        wins = [t for t in trades if t["result"] == "win"]
        losses = [t for t in trades if t["result"] == "loss"]
        total_pnl = sum(t["pnl"] or 0 for t in trades)
        win_r = sum(abs(t["rr_achieved"] or 0) for t in wins)
        loss_r = sum(abs(t["rr_achieved"] or 0) for t in losses)
        pf = (win_r / loss_r) if loss_r > 0 else 99

        # By session
        by_session: dict = {}
        for t in trades:
            s = t.get("session") or "Unknown"
            if s not in by_session:
                by_session[s] = {"wins": 0, "losses": 0, "pnl": 0}
            if t["result"] == "win": by_session[s]["wins"] += 1
            elif t["result"] == "loss": by_session[s]["losses"] += 1
            by_session[s]["pnl"] += t["pnl"] or 0

        # By asset
        by_asset: dict = {}
        for t in trades:
            s = t.get("symbol") or "Unknown"
            if s not in by_asset:
                by_asset[s] = {"wins": 0, "losses": 0, "pnl": 0}
            if t["result"] == "win": by_asset[s]["wins"] += 1
            elif t["result"] == "loss": by_asset[s]["losses"] += 1
            by_asset[s]["pnl"] += t["pnl"] or 0

        return {
            "total": len(trades),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / len(trades) * 100, 1) if trades else 0,
            "total_pnl": round(total_pnl, 2),
            "profit_factor": round(pf, 2),
            "avg_win_r": round(win_r / len(wins), 2) if wins else 0,
            "avg_loss_r": round(loss_r / len(losses), 2) if losses else 0,
            "by_session": by_session,
            "by_asset": by_asset,
            "paused_assets": list(self.paused_assets),
        }

    # ── ML PATTERN FINDER ────────────────────────────────────────────────────

    def find_winning_patterns(self) -> dict:
        """Use sklearn to find which features correlate with winning trades."""
        try:
            import numpy as np
            from sklearn.ensemble import RandomForestClassifier
            from sklearn.preprocessing import LabelEncoder

            with sqlite3.connect(self.perf_db_path) as conn:
                rows = conn.execute(
                    "SELECT ai_score, session, timeframe, smc_zone, result FROM trade_outcomes WHERE result IN ('win','loss')"
                ).fetchall()

            if len(rows) < 20:
                return {"error": "Need at least 20 trades for ML analysis"}

            le_session  = LabelEncoder()
            le_tf       = LabelEncoder()
            le_zone     = LabelEncoder()

            sessions  = le_session.fit_transform([r[1] or "unknown" for r in rows])
            tfs       = le_tf.fit_transform([r[2] or "H1" for r in rows])
            zones     = le_zone.fit_transform([r[3] or "discount" for r in rows])
            scores    = np.array([r[0] or 5 for r in rows])
            y         = np.array([1 if r[4] == "win" else 0 for r in rows])

            X = np.column_stack([scores, sessions, tfs, zones])
            clf = RandomForestClassifier(n_estimators=100, random_state=42)
            clf.fit(X, y)

            importances = dict(zip(
                ["ai_score", "session", "timeframe", "zone"],
                clf.feature_importances_.tolist()
            ))

            # Best combination
            best = {"ai_score": 9, "session": "New York AM", "timeframe": "H1", "zone": "discount"}
            return {
                "feature_importance": importances,
                "recommendation": f"Focus on: {max(importances, key=importances.get)}",
                "best_session": max(
                    {s: sum(1 for r in rows if r[1]==s and r[4]=="win") / max(1, sum(1 for r in rows if r[1]==s))
                     for s in set(r[1] for r in rows)}.items(),
                    key=lambda x: x[1]
                )[0] if rows else "unknown",
                "model_accuracy": round(float(clf.score(X, y)) * 100, 1),
            }
        except ImportError:
            return {"error": "sklearn not installed — pip install scikit-learn"}
        except Exception as e:
            return {"error": str(e)}

    # ── WEEKLY REPORT ─────────────────────────────────────────────────────────

    async def generate_weekly_report(self) -> str:
        stats = self.get_performance_stats(days=7)
        patterns = self.find_winning_patterns()

        best_asset  = max(stats.get("by_asset",  {}).items(), key=lambda x: x[1]["pnl"], default=("N/A", {}))
        worst_asset = min(stats.get("by_asset",  {}).items(), key=lambda x: x[1]["pnl"], default=("N/A", {}))
        best_session = max(stats.get("by_session",{}).items(), key=lambda x: x[1]["pnl"], default=("N/A", {}))

        report = f"""
📊 WEEKLY PERFORMANCE REPORT
Week ending: {datetime.utcnow().strftime('%Y-%m-%d')}

SUMMARY
Trades: {stats.get('total', 0)} | Wins: {stats.get('wins', 0)} | Losses: {stats.get('losses', 0)}
Win Rate: {stats.get('win_rate', 0):.1f}%
Total P&L: ${stats.get('total_pnl', 0):+.2f}
Profit Factor: {stats.get('profit_factor', 0):.2f}

BEST ASSET:   {best_asset[0]} (${best_asset[1].get('pnl', 0):+.0f})
WORST ASSET:  {worst_asset[0]} (${worst_asset[1].get('pnl', 0):+.0f})
BEST SESSION: {best_session[0]} (${best_session[1].get('pnl', 0):+.0f})

ML INSIGHTS
{json.dumps(patterns, indent=2)}

PAUSED ASSETS: {', '.join(self.paused_assets) if self.paused_assets else 'None'}
"""
        # Store in DB
        with sqlite3.connect(self.perf_db_path) as conn:
            week_start = (datetime.utcnow() - timedelta(days=7)).strftime('%Y-%m-%d')
            week_end   = datetime.utcnow().strftime('%Y-%m-%d')
            conn.execute("""
                INSERT INTO weekly_reports
                (week_start, week_end, total_trades, wins, losses, win_rate, total_pnl,
                 profit_factor, best_asset, worst_asset, best_session, summary, recommendations)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                week_start, week_end,
                stats.get("total", 0), stats.get("wins", 0), stats.get("losses", 0),
                stats.get("win_rate", 0), stats.get("total_pnl", 0),
                stats.get("profit_factor", 0),
                best_asset[0], worst_asset[0], best_session[0],
                report, str(patterns.get("recommendation", "")),
            ))
            conn.commit()

        if self.telegram:
            await self.telegram.send(f"<pre>{report[:3500]}</pre>")

        logger.info("Weekly report generated")
        return report

    # ── MAIN LOOP ─────────────────────────────────────────────────────────────

    async def run(self, interval: int = 3600):
        """Check for Sunday weekly report. Runs every hour."""
        self._running = True
        logger.info("SelfLearningAgent started")
        while self._running:
            now = datetime.utcnow()
            # Generate report on Sunday at 08:00 UTC
            if now.weekday() == 6 and now.hour == 8 and now.minute < 2:
                await self.generate_weekly_report()
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False
