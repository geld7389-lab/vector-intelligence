import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Database = {
  public: {
    Tables: {
      setups: {
        Row: {
          id: string
          symbol: string
          timeframe: string
          setup_type: string
          direction: 'bull' | 'bear' | 'inversion'
          confluence_score: number
          entry_low: number
          entry_high: number
          stop_loss: number
          target: number
          rr_ratio: number
          status: 'active' | 'watching' | 'triggered' | 'invalidated' | 'won' | 'lost' | 'expired'
          dol_target: string
          ai_analysis: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['setups']['Row'], 'id' | 'created_at' | 'updated_at'>
      }
      pd_arrays: {
        Row: {
          id: string
          symbol: string
          timeframe: string
          type: 'ob' | 'fvg' | 'bisi' | 'sibi' | 'iob' | 'ifvg' | 'ibrk' | 'brk'
          direction: 'bull' | 'bear'
          price_high: number
          price_low: number
          is_mitigated: boolean
          is_inverted: boolean
          created_at: string
        }
      }
      trades: {
        Row: {
          id: string
          setup_id: string | null
          symbol: string
          direction: 'long' | 'short'
          entry_price: number
          stop_loss: number
          take_profit: number
          result: 'win' | 'loss' | 'breakeven' | 'open'
          rr_achieved: number | null
          notes: string | null
          opened_at: string
          closed_at: string | null
        }
      }
      knowledge_base: {
        Row: {
          id: string
          category: string
          title: string
          content: string
          source_episode: string
          tags: string[]
          created_at: string
        }
      }
      scanner_alerts: {
        Row: {
          id: string
          symbol: string
          timeframe: string
          alert_type: string
          message: string
          severity: 'info' | 'warning' | 'critical'
          is_read: boolean
          created_at: string
        }
      }
    }
  }
}
