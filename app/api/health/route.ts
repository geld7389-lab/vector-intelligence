import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ ok: true, version: '4.0', ts: new Date().toISOString() });
}
