import { supabaseAdmin } from './lib/supabase';
import { connection } from './lib/redis';
import { registrationQueue, verificationQueue } from './queues';
import { logEntry } from './lib/repo';
import { getMotorConfig } from './lib/motor-config';

let ultimoRun = 0;

/**
 * Recupera uploads travados em 'registering' (ex.: restart do container no
 * meio de uma execução) reenfileirando-os. Porta de
 * cmdsaas/celery.py:_recuperar_uploads_travados + watchdog_uploads_travados.
 *
 * Rodamos de forma dinâmica conforme configurado no banco.
 */
export async function recuperarUploadsTravados(forcar = false): Promise<void> {
  try {
    // ANTI-ÓRFÃ (roda SEMPRE, a cada 30s — fora do gate de 5 min): listas presas
    // em 'extracted' "aguardando a conta CMD" precisam de um job de espera. O
    // re-enqueue usa jobId FIXO (wait-conta-N): se já existe um job, o BullMQ
    // ignora (não empilha); se o job foi perdido (órfã), re-adiciona e recupera.
    const { data: aguardando } = await supabaseAdmin
      .from('uploads')
      .select('id')
      .eq('status', 'extracted')
      .is('deleted_at', null)
      .ilike('current_step', '%aguardando a conta%');
    for (const up of (aguardando ?? [])) {
      await registrationQueue.add('registrar', { uploadId: up.id }, { delay: 3_000, jobId: `wait-conta-${up.id}`, removeOnComplete: true, removeOnFail: true }).catch(() => {});
    }

    const config = await getMotorConfig().catch(() => ({ watchdog_interval_minutos: 5 }));
    const agora = Date.now();
    if (!forcar && (agora - ultimoRun < config.watchdog_interval_minutos * 60_000)) {
      return;
    }
    ultimoRun = agora;

    const { data: travados, error } = await supabaseAdmin
      .from('uploads')
      .select('id, status, clinic_account_id')
      .in('status', ['registering'])
      .is('deleted_at', null);

    if (error) {
      console.error('[watchdog] erro ao buscar travados:', error.message);
      return;
    }
    if (!travados?.length) return;

    for (const up of travados) {
      // Se o lock DESTA lista está ativo, um worker está REALMENTE processando
      // ela agora (registro longo é normal: centenas de pacientes × ~30s).
      // Só recupera quando o lock NÃO existe = ninguém processando (worker morreu).
      // O lock é crash-resiliente (TTL 90s renovado), então expira logo se cair.
      const lockAtivo = await connection.exists(`lock:upload:${up.id}`);
      if (lockAtivo) continue;

      // Sessão morreu sem rodar o finally (crash/restart) → limpa o marcador de
      // sessão para o tempo do relatório não inflar com a ociosidade. O tempo
      // ativo já acumulado fica preservado; a nova sessão recomeça a contar.
      await supabaseAdmin.from('uploads').update({ sessao_iniciada_em: null }).eq('id', up.id);

      const { count: pendentes } = await supabaseAdmin
        .from('patient_records')
        .select('id', { head: true, count: 'exact' })
        .eq('upload_id', up.id)
        .eq('status', 'pending_registration');

      if ((pendentes ?? 0) === 0) {
        await verificationQueue.add('verificar', { uploadId: up.id }, { delay: 5_000 });
        await logEntry(up.id, 'WARN', '[RECUPERAÇÃO] Travado em registering sem pendentes — reenfileirado p/ verificação.');
      } else {
        await registrationQueue.add('registrar', { uploadId: up.id }, { delay: 5_000 });
        await logEntry(up.id, 'WARN', `[RECUPERAÇÃO] Travado em registering (${pendentes} pendentes) — reenfileirado p/ registro.`);
      }
    }
    console.warn(`[watchdog] ${travados.length} upload(s) travado(s) recuperado(s).`);
  } catch (err) {
    console.error('[watchdog] erro fatal:', err);
  }
}

let timer: NodeJS.Timeout | null = null;

export function startWatchdog(): void {
  // Primeira passada após 10s forçada
  setTimeout(() => void recuperarUploadsTravados(true), 10_000);
  // Roda uma checagem rápida a cada 30 segundos para verificar se passou o intervalo dinâmico
  timer = setInterval(() => void recuperarUploadsTravados(), 30_000);
}

export function stopWatchdog(): void {
  if (timer) clearInterval(timer);
}
