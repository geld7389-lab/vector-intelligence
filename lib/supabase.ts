import { createClient } from '@supabase/supabase-js';

// Direct hardcoded values - no env var dependency
const SUPABASE_URL = 'https://xavkbjbgmuasfkliptsh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdmtiamJnbXVhc2ZrbGlwdHNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNTAzOTIsImV4cCI6MjA5MzkyNjM5Mn0.GJgxNwP6LfphbHTijGhrHK5DMpDcarJin2bVmoxU4bo';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const supabase = sb;
