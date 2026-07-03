import { Queue } from 'bullmq';
import { bullConnection } from './lib/redis';

/**
 * Filas ISOLADas por etapa do pipeline de automação. Cada uma tem seu próprio
 * worker e concorrência, então uma fila lenta (registro web via browser) não
 * trava as outras (extração, verificação).
 */
export const QUEUE = {
  EXTRACTION: 'extraction',
  REGISTRATION: 'registration',
  VERIFICATION: 'verification',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** Payload padrão dos jobs — sempre giramos em torno de um upload. */
export interface UploadJob {
  uploadId: number;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export const extractionQueue = new Queue<UploadJob>(QUEUE.EXTRACTION, { connection: bullConnection, defaultJobOptions });
export const registrationQueue = new Queue<UploadJob>(QUEUE.REGISTRATION, { connection: bullConnection, defaultJobOptions });
export const verificationQueue = new Queue<UploadJob>(QUEUE.VERIFICATION, { connection: bullConnection, defaultJobOptions });

export async function closeQueues(): Promise<void> {
  await Promise.all([extractionQueue.close(), registrationQueue.close(), verificationQueue.close()]);
}
