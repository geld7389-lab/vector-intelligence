import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// Static high-impact events for current week (ForexFactory often rate-limits)
// Combined with live fetch attempt
const STATIC_EVENTS = [
  { name:'NFP', day:'Friday', impact:'critical', time:'8:30 AM' },
  { name:'CPI', day:'Wednesday', impact:'critical', time:'8:30 AM' },
  { name:'FOMC', day:'Wednesday', impact:'critical', time:'2:00 PM' },
  { name:'Initial Jobless Claims', day:'Thursday', impact:'high', time:'8:30 AM' },
  { name:'PPI', day:'Thursday', impact:'high', time:'8:30 AM' },
  { name:'Retail Sales', day:'Wednesday', impact:'high', time:'8:30 AM' },
  { name:'GDP', day:'Thursday', impact:'high', time:'8:30 AM' },
];

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export async function GET() {
  const now = new Date();
  const nyNow = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  const nyDay = DAYS[nyNow.getDay()];
  const nyHour = nyNow.getHours();

  // Try ForexFactory first
  try {
    const r = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers:{'User-Agent':'Mozilla/5.0'}, cache:'no-store', signal: AbortSignal.timeout(3000)
    });
    if (r.ok) {
      const data = await r.json();
      const events = data
        .filter((e:any) => ['USD'].includes(e.country) && ['High Impact Expected','Medium Impact Expected'].includes(e.impact))
        .map((e:any) => {
          const eDate = new Date(e.date);
          const eNY = new Date(eDate.toLocaleString('en-US',{timeZone:'America/New_York'}));
          const diffMin = Math.round((eDate.getTime()-now.getTime())/60000);
          const isToday = eNY.toDateString()===nyNow.toDateString();
          const isDangerZone = isToday && diffMin > -60 && diffMin < 30;
          return { name:e.title, date:eDate.toISOString().slice(0,10), time:e.date.split('T')[1]?.slice(0,5), impact:e.impact.includes('High')?'critical':'high', isToday, diffMin, isDangerZone };
        })
        .sort((a:any,b:any)=>new Date(a.date).getTime()-new Date(b.date).getTime())
        .slice(0,10);
      return NextResponse.json({ events, source:'forexfactory' });
    }
  } catch {}

  // Fallback: static events
  const events = STATIC_EVENTS.map(e => {
    const dayDiff = ((DAYS.indexOf(e.day) - nyNow.getDay() + 7) % 7);
    const eDate = new Date(nyNow);
    eDate.setDate(eDate.getDate() + dayDiff);
    const [hStr, rest] = e.time.split(':');
    const [mStr, ampm] = rest.split(' ');
    let h = parseInt(hStr); const m = parseInt(mStr);
    if (ampm==='PM'&&h!==12) h+=12;
    eDate.setHours(h,m,0,0);
    const diffMin = Math.round((eDate.getTime()-now.getTime())/60000);
    const isToday = dayDiff===0;
    const isDangerZone = isToday && diffMin > -60 && diffMin < 30;
    return { name:e.name, date:eDate.toISOString().slice(0,10), time:e.time, impact:e.impact, isToday, diffMin, isDangerZone };
  }).sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime());

  return NextResponse.json({ events, source:'static' });
}
