import { createClient } from '@supabase/supabase-js';

// Direct hardcoded values - no env var dependency
const SUPABASE_URL = 'https://xavkbjbgmuasfkliptsh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamdtdWFzZmtsaXB0c2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjgxNTU5MiwiZXhwIjoyMDYyMzkxNTkyfQ.LMkYBBaSHNFUOm3ETy1N1PL60vVCj7kpORCBJ6mGf1M';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const supabase = sb;
