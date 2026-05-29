import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

// Called every 60s from Vercel cron (or manually) — checks all active setups against live prices
// Vercel cron: add to vercel.json: { "crons": [{ "path": "/api/monitor", "schedule": "* * * * *" }] }

async function getPrice(symbol: string): Promise<number | null> {
  try {
    const yahooSym = symbol === 'NQ' ? 'NQ=F' : symbol === 'ES' ? 'ES=F' : symbol === 'GC' ? 'GC=F'
      : symbol === 'BTC' ? 'BTC-USD' : symbol === 'ETH' ? 'ETH-USD' : symbol === 'SOL' ? 'SOL-USD'
      : symbol.includes('USD') || symbol.includes('EUR') || symbol.includes('GBP') ? `${symbol}=X`
      : symbol;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1m&range=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    const d = await r.json();
    const closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const last = closes.filter((v: number | null) => v != null).pop();
    return last ?? null;
  } catch { return null; }
}

export async function GET() {
  try {
    const { data: setups } = await sb.from('setups')
      .select('*')
      .in('status', ['active', 'watching'])
      .lt('expires_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

    if (!setups || setups.length === 0) return NextResponse.json({ checked: 0, updated: [] });

    const symbols = [...new Set(setups.map((s: { symbol: string }) => s.symbol))];
    const prices: Record<string, number | null> = {};
    await Promise.all(symbols.map(async (sym: string) => { prices[sym] = await getPrice(sym); }));

    const updates: string[] = [];
    const now = new Date();

    for (const setup of setups) {
      const price = prices[setup.symbol];
      const isBull = setup.direction === 'bull' || setup.direction === 'long';

      // Auto-expire if past expiry date
      if (setup.expires_at && new Date(setup.expires_at) < now) {
        await sb.from('setups').update({ status: 'expired' }).eq('id', setup.id);
        updates.push(`${setup.symbol} expired`);
        continue;
      }

      if (price === null) continue;

      // SL breached → mark lost
      if (isBull ? price < setup.stop_loss : price > setup.stop_loss) {
        await sb.from('setups').update({ status: 'lost', invalidated_reason: `SL ${setup.stop_loss} breached at ${price.toFixed(2)}` }).eq('id', setup.id);
        updates.push(`${setup.symbol} SL hit → LOST`);
        continue;
      }

      // Target hit → mark won
      if (isBull ? price >= setup.target : price <= setup.target) {
        await sb.from('setups').update({ status: 'won' }).eq('id', setup.id);
        updates.push(`${setup.symbol} TP hit → WON`);
        continue;
      }

      // Price inside entry zone → update to triggered
      if (price >= setup.entry_low && price <= setup.entry_high && setup.status === 'watching') {
        await sb.from('setups').update({ status: 'triggered' }).eq('id', setup.id);
        updates.push(`${setup.symbol} price in entry zone → TRIGGERED`);
      }
    }

    return NextResponse.json({ checked: setups.length, updated: updates, prices });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
