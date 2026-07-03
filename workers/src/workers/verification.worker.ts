import { Worker } from 'bullmq';
import { bullConnection } from '../lib/redis';
import { QUEUE, type UploadJob } from '../queues';
import { logEntry, setUploadStatus } from '../lib/repo';

/**
 * VERIFICAÇÃO — equivale a intake/tasks.py:verificar_pacientes_do_upload.
 * Reabre o CMD-COLETA e confere se cada paciente cadastrado bateu (marca
 * verified_ok / verified_divergent).
 *
 * ⚠️ Lógica de conferência a portar de automation_engine/web_automation.py.
 */
export function startVerificationWorker(): Worker<UploadJob> {
  const worker = new Worker<UploadJob>(
    QUEUE.VERIFICATION,
    async (job) => {
      const { uploadId } = job.data;
      await logEntry(uploadId, 'INFO', 'Iniciando verificação dos cadastros.');

      // TODO(port): conferir cada patient_record 'registered' no CMD-COLETA
      //   -> verified_ok | verified_divergent (preencher divergencias[])
      await logEntry(uploadId, 'WARN', 'Verificação ainda não implementada (esqueleto).');

      await setUploadStatus(uploadId, 'done', { current_step: '' });
    },
    { connection: bullConnection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[verification] upload #${job?.data.uploadId} falhou:`, err.message);
  });

  return worker;
}
