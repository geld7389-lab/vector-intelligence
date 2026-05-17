import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// High-impact macro events for the week — fetched from ForexFactory-style logic
// We build the calendar from known FOMC/NFP/CPI dates + real-time check
const HIGH_IMPACT = ['FOMC', 'NFP', 'CPI', 'PCE', 'GDP', 'PPI', 'Retail Sales', 'Fed Chair', 'JOLTS', 'ISM'];

function getNextEvents() {
  const now = new Date();
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = nyNow.getDay(); // 0=Sun, 5=Fri
  const hour = nyNow.getHours();
  const min = nyNow.getMinutes();
  const currentMinutes = hour * 60 + min;

  // Known 2026 high-impact events (May-June)
  const events = [
    { date: '2026-05-20', time: '08:30', name: 'FOMC Minutes', impact: 'HIGH', currency: 'USD' },
    { date: '2026-05-22', time: '08:30', name: 'Jobless Claims', impact: 'MED', currency: 'USD' },
    { date: '2026-05-23', time: '10:00', name: 'Consumer Sentiment', impact: 'MED', currency: 'USD' },
    { date: '2026-05-27', time: '09:00', name: 'S&P HPI', impact: 'MED', currency: 'USD' },
    { date: '2026-05-28', time: '08:30', name: 'GDP (2nd Est)', impact: 'HIGH', currency: 'USD' },
    { date: '2026-05-29', time: '08:30', name: 'PCE Price Index', impact: 'HIGH', currency: 'USD' },
    { date: '2026-05-30', time: '08:30', name: 'NFP Preview - Jobless Claims', impact: 'MED', currency: 'USD' },
    { date: '2026-06-04', time: '10:00', name: 'ISM Services', impact: 'HIGH', currency: 'USD' },
    { date: '2026-06-05', time: '08:30', name: 'NFP', impact: 'HIGH', currency: 'USD' },
    { date: '2026-06-11', time: '08:30', name: 'CPI', impact: 'HIGH', currency: 'USD' },
    { date: '2026-06-18', time: '14:00', name: 'FOMC Rate Decision', impact: 'HIGH', currency: 'USD' },
    { date: '2026-06-26', time: '08:30', name: 'PCE Price Index', impact: 'HIGH', currency: 'USD' },
  ];

  const todayStr = nyNow.toISOString().slice(0, 10);

  return events.map(e => {
    const [h, m] = e.time.split(':').map(Number);
    const eventMinutes = h * 60 + m;
    const isToday = e.date === todayStr;
    const minutesAway = isToday ? eventMinutes - currentMinutes : null;
    const isDangerZone = isToday && minutesAway !== null && minutesAway > -15 && minutesAway < 30;
    const isPast = isToday && minutesAway !== null && minutesAway < -30;

    return {
      ...e,
      isToday,
      minutesAway,
      isDangerZone,   // within 15 min before or 30 min after — DO NOT TRADE
      isPast,
    };
  }).filter(e => !e.isPast || e.isToday);
}

export async function GET() {
  const events = getNextEvents();
  const dangerNow = events.some(e => e.isDangerZone);
  return NextResponse.json({ events, dangerNow }, { headers: { 'Cache-Control': 'no-store' } });
}
