import { NextResponse } from 'next/server';
import { sb } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MT5_BASE = 'https://mt5.mtapi.io';

// Yahoo Finance symbols for price lookups
const YAHOO_MAP: Record<string, string> = {
  NQ: 'NQ=F', ES: 'ES=F', GC: 'GC=F', CL: 'CL=F',
  BTC: 'BTC-USD', ETH: 'ETH-USD',
  EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X',
};

const MT5_SYMBOL_MAP: Record<string, string> = {
  NQ: 'US100.', ES: 'US500.', GC: 'XAUUSD.', CL: 'USOIL.c',
  BTC: 'BTCUSD.', ETH: 'ETHUSD.',
  EURUSD: 'EURUSD.', GBPUSD: 'GBPUSD.', USDJPY: 'USDJPY.',
};

async function getPrice(symbol: string): Promise<number | null> {
  try {
    const yahooSym = YAHOO_MAP[symbol];
    if (!yahooSym) return null;
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1m&range=1d`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d = await r.json();
    const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price ? Number(price) : null;
  } catch {
    return null;
  }
}

async function closePosition(token: string, ticket: string): Promise<any> {
  try {
    const r = await fetch(`${MT5_BASE}/OrderClose?id=${token}&ticket=${ticket}`, {
      headers: { accept: 'text/json' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } catch (e: any) {
    return { error: e.message };
  }
}

// Heartbeat helper — MUST be called on every single exit path (early returns,
// success, and the top-level catch). The whole reason this bug went undetected
// for ~18 hours is that early returns and thrown exceptions skipped writing to
// agent_status entirely, so a dead monitor looked identical to "nothing to do."
async function heartbeat(status: string, last_action: string, data: any = null) {
  try {
    await sb.from('agent_status').upsert({
      agent: 'position_monitor',
      status,
      last_action,
      data: data ? JSON.stringify(data) : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent' });
  } catch {
    // Never let a heartbeat failure mask the real result being returned.
  }
}

export async function GET() {
  return POST();
}

export async function POST() {
  try {
    // Get MT5 session/credentials from Supabase
    const { data: mt5Session } = await sb.from('agent_status').select('data').eq('agent', 'mt5_session').single();
    const rawData = mt5Session?.data;
    const sessionData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    if (!sessionData?.token && !sessionData?.login) {
      await heartbeat('error', '⚠ Skipped: no MT5 token/login in agent_status', { checked: 0, last_run: new Date().toISOString() });
      return NextResponse.json({ ok: true, skipped: 'no MT5 token', checked: 0 });
    }

    // Always reconnect fresh before checking positions — a stale/expired token doesn't
    // throw an error from mtapi.io, it silently returns an object instead of an array,
    // which was previously misread as "zero live positions" and caused REAL open trades
    // to be incorrectly marked closed_external. Reconnecting fresh (same pattern as the
    // executor) avoids trusting a cached token that might already be dead.
    let token = sessionData?.token;
    if (sessionData?.login && sessionData?.password && sessionData?.server) {
      try {
        const reconnectUrl = `${MT5_BASE}/ConnectEx?user=${sessionData.login}&password=${encodeURIComponent(sessionData.password)}&server=${encodeURIComponent(sessionData.server)}&connectTimeoutSeconds=20&connectTimeoutClusterMemberSeconds=10&errorReplyStatusCode=201`;
        const rr = await fetch(reconnectUrl, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(25000) });
        const newToken = (await rr.text()).replace(/"/g, '').trim();
        if (newToken && newToken.length > 10 && !newToken.includes('error') && !newToken.includes('message')) {
          token = newToken;
          await sb.from('agent_status').upsert({
            agent: 'mt5_session',
            status: 'connected',
            last_action: `Auto-reconnected to ${sessionData.server} (monitor)`,
            data: JSON.stringify({ ...sessionData, token: newToken, connected_at: new Date().toISOString() }),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'agent' });
        }
      } catch {}
    }
    if (!token) {
      await heartbeat('error', '⚠ Skipped: reconnect attempt failed, no usable MT5 token', { checked: 0, last_run: new Date().toISOString() });
      return NextResponse.json({ ok: true, skipped: 'no MT5 token after reconnect attempt', checked: 0 });
    }

    // Get all open trades from Supabase that were agent-executed (have stop_loss or take_profit set)
    const { data: openTrades } = await sb
      .from('trades')
      .select('*')
      .eq('result', 'open')
      .not('stop_loss', 'is', null)
      .not('take_profit', 'is', null);

    if (!openTrades?.length) {
      await heartbeat('running', 'No open trades to monitor', { checked: 0, closed: [], last_run: new Date().toISOString() });
      return NextResponse.json({ ok: true, checked: 0, closed: [] });
    }

    // ── Structure-based protective exit ─────────────────────────────────
    // market_structure only updates when a full orchestrator cycle runs
    // (there's no cron for the full cycle yet, only this monitor). So bias
    // data can genuinely be hours old. STRUCTURE_STALE_MS is deliberately
    // generous but finite — beyond this, we explicitly skip the structure
    // check rather than silently act on data that may no longer reflect
    // reality. This mirrors the exact lesson from today's price-source bug:
    // never trust a secondary feed without checking its freshness first.
    const STRUCTURE_STALE_MS = 90 * 60 * 1000; // 90 minutes
    let structureBiases: Record<string, string> = {};
    let structureFresh = false;
    let structureAgeMin = 0;
    {
      const { data: msRow } = await sb.from('agent_status').select('data, updated_at').eq('agent', 'market_structure').single();
      if (msRow?.updated_at) {
        const ageMs = Date.now() - new Date(msRow.updated_at).getTime();
        structureAgeMin = Math.round(ageMs / 60000);
        structureFresh = ageMs < STRUCTURE_STALE_MS;
        if (structureFresh) {
          try {
            const parsed = typeof msRow.data === 'string' ? JSON.parse(msRow.data) : msRow.data;
            structureBiases = parsed?.biases ?? {};
          } catch { structureBiases = {}; }
        }
      }
    }

    // Cross-check against REAL live MT5 positions. If a trade was closed manually
    // on MT5 directly (outside this app), its Supabase row never gets updated and
    // the monitor would otherwise "watch" a phantom position forever, since price
    // may never naturally cross that trade's old SL/TP again.
    // IMPORTANT: livePositionTickets is `null` unless we get a CONFIRMED valid array
    // back from the broker. An error object, empty response, or fetch failure must
    // all skip the orphan-check rather than being treated as "zero live positions" —
    // that distinction is exactly what caused real open trades to be wrongly closed.
    let livePositionTickets: Set<string> | null = null;
    const brokerPriceByTicket = new Map<string, number>();
    const brokerProfitByTicket = new Map<string, number>();
    const brokerLotsByTicket = new Map<string, number>();
    try {
      const posRes = await fetch(`${MT5_BASE}/OpenedOrders?id=${token}`, {
        headers: { accept: 'text/json' },
        signal: AbortSignal.timeout(10000),
      });
      const posText = await posRes.text();
      const positions = JSON.parse(posText);
      if (Array.isArray(positions)) {
        livePositionTickets = new Set(
          positions.map((p: any) => String(p.ticket ?? p.Ticket ?? p.orderTicket ?? ''))
        );
        // mtapi.io's OpenedOrders response includes `closePrice` on still-open
        // positions — despite the name, this IS the current live broker price
        // (verified: profit = (closePrice - openPrice) * lots * contractSize
        // matches exactly). This is the REAL price the broker will actually
        // fill against, not an approximation from a different market (Yahoo
        // futures vs. broker spot/CFD can genuinely diverge by real dollars,
        // which previously caused false TP/SL triggers on brand-new trades).
        for (const p of positions) {
          const t = String(p.ticket ?? p.Ticket ?? p.orderTicket ?? '');
          const cp = Number(p.closePrice);
          if (t && Number.isFinite(cp) && cp > 0) brokerPriceByTicket.set(t, cp);
          // profit is the broker's own real P&L math for this position (nets
          // swap/commission) — used as a fallback if OrderClose doesn't return
          // its own final profit figure. This was never captured before, which
          // is why pnl was NULL on every single closed trade — self-learning
          // had no numeric outcome data to compute profit factor / avg R from,
          // only win/loss labels.
          const profit = Number(p.profit);
          if (t && Number.isFinite(profit)) brokerProfitByTicket.set(t, profit);
          const lots = Number(p.lots ?? p.volume);
          if (t && Number.isFinite(lots) && lots > 0) brokerLotsByTicket.set(t, lots);
        }
      }
      // else: got valid JSON but not an array (e.g. an error object like
      // {"message":"...","code":"INVALID_TOKEN"}) — leave livePositionTickets as null
    } catch {
      // Fetch/parse genuinely failed — also leave as null
    }

    const orphaned: any[] = [];
    const stillOpenTrades: any[] = [];
    const errors: any[] = [];
    if (livePositionTickets) {
      for (const trade of openTrades) {
        const ticketMatch = trade.notes?.match(/Ticket:\s*(\d+)/);
        const ticket = ticketMatch?.[1];
        if (ticket && !livePositionTickets.has(ticket)) {
          // Position no longer exists on the broker — mark closed so we stop watching it
          const upd = await sb.from('trades').update({
            result: 'closed_external',
            closed_at: new Date().toISOString(),
            notes: (trade.notes ?? '') + ` | Closed outside app (not found in live MT5 positions) @ ${new Date().toISOString()}`,
          }).eq('id', trade.id);
          if (upd.error) {
            errors.push({ id: trade.id, symbol: trade.symbol, action: 'orphan_close', error: upd.error.message });
            stillOpenTrades.push(trade); // couldn't close it — don't lose track of it
          } else {
            orphaned.push({ symbol: trade.symbol, ticket });
          }
        } else {
          stillOpenTrades.push(trade);
        }
      }
    } else {
      stillOpenTrades.push(...openTrades);
    }

    if (!stillOpenTrades.length) {
      await sb.from('agent_status').upsert({
        agent: 'position_monitor',
        status: 'running',
        last_action: orphaned.length
          ? `Removed ${orphaned.length} stale position(s) closed outside the app: ${orphaned.map(o => o.symbol).join(', ')}`
          : 'No open positions to monitor',
        data: JSON.stringify({ checked: 0, closed: [], watching: [], orphaned, last_run: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent' });
      return NextResponse.json({ ok: true, checked: 0, closed: [], orphaned });
    }

    const closed: any[] = [];
    const watching: any[] = [];

    for (const trade of stillOpenTrades) {
      // Extract MT5 ticket from notes field: "... | Ticket: 59201089 | ..."
      const ticketMatch = trade.notes?.match(/Ticket:\s*(\d+)/);
      if (!ticketMatch) continue;
      const ticket = ticketMatch[1];

      const brokerPrice = brokerPriceByTicket.get(ticket);
      const currentPrice = brokerPrice ?? await getPrice(trade.symbol);
      if (!currentPrice) continue;
      const priceSource = brokerPrice ? 'broker' : 'yahoo_fallback';

      const sl = Number(trade.stop_loss);
      const tp = Number(trade.take_profit);
      const isLong = trade.direction === 'long';

      const slHit = isLong ? currentPrice <= sl : currentPrice >= sl;
      const tpHit = isLong ? currentPrice >= tp : currentPrice <= tp;

      // Structure-based protective exit — see comment above where
      // structureBiases/structureFresh are loaded. Deliberately asymmetric:
      // this can only ever trigger an EARLY exit on a trade that's already
      // meaningfully in profit (locking in a win before a structure flip
      // erases it). It never overrides the hard SL on a losing trade — a
      // lagging secondary signal is not grounds to widen or override the
      // risk level that was actually sized and agreed to at entry. If the
      // trade is underwater when structure flips, we only flag it (visible
      // in the API/UI) and let the real SL stay the actual safety net.
      const bias = structureBiases[trade.symbol];
      const structureAgainstTrade = structureFresh && bias
        && ((isLong && bias === 'bearish') || (!isLong && bias === 'bullish'));
      const riskDistance = Math.abs(Number(trade.entry_price) - sl) || 0;
      const favorableMove = isLong ? (currentPrice - Number(trade.entry_price)) : (Number(trade.entry_price) - currentPrice);
      // Require the trade to already be at least 30% of the way to a 1:1 R
      // gain before structure alone can close it — a single tick of noise
      // past entry shouldn't trigger this, only a real, meaningful profit.
      const meaningfullyInProfit = riskDistance > 0 && favorableMove > riskDistance * 0.3;
      const structureLockProfit = structureAgainstTrade && meaningfullyInProfit && !slHit && !tpHit;
      const structureWarningOnly = structureAgainstTrade && !meaningfullyInProfit && !slHit && !tpHit;

      // ── Trail the target instead of always cashing out at the first TP ──
      // Real example that exposed this gap: a CL trade closed exactly at its
      // fixed TP (74.97) while the broker's own close price was already
      // 75.118 — price had kept running past the target before the close even
      // processed, and the static-TP model just walks away with the smaller
      // number every time, regardless of whether momentum/structure still
      // supports the move.
      //
      // Only trails when structure is FRESH and STILL AGREES with the trade
      // direction (never trails on stale or flipped structure — that's
      // exactly the "don't act on a signal you can't currently trust" rule
      // from the protective-exit logic above). Capped at MAX_TRAILS extensions
      // so this can't run away indefinitely — after that, TP_HIT closes
      // normally like today. Each trail locks in real, meaningful profit by
      // dragging the stop up, never just moves the target with no protection.
      const MAX_TRAILS = 2;
      const trailMatch = trade.notes?.match(/TRAIL:(\d+)/);
      const trailCount = trailMatch ? Number(trailMatch[1]) : 0;
      const structureStillAgrees = structureFresh && bias
        && ((isLong && bias === 'bullish') || (!isLong && bias === 'bearish'));
      const shouldTrail = tpHit && !slHit && structureStillAgrees && trailCount < MAX_TRAILS && riskDistance > 0;

      if (shouldTrail) {
        const newTp = isLong ? tp + riskDistance : tp - riskDistance;
        // Lock in half of the leg just achieved rather than only breakeven —
        // a real ratchet, not just "don't lose money."
        const newSl = isLong ? tp - riskDistance * 0.5 : tp + riskDistance * 0.5;
        const newNotes = (trade.notes ?? '').replace(/\| TRAIL:\d+.*$/, '')
          + ` | TRAIL:${trailCount + 1} — TP ${tp}→${newTp}, SL ${sl}→${newSl} (structure still ${bias}, locking prior leg) @ ${new Date().toISOString()}`;
        const upd = await sb.from('trades').update({
          stop_loss: newSl,
          take_profit: newTp,
          notes: newNotes,
        }).eq('id', trade.id);
        if (upd.error) {
          errors.push({ id: trade.id, symbol: trade.symbol, action: 'trail_extend', error: upd.error.message });
        }
        watching.push({
          id: trade.id, symbol: trade.symbol, ticket,
          direction: trade.direction, entry: Number(trade.entry_price),
          sl: upd.error ? sl : newSl, tp: upd.error ? tp : newTp,
          currentPrice,
          volume: brokerLotsByTicket.get(ticket) ?? null,
          trailed: !upd.error, trailCount: trailCount + 1,
        });
        continue;
      }

      if (slHit || tpHit || structureLockProfit) {
        const reason = slHit ? 'SL_HIT' : tpHit ? 'TP_HIT' : 'STRUCTURE_INVALIDATED';
        const closeResult = await closePosition(token, ticket);
        // Only treat this as a real close if the broker actually confirms it — an error
        // object, missing ticket, or message field means OrderClose likely failed, and
        // we must NOT mark the trade closed in our DB while it's still live on the broker.
        const brokerConfirmedClose = closeResult
          && !closeResult.error
          && !closeResult.message
          && (closeResult.ticket !== undefined || closeResult.closePrice !== undefined || closeResult.closeVolume !== undefined);

        if (!brokerConfirmedClose) {
          errors.push({ id: trade.id, symbol: trade.symbol, action: 'close_attempt_failed', error: JSON.stringify(closeResult) });
          watching.push({
            id: trade.id, symbol: trade.symbol, ticket,
            direction: trade.direction, entry: Number(trade.entry_price),
            sl, tp, currentPrice,
          });
          continue;
        }

        const closePrice = closeResult?.closePrice || currentPrice;
        const priceDelta = isLong
          ? (closePrice - Number(trade.entry_price))
          : (Number(trade.entry_price) - closePrice);

        // Real dollar P&L: prefer whatever OrderClose itself reports (most
        // authoritative — the actual realized fill), then the last-known
        // floating profit captured from OpenedOrders moments earlier, and only
        // fall back to a raw point-delta (no lot size / contract size known
        // here, so this is directional-sign-correct but not true dollars) if
        // the broker genuinely gave us nothing. Previously this was never set
        // at all — every closed trade had pnl: null forever.
        const brokerProfit = Number(closeResult?.profit);
        const pnl = Number.isFinite(brokerProfit) ? brokerProfit
          : brokerProfitByTicket.has(ticket) ? brokerProfitByTicket.get(ticket)!
          : priceDelta;

        const riskPoints = Math.abs(Number(trade.entry_price) - sl) || null;
        const rrAchieved = riskPoints ? Math.round((priceDelta / riskPoints) * 100) / 100 : null;

        // Update trade record in Supabase
        const upd = await sb.from('trades').update({
          result: slHit ? 'loss' : 'win',
          exit_price: closePrice,
          pnl,
          closed_at: new Date().toISOString(),
          rr_achieved: rrAchieved,
          notes: (trade.notes ?? '') + ` | ${reason} @ ${closePrice} (decided via ${priceSource} price ${currentPrice}) | Auto-closed by monitor`,
        }).eq('id', trade.id);
        if (upd.error) errors.push({ id: trade.id, symbol: trade.symbol, action: 'tp_sl_close', error: upd.error.message });

        closed.push({
          symbol: trade.symbol,
          ticket,
          reason,
          entry: trade.entry_price,
          exit: closePrice,
          sl, tp,
          currentPrice,
          priceSource,
          pnl,
        });
      } else {
        const riskMatch = trade.notes?.match(/Risk:\s*([\d.]+)%/);
        watching.push({
          id: trade.id,
          symbol: trade.symbol,
          ticket,
          direction: trade.direction,
          entry: Number(trade.entry_price),
          sl, tp,
          currentPrice,
          volume: brokerLotsByTicket.get(ticket) ?? null,
          risk_percent: riskMatch ? Number(riskMatch[1]) / 100 : null,
          structureWarning: structureWarningOnly ? { bias, ageMin: structureAgeMin } : null,
        });
      }
    }

    // Save monitor status
    await sb.from('agent_status').upsert({
      agent: 'position_monitor',
      status: 'running',
      last_action: (() => {
        const parts = [];
        if (orphaned.length) parts.push(`Removed ${orphaned.length} closed-outside-app: ${orphaned.map(o=>o.symbol).join(', ')}`);
        if (closed.length) parts.push(`Closed ${closed.length}: ${closed.map(c => `${c.symbol} (${c.reason})`).join(', ')}`);
        if (!parts.length) parts.push(watching.length ? `Watching ${watching.length} open position(s) — no stops hit` : 'No open positions to monitor');
        return parts.join(' | ');
      })(),
      data: JSON.stringify({
        checked: stillOpenTrades.length, closed, watching, orphaned,
        structure: { fresh: structureFresh, ageMin: structureAgeMin },
        last_run: new Date().toISOString(),
      }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent' });

    return NextResponse.json({
      ok: true, checked: stillOpenTrades.length, closed, watching, orphaned, errors,
      structure: { fresh: structureFresh, ageMin: structureAgeMin },
    });
  } catch (e: any) {
    await heartbeat('error', `⚠ Monitor crashed: ${e.message}`, { checked: 0, last_run: new Date().toISOString() });
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

