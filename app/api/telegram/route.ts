import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'
);

async function sendTelegram(token: string, chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  return res.json();
}

export async function GET() {
  const { data } = await sb.from('telegram_config').select('*').limit(1).single();
  return NextResponse.json({ config: data ?? null });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  
  // Save/update config
  if (body.action === 'save') {
    await sb.from('telegram_config').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const { data, error } = await sb.from('telegram_config').insert({ bot_token: body.bot_token, chat_id: body.chat_id, active: true, alert_sl: body.alert_sl ?? true, alert_entry: body.alert_entry ?? true, alert_tp: body.alert_tp ?? true, alert_scan: body.alert_scan ?? true }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ config: data, ok: true });
  }

  // Test message
  if (body.action === 'test') {
    const result = await sendTelegram(body.bot_token, body.chat_id, '🤖 <b>VECTOR Intelligence</b>\n\nTelegram alerts connected successfully!\n\nYou will receive alerts for:\n• 🔴 SL breached\n• 🟡 Price in entry zone\n• 🟢 Target hit\n• 📡 New setups detected');
    return NextResponse.json({ result });
  }

  // Send alert (called internally)
  if (body.action === 'alert') {
    const { data: cfg } = await sb.from('telegram_config').select('*').eq('active', true).limit(1).single();
    if (!cfg?.bot_token || !cfg?.chat_id) return NextResponse.json({ error: 'No config' }, { status: 400 });
    
    const icons: Record<string, string> = { sl: '🔴', entry: '🟡', tp: '🟢', scan: '📡', info: 'ℹ️' };
    const icon = icons[body.type] ?? 'ℹ️';
    const msg = `${icon} <b>VECTOR Alert</b>\n\n${body.message}\n\n<i>${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} NY</i>`;
    const result = await sendTelegram(cfg.bot_token, cfg.chat_id, msg);
    return NextResponse.json({ result });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
