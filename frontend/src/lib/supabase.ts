import { createClient } from '@supabase/supabase-js';

// Fallback com os valores públicos (a anon key é pública por design — o RLS
// protege os dados) para o app funcionar mesmo se a env não estiver setada.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'https://zszlhuwdtqahfjlxpjxw.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzemxodXdkdHFhaGZqbHhwanh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MTY5NjAsImV4cCI6MjA5ODE5Mjk2MH0.EU1ZS5RldxFdTDLnMD0jJ4_4SDr_zzi_3ympratidXk',
);
