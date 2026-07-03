/**
 * Verificação rápida de conectividade das 3 dependências.
 * Rode com: npm run check:conn
 */
import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabase';
import { getRedis, closeRedis } from '../lib/redis';
import { getPool, closePool } from '../lib/db';

async function main() {
  console.log(`\nAmbiente: ${env.NODE_ENV} | Supabase: ${env.SUPABASE_URL}\n`);

  // 1. Supabase (service_role)
  try {
    const { count, error } = await supabaseAdmin
      .from('tenants')
      .select('id', { head: true, count: 'exact' });
    if (error) throw error;
    console.log(`✓ Supabase OK — tenants: ${count ?? 0} linhas`);
  } catch (e) {
    console.error('✗ Supabase FALHOU:', (e as Error).message);
  }

  // 2. Postgres direto (se DATABASE_URL setada)
  if (env.DATABASE_URL) {
    try {
      const r = await getPool().query<{ n: number }>(
        "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
      );
      console.log(`✓ Postgres OK — tabelas no schema public: ${r.rows[0]?.n}`);
    } catch (e) {
      console.error('✗ Postgres FALHOU:', (e as Error).message);
    }
  } else {
    console.log('· Postgres: DATABASE_URL não setada (pulando)');
  }

  // 3. Redis
  try {
    const pong = await getRedis().ping();
    console.log(`✓ Redis OK — ${pong}`);
  } catch (e) {
    console.error('✗ Redis FALHOU (suba o Redis p/ os workers BullMQ):', (e as Error).message);
  }

  await closeRedis();
  await closePool();
  console.log('');
}

void main();
