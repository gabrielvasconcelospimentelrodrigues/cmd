import { env } from './config/env';
import { connection } from './lib/redis';
import { startExtractionWorker } from './workers/extraction.worker';
import { startRegistrationWorker } from './workers/registration.worker';
import { startVerificationWorker } from './workers/verification.worker';
import { startWatchdog, stopWatchdog } from './watchdog';
import { closeQueues } from './queues';

/**
 * Processo dos workers: sobe os 3 workers (extração, registro, verificação)
 * + o watchdog de recuperação. Um único processo Node leve segura tudo
 * (cada fila com sua concorrência), alinhado ao baixo consumo na VPS.
 */
async function main() {
  console.log(`🔧 CMD Workers iniciando | env=${env.NODE_ENV} | redis=${env.REDIS_URL}`);

  const workers = [startExtractionWorker(), startRegistrationWorker(), startVerificationWorker()];
  startWatchdog();

  console.log(
    `✅ Workers ativos: extraction(${env.EXTRACTION_CONCURRENCY}), ` +
      `registration(${env.REGISTRATION_CONCURRENCY}), verification(2) + watchdog(5min)`,
  );

  const shutdown = async (signal: string) => {
    console.log(`\nRecebido ${signal}, encerrando workers...`);
    stopWatchdog();
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
