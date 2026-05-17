import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET() {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = nyTime.getHours();
  const m = nyTime.getMinutes();
  const totalMin = h * 60 + m;
  const day = nyTime.getDay(); // 0=Sun,6=Sat
  const isWeekend = day === 0 || day === 6;

  // Killzone windows (NY time, minutes from midnight)
  const zones = [
    { name: 'Asian',        short: 'ASIA',   start: 19*60,      end: 22*60,      color: '#6366f1', description: 'Asian range building. Low volume. NQ/ES consolidate.' },
    { name: 'London Open',  short: 'LON',    start: 2*60,       end: 5*60,       color: '#f59e0b', description: 'Judas swing. London sweeps Asian range lows/highs before reversing.' },
    { name: 'NY Open',      short: 'NY',     start: 8*60+30,    end: 11*60,      color: '#22c55e', description: 'Highest probability. Main directional move delivers here.' },
    { name: 'Silver Bullet',short: 'SB',     start: 10*60,      end: 11*60,      color: '#3b82f6', description: 'Best 60-min window of the day. FVG+liquidity sweep entries only.' },
    { name: 'London Close', short: 'LCL',    start: 11*60+30,   end: 13*60,      color: '#f97316', description: 'NY Lunch. AVOID. Low volume, chop, stop hunts.' },
    { name: 'NY Afternoon', short: 'NYA',    start: 13*60+30,   end: 16*60,      color: '#a855f7', description: 'PM session. Continuation or reversal of AM trend.' },
  ];

  // Danger zone: NY lunch (avoid entirely)
  const LUNCH_START = 11 * 60 + 30;
  const LUNCH_END   = 13 * 60 + 30;
  const isLunch = totalMin >= LUNCH_START && totalMin < LUNCH_END;

  // Find active zone
  let active = zones.find(z => {
    if (z.start > z.end) { // crosses midnight (Asian)
      return totalMin >= z.start || totalMin < z.end;
    }
    return totalMin >= z.start && totalMin < z.end;
  });

  // Minutes to next zone
  function minsToNext(zoneStart: number) {
    let diff = zoneStart - totalMin;
    if (diff < 0) diff += 24 * 60;
    return diff;
  }

  const upcoming = zones
    .map(z => ({ ...z, minsAway: minsToNext(z.start) }))
    .filter(z => z.minsAway > 0 && z.minsAway < 180)
    .sort((a, b) => a.minsAway - b.minsAway)
    .slice(0, 2);

  const probability = isWeekend ? 'CLOSED'
    : isLunch ? 'AVOID'
    : active?.short === 'SB' ? 'HIGHEST'
    : active?.short === 'NY' ? 'HIGH'
    : active?.short === 'LON' ? 'MEDIUM'
    : active?.short === 'NYA' ? 'MEDIUM'
    : active?.short === 'ASIA' ? 'LOW'
    : 'DEAD';

  const shouldTrade = !isWeekend && !isLunch && !!active && active.short !== 'LCL';

  return NextResponse.json({
    nyTime: nyTime.toLocaleTimeString('en-US', { hour12: true }),
    active: active ?? null,
    upcoming,
    probability,
    shouldTrade,
    isLunch,
    isWeekend,
    totalMin,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
