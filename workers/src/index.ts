import { execFile } from 'node:child_process';
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
/**
 * Mata navegadores Chromium órfãos. Um worker que acabou de subir NÃO tem
 * navegador legítimo ainda — qualquer Chromium presente é zumbi de um restart
 * anterior: o `pm2 restart` mata o Node com SIGKILL após ~1,6s (kill_timeout),
 * antes de um cadastro longo terminar, e os navegadores que o Playwright abriu
 * ficam órfãos (reparentados ao init) consumindo RAM até esgotar (→ OOM → todo
 * login novo trava). Rodar isto no boot bane o acúmulo entre restarts.
 */
function matarNavegadoresOrfaos(): Promise<void> {
  return new Promise((resolve) => {
    // Best-effort; só existe Chromium de automação nesta VPS. -f casa a linha
    // de comando dos processos headless do Playwright.
    execFile('pkill', ['-9', '-f', 'chrome.*--headless|chromium.*--headless|chrome-headless'], () => resolve());
    setTimeout(resolve, 4000);
  });
}

async function main() {
  console.log(`🔧 CMD Workers iniciando | env=${env.NODE_ENV} | redis=${env.REDIS_URL}`);

  await matarNavegadoresOrfaos(); // limpa zumbis de restarts anteriores

  const workers = [startExtractionWorker(), startRegistrationWorker(), startVerificationWorker()];
  startWatchdog();

  console.log(
    `✅ Workers ativos: extraction(${env.EXTRACTION_CONCURRENCY}), ` +
      `registration(${env.REGISTRATION_CONCURRENCY}), verification(2) + watchdog(5min)`,
  );

  const shutdown = async (signal: string) => {
    console.log(`\nRecebido ${signal}, encerrando workers...`);
    stopWatchdog();
    // Fecha os workers com um TETO de tempo: um cadastro pode levar minutos e o
    // pm2 mata na força em ~1,6s de qualquer jeito — não adianta esperar. Depois
    // mata os navegadores explicitamente para não deixá-los órfãos.
    await Promise.race([
      Promise.all(workers.map((w) => w.close())),
      new Promise((r) => setTimeout(r, 1200)),
    ]);
    await matarNavegadoresOrfaos();
    await closeQueues().catch(() => {});
    await connection.quit().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
