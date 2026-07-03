import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import type { Database } from '../types/database';

/**
 * Client administrativo (service_role) — usa a chave secreta, IGNORA RLS.
 * Use SOMENTE no backend/workers, nunca exponha ao cliente.
 *
 * Sem sessão persistida nem refresh de token: é um serviço stateless.
 */
export const supabaseAdmin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
