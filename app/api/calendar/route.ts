import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HIGH_IMPACT = ['FOMC','Fed','CPI','NFP','GDP','PCE','PPI','ISM','Retail Sales','Jobless Claims','PMI','Non-Farm','Interest Rate','Powell','Unemployment'];

export async function GET() {
  // Static high-impact calendar with proper dates (dynamic enough for 2026)
  const now = new Date();
  const events = [
    { date: '2026-05-22', time: '8:30 AM', name: 'Jobless Claims', impact: 'high', currency: 'USD' },
    { date: '2026-05-23', time: '10:00 AM', name: 'Consumer Sentiment', impact: 'medium', currency: 'USD' },
    { date: '2026-05-27', time: '9:00 AM', name: 'S&P HPI', impact: 'medium', currency: 'USD' },
    { date: '2026-05-28', time: '8:30 AM', name: 'GDP (2nd Est)', impact: 'high', currency: 'USD' },
    { date: '2026-05-29', time: '8:30 AM', name: 'PCE Price Index', impact: 'high', currency: 'USD' },
    { date: '2026-06-04', time: '8:30 AM', name: 'Jobless Claims', impact: 'high', currency: 'USD' },
    { date: '2026-06-05', time: '8:30 AM', name: 'NFP + Unemployment', impact: 'high', currency: 'USD' },
    { date: '2026-06-11', time: '8:30 AM', name: 'CPI', impact: 'high', currency: 'USD' },
    { date: '2026-06-12', time: '8:30 AM', name: 'PPI', impact: 'high', currency: 'USD' },
    { date: '2026-06-17', time: '8:30 AM', name: 'Retail Sales', impact: 'high', currency: 'USD' },
    { date: '2026-06-18', time: '2:00 PM', name: 'FOMC Rate Decision', impact: 'critical', currency: 'USD' },
    { date: '2026-06-25', time: '8:30 AM', name: 'GDP (Final)', impact: 'high', currency: 'USD' },
  ].map(e => {
    const eventDate = new Date(e.date + 'T' + e.time.replace(' AM','').replace(' PM', e.time.includes('PM') && !e.time.startsWith('12') ? '' : '') + ':00');
    const diffMs = new Date(e.date).getTime() - new Date(now.toDateString()).getTime();
    const diffDays = Math.round(diffMs / (1000*60*60*24));
    const isToday = diffDays === 0;
    let minutesAway: number|null = null;
    if (isToday) {
      const [h, m] = e.time.replace(' AM','').replace(' PM','').split(':').map(Number);
      const isPM = e.time.includes('PM') && h !== 12;
      const eventHour = isPM ? h+12 : h;
      minutesAway = (eventHour*60 + (m||0)) - (now.getHours()*60 + now.getMinutes());
    }
    const isDangerZone = isToday && minutesAway !== null && minutesAway >= -30 && minutesAway <= 15;
    return { ...e, isToday, daysAway: diffDays, minutesAway, isDangerZone, isPast: diffDays < 0 };
  }).filter(e => !e.isPast || e.isToday);

  const hasDangerZone = events.some(e => e.isDangerZone);
  return NextResponse.json({ events, hasDangerZone });
}
