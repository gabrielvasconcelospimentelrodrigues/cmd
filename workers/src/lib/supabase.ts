import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

/**
 * Client service_role — workers leem/escrevem o banco livremente (ignora RLS).
 */
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
