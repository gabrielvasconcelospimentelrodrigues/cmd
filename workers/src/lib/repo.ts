import { supabaseAdmin } from './supabase';
import type { JanelaConfig } from '../scheduling';

/** Dados da conta CMD necessários ao registro (credenciais + janela). */
export interface ContaInfo extends JanelaConfig {
  id: number;
  tenant_id: number;
  empresa_id: number | null;
  is_enabled: boolean;
  cmd_username: string;
  cmd_password_encrypted: string;
  mfa_secret_encrypted: string;
  cid_padrao: string; // CID-10 padrão (fallback quando a ficha não tem CID)
  // Controles clínicos: CID por idade (calculado pela data de nascimento na automação).
  cid_oci_0_8: string; // OCI de 0 a 8 anos
  cid_9_mais: string; // acima de 9 anos
  delay_inicio_minutos: number;
}

export interface UploadComConta {
  id: number;
  status: string;
  clinic_account_id: number;
  file_path: string;
  mapeamento_campos: Record<string, string>;
  // Para retomar de onde parou (preserva contadores e o início do registro):
  patients_registered: number;
  patients_errored: number;
  registro_iniciado_em: string | null;
  retry_rounds: number;
  clinic_accounts: ContaInfo | null;
}

/** Grava uma linha de log visível no painel (equivalente ao _log do Django). */
export async function logEntry(uploadId: number, level: string, message: string): Promise<void> {
  await supabaseAdmin.from('log_entries').insert({ upload_id: uploadId, level, message });
}

/** Atualiza status (e opcionalmente o passo atual) de um upload. */
export async function setUploadStatus(
  uploadId: number,
  status: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await supabaseAdmin.from('uploads').update({ status, ...patch }).eq('id', uploadId);
}

