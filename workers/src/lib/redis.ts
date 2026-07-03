import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env';

/**
 * Opções de conexão para o BullMQ. Passamos um objeto (host/port) em vez da
 * instância para não acoplar à versão de ioredis que o BullMQ embute.
 * `maxRetriesPerRequest: null` é EXIGIDO pelo BullMQ.
 */
function parseRedisUrl(url: string): RedisOptions {
  const u = new URL(url);
  const isTls = u.protocol === 'rediss:';
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    // rediss:// (ex.: Upstash) exige TLS — sem isso o servidor derruba a
    // conexão (ECONNRESET). Endpoints gerenciados usam certificado válido.
    ...(isTls ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

export const bullConnection: RedisOptions = parseRedisUrl(env.REDIS_URL);

/**
 * Instância ioredis dedicada — usada pelo lock distribuído (SET NX / EVAL).
 * Separada da(s) conexão(ões) que o BullMQ gerencia internamente.
 */
export const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

connection.on('error', (err) => {
  console.error('[redis] erro de conexão:', err.message);
});
