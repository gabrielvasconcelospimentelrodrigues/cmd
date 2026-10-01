/**
 * Remove jobs DUPLICADOS da fila de registro.
 *
 * O watchdog reenfileira listas travadas sem checar se ja existe job para
 * elas, entao a fila acumula centenas de duplicatas — foi o que derrubou o
 * sistema em 30/09. A correcao de verdade e no watchdog, mas exige reiniciar
 * os workers; isto aqui segura o problema sem interromper ninguem.
 *
 * Mantem UM job por lista e nunca mexe nos ativos.
 */
import { Queue } from "bullmq";
import IORedis from "ioredis";
import fs from "node:fs";

const url = fs.readFileSync("/var/www/cmd-saas/workers/.env", "utf8").match(/^REDIS_URL=(.*)$/m)[1].trim();
const conn = new IORedis(url, { maxRetriesPerRequest: null });
const q = new Queue("registration", { connection: conn });

// Uma passagem so: o conjunto "vistos" nao pode sobreviver entre passagens,
// senao o job legitimo guardado numa volta e removido na seguinte.
const manter = new Set();
for (const j of await q.getJobs(["active"], 0, 50)) manter.add(String(j.data?.uploadId));

let removidos = 0;
for (const estado of ["waiting", "delayed"]) {
  for (let i = 0; i < 5000; i += 250) {
    const jobs = await q.getJobs([estado], i, i + 249);
    if (!jobs.length) break;
    for (const j of jobs) {
      const id = String(j.data?.uploadId);
      if (manter.has(id)) { await j.remove().catch(() => {}); removidos++; }
      else manter.add(id);
    }
  }
}
const c = await q.getJobCounts();
if (removidos > 0) console.log(`[${new Date().toISOString()}] duplicatas removidas: ${removidos} | ativas ${c.active}, esperando ${c.waiting}, adiadas ${c.delayed}`);
await q.close(); await conn.quit(); process.exit(0);
