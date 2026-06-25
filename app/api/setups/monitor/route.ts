import { NextRequest, NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';
export const dynamic = 'force-dynamic';

// Fetch current price from Yahoo Finance
async function fetchPrice(symbol: string): Promise<number | null> {
  const YAHOO_MAP: Record<string, string> = {
    NQ: 'NQ=F', ES: 'ES=F', GC: 'GC=F', CL: 'CL=F', SI: 'SI=F',
    BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', XRP: 'XRP-USD',
    EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X',
    AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X',
    GBPJPY: 'GBPJPY=X', EURJPY: 'EURJPY=X', EURGBP: 'EURGBP=X',
    XAUUSD: 'GC=F', XAGUSD: 'SI=F', USOIL: 'CL=F',
    SPY: 'SPY', QQQ: 'QQQ', NVDA: 'NVDA', AAPL: 'AAPL', MSFT: 'MSFT',
    US30: 'YM=F', SPX500: 'ES=F', DXY: 'DX-Y.NYB',
  };
  const ySym = YAHOO_MAP[symbol] ?? `${symbol}=X`;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1m&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const last = closes.filter(Boolean).at(-1);
    return last ?? null;
  } catch { return null; }
}

// Determine setup invalidation reason
function getInvalidationReason(
  setup: any,
  price: number
): { status: string; reason: string } | null {
  const isBull = setup.direction === 'bull' || setup.direction === 'long';
  const now = new Date();

  // 1. Time expired
  if (setup.expires_at && new Date(setup.expires_at) < now) {
    return { status: 'expired', reason: `Time expired at ${new Date(setup.expires_at).toUTCString()}` };
  }

  // 2. Stop loss hit — structural invalidation
  if (isBull && price < setup.stop_loss) {
    return {
      status: 'expired',
      reason: `SL hit — price ${price.toFixed(4)} breached stop ${setup.stop_loss} (OB/structure invalidated)`,
    };
  }
  if (!isBull && price > setup.stop_loss) {
    return {
      status: 'expired',
      reason: `SL hit — price ${price.toFixed(4)} breached stop ${setup.stop_loss} (OB/structure invalidated)`,
    };
  }

  // 3. Target / TP hit — filled
  if (isBull && price >= setup.target) {
    return {
      status: 'filled',
      reason: `TP reached — price ${price.toFixed(4)} hit target ${setup.target}`,
    };
  }
  if (!isBull && price <= setup.target) {
    return {
      status: 'filled',
      reason: `TP reached — price ${price.toFixed(4)} hit target ${setup.target}`,
    };
  }

  // 4. Entry triggered (price entered entry zone)
  if (
    setup.status === 'watching' &&
    price >= setup.entry_low &&
    price <= setup.entry_high
  ) {
    return { status: 'triggered', reason: `Entry zone reached — price ${price.toFixed(4)}` };
  }

  return null;
}

export async function POST(_req: NextRequest) {
  try {
    // Fetch all active/watching/triggered setups
    const { data: setups, error: fetchErr } = await sb
      .from('setups')
      .select('*')
      .in('status', ['active', 'watching', 'triggered'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!setups || setups.length === 0) {
      return NextResponse.json({ message: 'No active setups to monitor', updated: 0 });
    }

    // Group by symbol to avoid redundant price fetches
    const symbolPrices: Record<string, number | null> = {};
    const uniqueSymbols = [...new Set(setups.map((s: any) => s.symbol))];
    await Promise.all(
      uniqueSymbols.map(async (sym: string) => {
        symbolPrices[sym] = await fetchPrice(sym);
      })
    );

    const log: string[] = [];
    let updated = 0;
    let filled = 0;
    let expired = 0;
    let triggered = 0;

    for (const setup of setups) {
      const price = symbolPrices[setup.symbol];
      if (price == null) {
        log.push(`${setup.symbol} — no price data`);
        continue;
      }

      const result = getInvalidationReason(setup, price);
      if (!result) {
        log.push(`${setup.symbol} ${setup.direction} — watching @ ${price.toFixed(4)}`);
        continue;
      }

      // Update setup status in DB
      const { error: updateErr } = await sb
        .from('setups')
        .update({
          status: result.status,
          ai_analysis: setup.ai_analysis
            ? `${setup.ai_analysis}\n\n[AUTO] ${result.reason}`
            : `[AUTO] ${result.reason}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', setup.id);

      if (!updateErr) {
        updated++;
        if (result.status === 'filled') filled++;
        else if (result.status === 'expired') expired++;
        else if (result.status === 'triggered') triggered++;
        log.push(`✓ ${setup.symbol} ${setup.direction} → ${result.status}: ${result.reason}`);
      } else {
        log.push(`✗ ${setup.symbol} DB error: ${updateErr.message}`);
      }
    }

    return NextResponse.json({
      message: `Monitored ${setups.length} setups → ${updated} updated (${filled} filled, ${expired} expired, ${triggered} triggered)`,
      updated, filled, expired, triggered,
      checked: setups.length,
      prices: symbolPrices,
      log,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(_req: NextRequest) {
  return POST(_req);
}
