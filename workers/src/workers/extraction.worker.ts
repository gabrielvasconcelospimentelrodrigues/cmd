import { Worker } from 'bullmq';
import { bullConnection } from '../lib/redis';
import { QUEUE, type UploadJob, registrationQueue } from '../queues';
import { env } from '../config/env';
import { logEntry, setUploadStatus, getUploadComConta, baixarArquivo, inserirPacientes } from '../lib/repo';
import { extrairPacientes } from '../extractors';

/**
 * EXTRAÇÃO — baixa o arquivo tabular (CSV/Excel/XML) do Storage, extrai os
 * pacientes e cria os patient_records. Ao final, agenda o REGISTRO
 * respeitando o delay_inicio_minutos da clínica.
 * (Substitui intake/tasks.py:processar_upload — sem OCR/IA, só tabelas.)
 */
export function startExtractionWorker(): Worker<UploadJob> {
  const worker = new Worker<UploadJob>(
    QUEUE.EXTRACTION,
    async (job) => {
      const { uploadId } = job.data;
      await setUploadStatus(uploadId, 'extracting', { current_step: 'Analisando e mapeando a planilha...' });
      await logEntry(uploadId, 'INFO', 'Iniciando extração do arquivo.');

      const upload = await getUploadComConta(uploadId);
      if (!upload.file_path) throw new Error('Upload sem file_path.');

      // Baixa e extrai.
      const buffer = await baixarArquivo(upload.file_path);
      const filename = upload.file_path.split('/').pop() ?? upload.file_path;
      const pacientes = await extrairPacientes(buffer, filename, upload.mapeamento_campos ?? {});

      if (!pacientes.length) {
        await setUploadStatus(uploadId, 'extraction_failed', { patients_found: 0 });
        await logEntry(uploadId, 'WARN', 'Nenhum paciente encontrado no arquivo.');
        return;
      }

      await setUploadStatus(uploadId, 'extracting', { current_step: 'Verificando dados obrigatórios...' });
      const total = await inserirPacientes(uploadId, upload.clinic_account_id, pacientes);
      const incertos = pacientes.filter((p) => p.status === 'needs_review').length;
      await setUploadStatus(uploadId, 'extracted', { patients_found: total, current_step: 'Aguardando cadastro...' });
      await logEntry(
        uploadId,
        'INFO',
        `Extração concluída: ${total} paciente(s)${incertos ? `, ${incertos} para revisão manual` : ''}.`,
      );

      // Agenda o registro respeitando o delay da clínica.
      const conta = upload.clinic_accounts;
      const delayMin = conta?.delay_inicio_minutos ?? 0;
      await registrationQueue.add('registrar', { uploadId }, { delay: delayMin * 60_000 });
      await logEntry(uploadId, 'INFO', `Registro agendado em ${delayMin} min.`);
    },
    { connection: bullConnection, concurrency: env.EXTRACTION_CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    const id = job?.data.uploadId;
    if (id) void setUploadStatus(id, 'extraction_failed', { current_step: '' });
    console.error(`[extraction] upload #${id} falhou:`, err.message);
  });

  return worker;
}
