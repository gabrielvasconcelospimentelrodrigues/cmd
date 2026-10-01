/**
 * Saude da fila de registro: remove DUPLICATAS e recoloca listas ESQUECIDAS.
 *
 * Dois defeitos do motor que este script contem sem precisar reiniciar nada:
 *
 * 1) O watchdog reenfileira lista travada sem checar se ela ja tem job, entao
 *    a fila acumula centenas de duplicatas (chegou a 1.647 em 30/09 e derrubou
 *    o sistema).
 *
 * 2) Uma lista pode ficar SEM job nenhum, sem estar pausada — aconteceu com a
 *    217 e depois com a 225, que passou a madrugada parada com 706 fichas
 *    pendentes enquanto havia vaga livre. Some da fila e ninguem percebe.
 *
 * A correcao de raiz e no worker e exige reinicio; isto roda por cron a cada
 * 10 min sem interromper ninguem. Usa a API REST do Supabase de proposito: o
 * pacote dos workers nao tem driver de Postgres, e nao vale instalar um so
 * para isto.
 */
import { Queue } from "bullmq";
import IORedis from "ioredis";
import fs from "node:fs";

const env = fs.readFileSync("/var/www/cmd-saas/workers/.env", "utf8");
const pegar = (k) => env.match(new RegExp("^" + k + "=(.*)$", "m"))?.[1]?.trim();

const conn = new IORedis(pegar("REDIS_URL"), { maxRetriesPerRequest: null });
const q = new Queue("registration", { connection: conn });

// ---- 1. duplicatas -------------------------------------------------------
// Uma passagem so: reaproveitar o conjunto entre passagens apagaria o job
// legitimo guardado na volta anterior.
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

// ---- 2. listas esquecidas ------------------------------------------------
let recolocadas = 0;
try {
  const url = pegar("SUPABASE_URL");
  const key = pegar("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${url}/rest/v1/uploads?select=id,patients_found,patients_registered,patients_errored,status&deleted_at=is.null&status=in.(registering,extracted)`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const listas = await r.json();
  for (const u of Array.isArray(listas) ? listas : []) {
    const falta = u.patients_found - u.patients_registered - u.patients_errored;
    if (falta <= 0) continue;
    const id = String(u.id);
    // Pausada/parada no Redis = de proposito; nao recoloca.
    if (await conn.exists(`ctrl:pause:${id}`)) continue;
    if (await conn.exists(`ctrl:stop:${id}`)) continue;
    if (manter.has(id)) continue;
    await q.add("registrar", { uploadId: Number(id) });
    manter.add(id);
    recolocadas++;
  }
} catch (e) {
  console.log(`[${new Date().toISOString()}] falha ao checar listas esquecidas: ${e.message}`);
}

const c = await q.getJobCounts();
if (removidos > 0 || recolocadas > 0) {
  console.log(`[${new Date().toISOString()}] duplicatas: ${removidos} | listas recolocadas: ${recolocadas} | ativas ${c.active}, esperando ${c.waiting}`);
}
await q.close(); await conn.quit(); process.exit(0);
