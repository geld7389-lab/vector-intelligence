export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BASE = 'https://mt5.mtapi.io';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { login, password, server } = body;
    if (!login || !password || !server) {
      return Response.json({ error: 'login, password, server required' }, { status: 400 });
    }

    const url = `${BASE}/ConnectEx?user=${login}&password=${encodeURIComponent(password)}&server=${encodeURIComponent(server)}&connectTimeoutSeconds=60&connectTimeoutClusterMemberSeconds=20&errorReplyStatusCode=201`;
    const r = await fetch(url, { headers: { accept: 'text/plain' } });
    const text = await r.text();

    // On error (201 status code returned as body or non-200)
    if (!r.ok) {
      let errMsg = text;
      try { const j = JSON.parse(text); errMsg = j.message ?? text; } catch {}
      return Response.json({ error: errMsg });
    }

    // Token comes back as plain text (with or without quotes)
    const token = text.replace(/"/g, '').trim();
    if (!token || token.length < 10) {
      return Response.json({ error: `Unexpected response: ${text}` });
    }

    return Response.json({ success: true, token, brokerName: server });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
