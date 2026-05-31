import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

async function sendTelegramAlert(type: string, message: string) {
  try {
    const { data: cfg } = await sb.from('telegram_config').select('*').eq('active', true).limit(1).single();
    if (!cfg?.bot_token || !cfg?.chat_id) return;
    const shouldSend = (type === 'sl' && cfg.alert_sl) || (type === 'entry' && cfg.alert_entry) || (type === 'tp' && cfg.alert_tp) || (type === 'scan' && cfg.alert_scan);
    if (!shouldSend) return;
    const icons: Record<string, string> = { sl: '🔴', entry: '🟡', tp: '🟢', scan: '📡' };
    const text = `${icons[type] ?? 'ℹ️'} <b>VECTOR Alert</b>\n\n${message}\n\n<i>${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} NY</i>`;
    await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chat_id, text, parse_mode: 'HTML' })
    });
  } catch {}
}

async function getPrice(symbol: string): Promise<number | null> {
  try {
    const map: Record<string,string> = { NQ:'NQ=F', ES:'ES=F', GC:'GC=F', BTC:'BTC-USD', ETH:'ETH-USD', SOL:'SOL-USD' };
    const ySym = map[symbol] ?? `${symbol}=F`;
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ySym}?interval=1m&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    const d = await r.json();
    return d?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch { return null; }
}

export async function GET() {
  try {
    const { data: setups } = await sb.from('setups').select('*').in('status', ['active','watching','triggered']);
    if (!setups?.length) return NextResponse.json({ checked: 0, updated: [] });

    const symbols = [...new Set(setups.map((s: {symbol:string}) => s.symbol))];
    const prices: Record<string, number | null> = {};
    await Promise.all(symbols.map(async (sym: string) => { prices[sym] = await getPrice(sym); }));

    const updates: string[] = [];
    const now = new Date();

    for (const setup of setups) {
      const price = prices[setup.symbol];
      const isBull = setup.direction === 'bull' || setup.direction === 'long';

      if (setup.expires_at && new Date(setup.expires_at) < now) {
        await sb.from('setups').update({ status: 'expired' }).eq('id', setup.id);
        updates.push(`${setup.symbol} expired`);
        continue;
      }
      if (price === null) continue;

      if (isBull ? price < setup.stop_loss : price > setup.stop_loss) {
        await sb.from('setups').update({ status: 'lost', invalidated_reason: `SL ${setup.stop_loss} breached at ${price.toFixed(2)}` }).eq('id', setup.id);
        await sendTelegramAlert('sl', `SL breached on <b>${setup.symbol} ${setup.timeframe}</b> ${setup.setup_type}\nSL: ${setup.stop_loss} | Price: ${price.toFixed(2)}\nR:R was ${setup.rr_ratio}`);
        updates.push(`${setup.symbol} SL hit`);
        continue;
      }
      if (isBull ? price >= setup.target : price <= setup.target) {
        await sb.from('setups').update({ status: 'won' }).eq('id', setup.id);
        await sendTelegramAlert('tp', `🎯 Target hit on <b>${setup.symbol} ${setup.timeframe}</b> ${setup.setup_type}\nTarget: ${setup.target} | Price: ${price.toFixed(2)}\nR:R: ${setup.rr_ratio}`);
        updates.push(`${setup.symbol} TP hit`);
        continue;
      }
      if (price >= setup.entry_low && price <= setup.entry_high && setup.status === 'watching') {
        await sb.from('setups').update({ status: 'triggered' }).eq('id', setup.id);
        await sendTelegramAlert('entry', `Price in entry zone — <b>${setup.symbol} ${setup.timeframe}</b>\n${setup.setup_type} | ${setup.direction.toUpperCase()}\nEntry: ${setup.entry_low}–${setup.entry_high}\nSL: ${setup.stop_loss} | TP: ${setup.target} | R:R: ${setup.rr_ratio}`);
        updates.push(`${setup.symbol} in entry zone`);
      }
    }

    return NextResponse.json({ checked: setups.length, updated: updates, prices });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
