import { execFile } from 'node:child_process';

/**
 * FAXINEIRO DE NAVEGADORES ÓRFÃOS (auto-limpeza contínua).
 *
 * Cada cadastro abre um Chromium (Playwright), filho do processo do worker.
 * Se o worker morre (pm2 SIGKILL num restart, crash), o Chromium NÃO morre
 * junto — o Linux o "adota" (reparenta para o init, PID 1) e ele fica vivo
 * consumindo RAM até esgotar (→ OOM → todo login novo trava). Já vimos 97
 * desses acumulados.
 *
 * Sinal PRECISO de órfão: PPID == 1. Um navegador ATIVO tem como pai o worker
 * (PPID = pid do node), então nunca é morto por engano; só os adotados pelo
 * init (sem dono) caem. Roda a cada ciclo do watchdog — auto-cura sem ninguém
 * precisar entrar na VPS.
 *
 * No-op fora do Linux (dev no Windows/Mac) — lá o pgrep/ps não têm o mesmo
 * formato e não há navegadores de produção para limpar.
 */
export function matarNavegadoresOrfaos(): Promise<number> {
  return new Promise((resolve) => {
    if (process.platform !== 'linux') return resolve(0);
    // Lista pid/ppid/comando e filtra: comando é chrome/chromium E ppid==1.
    execFile('bash', ['-c',
      "ps -eo pid=,ppid=,comm= | awk '$2==1 && $3 ~ /chrome|chromium/ {print $1}'",
    ], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve(0);
      const pids = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!pids.length) return resolve(0);
      execFile('kill', ['-9', ...pids], { timeout: 5000 }, () => {
        console.warn(`[reaper] matou ${pids.length} navegador(es) órfão(s): ${pids.join(', ')}`);
        resolve(pids.length);
      });
    });
  });
}
