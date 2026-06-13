import { NextRequest, NextResponse } from 'next/server';
import { sb as supabase } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';


const COT_CODES: Record<string,string> = {
  NQ:'209742', ES:'13874A', GC:'088691', CL:'067651',
  EUR:'099741', GBP:'096742', JPY:'097741', DXY:'098662',
};

function interpretCOT(data: any[]): string {
  if (!data?.length) return '';
  const latest = data[0];
  const prev = data[1];
  const commNet = latest.comm_net ?? 0;
  const largeNet = latest.large_net ?? 0;
  const commChange = prev ? commNet - (prev.comm_net ?? 0) : 0;
  const bias = commNet > 0 ? 'BULLISH' : 'BEARISH';
  const strength = Math.abs(commNet) > 100000 ? 'strongly' : Math.abs(commNet) > 50000 ? 'moderately' : 'slightly';
  const trend = commChange > 5000 ? 'increasing longs' : commChange < -5000 ? 'increasing shorts' : 'holding position';
  const divergence = (commNet > 0 && largeNet < 0) || (commNet < 0 && largeNet > 0);
  return `Commercials (smart money) are ${strength} ${bias} with net ${commNet > 0 ? '+' : ''}${Math.round(commNet/1000)}k contracts. ` +
    `They are ${trend} week-over-week. ` +
    `Large Speculators (trend followers) are net ${largeNet > 0 ? 'long' : 'short'} ${Math.abs(Math.round(largeNet/1000))}k. ` +
    (divergence ? `⚠️ DIVERGENCE: Commercials and Specs are on opposite sides — potential reversal signal. ` : `Commercials and Specs are aligned. `) +
    `ICT note: Commercials represent institutional money. When they ${commNet > 0 ? 'accumulate longs' : 'add shorts'}, it indicates ${commNet > 0 ? 'bullish' : 'bearish'} institutional intent.`;
}

async function fetchCOT(symbol: string) {
  try {
    const code = COT_CODES[symbol];
    if (!code) return null;
    const apiUrl = `https://publicreporting.cftc.gov/api/explore/dataset/com-disagg/records/?where=cftc_commodity_code="${code}"&sort=-report_date_as_yyyy_mm_dd&limit=20&timezone=UTC`;
    const res = await fetch(apiUrl, { headers:{'User-Agent':'Mozilla/5.0'}, cache:'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.records??[]).map((r:any) => {
      const f = r.fields ?? r;
      return {
        date: f.report_date_as_yyyy_mm_dd ?? f.report_date,
        comm_long: Number(f.comm_positions_long_all??0),
        comm_short: Number(f.comm_positions_short_all??0),
        comm_net: Number(f.comm_positions_long_all??0)-Number(f.comm_positions_short_all??0),
        large_long: Number(f.noncomm_positions_long_all??0),
        large_short: Number(f.noncomm_positions_short_all??0),
        large_net: Number(f.noncomm_positions_long_all??0)-Number(f.noncomm_positions_short_all??0),
        small_net: Number(f.nonrept_positions_long_all??0)-Number(f.nonrept_positions_short_all??0),
        oi: Number(f.open_interest_all??0),
      };
    });
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') ?? 'NQ';
  const { data:cached } = await supabase.from('cot_data').select('*').eq('symbol',symbol).order('report_date',{ascending:false}).limit(20);
  if (cached&&cached.length>0) {
    const daysSince=(Date.now()-new Date(cached[0].report_date).getTime())/(1000*60*60*24);
    if (daysSince<7) {
      const latest=cached[0];
      return NextResponse.json({ symbol, data:cached, source:'cache', latest, interpretation:interpretCOT(cached) });
    }
  }
  const fresh = await fetchCOT(symbol.replace('USD','').replace('EURUSD','EUR').replace('GBPUSD','GBP'));
  if (!fresh||!fresh.length) return NextResponse.json({ symbol, data:cached??[], source:'cache_fallback', latest:cached?.[0]??null, interpretation:interpretCOT(cached??[]) });
  const rows = fresh.map((r:any)=>({ symbol, report_date:r.date, ...r }));
  await supabase.from('cot_data').upsert(rows,{onConflict:'report_date,symbol'});
  return NextResponse.json({ symbol, data:fresh, source:'cftc_live', latest:fresh[0], interpretation:interpretCOT(fresh) });
}
