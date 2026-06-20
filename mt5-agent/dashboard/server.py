"""
Dashboard Server — FastAPI backend serving real-time data to the web UI.
Access from any device on local network: http://YOUR_PC_IP:8000
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
from fastapi.responses import HTMLResponse
import uvicorn

logger = logging.getLogger("dashboard")

app = FastAPI(title="VECTOR AI Trading Dashboard", version="5.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_agents: dict = {}
_mt5 = None
_perf_db = "data/performance.db"
_trade_db = "data/trade_history.db"

def init_dashboard(agents: dict, mt5_connector, perf_db: str, trade_db: str):
    global _agents, _mt5, _perf_db, _trade_db
    _agents = agents
    _mt5 = mt5_connector
    _perf_db = perf_db
    _trade_db = trade_db

class WSManager:
    def __init__(self):
        self.active: list = []
    async def connect(self, ws):
        await ws.accept()
        self.active.append(ws)
    def disconnect(self, ws):
        if ws in self.active: self.active.remove(ws)
    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try: await ws.send_json(data)
            except: dead.append(ws)
        for ws in dead: self.active.remove(ws)

ws_manager = WSManager()

@app.get("/api/account")
async def get_account():
    if not _mt5: return {"error": "MT5 not connected"}
    return _mt5.get_account_info()

@app.get("/api/positions")
async def get_positions():
    if not _mt5: return []
    return _mt5.get_open_positions()

@app.get("/api/agents/status")
async def get_agent_status():
    risk = _agents.get("risk")
    learning = _agents.get("learning")
    macro = _agents.get("macro")
    return {
        "orchestrator":  {"status": "running", "name": "Master Orchestrator"},
        "structure":     {"status": "running", "name": "Market Structure"},
        "smc":           {"status": "running", "name": "Smart Money Concepts"},
        "technical":     {"status": "running", "name": "Technical Confluence"},
        "macro":         {"status": "running", "name": "Macro & Sentiment",
                          "blackout": macro.current_blackout if macro else None},
        "ai_brain":      {"status": "running", "name": "AI Brain"},
        "risk":          {"status": "paused" if (risk and risk.trading_paused) else "running",
                          "name": "Risk Manager",
                          "pause_reason": risk.pause_reason if risk else None},
        "executor":      {"status": "running", "name": "Execution"},
        "self_learning": {"status": "running", "name": "Self-Learning",
                          "paused_assets": list(learning.paused_assets) if learning else []},
        "alert":         {"status": "running", "name": "Alert & Notification"},
    }

@app.get("/api/market/biases")
async def get_market_biases():
    structure = _agents.get("structure")
    if not structure: return {}
    return structure.get_all_biases()

@app.get("/api/market/smc/{symbol}/{timeframe}")
async def get_smc(symbol: str, timeframe: str):
    smc_agent = _agents.get("smc")
    if not smc_agent: return {}
    smc = smc_agent.get_smc(symbol, timeframe)
    if not smc: return {}
    return {
        "symbol": smc.symbol, "timeframe": smc.timeframe,
        "fvgs": [{"type": f.type, "high": f.high, "low": f.low, "fill_pct": f.fill_pct} for f in smc.fvgs],
        "order_blocks": [{"type": o.type, "high": o.high, "low": o.low, "strength": o.strength} for o in smc.order_blocks],
        "liquidity": [{"type": l.type, "price": l.price, "swept": l.swept} for l in smc.liquidity_levels],
        "in_discount": smc.in_discount, "in_premium": smc.in_premium,
        "equilibrium": smc.equilibrium, "po3_phase": smc.po3_phase,
        "judas_swing": smc.judas_swing_detected,
    }

@app.get("/api/trades/history")
async def get_trade_history(limit: int = 100, symbol: Optional[str] = None, result: Optional[str] = None):
    try:
        with sqlite3.connect(_perf_db) as conn:
            conn.row_factory = sqlite3.Row
            q = "SELECT * FROM trade_outcomes WHERE 1=1"
            p = []
            if symbol: q += " AND symbol=?"; p.append(symbol)
            if result: q += " AND result=?"; p.append(result)
            q += " ORDER BY closed_at DESC LIMIT ?"; p.append(limit)
            return [dict(r) for r in conn.execute(q, p).fetchall()]
    except: return []

@app.get("/api/analytics/stats")
async def get_analytics(days: int = 30):
    learning = _agents.get("learning")
    if not learning: return {}
    return learning.get_performance_stats(days)

@app.get("/api/analytics/patterns")
async def get_patterns():
    learning = _agents.get("learning")
    if not learning: return {}
    return learning.find_winning_patterns()

@app.get("/api/ai/recent_logs")
async def get_ai_logs(n: int = 20):
    brain = _agents.get("ai_brain")
    if not brain: return []
    return brain.get_recent_logs(n)

@app.get("/api/risk/status")
async def get_risk_status():
    risk = _agents.get("risk")
    if not risk: return {}
    account = _mt5.get_account_info() if _mt5 else {}
    positions = _mt5.get_open_positions() if _mt5 else []
    heat = risk.calc_portfolio_heat(positions, account.get("balance", 1))
    return {**risk.get_status(), "portfolio_heat": round(heat * 100, 2), "open_positions": len(positions)}

@app.post("/api/risk/pause")
async def pause_trading(reason: str = "manual"):
    risk = _agents.get("risk")
    if risk: risk._pause(reason, hours=24)
    return {"ok": True}

@app.post("/api/risk/resume")
async def resume_trading():
    risk = _agents.get("risk")
    if risk:
        risk.trading_paused = False
        risk.pause_reason = None
        risk.pause_until = None
    return {"ok": True}

@app.post("/api/emergency/close_all")
async def emergency_close():
    executor = _agents.get("executor")
    if not executor: return {"error": "Executor not available"}
    closed = await executor.close_all_positions("emergency_dashboard")
    return {"closed": closed}

@app.post("/api/backtest/run")
async def run_backtest(symbol: str, timeframe: str, direction: str = "bull"):
    from backtester.engine import BacktestEngine
    engine = BacktestEngine(_mt5)
    try:
        result = engine.run(symbol, timeframe, direction)
        result.pop("equity_curve", None)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/news")
async def get_news():
    macro = _agents.get("macro")
    if not macro or not macro.news: return []
    return [{"title": e["title"], "country": e["country"], "impact": e["impact"],
             "time": e["datetime_utc"].isoformat(), "is_high": e.get("is_high", False)}
            for e in macro.news.get_upcoming_high_impact(hours=24)]

@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            if _mt5:
                await ws.send_json({
                    "type": "live_update",
                    "account": _mt5.get_account_info(),
                    "positions": _mt5.get_open_positions(),
                    "ts": datetime.utcnow().isoformat(),
                })
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    html_path = Path(__file__).parent / "frontend" / "index.html"
    if html_path.exists():
        return html_path.read_text()
    return HTMLResponse(content="<h1>VECTOR AI Dashboard — frontend/index.html not found</h1>")

def run_server(host: str = "0.0.0.0", port: int = 8000):
    uvicorn.run(app, host=host, port=port, log_level="warning")
