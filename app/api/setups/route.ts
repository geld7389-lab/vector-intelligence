import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')
  const direction = searchParams.get('direction')
  const minScore = searchParams.get('minScore')

  let query = supabase
    .from('setups')
    .select('*')
    .in('status', ['active', 'watching', 'triggered'])
    .order('confluence_score', { ascending: false })
    .limit(50)

  if (symbol) query = query.eq('symbol', symbol)
  if (direction) query = query.eq('direction', direction)
  if (minScore) query = query.gte('confluence_score', parseInt(minScore))

  const { data, error } = await query
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ setups: data })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase.from('setups').insert(body).select()
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ setup: data[0] })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body
  const { data, error } = await supabase
    .from('setups')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ setup: data[0] })
}
