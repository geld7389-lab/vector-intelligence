import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { audioBase64, mimeType = 'audio/mpeg', title, chunkNum } = await req.json();
    if (!audioBase64) return NextResponse.json({ error: 'No audio data' }, { status: 400 });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Transcribe this audio from ICT trading video "${title}" (part ${chunkNum}). Output ONLY the transcript. Preserve all trading terms exactly: PD Arrays, FVG, OB, CISD, DOL, BISI, SIBI, SSL, BSL, MMXM, AMD, IOB, IFVG, killzone, displacement, inducement, liquidity, etc.`
            },
            {
              type: 'document',
              source: { type: 'base64', media_type: mimeType, data: audioBase64 }
            }
          ]
        }]
      })
    });

    const data = await response.json();
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 500 });
    return NextResponse.json({ transcript: data.content?.[0]?.text ?? '' });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
