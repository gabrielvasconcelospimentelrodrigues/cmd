import { supabaseAdmin } from './lib/supabase';
import { connection } from './lib/redis';
import { registrationQueue, verificationQueue } from './queues';
import { logEntry } from './lib/repo';

/**
 * Recupera uploads travados em 'registering' (ex.: restart do container no
 * meio de uma execução) reenfileirando-os. Porta de
 * cmdsaas/celery.py:_recuperar_uploads_travados + watchdog_uploads_travados.
 *
 * Rodamos uma vez no boot e depois a cada 5 minutos.
 */
export async function recuperarUploadsTravados(): Promise<void> {
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
}

let timer: NodeJS.Timeout | null = null;

export function startWatchdog(): void {
  // Primeira passada após 10s; depois a cada 5 min (igual ao Django).
  setTimeout(() => void recuperarUploadsTravados(), 10_000);
  timer = setInterval(() => void recuperarUploadsTravados(), 5 * 60_000);
}

export function stopWatchdog(): void {
  if (timer) clearInterval(timer);
}
