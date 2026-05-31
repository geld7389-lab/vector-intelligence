import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

// CFTC COT data — free, no API key
// Maps our symbols to CFTC market codes
const COT_CODES: Record<string, string> = {
  'NQ':  '209742', // E-Mini Nasdaq-100
  'ES':  '13874A', // E-Mini S&P 500
  'GC':  '088691', // Gold
  'CL':  '067651', // Crude Oil WTI
  'EUR': '099741', // Euro FX
  'GBP': '096742', // British Pound
  'JPY': '097741', // Japanese Yen
  'DXY': '098662', // US Dollar Index
};

async function fetchCOT(symbol: string) {
  try {
    const code = COT_CODES[symbol];
    if (!code) return null;
    // CFTC publishes CSV — we parse the latest week
    const url = `https://www.cftc.gov/dea/futures/deacmelf.htm`;
    // Use a structured data endpoint instead
    const apiUrl = `https://publicreporting.cftc.gov/api/explore/dataset/com-disagg/records/?where=cftc_commodity_code="${code}"&sort=-report_date_as_yyyy_mm_dd&limit=20&timezone=UTC`;
    const res = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const records = data?.records ?? [];
    return records.map((r: Record<string, unknown>) => {
      const f = r.fields as Record<string, unknown> ?? r;
      return {
        date: f.report_date_as_yyyy_mm_dd ?? f.report_date,
        comm_long: Number(f.comm_positions_long_all ?? 0),
        comm_short: Number(f.comm_positions_short_all ?? 0),
        comm_net: Number(f.comm_positions_long_all ?? 0) - Number(f.comm_positions_short_all ?? 0),
        large_long: Number(f.noncomm_positions_long_all ?? 0),
        large_short: Number(f.noncomm_positions_short_all ?? 0),
        large_net: Number(f.noncomm_positions_long_all ?? 0) - Number(f.noncomm_positions_short_all ?? 0),
        oi: Number(f.open_interest_all ?? 0),
      };
    });
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') ?? 'NQ';
  
  // Check cache first (refresh weekly)
  const { data: cached } = await sb.from('cot_data').select('*').eq('symbol', symbol).order('report_date', { ascending: false }).limit(20);
  
  if (cached && cached.length > 0) {
    const lastDate = new Date(cached[0].report_date);
    const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) return NextResponse.json({ symbol, data: cached, source: 'cache' });
  }

  // Fetch fresh from CFTC
  const fresh = await fetchCOT(symbol);
  if (!fresh || fresh.length === 0) {
    return NextResponse.json({ symbol, data: cached ?? [], source: 'cache_fallback' });
  }

  // Upsert into DB
  const rows = fresh.map((r: Record<string, unknown>) => ({ symbol, report_date: r.date, ...r }));
  await sb.from('cot_data').upsert(rows, { onConflict: 'report_date,symbol' });

  return NextResponse.json({ symbol, data: fresh, source: 'cftc_live' });
}
