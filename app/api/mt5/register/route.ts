import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const TOKEN = process.env.METAAPI_TOKEN ?? '';
  const pw = searchParams.get('p') ?? '0777564264a-Z';
  const action = searchParams.get('action') ?? 'list';

  if (!TOKEN) return NextResponse.json({ error: 'METAAPI_TOKEN not set' });

  // Always list first
  const listR = await fetch(`${PROV}/users/current/accounts?limit=100`, {
    headers: { 'auth-token': TOKEN }, cache: 'no-store'
  });
  const listText = await listR.text();
  
  if (action === 'list') {
    return NextResponse.json({ status: listR.status, raw: listText, tokenOk: listR.ok });
  }

  // Parse list
  let items: any[] = [];
  try { const p = JSON.parse(listText); items = Array.isArray(p) ? p : (p.items ?? []); } catch {}
  
  // Already exists?
  const existing = items.find((a: any) => String(a.login) === '8029341');
  if (existing) {
    if (existing.state !== 'DEPLOYED') {
      // Fire deploy and don't wait
      fetch(`${PROV}/users/current/accounts/${existing.id}/deploy`, {
        method: 'POST', headers: { 'auth-token': TOKEN }
      }).catch(() => {});
    }
    return NextResponse.json({ 
      found: true, accountId: existing.id, 
      state: existing.state, name: existing.name,
      server: existing.server, login: existing.login
    });
  }

  // Fire-and-forget the create — don't await, return immediately
  // MetaApi takes 15-30s and we'll time out waiting
  const body = JSON.stringify({
    name: 'VECTOR-ExclusiveMarkets', type: 'cloud',
    login: '8029341', password: pw,
    server: 'ExclusiveMarkets-Demo', platform: 'mt5',
    application: 'MetaApi', magic: 73921, reliability: 'regular',
    quoteStreamingIntervalInSeconds: 2.5,
  });

  // Use AbortController with 25s timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  
  try {
    const r = await fetch(`${PROV}/users/current/accounts`, {
      method: 'POST',
      headers: { 'auth-token': TOKEN, 'Content-Type': 'application/json' },
      body, signal: ctrl.signal, cache: 'no-store',
    });
    clearTimeout(timer);
    const text = await r.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    
    if (!r.ok) {
      return NextResponse.json({ 
        error: data.message ?? text, 
        httpStatus: r.status,
        hint: data.recommendedBrokerServers ?? null,
        sentPassword: pw.substring(0,3)+'***'
      });
    }
    return NextResponse.json({ 
      success: true, accountId: data.id, 
      state: data.state, sentPassword: pw.substring(0,3)+'***'
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      return NextResponse.json({ 
        timedOut: true, 
        message: 'MetaApi is processing the request (takes 15-30s). Call ?action=list in 60s to check if account appeared.',
        sentPassword: pw.substring(0,3)+'***'
      });
    }
    return NextResponse.json({ error: e.message });
  }
}
