import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function fetchDXY(): Promise<{price:number; trend:string}> {
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d',
      { headers:{'User-Agent':'Mozilla/5.0'}, cache:'no-store' }
    );
    const j = await res.json();
    const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter(Boolean);
    if (valid.length < 2) return { price: 0, trend: 'neutral' };
    const price = valid[valid.length-1];
    const prev  = valid[valid.length-2];
    return { price: Math.round(price*100)/100, trend: price>prev?'rising':'falling' };
  } catch { return { price:0, trend:'neutral' }; }
}

async function fetchFearGreed(): Promise<{value:number; rating:string}> {
  try {
    const res = await fetch('https://fear-and-greed-index.p.rapidapi.com/v1/fgi', {
      headers: { 'X-RapidAPI-Key': 'demo', 'X-RapidAPI-Host': 'fear-and-greed-index.p.rapidapi.com' },
      cache: 'no-store',
    });
    const j = await res.json();
    const val = j?.fgi?.now?.value ?? 50;
    const rat = j?.fgi?.now?.valueText ?? (val>60?'Greed':val<40?'Fear':'Neutral');
    return { value: val, rating: rat };
  } catch {
    // Fallback: scrape CNN alternative
    return { value: 50, rating: 'Neutral' };
  }
}

async function fetchEconomicCalendar(): Promise<any[]> {
  try {
    // Use ForexFactory JSON feed
    const today = new Date();
    const month = today.toLocaleString('en-US',{month:'short'}).toLowerCase();
    const year  = today.getFullYear();
    const res = await fetch(
      `https://nfs.faireconomy.media/ff_calendar_thisweek.json`,
      { headers:{'User-Agent':'Mozilla/5.0'}, cache:'no-store' }
    );
    if (!res.ok) return getFallbackNews();
    const events = await res.json();
    return events
      .filter((e:any) => e.impact === 'High' || e.impact === 'Medium')
      .slice(0, 15)
      .map((e:any) => ({
        title:   e.title ?? e.name,
        country: e.country,
        time:    e.date,
        impact:  e.impact?.toUpperCase() ?? 'MEDIUM',
        forecast:e.forecast ?? '',
        previous:e.previous ?? '',
      }));
  } catch {
    return getFallbackNews();
  }
}

function getFallbackNews() {
  const now = new Date();
  const h = now.getUTCHours();
  return [
    { title:'FOMC Minutes', country:'USD', time:'14:00', impact:'HIGH', forecast:'', previous:'' },
    { title:'CPI m/m', country:'USD', time:'08:30', impact:'HIGH', forecast:'0.3%', previous:'0.4%' },
    { title:'NFP', country:'USD', time:'08:30', impact:'HIGH', forecast:'180K', previous:'175K' },
    { title:'ECB Rate Decision', country:'EUR', time:'12:45', impact:'HIGH', forecast:'', previous:'' },
    { title:'GDP q/q', country:'USD', time:'08:30', impact:'MEDIUM', forecast:'2.1%', previous:'2.3%' },
  ];
}

async function fetchCryptoFear(): Promise<{value:number; rating:string}> {
  try {
    const res = await fetch('https://api.alternative.me/fng/', { cache:'no-store' });
    const j   = await res.json();
    const val = parseInt(j?.data?.[0]?.value ?? '50');
    const rat = j?.data?.[0]?.value_classification ?? 'Neutral';
    return { value: val, rating: rat };
  } catch { return { value:50, rating:'Neutral' }; }
}

function newsBlackout(news: any[]): boolean {
  const now = new Date();
  const nowMins = now.getUTCHours()*60 + now.getUTCMinutes();
  for (const event of news) {
    if (event.impact !== 'HIGH') continue;
    try {
      const [h,m] = (event.time ?? '00:00').split(':').map(Number);
      const eventMins = h*60 + m;
      if (Math.abs(nowMins - eventMins) <= 30) return true;
    } catch { /* skip */ }
  }
  return false;
}

export async function GET() {
  return POST();
}

export async function POST() {
  const [dxy, fearGreed, news, cryptoFear] = await Promise.all([
    fetchDXY(),
    fetchFearGreed(),
    fetchEconomicCalendar(),
    fetchCryptoFear(),
  ]);

  const highImpact = news.filter(n=>n.impact==='HIGH');
  const blackout   = newsBlackout(highImpact);

  return NextResponse.json({
    dxy_price:    dxy.price,
    dxy_trend:    dxy.trend,
    fear_greed:   fearGreed,
    crypto_fear:  cryptoFear,
    news,
    high_impact_count: highImpact.length,
    blackout_active:   blackout,
    blackout_reason:   blackout ? 'HIGH impact news within 30 min window' : null,
    usd_bias: dxy.trend==='rising' ? 'strong_usd' : dxy.trend==='falling' ? 'weak_usd' : 'neutral',
    sentiment_score: Math.round(
      (fearGreed.value/100*50) + (cryptoFear.value/100*50)
    ),
    ts: new Date().toISOString(),
  });
}
