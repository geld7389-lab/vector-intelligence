import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// Live economic calendar via ForexFactory JSON feed (free, no key)
// Falls back to curated static events if FF is unavailable
async function fetchForexFactory() {
  try {
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0,10);
    const url = `https://nfs.faireconomy.media/ff_calendar_thisweek.json?version=${Date.now()}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json();
    return data;
  } catch { return null; }
}

const HIGH_IMPACT_KEYWORDS = ['FOMC','Fed','CPI','NFP','GDP','PCE','PPI','ISM','Retail','Jobless','PMI','Non-Farm','Interest Rate','Powell','Unemployment','ADP','JOLTS','Durable'];

const STATIC_EVENTS = [
  { date: '2026-06-04', time: '08:30', name: 'Jobless Claims', impact: 'high', currency: 'USD' },
  { date: '2026-06-05', time: '08:30', name: 'NFP + Unemployment', impact: 'critical', currency: 'USD' },
  { date: '2026-06-10', time: '08:30', name: 'CPI MoM', impact: 'critical', currency: 'USD' },
  { date: '2026-06-11', time: '08:30', name: 'PPI MoM', impact: 'high', currency: 'USD' },
  { date: '2026-06-16', time: '08:30', name: 'Retail Sales', impact: 'high', currency: 'USD' },
  { date: '2026-06-17', time: '08:30', name: 'Jobless Claims', impact: 'high', currency: 'USD' },
  { date: '2026-06-18', time: '14:00', name: 'FOMC Rate Decision', impact: 'critical', currency: 'USD' },
  { date: '2026-06-25', time: '08:30', name: 'GDP Final', impact: 'high', currency: 'USD' },
  { date: '2026-06-26', time: '08:30', name: 'PCE Price Index', impact: 'critical', currency: 'USD' },
];

export async function GET() {
  const now = new Date();
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  
  let rawEvents: {date:string;time:string;name:string;impact:string;currency:string}[] = [];

  // Try live ForexFactory feed
  const ffData = await fetchForexFactory();
  if (ffData && Array.isArray(ffData)) {
    rawEvents = ffData
      .filter((e: any) => e.currency === 'USD' && e.impact !== 'Non-Economic')
      .map((e: any) => {
        const impactMap: Record<string,string> = { 'High': 'high', 'Medium': 'medium', 'Low': 'low' };
        const isHighKeyword = HIGH_IMPACT_KEYWORDS.some(k => e.title?.includes(k));
        const impact = isHighKeyword ? (e.impact === 'High' ? 'critical' : 'high') : impactMap[e.impact] ?? 'low';
        return { date: e.date?.slice(0,10) ?? '', time: e.time ?? '00:00', name: e.title ?? '', impact, currency: e.currency ?? 'USD' };
      })
      .filter(e => e.impact === 'high' || e.impact === 'critical');
  } else {
    // Use static fallback
    rawEvents = STATIC_EVENTS;
  }

  // Only show next 5 days
  const cutoff = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  
  const events = rawEvents
    .filter(e => {
      const d = new Date(e.date + 'T00:00:00');
      return d >= new Date(now.toDateString()) && d <= cutoff;
    })
    .map(e => {
      const [hStr, mStr] = (e.time || '08:30').split(':');
      const h = parseInt(hStr), m = parseInt(mStr || '0');
      const eventNY = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const eventDate = new Date(e.date);
      const isToday = eventDate.toDateString() === new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'})).toDateString();
      const nyH = nyNow.getHours(), nyM = nyNow.getMinutes();
      const diffMin = isToday ? (h * 60 + m) - (nyH * 60 + nyM) : null;
      const isDangerZone = diffMin !== null && diffMin >= -30 && diffMin <= 60 && (e.impact === 'high' || e.impact === 'critical');
      return { ...e, isToday, diffMin, isDangerZone };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time||'').localeCompare(b.time||''));

  return NextResponse.json({ events, source: ffData ? 'live' : 'static', count: events.length });
}
