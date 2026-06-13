import { NextResponse } from 'next/server';
import { sb as supabase } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';


async function getPrice(sym: string): Promise<number|null> {
  try {
    const map:Record<string,string> = {NQ:'NQ=F',ES:'ES=F',GC:'GC=F',BTC:'BTC-USD',ETH:'ETH-USD',EURUSD:'EURUSD=X',GBPUSD:'GBPUSD=X'};
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${map[sym]??sym}?interval=1m&range=1d`,{headers:{'User-Agent':'Mozilla/5.0'},cache:'no-store'});
    if(!r.ok) return null;
    const d = await r.json();
    return d?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch { return null; }
}

async function sendTelegram(token: string, chatId: string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: chatId, text, parse_mode:'HTML' })
    });
  } catch {}
}

export async function GET() {
  try {
    // Get Telegram config
    const { data: cfg } = await supabase.from('telegram_config').select('*').eq('id',1).single();
    if (!cfg?.bot_token || !cfg?.chat_id || !cfg?.active) return NextResponse.json({ ok:true, skipped:'no config' });

    // Get open trades
    const { data: trades } = await supabase.from('trades').select('*').eq('result','open');
    if (!trades?.length) return NextResponse.json({ ok:true, checked:0 });

    const fired: string[] = [];
    const syms = [...new Set(trades.map((t:any)=>t.symbol))];
    const prices: Record<string,number|null> = {};
    await Promise.all(syms.map(async s => { prices[s] = await getPrice(s); }));

    for (const trade of trades) {
      const p = prices[trade.symbol];
      if (p == null) continue;
      const isBull = trade.direction === 'long';
      const alertKey = `${trade.id}`;

      // SL hit
      if (cfg.alert_sl && ((isBull && p <= trade.stop_loss) || (!isBull && p >= trade.stop_loss))) {
        await sendTelegram(cfg.bot_token, cfg.chat_id,
          `🔴 <b>SL HIT</b> — ${trade.symbol}\nDirection: ${isBull?'LONG':'SHORT'}\nSL: ${trade.stop_loss} | Price: ${p.toFixed(2)}`);
        fired.push(`SL:${trade.symbol}`);
      }
      // TP hit
      if (cfg.alert_tp && ((isBull && p >= trade.take_profit) || (!isBull && p <= trade.take_profit))) {
        await sendTelegram(cfg.bot_token, cfg.chat_id,
          `🟢 <b>TP HIT</b> — ${trade.symbol}\nDirection: ${isBull?'LONG':'SHORT'}\nTP: ${trade.take_profit} | Price: ${p.toFixed(2)}`);
        fired.push(`TP:${trade.symbol}`);
      }
      // Entry zone (setups)
    }

    // Check setups entry zones
    if (cfg.alert_entry) {
      const { data: setups } = await supabase.from('setups').select('*').eq('status','watching');
      for (const s of (setups??[])) {
        const p = prices[s.symbol] ?? await getPrice(s.symbol);
        if (p == null) continue;
        if (p >= s.entry_low && p <= s.entry_high) {
          await sendTelegram(cfg.bot_token, cfg.chat_id,
            `🟡 <b>ENTRY ZONE</b> — ${s.symbol} ${s.setup_type}\nDirection: ${s.direction?.toUpperCase()}\nZone: ${s.entry_low}–${s.entry_high} | Price: ${p.toFixed(2)}\nSL: ${s.stop_loss} | TP: ${s.target} | Score: ${s.confluence_score}`);
          fired.push(`ENTRY:${s.symbol}`);
        }
      }
    }

    return NextResponse.json({ ok:true, checked:trades.length, fired });
  } catch (e) { return NextResponse.json({ ok:false, error: String(e) }); }
}
