import { Worker } from 'bullmq';
import { bullConnection } from '../lib/redis';
import { QUEUE, type UploadJob, registrationQueue, verificationQueue } from '../queues';
import { env } from '../config/env';
import {
  logEntry, setUploadStatus, getUploadComConta, listarPendentes, marcarPaciente, atualizarContadores, statusDoUpload, registrarExecucao, contarStatus, acrescentarTempoAtivo, jaCadastrado, marcarDuplicados, reenfileirarErros,
} from '../lib/repo';
import { proximaJanelaPermitida } from '../scheduling';
import { withLock } from '../lib/lock';
import { decrypt } from '../lib/crypto';
import { WebAutomator, ProfessionalNotFoundError, LoginAbortadoError, type PatientData } from '../automation/web-automation';
import { getMotorConfig, MOTOR_CONFIG_PADRAO } from '../lib/motor-config';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Limites para DETECTAR TRAVAMENTO (a operação real nunca demora tanto). */
const LOGIN_TIMEOUT_MS = 150_000; // 2,5 min
const CADASTRO_TIMEOUT_MS = 360_000; // 6 min por paciente
const MAX_RONDAS_RETRY = 3; // rodadas extras refazendo os que deram erro (rumo a 100%)

class TimeoutError extends Error {}
/** Resolve a promise OU rejeita se passar de `ms` — detecta operação travada. */
function comTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(`travou (tempo limite de ${Math.round(ms / 1000)}s) em ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * REGISTRO — equivale a intake/tasks.py:registrar_pacientes_do_upload.
 * Loga no CMD-COLETA e cadastra cada paciente pendente do upload.
 *
 * Modo de operação:
 *  - AUTOMACAO_SIMULADA=true (padrão): SIMULA o cadastro (marca cada paciente),
 *    para demonstrar o fluxo enquanto o cadastro Playwright real não está
 *    validado contra o site do gov.br.
 *  - AUTOMACAO_SIMULADA=false: usa o WebAutomator (login real + cadastro).
 *
 * Regras preservadas: conta desligada não roda; janela de execução; 1 sessão
 * por conta CMD (lock); pausa/parada pelo usuário interrompe o loop.
 */
export function startRegistrationWorker(): Worker<UploadJob> {
  const worker = new Worker<UploadJob>(
    QUEUE.REGISTRATION,
    async (job) => {
      const { uploadId } = job.data;

      // Trava de entrada: se o usuário parou/pausou/excluiu este envio, NÃO
      // processa (um job atrasado/retry não pode ressuscitar um envio parado).
      // O 'iniciar' no backend zera o status para 'extracted' antes de
      // enfileirar, então um Play legítimo passa por aqui normalmente.
      const stInicial = await statusDoUpload(uploadId);
      if (stInicial === 'parado' || stInicial === 'paused') {
        await logEntry(uploadId, 'INFO', 'Envio está parado/pausado — job ignorado.');
        // Normaliza status "zumbi" (ficou 'registering' após deleção/parada no
        // meio) para não aparecer como rodando/invisível no painel.
        await setUploadStatus(uploadId, stInicial, { current_step: '' });
        return;
      }

      const upload = await getUploadComConta(uploadId);
      const conta = upload.clinic_accounts;
      if (!conta) throw new Error(`Conta CMD do upload #${uploadId} não encontrada.`);

      if (!conta.is_enabled) {
        await setUploadStatus(uploadId, 'paused');
        await logEntry(uploadId, 'WARN', 'Automação desligada nesta conta — ligue em Configurações para iniciar.');
        return;
      }

      // Janela de execução: fora dela, reagenda.
      const janela = proximaJanelaPermitida(conta);
      if (!janela.permitidoAgora) {
        const delayMs = janela.proximoHorario ? Math.max(0, janela.proximoHorario.getTime() - Date.now()) : 3_600_000;
        await setUploadStatus(uploadId, 'paused');
        await registrationQueue.add('registrar', { uploadId }, { delay: delayMs });
        await logEntry(uploadId, 'INFO', `Fora da janela. Reagendado para ${janela.proximoHorario?.toLocaleString('pt-BR') ?? '+1h'}.`);
        return;
      }

      // SERIALIZA POR CONTA CMD: duas listas da MESMA conta NÃO podem rodar ao
      // mesmo tempo — o CMD-COLETA só mantém 1 sessão por operador, então a 2ª
      // sessão DERRUBA a 1ª e nenhuma conclui. A 2ª lista espera a vez.
      const execucao = await withLock(`conta:${conta.id}`, async () => {
      const resultado = await withLock(`upload:${uploadId}`, async () => {
        const config = await getMotorConfig().catch(() => MOTOR_CONFIG_PADRAO);
        const loginTimeoutMs = config.login_timeout_segundos * 1000;
        const cadastroTimeoutMs = config.cadastro_timeout_segundos * 1000;
        const maxRondasRetry = config.max_rondas_retry;
        const automacaoSimulada = config.automacao_simulada;

        // Mede o tempo ATIVO desta sessão (exclui ociosidade entre sessões).
        const sessaoInicioMs = Date.now();
        // RETOMADA: preserva o início do registro (não reseta o tempo do
        // relatório) e CONTINUA os contadores de onde parou — não zera.
        const inicio = upload.registro_iniciado_em ?? new Date().toISOString();
        await setUploadStatus(uploadId, 'registering', { job_id: job.id ?? '', registro_iniciado_em: inicio, registro_concluido_em: null, sessao_iniciada_em: new Date().toISOString(), current_step: 'Verificando duplicidades...' });
        try {
        // ANTES de cadastrar: confere duplicados e manda-os para Pendências.
        // (Vale também quando a extração dispara o registro automaticamente.)
        const dups = await marcarDuplicados(uploadId, conta.tenant_id);
        if (dups > 0) await logEntry(uploadId, 'WARN', `${dups} duplicado(s) encontrado(s) e enviado(s) para Pendências — não serão cadastrados.`);
        const pendentes = await listarPendentes(uploadId);
        if (pendentes.length === 0) {
          await setUploadStatus(uploadId, 'done', { current_step: '', registro_concluido_em: new Date().toISOString() });
          await logEntry(uploadId, 'INFO', 'Nenhum paciente pendente.');
          return 'done';
        }

        // Conta os JÁ cadastrados a partir dos registros (fonte da verdade) —
        // assim retoma de onde parou mesmo se o contador da linha foi zerado.
        const contagem = await contarStatus(uploadId);
        let registered = contagem.registered;
        let errored = contagem.errored;
        await atualizarContadores(uploadId, registered, errored); // corrige o contador na hora
        if (registered > 0 || errored > 0) {
          await logEntry(uploadId, 'INFO', `Retomando de onde parou: ${registered} cadastrado(s), ${errored} com erro. Faltam ${pendentes.length}.`);
        }

        if (automacaoSimulada) {
          await logEntry(uploadId, 'INFO', `[SIMULAÇÃO] Iniciando cadastro de ${pendentes.length} paciente(s) (demonstração — cadastro real depende do motor + conta gov.br ativa).`);
          for (const p of pendentes) {
            if (await pausouOuParou(uploadId)) { await logEntry(uploadId, 'WARN', 'Interrompido pelo usuário.'); const real = await statusDoUpload(uploadId); await setUploadStatus(uploadId, real === 'paused' ? 'paused' : 'parado', { current_step: '' }); return 'parado'; }
            await setUploadStatus(uploadId, 'registering', { current_step: `Cadastrando ${p.nome || 'paciente'}...` });
            await sleep(700 + Math.floor(Math.random() * 500));
            if (Math.random() > 0.08) {
              await marcarPaciente(p.id, 'registered');
              await registrarExecucao({ tenantId: conta.tenant_id, empresaId: conta.empresa_id, clinicAccountId: conta.id, uploadId, patientId: p.id });
              registered++;
              await logEntry(uploadId, 'INFO', `✓ ${p.nome || p.cns} cadastrado no CMD-COLETA.`);
            } else {
              await marcarPaciente(p.id, 'error', 'O site do CMD-COLETA demorou demais para responder nesta etapa.');
              errored++;
              await logEntry(uploadId, 'WARN', `⚠ ${p.nome || p.cns} falhou — vai para Pendências.`);
            }
            await atualizarContadores(uploadId, registered, errored);
          }
        } else {
          // Automação REAL (Playwright). Cadastro por paciente ainda em port.
          await logEntry(uploadId, 'INFO', `Logando no CMD-COLETA como ${conta.cmd_username}...`);
          const automator = new WebAutomator({
            username: conta.cmd_username,
            password: decrypt(conta.cmd_password_encrypted),
            mfaSecret: decrypt(conta.mfa_secret_encrypted),
            uploadId,
            onStep: (d) => void setUploadStatus(uploadId, 'registering', { current_step: d }),
            // Corta o login no meio se o usuário parou/pausou/excluiu (sem fantasma).
            abortou: () => pausouOuParou(uploadId),
            // CID por idade (controles): 0–8 anos vs 9+ (fallback H53 dentro do motor).
            cidOci0a8: conta.cid_oci_0_8,
            cid9Mais: conta.cid_9_mais,
          });
          let precisaRetomar = false; // travou → pausa, alerta, retoma em 30s
          let abortado = false; // usuário parou/excluiu durante o login → para limpo
          try {
            await automator.start();
            try {
              await comTimeout(automator.login(), loginTimeoutMs, 'login');
            } catch (e) {
              if (e instanceof LoginAbortadoError) {
                await logEntry(uploadId, 'WARN', 'Login interrompido — envio parado/excluído pelo usuário.');
                abortado = true;
              } else {
                await logEntry(uploadId, 'WARN', `⚠ Automação ${(e as Error).message} no login. Pausando e retomando em 30s de onde parou (${registered} já cadastrado(s)).`);
                precisaRetomar = true;
              }
            }

            for (const p of pendentes) {
              if (abortado || precisaRetomar) break;
              if (await pausouOuParou(uploadId)) { await logEntry(uploadId, 'WARN', 'Interrompido pelo usuário.'); const real = await statusDoUpload(uploadId); await setUploadStatus(uploadId, real === 'paused' ? 'paused' : 'parado', { current_step: '' }); return 'parado'; }
              const pd: PatientData = {
                cns: p.cns,
                nome: p.nome,
                dataNascimento: p.data_nascimento ? new Date(p.data_nascimento) : null,
                dataAtendimento: p.data_atendimento ? new Date(p.data_atendimento) : null,
                // CID da ficha; se vazio, usa o CID padrão configurado na conta.
                cid10Codigo: (p.cid10_codigo && p.cid10_codigo.trim()) ? p.cid10_codigo : (conta.cid_padrao || ''),
                medicoNome: p.medico_nome,
                overrides: p.automation_overrides ?? {},
              };
              // DEDUP: se este CNS+data já foi cadastrado nesta conta (outra
              // lista/retomada), NÃO cadastra de novo — manda para Pendências
              // como duplicado, para tratamento manual (envio manual).
              if (await jaCadastrado(conta.id, p.cns, p.data_atendimento, p.id)) {
                await marcarPaciente(p.id, 'needs_review', 'Cadastro duplicado — mesmo CNS já cadastrado nesta data de atendimento.');
                await logEntry(uploadId, 'WARN', `${p.nome || p.cns}: duplicado (mesmo CNS+data) — enviado para Pendências.`);
                await atualizarContadores(uploadId, registered, errored);
                continue;
              }
              let r: { ok: boolean; erro?: string };
              try {
                r = await comTimeout(cadastrarComRetry(automator, pd, uploadId), cadastroTimeoutMs, 'cadastro');
              } catch (e) {
                // Esse paciente TRAVOU. Recupera a sessão p/ os próximos e o
                // manda para Pendências (não congela o lote inteiro).
                await logEntry(uploadId, 'WARN', `⚠ ${p.nome || p.cns} ${(e as Error).message}. Recuperando a sessão e seguindo.`);
                await comTimeout(automator.recuperarParaContatos(), 30_000, 'recuperar').catch(() => { precisaRetomar = true; });
                r = { ok: false, erro: `Cadastro travou: ${(e as Error).message}` };
              }
              if (r.ok) {
                await marcarPaciente(p.id, 'registered');
                await registrarExecucao({ tenantId: conta.tenant_id, empresaId: conta.empresa_id, clinicAccountId: conta.id, uploadId, patientId: p.id });
                registered++;
                await logEntry(uploadId, 'INFO', `✓ ${p.nome || p.cns} cadastrado no CMD-COLETA.`);
              } else {
                await marcarPaciente(p.id, 'error', (r.erro || 'erro').slice(0, 240));
                errored++;
                await logEntry(uploadId, 'WARN', `⚠ ${p.nome || p.cns}: ${(r.erro || '').slice(0, 160)} — foi para Pendências.`);
              }
              await atualizarContadores(uploadId, registered, errored);
            }
          } catch (fatal) {
            // Erro fatal inesperado (navegador caiu, etc.) → retoma em 30s.
            await logEntry(uploadId, 'WARN', `⚠ Automação travou (${(fatal as Error).message.slice(0, 120)}). Retomando em 30s de onde parou (${registered} cadastrado(s)).`);
            precisaRetomar = true;
          } finally {
            await automator.close();
          }

          if (abortado) {
            // Parada/exclusão no meio do login: normaliza o status e ENCERRA
            // (não reenfileira) — nada de fantasma rodando.
            const real = await statusDoUpload(uploadId);
            await setUploadStatus(uploadId, real === 'paused' ? 'paused' : 'parado', { current_step: '' });
            return 'parado';
          }

          if (precisaRetomar) {
            // PAUSA + ALERTA + 30s + CONTINUA de onde parou (contadores e tempo
            // preservados; só os pacientes pendentes serão processados).
            await setUploadStatus(uploadId, 'registering', { current_step: 'Travou — retomando em 30s de onde parou…' });
            await registrationQueue.add('registrar', { uploadId }, { delay: 30_000 });
            return 'retomando';
          }
        }

        // RETRY até 100%: ao terminar, se sobraram erros, refaz numa rodada
        // extra (novo login + só os que erraram). Limitado a maxRondasRetry
        // para não repetir eternamente erros de dado (CID/nascimento ausente).
        const cont = await contarStatus(uploadId);
        await atualizarContadores(uploadId, cont.registered, cont.errored);
        if (cont.errored > 0 && (upload.retry_rounds ?? 0) < maxRondasRetry && !(await pausouOuParou(uploadId))) {
          const reset = await reenfileirarErros(uploadId);
          if (reset > 0) {
            const ronda = (upload.retry_rounds ?? 0) + 1;
            await setUploadStatus(uploadId, 'registering', { current_step: `Refazendo ${reset} ficha(s) com erro para chegar a 100%…`, retry_rounds: ronda });
            await registrationQueue.add('registrar', { uploadId }, { delay: 3000 });
            await logEntry(uploadId, 'INFO', `Rodada extra ${ronda}/${maxRondasRetry}: refazendo ${reset} que deram erro.`);
            return 'refazendo';
          }
        }

        await setUploadStatus(uploadId, 'done', { current_step: '', registro_concluido_em: new Date().toISOString() });
        await logEntry(uploadId, 'INFO', `Concluído: ${cont.registered} cadastrado(s)${cont.errored ? `, ${cont.errored} com erro (após ${upload.retry_rounds ?? 0} rodada(s) extra)` : ' — 100% ✓'}.`);
        return 'done';
        } finally {
          // Acumula o tempo ativo desta sessão (em qualquer saída: done/parado/
          // retomando/erro) e zera o marcador de sessão.
          await acrescentarTempoAtivo(uploadId, (Date.now() - sessaoInicioMs) / 1000);
        }
      });
      return resultado;
      }); // fecha o lock por conta CMD

      if (execucao === 'locked') {
        // Conta CMD ocupada por OUTRA lista (ou job duplicado desta) — espera a
        // vez. Sai de 'registering' para 'extracted' para o WATCHDOG NÃO
        // re-enfileirar em loop, e re-agenda com jobId FIXO (dedupe: BullMQ
        // ignora um 2º job atrasado com o mesmo id) para não empilhar jobs.
        const st = await statusDoUpload(uploadId);
        if (st !== 'paused' && st !== 'parado') {
          await setUploadStatus(uploadId, 'extracted', { current_step: 'Na fila — aguardando a conta CMD liberar…' });
        }
        await registrationQueue.add('registrar', { uploadId }, { delay: 45_000, jobId: `wait-conta-${uploadId}` });
        return;
      }
      if (execucao === 'done') {
        await verificationQueue.add('verificar', { uploadId }, { delay: 10_000 });
      }
    },
    { connection: bullConnection, concurrency: env.REGISTRATION_CONCURRENCY, lockDuration: 120_000 },
  );

  worker.on('failed', (job, err) => {
    const id = job?.data.uploadId;
    if (id) void setUploadStatus(id, 'registration_failed', { current_step: '' });
    console.error(`[registration] upload #${id} falhou:`, err.message);
  });

  return worker;
}

