import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const GROQ_KEY = process.env.GROQ_API_KEY ?? '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';

export async function GET() {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'say hi in one word' }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return NextResponse.json({ status: res.status, ok: res.ok, body: text });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, name: e.name });
  }
}
