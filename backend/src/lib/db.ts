import { Pool } from 'pg';
import { env } from '../config/env';

/**
 * Pool de conexões Postgres direto (para queries/migrations que fogem do
 * PostgREST). Opcional: só inicializa se DATABASE_URL estiver setada.
 *
 * Dica de performance/baixo consumo: a connection string aponta para o
 * Transaction Pooler do Supabase (porta 6543), então mantemos o pool local
 * pequeno — o pooler do Supabase é quem absorve a concorrência real.
 */
let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL não configurada — pool Postgres indisponível.');
  }
  if (!_pool) {
    _pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    _pool.on('error', (err) => {
      console.error('[pg] erro inesperado em cliente ocioso:', err.message);
    });
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
