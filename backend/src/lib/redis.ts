import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env';

/**
 * Opções de conexão para o BullMQ (produtor de jobs). Passamos host/port em
 * vez da instância para não acoplar à versão de ioredis embutida no BullMQ.
 * `rediss://` (ex.: Upstash) exige TLS — senão o servidor derruba (ECONNRESET).
 */
export function bullConnection(): RedisOptions {
  const u = new URL(env.REDIS_URL);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

/**
 * Conexão Redis compartilhada. `maxRetriesPerRequest: null` é EXIGIDO pelo
 * BullMQ (os workers vão reusar esta conexão para enfileirar jobs a partir
 * da API). Lazy connect para não travar o boot se o Redis ainda não subiu.
 */
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      // Não pendura para sempre se o Redis estiver fora: limita reconexões.
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    });
    _redis.on('error', (err) => {
      console.error('[redis] erro de conexão:', err.message);
    });
  }
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    try {
      await _redis.quit();
    } catch {
      _redis.disconnect();
    }
    _redis = null;
  }
}