/** Baixa o arquivo do upload do Supabase Storage como Buffer. */
export async function baixarArquivo(filePath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from('uploads').download(filePath);
  if (error || !data) throw new Error(`Falha ao baixar '${filePath}': ${error?.message ?? 'vazio'}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Insere os patient_records extraídos. Retorna quantos foram criados. */
export async function inserirPacientes(
  uploadId: number,
  clinicAccountId: number,
  pacientes: Array<{
    nome: string;
    cns: string;
    data_nascimento: string | null;
    data_atendimento: string | null;
    cid10_codigo: string;
    medico_nome: string;
    modalidade?: 'oci' | 'catarata';
    extraction_method: Record<string, string>;
    campos_incertos: string[];
    status: 'ok' | 'needs_review';
  }>,
): Promise<number> {
  if (!pacientes.length) return 0;
  const rows = pacientes.map((p) => ({
    upload_id: uploadId,
    clinic_account_id: clinicAccountId,
    nome: p.nome,
    cns: p.cns,
    data_nascimento: p.data_nascimento,
    data_atendimento: p.data_atendimento,
    cid10_codigo: p.cid10_codigo,
    medico_nome: p.medico_nome,
    modalidade: p.modalidade ?? 'oci',
    extraction_method: p.extraction_method,
    campos_incertos: p.campos_incertos,
    // 'ok' -> pronto para registrar; 'needs_review' -> revisão manual antes.
    status: p.status === 'ok' ? 'pending_registration' : 'needs_review',
  }));
  const { error } = await supabaseAdmin.from('patient_records').insert(rows);
  if (error) throw new Error(`Falha ao inserir patient_records: ${error.message}`);
  return rows.length;
}

/** Pacientes pendentes de registro de um upload. */
export interface PendentePaciente {
  id: number;
  nome: string;
  cns: string;
  data_nascimento: string | null;
  data_atendimento: string | null;
  cid10_codigo: string;
  medico_nome: string;
  modalidade: 'oci' | 'catarata' | null;
  automation_overrides: Record<string, string> | null;
}

export async function listarPendentes(uploadId: number): Promise<PendentePaciente[]> {
  const { data } = await supabaseAdmin
    .from('patient_records')
    .select('id, nome, cns, data_nascimento, data_atendimento, cid10_codigo, medico_nome, modalidade, automation_overrides')
    .eq('upload_id', uploadId)
    .eq('status', 'pending_registration')
    .order('id', { ascending: true });
  return (data ?? []) as unknown as PendentePaciente[];
}

/** Deduplicação: já existe cadastro do MESMO CNS + data de atendimento + MESMA
 * modalidade nesta conta CMD? Evita cadastrar o mesmo paciente 2x no gov.
 * A modalidade entra na chave por causa da CATARATA: o paciente opera os dois
 * olhos em DIAS SEPARADOS (faturados à parte), então mesmo CNS em DATAS
 * diferentes NÃO é duplicidade — só é duplicado se for a MESMA data (mesmo
 * olho/dia). E catarata nunca colide com OCI (modalidade diferente). */
export async function jaCadastrado(clinicAccountId: number, cns: string, dataAtendimento: string | null, excludePatientId: number, modalidade: string = 'oci'): Promise<boolean> {
  if (!cns || !dataAtendimento) return false;
  const { count } = await supabaseAdmin
    .from('patient_records')
    .select('id', { head: true, count: 'exact' })
    .eq('clinic_account_id', clinicAccountId)
    .eq('cns', cns)
    .eq('data_atendimento', dataAtendimento)
    .eq('modalidade', modalidade === 'catarata' ? 'catarata' : 'oci')
    .in('status', ['registered', 'verified_ok', 'verified_divergent'])
    .neq('id', excludePatientId);
  return (count ?? 0) > 0;
}

/** Verifica os duplicados da lista ANTES de cadastrar: um pendente é duplicado
 * se o mesmo CNS + data já está cadastrado (em outra ficha do assinante) OU se
 * repete dentro da própria lista. Os duplicados vão para PENDÊNCIAS
 * (needs_review) para tratamento manual. Retorna quantos foram marcados. */
export async function marcarDuplicados(uploadId: number, tenantId: number): Promise<number> {
  // Chave de dedup = CNS + data + MODALIDADE. Para CATARATA, os dois olhos são
  // operados em DATAS diferentes (faturados à parte) → datas diferentes NÃO são
  // duplicidade; só a MESMA data conta. A modalidade na chave também impede
  // catarata colidir com OCI.
  const mod = (m: string | null | undefined) => (m === 'catarata' ? 'catarata' : 'oci');
  const { data: pend } = await supabaseAdmin
    .from('patient_records')
    .select('id, cns, data_atendimento, modalidade')
    .eq('upload_id', uploadId)
    .eq('status', 'pending_registration')
    .order('id', { ascending: true });
  const pendentes = (pend ?? []) as { id: number; cns: string | null; data_atendimento: string | null; modalidade: string | null }[];
  if (pendentes.length === 0) return 0;

  const { data: cas } = await supabaseAdmin.from('clinic_accounts').select('id').eq('tenant_id', tenantId);
  const caIds = (cas ?? []).map((c) => c.id);
  const jaCad = new Set<string>();
  if (caIds.length > 0) {
    const { data: reg } = await supabaseAdmin
      .from('patient_records')
      .select('cns, data_atendimento, modalidade')
      .in('clinic_account_id', caIds)
      .in('status', ['registered', 'verified_ok', 'verified_divergent', 'done_manually']);
    for (const r of (reg ?? []) as { cns: string | null; data_atendimento: string | null; modalidade: string | null }[]) {
      if (r.cns && r.data_atendimento) jaCad.add(`${r.cns}|${r.data_atendimento}|${mod(r.modalidade)}`);
    }
  }

  const vistos = new Set<string>();
  const dupIds: number[] = [];
  for (const p of pendentes) {
    if (!p.cns || !p.data_atendimento) continue;
    const chave = `${p.cns}|${p.data_atendimento}|${mod(p.modalidade)}`;
    if (jaCad.has(chave) || vistos.has(chave)) dupIds.push(p.id);
    else vistos.add(chave);
  }
  if (dupIds.length > 0) {
    await supabaseAdmin
      .from('patient_records')
      .update({ status: 'needs_review', error_message: 'Cadastro duplicado — mesmo CNS já cadastrado nesta data de atendimento.' })
      .in('id', dupIds);
  }
  return dupIds.length;
}

/**
 * Validação UPFRONT dos dados obrigatórios (antes de cadastrar): manda para
 * Pendências (needs_review) quem não tem o mínimo para o formulário do CMD
 * funcionar — CPF/CNS e médico. Sem isso, o cadastro quebra no meio do
 * formulário e dispara o relogin ("sair com segurança").
 * (Data de nascimento NÃO é obrigatória: o CMD a preenche via CADSUS pelo CNS.)
 * Retorna quantos foram barrados. */
export async function marcarFaltandoDados(uploadId: number): Promise<number> {
  const { data: pend } = await supabaseAdmin
    .from('patient_records')
    .select('id, cns, medico_nome')
    .eq('upload_id', uploadId)
    .eq('status', 'pending_registration');
  const pendentes = (pend ?? []) as { id: number; cns: string | null; medico_nome: string | null }[];

  // Obrigatórios (definição do usuário): CPF/CNS e médico. Data de nascimento
  // NÃO (vem do CADSUS pelo CNS); data de atendimento também não trava aqui.
  const porMotivo: Record<string, number[]> = {};
  for (const p of pendentes) {
    const faltas: string[] = [];
    if (!p.cns || !String(p.cns).trim()) faltas.push('CNS/CPF');
    if (!p.medico_nome || !String(p.medico_nome).trim()) faltas.push('médico');
    if (faltas.length) {
      const msg = `Falta dado obrigatório: ${faltas.join(', ')}.`;
      (porMotivo[msg] ??= []).push(p.id);
    }
  }
  let total = 0;
  for (const [msg, ids] of Object.entries(porMotivo)) {
    await supabaseAdmin
      .from('patient_records')
      .update({ status: 'needs_review', error_message: msg })
      .in('id', ids);
    total += ids.length;
  }
  return total;
}

/** Atualiza o status de um paciente (e marca registered_at quando cadastrado). */
export async function marcarPaciente(id: number, status: string, errorMessage = ''): Promise<void> {
  await supabaseAdmin
    .from('patient_records')
    .update({ status, error_message: errorMessage, registered_at: status === 'registered' ? new Date().toISOString() : null })
    .eq('id', id);
}

/** Id (em cache) do tipo de automação do cadastro CMD — para as métricas. */
let _tipoCadastroId: number | null = null;
async function tipoCadastroId(): Promise<number | null> {
  if (_tipoCadastroId) return _tipoCadastroId;
  const { data } = await supabaseAdmin.from('tipos_automacao').select('id').eq('chave', 'cadastro_cmd').maybeSingle();
  _tipoCadastroId = data?.id ?? null;
  return _tipoCadastroId;
}

/** Registra 1 execução de automação (métrica para o módulo de Economia). */
export async function registrarExecucao(opts: {
  tenantId: number; empresaId: number | null; clinicAccountId: number; uploadId: number; patientId: number;
}): Promise<void> {
  const tipoId = await tipoCadastroId();
  if (!tipoId) return;
  await supabaseAdmin.from('execucoes_automacao').insert({
    tenant_id: opts.tenantId,
    empresa_id: opts.empresaId,
    clinic_account_id: opts.clinicAccountId,
    tipo_automacao_id: tipoId,
    upload_id: opts.uploadId,
    patient_record_id: opts.patientId,
    sucesso: true,
  });
}

/** Conta os pacientes JÁ cadastrados/errados de um upload a partir dos próprios
 * registros (fonte da verdade) — usado para RETOMAR contando de onde parou,
 * mesmo que o contador da linha do upload tenha sido zerado por um run anterior. */
export async function contarStatus(uploadId: number): Promise<{ registered: number; errored: number }> {
  const okStatus = ['registered', 'verified_ok', 'verified_divergent', 'done_manually'];
  const [{ count: r }, { count: e }] = await Promise.all([
    supabaseAdmin.from('patient_records').select('id', { head: true, count: 'exact' }).eq('upload_id', uploadId).in('status', okStatus),
    supabaseAdmin.from('patient_records').select('id', { head: true, count: 'exact' }).eq('upload_id', uploadId).eq('status', 'error'),
  ]);
  return { registered: r ?? 0, errored: e ?? 0 };
}

/** Atualiza os contadores do upload. */
export async function atualizarContadores(uploadId: number, registered: number, errored: number): Promise<void> {
  await supabaseAdmin.from('uploads').update({ patients_registered: registered, patients_errored: errored }).eq('id', uploadId);
}

/** Acrescenta o tempo ATIVO (segundos) desta sessão ao acumulado do upload e
 * encerra o marcador de sessão. Mede só o tempo trabalhando — exclui o tempo
 * pausado/parado (senão o relatório contaria a ociosidade como trabalho). */
export async function acrescentarTempoAtivo(uploadId: number, segundos: number): Promise<void> {
  const { data } = await supabaseAdmin.from('uploads').select('tempo_ativo_segundos').eq('id', uploadId).maybeSingle();
  const atual = (data?.tempo_ativo_segundos as number | undefined) ?? 0;
  await supabaseAdmin.from('uploads').update({ tempo_ativo_segundos: atual + Math.max(0, Math.round(segundos)), sessao_iniciada_em: null }).eq('id', uploadId);
}

/** Volta os pacientes com ERRO para 'pending_registration' (nova rodada de
 * retry ao concluir a lista) — para tentar bater 100%. Retorna quantos. */
export async function reenfileirarErros(uploadId: number): Promise<number> {
  const { data } = await supabaseAdmin
    .from('patient_records')
    .update({ status: 'pending_registration', error_message: '' })
    .eq('upload_id', uploadId)
    .eq('status', 'error')
    .select('id');
  return data?.length ?? 0;
}

/** Status atual do upload (para detectar pausa/parada/exclusão pelo usuário).
 * Um upload excluído (deleted_at) ou inexistente conta como 'parado' — o
 * worker deve abortar imediatamente e não cadastrar mais nada. */
export async function statusDoUpload(uploadId: number): Promise<string> {
  const { data } = await supabaseAdmin.from('uploads').select('status, deleted_at').eq('id', uploadId).maybeSingle();
  if (!data) return 'parado'; // sumiu = abortar
  if (data.deleted_at) return 'parado'; // excluído = abortar
  return data.status ?? '';
}

/** Carrega o upload + a conta CMD (credenciais cifradas + janela de execução). */
export async function getUploadComConta(uploadId: number): Promise<UploadComConta> {
  const { data, error } = await supabaseAdmin
    .from('uploads')
    .select(
      'id, status, clinic_account_id, file_path, mapeamento_campos, patients_registered, patients_errored, registro_iniciado_em, retry_rounds, ' +
        'clinic_accounts:clinic_account_id (id, tenant_id, empresa_id, is_enabled, cmd_username, cmd_password_encrypted, mfa_secret_encrypted, cid_padrao, cid_oci_0_8, cid_9_mais, dias_execucao, horario_inicio_execucao, horario_fim_execucao, pausa_inicio, pausa_fim, delay_inicio_minutos)',
    )
    .eq('id', uploadId)
    .single();
  if (error) throw new Error(`Upload #${uploadId} não encontrado: ${error.message}`);
  return data as unknown as UploadComConta;
}
