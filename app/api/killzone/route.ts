import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const KZ = [
  { name:'Asia', short:'AS', start:20, end:23, color:'blue' },
  { name:'London Open', short:'LO', start:2, end:5, color:'green' },
  { name:'New York AM', short:'NY', start:9, end:11, color:'yellow' },
  { name:'Silver Bullet', short:'SB', start:10, end:11, color:'orange' },
  { name:'New York PM', short:'PM', start:14, end:16, color:'purple' },
];

export async function GET() {
  const nyNow = new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
  const h = nyNow.getHours() + nyNow.getMinutes()/60;
  const nyTime = nyNow.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});

  const active = KZ.find(k => h >= k.start && h < k.end) ?? null;
  const next = KZ.find(k => k.start > h) ?? KZ[0];
  const minsToNext = next ? Math.round((next.start - (h % 24)) * 60) : null;

  return NextResponse.json({ active, next, minsToNext, nyTime, hour: h });
}
