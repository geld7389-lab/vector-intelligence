"""
Dashboard Server — FastAPI backend serving real-time data to the web UI.
Serves the frontend HTML + provides WebSocket live updates.
Access: http://YOUR_PC_IP:8000
"""
import logging
import asyncio
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

logger = logging.getLogger("dashboard")

app = FastAPI(title="VECTOR AI Trading Dashboard", version="5.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── GLOBALS (set by init_dashboard) ─────────────────────────────────────────
_agents: dict = {}
_mt5 = None
_perf_db = "data/performance.db"
_trade_db = "data/trade_history.db"
_orchestrator = None

FRONTEND = Path(__file__).parent / "frontend"

def init_dashboard(agents: dict, mt5_connector, perf_db: str, trade_db: str, orchestrator=None):
    global _agents, _mt5, _perf_db, _trade_db, _orchestrator
    _agents = agents
    _mt5 = mt5_connector
    _perf_db = perf_db
    _trade_db = trade_db
    _orchestrator = orchestrator

# ── WEBSOCKET MANAGER ────────────────────────────────────────────────────────
class WSManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.remove(ws)

ws_manager = WSManager()

# ── HELPERS ──────────────────────────────────────────────────────────────────
def _db_query(db_path: str, query: str, params: tuple = ()) -> list[dict]:
    try:
        con = sqlite3.connect(db_path)
        con.row_factory = sqlite3.Row
        cur = con.execute(query, params)
        rows = [dict(r) for r in cur.fetchall()]
        con.close()
        return rows
    except Exception as e:
        logger.error(f"DB query error: {e}")
        return []

def _get_account() -> dict:
    if _mt5:
        try:
            return _mt5.get_account_info()
        except Exception:
            pass
    return {"balance": 0, "equity": 0, "margin": 0, "free_margin": 0}

def _get_positions() -> list[dict]:
    if _mt5:
        try:
            return _mt5.get_positions()
        except Exception:
            pass
    return []

def _get_agent_status() -> dict:
    status = {}
    for name, agent in _agents.items():
        status[name] = {
            "status": getattr(agent, "_status", "offline"),
            "last_action": getattr(agent, "_last_action", "—"),
        }
    return status

def _get_biases() -> dict:
    ms = _agents.get("market_structure")
    if ms:
        try:
            return ms.get_all_biases()
        except Exception:
            pass
    return {}

def _get_smc_arrays() -> tuple[list, list]:
    smc = _agents.get("smc")
    if smc:
        try:
            fvgs, obs = [], []
            for key, smap in smc.smc_maps.items():
                sym, tf = key.split("_", 1)
                for f in smap.fvgs[:3]:
                    if not f.filled:
                        fvgs.append({"symbol": sym, "timeframe": tf, "type": f.type,
                                     "high": f.high, "low": f.low, "fill_pct": f.fill_pct})
                for o in smap.order_blocks[:3]:
                    if not o.mitigated:
                        obs.append({"symbol": sym, "timeframe": tf, "type": o.type,
                                    "high": o.high, "low": o.low, "strength": o.strength})
            return fvgs[:20], obs[:20]
        except Exception:
            pass
    return [], []

def _calc_analytics() -> dict:
    trades = _db_query(_trade_db, "SELECT * FROM trades WHERE status='closed'")
    if not trades:
        return {"win_rate": 0, "wins": 0, "losses": 0, "avg_rr": 0,
                "profit_factor": 0, "max_drawdown": 0,
                "by_asset": {}, "by_session": {}, "by_day": {}, "by_setup": {}}

    wins = [t for t in trades if t.get("result") == "win"]
    losses = [t for t in trades if t.get("result") == "loss"]
    win_rate = len(wins) / len(trades) * 100 if trades else 0

    gross_profit = sum(t.get("pnl", 0) for t in wins)
    gross_loss = abs(sum(t.get("pnl", 0) for t in losses)) or 1
    pf = gross_profit / gross_loss

    rrs = [t.get("rr_achieved", 0) for t in trades if t.get("rr_achieved")]
    avg_rr = sum(rrs) / len(rrs) if rrs else 0

    # By asset
    by_asset = {}
    for sym in set(t.get("symbol", "") for t in trades):
        sub = [t for t in trades if t.get("symbol") == sym]
        w = sum(1 for t in sub if t.get("result") == "win")
        by_asset[sym] = w / len(sub) * 100 if sub else 0

    # By session
    by_session = {}
    for t in trades:
        sess = t.get("session", "unknown")
        by_session.setdefault(sess, {"w": 0, "t": 0})
        by_session[sess]["t"] += 1
        if t.get("result") == "win":
            by_session[sess]["w"] += 1
    by_session = {k: v["w"] / v["t"] * 100 for k, v in by_session.items() if v["t"]}

    # By day
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    by_day = {}
    for t in trades:
        try:
            d = datetime.fromisoformat(t.get("open_time", "")).strftime("%a")
            by_day.setdefault(d, {"w": 0, "t": 0})
            by_day[d]["t"] += 1
            if t.get("result") == "win":
                by_day[d]["w"] += 1
        except Exception:
            pass
    by_day = {k: v["w"] / v["t"] * 100 for k, v in by_day.items() if v["t"]}

    # By setup
    by_setup = {}
    for t in trades:
        st = t.get("setup_type", "unknown")
        by_setup.setdefault(st, {"w": 0, "t": 0})
        by_setup[st]["t"] += 1
        if t.get("result") == "win":
            by_setup[st]["w"] += 1
    by_setup = {k: v["w"] / v["t"] * 100 for k, v in by_setup.items() if v["t"]}

    # Equity curve
    balances = [t.get("balance_after", 10000) for t in trades if t.get("balance_after")]

    # Max drawdown
    peak, mdd = (balances[0] if balances else 10000), 0
    for b in balances:
        if b > peak:
            peak = b
        dd = (peak - b) / peak * 100 if peak > 0 else 0
        if dd > mdd:
            mdd = dd

    return {
        "win_rate": win_rate, "wins": len(wins), "losses": len(losses),
        "avg_rr": avg_rr, "profit_factor": pf, "max_drawdown": mdd,
        "by_asset": by_asset, "by_session": by_session,
        "by_day": by_day, "by_setup": by_setup,
        "equity_curve": balances,
    }

def _get_learning_data() -> dict:
    sl = _agents.get("self_learning")
    if sl:
        try:
            return {
                "asset_win_rates": getattr(sl, "asset_win_rates", {}),
                "setup_win_rates": getattr(sl, "setup_win_rates", {}),
                "paused_assets": list(getattr(sl, "paused_assets", set())),
            }
        except Exception:
            pass
    return {"asset_win_rates": {}, "setup_win_rates": {}, "paused_assets": []}

def _get_weekly_report() -> str:
    reports = sorted(Path("reports").glob("weekly_*.txt"), reverse=True) if Path("reports").exists() else []
    if reports:
        try:
            return reports[0].read_text()
        except Exception:
            pass
    return ""

def _build_snapshot() -> dict:
    account = _get_account()
    positions = _get_positions()
    fvgs, obs = _get_smc_arrays()
    analytics = _calc_analytics()

    closed_trades = _db_query(
        _trade_db,
        "SELECT * FROM trades WHERE status='closed' ORDER BY close_time DESC LIMIT 30"
    )

    macro = _agents.get("macro")
    news = []
    if macro:
        try:
            news = getattr(macro, "news_cache", [])[:15]
        except Exception:
            pass

    daily_pnl = sum(p.get("profit", 0) for p in positions)
    portfolio_heat = sum(p.get("risk_pct", 0) for p in positions)

    return {
        "account": account,
        "daily_pnl": daily_pnl,
        "portfolio_heat": portfolio_heat,
        "positions": positions,
        "closed_trades": closed_trades,
        "agents": _get_agent_status(),
        "biases": _get_biases(),
        "news": news,
        "fvgs": fvgs,
        "order_blocks": obs,
        "analytics": analytics,
        "learning": _get_learning_data(),
        "equity_curve": analytics.get("equity_curve", []),
        "weekly_report": _get_weekly_report(),
        "ts": datetime.utcnow().isoformat(),
    }

# ── ROUTES ───────────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def root():
    html_file = FRONTEND / "index.html"
    if html_file.exists():
        return HTMLResponse(html_file.read_text())
    return HTMLResponse("<h1>VECTOR Dashboard starting...</h1>")

@app.get("/api/snapshot")
async def snapshot():
    return _build_snapshot()

@app.get("/api/health")
async def health():
    return {"status": "ok", "ts": datetime.utcnow().isoformat(), "agents": len(_agents)}

@app.post("/api/close-all")
async def close_all():
    if not _mt5:
        raise HTTPException(503, "MT5 not connected")
    try:
        positions = _get_positions()
        closed = 0
        for p in positions:
            _mt5.close_position(p["ticket"])
            closed += 1
        logger.warning(f"Emergency: closed {closed} positions")
        return {"message": f"Closed {closed} positions", "count": closed}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/close-trade")
async def close_trade(body: dict):
    if not _mt5:
        raise HTTPException(503, "MT5 not connected")
    ticket = body.get("ticket")
    if not ticket:
        raise HTTPException(400, "ticket required")
    try:
        _mt5.close_position(ticket)
        return {"message": f"Position {ticket} closed"}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/api/trade/{ticket}")
async def trade_detail(ticket: str):
    rows = _db_query(_trade_db, "SELECT * FROM trades WHERE ticket=?", (ticket,))
    if not rows:
        raise HTTPException(404, "Trade not found")
    return rows[0]

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    logger.info(f"WS client connected — total: {len(ws_manager.active)}")
    try:
        while True:
            await asyncio.sleep(2)
            try:
                snapshot = _build_snapshot()
                await ws_manager.broadcast(snapshot)
            except Exception as e:
                logger.error(f"WS broadcast error: {e}")
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
        logger.info(f"WS client disconnected — total: {len(ws_manager.active)}")

# ── STANDALONE RUNNER ────────────────────────────────────────────────────────
def run_dashboard(host: str = "0.0.0.0", port: int = 8000):
    uvicorn.run(app, host=host, port=port, log_level="warning")

if __name__ == "__main__":
    run_dashboard()
