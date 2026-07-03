import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import { getRedis } from '../lib/redis';

/**
 * Healthcheck: verifica API viva + dependências (Supabase e Redis).
 * GET /health        -> liveness simples (sempre 200 se o processo responde)
 * GET /health/ready  -> readiness (checa dependências; 503 se algo está fora)
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/health/ready', async (_req, reply) => {
    const checks: Record<string, 'ok' | string> = {};

    // Supabase: 1 query leve (HEAD count) numa tabela pequena.
    try {
      const { error } = await supabaseAdmin
        .from('tenants')
        .select('id', { head: true, count: 'exact' });
      checks.supabase = error ? error.message : 'ok';
    } catch (e) {
      checks.supabase = (e as Error).message;
    }

    // Redis: ping.
    try {
      const pong = await getRedis().ping();
      checks.redis = pong === 'PONG' ? 'ok' : pong;
    } catch (e) {
      checks.redis = (e as Error).message;
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ready' : 'degraded',
      checks,
    });
  });
}
