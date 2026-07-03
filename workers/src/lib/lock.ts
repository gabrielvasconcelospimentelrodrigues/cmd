import { connection } from './redis';

/**
 * Lock distribuído por CHAVE. Usado por LISTA (upload), não mais por conta CMD:
 * o CMD-COLETA aceita múltiplas sessões do mesmo usuário, então várias listas
 * podem rodar EM PARALELO (inclusive no mesmo login/terminal). O lock por lista
 * só impede processar a MESMA lista duas vezes ao mesmo tempo (jobs duplicados).
 *
 * Resiliência a crash: TTL curto renovado periodicamente enquanto fn() roda.
 * Se o processo morre, ninguém renova e o lock expira em poucos segundos
 * (o watchdog então recupera a lista de onde parou).
 */
const LOCK_TTL_MS = 90_000; // expira rápido se o dono morrer
const RENEW_EVERY_MS = 30_000; // renova com folga (1/3 do TTL)

export async function withLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T | 'locked'> {
  const key = `lock:${lockKey}`;
  const token = `${process.pid}:${Date.now()}`;
  const acquired = await connection.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
  if (!acquired) return 'locked';

  // Renova o lock enquanto formos o dono (heartbeat). Para na hora que fn() sai.
  const renewLua = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
  const timer = setInterval(() => {
    void connection.eval(renewLua, 1, key, token, String(LOCK_TTL_MS)).catch(() => {});
  }, RENEW_EVERY_MS);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
    // Só libera se ainda formos o dono do lock (evita liberar o de outro).
    const delLua = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
    await connection.eval(delLua, 1, key, token).catch(() => {});
  }
}
