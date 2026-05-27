import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xavkbjbgmuasfkliptsh.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Database = {
  public: {
    Tables: {
      setups: {
        Row: {
          id: string
          symbol: string
          timeframe: string
          direction: string
          setup_type: string
          entry_low: number
          entry_high: number
          stop_loss: number
          target: number
          rr_ratio: number
          confluence_score: number
          status: 'active' | 'watching' | 'triggered' | 'invalidated' | 'won' | 'lost' | 'expired'
          dol_target: string | null
          ai_analysis: string | null
          created_at: string
          htf_bias: string | null
          cisd_confirmed: boolean
          volume_context: string | null
          killzone_valid: string | null
          correlated_align: boolean
          expires_at: string | null
          invalidated_reason: string | null
          market_section: string | null
        }
      }
    }
  }
}
