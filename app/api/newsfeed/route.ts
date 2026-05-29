import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

const sb = createClient((process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co'), (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'));

const MT_BASE = 'https://vast-mcp.blueskyapi.com';

async function fetchMTNews(symbol?: string) {
  try {
    const dataset = 'mt_newswires_north_america';
    const path = symbol ? `${MT_BASE}/data/edge/${dataset}/${symbol}` : `${MT_BASE}/data/edge/${dataset}`;
    const r = await fetch(path, {
      headers: { 'Authorization': `Bearer ${process.env.MT_NEWSWIRES_API_KEY ?? ''}` },
      cache: 'no-store'
    });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data.slice(0, 20) : [];
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') ?? undefined;
  const section = req.nextUrl.searchParams.get('section') ?? 'all';

  // Try to fetch fresh news
  const fresh = await fetchMTNews(symbol);

  // Also get cached from DB
  const query = sb.from('news_cache').select('*').order('release_time', { ascending: false }).limit(30);
  if (symbol) query.eq('symbol', symbol);
  if (section !== 'all') query.eq('market_section', section);
  const { data: cached } = await query;

  // Cache new items
  if (fresh.length > 0) {
    const toCache = fresh.map((n: {key?: string; subkey?: string; headline?: string; body?: string; releaseTime?: string; metadata?: string}) => ({
      symbol: n.key ?? symbol ?? 'MARKET',
      market_section: section,
      headline: n.headline ?? '',
      body: n.body ?? null,
      release_time: n.releaseTime ?? new Date().toISOString(),
      metadata: n.metadata ?? null,
    }));
    try { await sb.from('news_cache').upsert(toCache, { onConflict: 'headline' }); } catch {}
  }

  const news = fresh.length > 0 ? fresh : (cached ?? []);
  return NextResponse.json({ news, count: news.length, ts: Date.now() });
}
