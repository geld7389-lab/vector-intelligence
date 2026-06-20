"""
MT5 Connector — wraps MetaTrader5 Python library with retry logic,
reconnection handling, and helper methods for all agents.
"""
import logging
import time
from typing import Optional
import pandas as pd

logger = logging.getLogger("mt5_connector")

# MetaTrader5 is Windows-only; handle import gracefully for dev
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None  # type: ignore
    MT5_AVAILABLE = False
    logger.warning("MetaTrader5 not installed — running in MOCK mode")


class MT5Connector:
    """Thread-safe MT5 connection manager with auto-reconnect."""

    def __init__(self, login: int, password: str, server: str):
        self.login = login
        self.password = password
        self.server = server
        self._connected = False

    # ── CONNECTION ──────────────────────────────────────────────────────────

    def connect(self) -> bool:
        if not MT5_AVAILABLE:
            logger.info("Mock mode: MT5 connection simulated")
            self._connected = True
            return True
        for attempt in range(3):
            if mt5.initialize(login=self.login, password=self.password, server=self.server):
                info = mt5.account_info()
                if info:
                    logger.info(f"MT5 connected — account={info.login} balance={info.balance:.2f} server={info.server}")
                    self._connected = True
                    return True
            logger.warning(f"MT5 connect attempt {attempt+1}/3 failed: {mt5.last_error()}")
            time.sleep(3)
        return False

    def disconnect(self):
        if MT5_AVAILABLE and mt5:
            mt5.shutdown()
        self._connected = False
        logger.info("MT5 disconnected")

    def reconnect(self) -> bool:
        logger.info("Attempting MT5 reconnect…")
        self.disconnect()
        time.sleep(5)
        return self.connect()

    def ensure_connected(self) -> bool:
        if not self._connected:
            return self.connect()
        if MT5_AVAILABLE and mt5:
            info = mt5.account_info()
            if info is None:
                return self.reconnect()
        return True

    # ── ACCOUNT ─────────────────────────────────────────────────────────────

    def get_account_info(self) -> dict:
        if not MT5_AVAILABLE:
            return {"balance": 10000, "equity": 10000, "margin": 0, "free_margin": 10000, "margin_level": 0, "profit": 0}
        self.ensure_connected()
        info = mt5.account_info()
        if not info:
            return {}
        return {
            "balance": info.balance,
            "equity": info.equity,
            "margin": info.margin,
            "free_margin": info.margin_free,
            "margin_level": info.margin_level,
            "profit": info.profit,
            "leverage": info.leverage,
            "currency": info.currency,
        }

    # ── PRICES ──────────────────────────────────────────────────────────────

    def get_tick(self, symbol: str) -> Optional[dict]:
        if not MT5_AVAILABLE:
            return {"bid": 19000.0, "ask": 19001.0, "spread": 1.0}
        self.ensure_connected()
        tick = mt5.symbol_info_tick(symbol)
        if not tick:
            return None
        info = mt5.symbol_info(symbol)
        avg_spread = (info.spread if info else 0)
        return {
            "bid": tick.bid,
            "ask": tick.ask,
            "spread": round(tick.ask - tick.bid, 5),
            "avg_spread": avg_spread,
        }

    def get_candles(self, symbol: str, timeframe: str, count: int = 500) -> pd.DataFrame:
        if not MT5_AVAILABLE:
            return pd.DataFrame()
        self.ensure_connected()
        tf_map = {
            "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5,
            "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
            "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
            "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1,
        }
        tf = tf_map.get(timeframe)
        if tf is None:
            logger.error(f"Unknown timeframe: {timeframe}")
            return pd.DataFrame()
        rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
        if rates is None or len(rates) == 0:
            return pd.DataFrame()
        df = pd.DataFrame(rates)
        df["time"] = pd.to_datetime(df["time"], unit="s")
        return df.rename(columns={"open": "o", "high": "h", "low": "l", "close": "c", "tick_volume": "v"})

    # ── ORDERS ──────────────────────────────────────────────────────────────

    def place_market_order(self, symbol: str, direction: str, lot: float,
                           sl: float, tp: float, comment: str = "VECTOR_AI") -> Optional[dict]:
        if not MT5_AVAILABLE:
            fake_ticket = int(time.time())
            logger.info(f"MOCK order: {direction} {lot} lots {symbol} SL={sl} TP={tp} ticket={fake_ticket}")
            return {"ticket": fake_ticket, "price": sl + (tp - sl) * 0.5}

        self.ensure_connected()
        tick = mt5.symbol_info_tick(symbol)
        if not tick:
            logger.error(f"No tick for {symbol}")
            return None

        order_type = mt5.ORDER_TYPE_BUY if direction == "buy" else mt5.ORDER_TYPE_SELL
        price = tick.ask if direction == "buy" else tick.bid
        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            logger.error(f"Symbol {symbol} not found")
            return None

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": lot,
            "type": order_type,
            "price": price,
            "sl": sl,
            "tp": tp,
            "deviation": 20,
            "magic": 202401,
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        for attempt in range(3):
            result = mt5.order_send(request)
            if result and result.retcode == mt5.TRADE_RETCODE_DONE:
                logger.info(f"Order placed: {direction} {lot} {symbol} ticket={result.order}")
                return {"ticket": result.order, "price": result.price}
            err = mt5.last_error()
            logger.warning(f"Order attempt {attempt+1}/3 failed: {result.retcode if result else err}")
            time.sleep(1)
        return None

    def close_position(self, ticket: int) -> bool:
        if not MT5_AVAILABLE:
            logger.info(f"MOCK close: ticket={ticket}")
            return True
        self.ensure_connected()
        positions = mt5.positions_get(ticket=ticket)
        if not positions:
            return False
        pos = positions[0]
        direction = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
        tick = mt5.symbol_info_tick(pos.symbol)
        if not tick:
            return False
        price = tick.bid if direction == mt5.ORDER_TYPE_SELL else tick.ask
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": direction,
            "position": ticket,
            "price": price,
            "deviation": 20,
            "magic": 202401,
            "comment": "VECTOR_CLOSE",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        result = mt5.order_send(request)
        return result and result.retcode == mt5.TRADE_RETCODE_DONE

    def modify_sl_tp(self, ticket: int, sl: float, tp: float) -> bool:
        if not MT5_AVAILABLE:
            return True
        self.ensure_connected()
        request = {
            "action": mt5.TRADE_ACTION_SLTP,
            "position": ticket,
            "sl": sl,
            "tp": tp,
        }
        result = mt5.order_send(request)
        return result and result.retcode == mt5.TRADE_RETCODE_DONE

    def get_open_positions(self) -> list:
        if not MT5_AVAILABLE:
            return []
        self.ensure_connected()
        positions = mt5.positions_get()
        if not positions:
            return []
        return [
            {
                "ticket": p.ticket, "symbol": p.symbol,
                "direction": "buy" if p.type == 0 else "sell",
                "volume": p.volume, "open_price": p.price_open,
                "sl": p.sl, "tp": p.tp, "profit": p.profit,
                "magic": p.magic, "comment": p.comment,
            }
            for p in positions if p.magic == 202401
        ]