/**
 * Cadastra um paciente com a estratégia de resiliência do sistema antigo
 * (intake/tasks.py): 3 tentativas com recuperação de página crescente.
 *  1ª: tenta direto.
 *  - ProfessionalNotFoundError → erro de DADOS (médico não existe), não adianta
 *    repetir; só recupera a página e desiste.
 *  2ª: erro de UI/timing → volta para 'Contatos Assistenciais' e tenta de novo.
 *  3ª: persistiu → desloga/loga de novo (sessão degradada) e tenta a última vez.
 * Sem essa recuperação entre pacientes, um único erro deixa a página presa no
 * formulário e TODOS os próximos falham no primeiro clique (cascata).
 */
async function cadastrarComRetry(automator: WebAutomator, pd: PatientData, uploadId: number): Promise<{ ok: boolean; erro?: string }> {
  const quem = pd.nome || pd.cns;
  // 1ª tentativa
  try {
    await automator.incluirContato(pd);
    return { ok: true };
  } catch (e) {
    // DEBUG: fotografa a tela no 1º erro para vermos qual campo travou.
    await automator.capturarDebug(quem).catch(() => {});
    if (e instanceof ProfessionalNotFoundError) {
      await automator.recuperarParaContatos();
      return { ok: false, erro: (e as Error).message };
    }
    await logEntry(uploadId, 'WARN', `${quem}: ${(e as Error).message.slice(0, 110)} — voltando à lista e tentando de novo (2ª).`);
  }
  // 2ª tentativa: recupera a página e repete
  await automator.recuperarParaContatos();
  try {
    await automator.incluirContato(pd);
    await logEntry(uploadId, 'INFO', `${quem}: ok na 2ª tentativa.`);
    return { ok: true };
  } catch (e) {
    await logEntry(uploadId, 'WARN', `${quem}: persistiu (${(e as Error).message.slice(0, 80)}) — sessão nova (relogin), 3ª tentativa.`);
  }
  // 3ª tentativa: relogin e última tentativa
  try {
    await automator.relogar();
    await automator.incluirContato(pd);
    await logEntry(uploadId, 'INFO', `${quem}: ok na 3ª tentativa (sessão nova).`);
    return { ok: true };
  } catch (e) {
    await automator.recuperarParaContatos();
    return { ok: false, erro: (e as Error).message };
  }
}

/** Detecta se o usuário pausou/parou o envio (entre pacientes). */
async function pausouOuParou(uploadId: number): Promise<boolean> {
  const st = await statusDoUpload(uploadId);
  return st === 'paused' || st === 'parado';
}
