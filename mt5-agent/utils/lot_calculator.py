"""
Lot size calculator — computes exact lot size based on account balance,
risk %, SL distance, and symbol contract specs.
"""
import logging
logger = logging.getLogger("lot_calculator")

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False

# Fallback pip values per lot (when MT5 not available)
FALLBACK_PIP_VALUE = {
    "EURUSD": 10.0, "GBPUSD": 10.0, "USDJPY": 9.1,
    "AUDUSD": 10.0, "USDCAD": 7.6, "USDCHF": 11.0,
    "XAUUSD": 10.0, "XAGUSD": 50.0, "USOIL": 10.0,
    "NASDAQ100": 1.0, "SP500": 0.5, "US30": 0.1,
    "GER40": 0.25, "UK100": 0.5,
    "BTCUSD": 1.0, "ETHUSD": 1.0,
}


def calculate_lot_size(symbol: str, entry: float, sl: float,
                       account_balance: float, risk_pct: float = 0.005) -> float:
    """
    Returns lot size rounded to broker's minimum step.
    
    Args:
        symbol: trading symbol
        entry: entry price
        sl: stop loss price
        account_balance: current account balance
        risk_pct: fraction of balance to risk (default 0.5%)
    """
    risk_amount = account_balance * risk_pct
    sl_distance = abs(entry - sl)

    if sl_distance == 0:
        logger.error("SL distance is 0 — cannot calculate lot size")
        return 0.01

    if MT5_AVAILABLE and mt5:
        try:
            info = mt5.symbol_info(symbol)
            if info:
                # Value of 1 point move for 1 lot
                point = info.point
                tick_size = info.trade_tick_size
                tick_value = info.trade_tick_value
                if tick_size and tick_value:
                    value_per_lot = (sl_distance / tick_size) * tick_value
                    if value_per_lot > 0:
                        raw_lot = risk_amount / value_per_lot
                        step = info.volume_step
                        lot = round(raw_lot / step) * step
                        lot = max(info.volume_min, min(info.volume_max, lot))
                        return round(lot, 2)
        except Exception as e:
            logger.warning(f"MT5 lot calc failed: {e}, using fallback")

    # Fallback calculation
    pip_val = FALLBACK_PIP_VALUE.get(symbol, 10.0)
    sl_pips = sl_distance / 0.0001 if "USD" in symbol and "XAU" not in symbol else sl_distance
    if sl_pips == 0:
        return 0.01
    raw = risk_amount / (sl_pips * pip_val)
    lot = max(0.01, round(raw * 2) / 2)  # round to 0.01
    return lot


def check_margin(symbol: str, lot: float, account_info: dict) -> bool:
    """Returns True if trade passes margin safety check (max 20% of free margin)."""
    from config.settings import MAX_MARGIN_PCT
    free_margin = account_info.get("free_margin", 0)
    if free_margin <= 0:
        return False
    # Rough margin estimate: varies by leverage and instrument
    # Conservative: require at least 5x the estimated margin
    estimated_margin = lot * 1000  # rough estimate
    return estimated_margin <= free_margin * MAX_MARGIN_PCT
