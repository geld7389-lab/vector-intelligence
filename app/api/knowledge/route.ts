import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('q')
  const category = searchParams.get('category')

  let dbQuery = supabase.from('knowledge_base').select('*').order('created_at')

  if (query) {
    dbQuery = dbQuery.or(`title.ilike.%${query}%,content.ilike.%${query}%`)
  }
  if (category) {
    dbQuery = dbQuery.eq('category', category)
  }

  const { data, error } = await dbQuery
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json({ knowledge: data })
}
