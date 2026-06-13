import { NextRequest, NextResponse } from 'next/server';
import { sb as supabase } from '../../../lib/supabase';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { type, botToken, chatId, message } = await req.json();
  const token = botToken || (await supabase.from('telegram_config').select('bot_token,chat_id').eq('id',1).single()).data?.bot_token;
  const chat = chatId || (await supabase.from('telegram_config').select('bot_token,chat_id').eq('id',1).single()).data?.chat_id;
  if (!token || !chat) return NextResponse.json({ error:'No config' },{status:400});
  const text = type==='test' ? '✅ <b>VECTOR Intelligence</b>\nTelegram alerts are working!' : (message ?? 'Alert from VECTOR');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({chat_id:chat,text,parse_mode:'HTML'})
  });
  const d = await r.json();
  return NextResponse.json(d);
}
