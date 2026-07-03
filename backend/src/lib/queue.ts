import { Queue } from 'bullmq';
import { bullConnection } from './redis';

/**
 * Filas (lado PRODUTOR) — o backend só enfileira; quem consome são os workers.
 * Os nomes DEVEM bater com os de `workers/src/queues.ts`.
 */
export const QUEUE = {
  EXTRACTION: 'extraction',
  REGISTRATION: 'registration',
  VERIFICATION: 'verification',
} as const;

export interface UploadJob {
  uploadId: number;
}

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

let _extraction: Queue<UploadJob> | null = null;
let _registration: Queue<UploadJob> | null = null;

export function extractionQueue(): Queue<UploadJob> {
  if (!_extraction) _extraction = new Queue<UploadJob>(QUEUE.EXTRACTION, { connection: bullConnection(), defaultJobOptions: JOB_OPTS });
  return _extraction;
}

export function registrationQueue(): Queue<UploadJob> {
  if (!_registration) _registration = new Queue<UploadJob>(QUEUE.REGISTRATION, { connection: bullConnection(), defaultJobOptions: JOB_OPTS });
  return _registration;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([_extraction?.close(), _registration?.close()]);
  _extraction = null;
  _registration = null;
}
