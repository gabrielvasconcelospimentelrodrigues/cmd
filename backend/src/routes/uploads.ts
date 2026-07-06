import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import { extractionQueue, registrationQueue } from '../lib/queue';
import { gerarShortCode } from '../lib/shortcode';
import { registrarLog, ator, atorNome } from '../lib/audit';
import type { Database, UploadOrigem } from '../types/database';

const BUCKET = 'uploads';
const ORIGENS_VALIDAS: UploadOrigem[] = ['ficha_completa', 'extrator', 'dados_importados'];

const MSG_DUPLICADO = 'Cadastro duplicado — mesmo CNS já cadastrado nesta data de atendimento.';

/**
 * Detecta duplicados ANTES de cadastrar: um paciente pendente é duplicado se o
 * mesmo CNS + data de atendimento já está cadastrado (em outra ficha do mesmo
 * assinante) OU se repete dentro da própria lista. Os duplicados vão para
 * PENDÊNCIAS (needs_review), para o assinante tratar manualmente. Retorna
 * quantos foram marcados.
 */
async function marcarDuplicados(uploadId: number, tenantId: number): Promise<number> {
  const { data: pend } = await (supabaseAdmin as any)
    .from('patient_records')
    .select('id, cns, data_atendimento')
    .eq('upload_id', uploadId)
    .eq('status', 'pending_registration')
    .order('id', { ascending: true });
  const pendentes = (pend ?? []) as { id: number; cns: string | null; data_atendimento: string | null }[];
  if (pendentes.length === 0) return 0;

  // Cadastros já existentes (mesmo assinante) — chave CNS|data.
  const { data: cas } = await supabaseAdmin.from('clinic_accounts').select('id').eq('tenant_id', tenantId);
  const caIds = (cas ?? []).map((c) => c.id);
  const jaCadastrados = new Set<string>();
  if (caIds.length > 0) {
    const { data: reg } = await (supabaseAdmin as any)
      .from('patient_records')
      .select('cns, data_atendimento')
      .in('clinic_account_id', caIds)
      .in('status', ['registered', 'verified_ok', 'verified_divergent', 'done_manually']);
    for (const r of (reg ?? []) as { cns: string | null; data_atendimento: string | null }[]) {
      if (r.cns && r.data_atendimento) jaCadastrados.add(`${r.cns}|${r.data_atendimento}`);
    }
  }

  // Marca duplicados: contra os já cadastrados OU repetidos na própria lista.
  const vistos = new Set<string>();
  const dupIds: number[] = [];
  for (const p of pendentes) {
    if (!p.cns || !p.data_atendimento) continue;
    const chave = `${p.cns}|${p.data_atendimento}`;
    if (jaCadastrados.has(chave) || vistos.has(chave)) dupIds.push(p.id);
    else vistos.add(chave);
  }
  if (dupIds.length > 0) {
    await (supabaseAdmin as any)
      .from('patient_records')
      .update({ status: 'needs_review', error_message: MSG_DUPLICADO })
      .in('id', dupIds);
  }
  return dupIds.length;
}

/**
 * Rotas de upload — TODAS protegidas por auth e escopadas à clínica (tenant)
 * do usuário autenticado. Um usuário nunca enxerga/usa dados de outra clínica.
 */
export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  // ---- Criar upload (arquivo tabular) → Storage → fila de extração ----------
  app.post('/uploads', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const tenantId = req.tenant!.id;
    let fileBuffer: Buffer | null = null;
    let filename = '';
    let contentType = 'application/octet-stream';
    let clinicAccountId: number | null = null;
    let empresaId: number | null = null;
    let name = '';
    let origem: string | null = null;
    let mapeamento: Record<string, string> = {};

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filename = part.filename;
        contentType = part.mimetype || contentType;
        fileBuffer = await part.toBuffer();
      } else if (part.fieldname === 'clinic_account_id') {
        const val = Number(part.value);
        if (!Number.isNaN(val)) clinicAccountId = val;
      } else if (part.fieldname === 'empresa_id') {
        const val = Number(part.value);
        if (!Number.isNaN(val)) empresaId = val;
      } else if (part.fieldname === 'name') {
        name = String(part.value);
      } else if (part.fieldname === 'origem') {
        origem = String(part.value);
      } else if (part.fieldname === 'mapeamento_campos') {
        try {
          mapeamento = JSON.parse(String(part.value));
        } catch {
          return reply.code(400).send({ error: 'mapeamento_campos não é um JSON válido.' });
        }
      }
    }

    if (!fileBuffer || !filename) return reply.code(400).send({ error: 'Arquivo ausente.' });

    if (empresaId) {
      const { data: emp } = await (supabaseAdmin as any)
        .from('empresas')
        .select('id')
        .eq('id', empresaId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!emp) return reply.code(404).send({ error: 'empresa não encontrada para esta clínica.' });
      // Se não veio uma conta explícita, resolve um TERMINAL (conta CMD) da
      // empresa — senão o registro não tem com que logar (registration_failed).
      if (!clinicAccountId) {
        const { data: ca } = await (supabaseAdmin as any)
          .from('clinic_accounts')
          .select('id')
          .eq('empresa_id', empresaId)
          .eq('tenant_id', tenantId)
          .order('is_enabled', { ascending: false })
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!ca) return reply.code(400).send({ error: 'Esta empresa ainda não tem um terminal (conta CMD-COLETA) configurado. Conecte um terminal antes de importar.' });
        clinicAccountId = (ca as { id: number }).id;
      }
    } else if (clinicAccountId) {
      const { data: ca } = await (supabaseAdmin as any)
        .from('clinic_accounts')
        .select('id, empresa_id')
        .eq('id', clinicAccountId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!ca) return reply.code(404).send({ error: 'clinic_account não encontrada para esta clínica.' });
      empresaId = (ca as any).empresa_id;
    } else {
      return reply.code(400).send({ error: 'empresa_id é obrigatório.' });
    }

    const shortCode = await gerarShortCode();
    const safeName = filename.replace(/[^\w.\-]/g, '_');
    const storagePath = `${empresaId}/${shortCode}_${safeName}`;
    const upStore = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType, upsert: false });
    if (upStore.error) {
      req.log.error(upStore.error);
      return reply.code(500).send({ error: 'Falha ao salvar o arquivo.' });
    }

    const temMapa = Object.keys(mapeamento).length > 0;
    const origemFinal: UploadOrigem | undefined =
      origem && ORIGENS_VALIDAS.includes(origem as UploadOrigem)
        ? (origem as UploadOrigem)
        : temMapa
          ? 'dados_importados'
          : undefined;

    const payload: any = {
      clinic_account_id: clinicAccountId,
      empresa_id: empresaId,
      name: name.trim() || filename,
      original_filename: filename,
      file_path: storagePath,
      status: 'extracting',
      short_code: shortCode,
      mapeamento_campos: mapeamento,
      uploaded_by: req.authUser!.id,
      ...(origemFinal ? { origem: origemFinal } : {}),
    };

    const { data: upload, error: upErr } = await (supabaseAdmin as any)
      .from('uploads')
      .insert(payload)
      .select('*')
      .single();
    if (upErr || !upload) {
      req.log.error(upErr);
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
      return reply.code(500).send({ error: 'Falha ao criar o upload.' });
    }

    await extractionQueue().add('extrair', { uploadId: upload.id });
    return reply.code(201).send(upload);
  });

  // ---- Listar uploads da clínica -------------------------------------------
  app.get('/uploads', { preHandler: [app.authenticate, app.requireActive] }, async (req) => {
    const tenantId = req.tenant!.id;

    if (req.member) {
      const { data: cas } = await supabaseAdmin
        .from('clinic_accounts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('member_user_id', req.member.user_id);
      const caIds = (cas ?? []).map(c => Number(c.id));

      const query = (supabaseAdmin as any)
        .from('uploads')
        .select('*, clinic_accounts(label), empresas(nome)')
        .is('deleted_at', null);

      if (caIds.length > 0) {
        query.or(`uploaded_by.eq.${req.member.user_id},clinic_account_id.in.(${caIds.join(',')})`);
      } else {
        query.eq('uploaded_by', req.member.user_id);
      }

      const { data } = await query.order('uploaded_at', { ascending: false }).limit(100);
      return data ?? [];
    }

    const { data: emps } = await supabaseAdmin.from('empresas').select('id').eq('tenant_id', tenantId);
    const empIds = (emps ?? []).map(e => e.id);

    const { data: cas } = await supabaseAdmin.from('clinic_accounts').select('id').eq('tenant_id', tenantId);
    const caIds = (cas ?? []).map(c => c.id);

    const query = (supabaseAdmin as any)
      .from('uploads')
      .select('*, clinic_accounts(label), empresas(nome)')
      .is('deleted_at', null)
      .order('uploaded_at', { ascending: false })
      .limit(100);

    if (empIds.length > 0 && caIds.length > 0) {
      query.or(`empresa_id.in.(${empIds.join(',')}),clinic_account_id.in.(${caIds.join(',')})`);
    } else if (empIds.length > 0) {
      query.in('empresa_id', empIds);
    } else if (caIds.length > 0) {
      query.in('clinic_account_id', caIds);
    } else {
      return [];
    }

    const { data } = await query;
    return data ?? [];
  });

  // ---- Detalhe de um upload (escopado) -------------------------------------
  app.get('/uploads/:id', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });

    const { data } = await (supabaseAdmin as any)
      .from('uploads')
      .select('*, clinic_accounts(tenant_id), empresas(tenant_id)')
      .eq('id', id)
      .maybeSingle();

    if (!data) return reply.code(404).send({ error: 'upload não encontrado.' });

    const isOwner = (data as any).clinic_accounts?.tenant_id === req.tenant!.id || (data as any).empresas?.tenant_id === req.tenant!.id;
    if (!isOwner) return reply.code(404).send({ error: 'upload não encontrado.' });

    return data;
  });

  // ---- Pacientes de um upload (escopado) -----------------------------------
  app.get('/uploads/:id/patients', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });

    const { data: up } = await (supabaseAdmin as any)
      .from('uploads')
      .select('id, clinic_accounts(tenant_id), empresas(tenant_id)')
      .eq('id', id)
      .maybeSingle();

    if (!up) return reply.code(404).send({ error: 'upload não encontrado.' });
    const isOwner = (up as any).clinic_accounts?.tenant_id === req.tenant!.id || (up as any).empresas?.tenant_id === req.tenant!.id;
    if (!isOwner) return reply.code(404).send({ error: 'upload não encontrado.' });

    const { data } = await supabaseAdmin
      .from('patient_records')
      .select('*')
      .eq('upload_id', id)
      .order('id', { ascending: true });
    return data ?? [];
  });

  // ---- Todas as fichas (patient_records) da clínica ------------------------
  app.get('/patients', { preHandler: [app.authenticate, app.requireActive] }, async (req) => {
    let caIds: number[] = [];
    if (req.member) {
      const { data: cas } = await supabaseAdmin
        .from('clinic_accounts')
        .select('id')
        .eq('tenant_id', req.tenant!.id)
        .eq('member_user_id', req.member.user_id);
      caIds = (cas ?? []).map(c => Number(c.id));
    }

    const { data } = await (supabaseAdmin as any)
      .from('patient_records')
      .select('id, upload_id, nome, cns, data_atendimento, clinic_account_id, cid10_codigo, medico_nome, status, error_message, created_at, clinic_accounts(tenant_id), uploads!inner(deleted_at, clinic_account_id, empresa_id, uploaded_by)')
      .is('uploads.deleted_at', null)
      .order('id', { ascending: false })
      .limit(500);

    // Filter programmatically since RLS or query structure handles tenant nesting
    const filtered = (data ?? []).filter((pr: any) => {
      // Legacy clinic account logic or via tenant if available
      if (pr.clinic_accounts && pr.clinic_accounts.tenant_id !== req.tenant!.id) {
        return false;
      }

      if (req.member) {
        const prCaId = pr.clinic_account_id ? Number(pr.clinic_account_id) : null;
        const upCaId = pr.uploads?.clinic_account_id ? Number(pr.uploads.clinic_account_id) : null;
        
        if (prCaId && caIds.includes(prCaId)) {
          return true;
        }
        if (upCaId && caIds.includes(upCaId)) {
          return true;
        }
        if (pr.uploads?.uploaded_by && pr.uploads.uploaded_by === req.member.user_id) {
          return true;
        }
        return false;
      }

      return true;
    });

    return filtered;
  });

  // ---- Pendências: reenviar 1 paciente (re-enfileira o registro) -----------
  app.post('/patients/:id/retry', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    
    const { data: pr } = await (supabaseAdmin as any)
      .from('patient_records')
      .select('id, upload_id, clinic_account_id')
      .eq('id', id)
      .maybeSingle();

    if (!pr) return reply.code(404).send({ error: 'paciente não encontrado.' });

    // Validate ownership of upload
    const { data: up } = await (supabaseAdmin as any)
      .from('uploads')
      .select('id, clinic_accounts(tenant_id), empresas(tenant_id)')
      .eq('id', (pr as any).upload_id)
      .maybeSingle();

    if (!up) return reply.code(404).send({ error: 'paciente não encontrado.' });
    const isOwner = (up as any).clinic_accounts?.tenant_id === req.tenant!.id || (up as any).empresas?.tenant_id === req.tenant!.id;
    if (!isOwner) return reply.code(404).send({ error: 'paciente não encontrado.' });

    if (!(pr as any).clinic_account_id) {
      return reply.code(400).send({ error: 'Selecione um terminal de automação para este envio antes de tentar reenviar.' });
    }

    await supabaseAdmin.from('patient_records').update({ status: 'pending_registration', error_message: '' }).eq('id', id);
    await registrationQueue().add('registrar', { uploadId: (pr as any).upload_id });
    return { ok: true };
  });

  // ---- Pendências: marcar como feito manualmente ---------------------------
  app.post('/patients/:id/manual', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });

    const { data: pr } = await (supabaseAdmin as any)
      .from('patient_records')
      .select('id, upload_id')
      .eq('id', id)
      .maybeSingle();

    if (!pr) return reply.code(404).send({ error: 'paciente não encontrado.' });

    const { data: up } = await (supabaseAdmin as any)
      .from('uploads')
      .select('id, clinic_accounts(tenant_id), empresas(tenant_id)')
      .eq('id', (pr as any).upload_id)
      .maybeSingle();

    if (!up) return reply.code(404).send({ error: 'paciente não encontrado.' });
    const isOwner = (up as any).clinic_accounts?.tenant_id === req.tenant!.id || (up as any).empresas?.tenant_id === req.tenant!.id;
    if (!isOwner) return reply.code(404).send({ error: 'paciente não encontrado.' });

    await supabaseAdmin.from('patient_records').update({ status: 'done_manually' }).eq('id', id);
    return { ok: true };
  });

  // Campos editáveis de uma ficha.
  const camposFicha = (b: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of ['nome', 'cns', 'data_atendimento', 'cid10_codigo', 'medico_nome', 'data_nascimento']) {
      if (b[k] !== undefined) out[k] = b[k] === '' ? null : b[k];
    }
    return out;
  };

  // ---- Editar UMA ficha -----------------------------------------------------
  app.patch('/patients/:id', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    const { data: pr } = await (supabaseAdmin as any).from('patient_records').select('id, upload_id').eq('id', id).maybeSingle();
    if (!pr) return reply.code(404).send({ error: 'ficha não encontrada.' });
    const { data: up } = await (supabaseAdmin as any).from('uploads').select('id, clinic_accounts(tenant_id), empresas(tenant_id)').eq('id', pr.upload_id).maybeSingle();
    const isOwner = up && ((up as any).clinic_accounts?.tenant_id === req.tenant!.id || (up as any).empresas?.tenant_id === req.tenant!.id);
    if (!isOwner) return reply.code(404).send({ error: 'ficha não encontrada.' });
    const patch = camposFicha((req.body ?? {}) as Record<string, unknown>);
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'nada para atualizar.' });
    const { data, error } = await (supabaseAdmin as any).from('patient_records').update(patch).eq('id', id).select('*').single();
    if (error) return reply.code(400).send({ error: error.message });
    return data;
  });

  // ---- Editar em MASSA as fichas de um envio -------------------------------
  // Aplica os campos enviados a TODAS as fichas do envio, ou só às `ids`
  // informadas (linhas marcadas na tabela).
  app.patch('/uploads/:id/patients', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    const { data: up } = await (supabaseAdmin as any).from('uploads').select('id, clinic_accounts(tenant_id), empresas(tenant_id)').eq('id', id).maybeSingle();
    const isOwner = up && ((up as any).clinic_accounts?.tenant_id === req.tenant!.id || (up as any).empresas?.tenant_id === req.tenant!.id);
    if (!isOwner) return reply.code(404).send({ error: 'envio não encontrado.' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch = camposFicha(body);
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'informe ao menos um campo para aplicar.' });
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(Number).filter((n) => !Number.isNaN(n)) : null;
    let q = (supabaseAdmin as any).from('patient_records').update(patch).eq('upload_id', id);
    if (ids && ids.length > 0) q = q.in('id', ids);
    const { data, error } = await q.select('id');
    if (error) return reply.code(400).send({ error: error.message });
    return { ok: true, atualizadas: (data ?? []).length };
  });

  // ---- Excluir um envio (soft-delete) --------------------------------------
  app.delete('/uploads/:id', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });

    const { data: up } = await (supabaseAdmin as any)
      .from('uploads')
      .select('id, clinic_accounts(tenant_id), empresas(tenant_id)')
      .eq('id', id)
      .maybeSingle();

    if (!up) return reply.code(404).send({ error: 'envio não encontrado.' });
    const isOwner = (up as any).clinic_accounts?.tenant_id === req.tenant!.id || (up as any).empresas?.tenant_id === req.tenant!.id;
    if (!isOwner) return reply.code(404).send({ error: 'envio não encontrado.' });

    // Excluir também PARA a automação: deleted_at já é tratado como 'parado'
    // pelo motor; marcamos o status junto para o estado ficar explícito.
    await (supabaseAdmin as any).from('uploads').update({ deleted_at: new Date().toISOString(), status: 'parado', sessao_iniciada_em: null }).eq('id', id);
    return reply.code(204).send();
  });

  // ---- Verificar duplicados de um envio (manda os duplicados p/ Pendências) -
  app.post('/uploads/:id/verificar-duplicados', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    const { data: up } = await (supabaseAdmin as any)
      .from('uploads').select('id, clinic_accounts(tenant_id), empresas(tenant_id)').eq('id', id).maybeSingle();
    const isOwner = up && ((up as any).clinic_accounts?.tenant_id === req.tenant!.id || (up as any).empresas?.tenant_id === req.tenant!.id);
    if (!isOwner) return reply.code(404).send({ error: 'envio não encontrado.' });
    const duplicados = await marcarDuplicados(id, req.tenant!.id);
    return { ok: true, duplicados };
  });

  // ---- Controle da automação de um envio (iniciar/pausar/parar/retomar) ----
  app.post('/uploads/:id/:acao', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const params = req.params as { id: string; acao: string };
    const id = Number(params.id);
    const acao = params.acao;
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    if (!['iniciar', 'retomar', 'pausar', 'parar'].includes(acao)) return reply.code(400).send({ error: 'ação inválida.' });

    const { data: up } = await (supabaseAdmin as any)
      .from('uploads')
      .select('id, status, clinic_account_id, empresa_id')
      .eq('id', id)
      .maybeSingle();

    if (!up) return reply.code(404).send({ error: 'envio não encontrado.' });

    let ownerOk = false;
    const uploadRow = up as any;
    if (uploadRow.clinic_account_id) {
      const { data: ca } = await (supabaseAdmin as any).from('clinic_accounts').select('tenant_id').eq('id', uploadRow.clinic_account_id).eq('tenant_id', req.tenant!.id).maybeSingle();
      if (ca) ownerOk = true;
    }
    if (!ownerOk && uploadRow.empresa_id) {
      const { data: emp } = await (supabaseAdmin as any).from('empresas').select('tenant_id').eq('id', uploadRow.empresa_id).eq('tenant_id', req.tenant!.id).maybeSingle();
      if (emp) ownerOk = true;
    }
    if (!ownerOk) return reply.code(403).send({ error: 'Acesso negado.' });

    const nomeLista = (up as any).name || `lista #${id}`;
    if (acao === 'pausar') {
      await supabaseAdmin.from('uploads').update({ status: 'paused' }).eq('id', id);
      await registrarLog({ tenantId: req.tenant!.id, categoria: 'automacao', acao: 'automacao.pausada', nivel: 'alerta', ator: ator(req), descricao: `${atorNome(req)} pausou a automação da lista "${nomeLista}".`, meta: { upload_id: id } });
    } else if (acao === 'parar') {
      await supabaseAdmin.from('uploads').update({ status: 'parado' }).eq('id', id);
      await registrarLog({ tenantId: req.tenant!.id, categoria: 'automacao', acao: 'automacao.parada', nivel: 'alerta', ator: ator(req), descricao: `${atorNome(req)} parou a automação da lista "${nomeLista}".`, meta: { upload_id: id } });
    } else {
      // GATE DE PAGAMENTO: só usa os terminais se os custos estão em dia.
      // Bloqueia se houver fatura VENCIDA em aberto.
      const hojeStr = new Date().toISOString().slice(0, 10);
      const { data: vencidas } = await (supabaseAdmin as any)
        .from('faturas').select('id').eq('tenant_id', req.tenant!.id).eq('status', 'aberto').lt('vencimento', hojeStr).limit(1);
      if (vencidas && vencidas.length > 0) {
        return reply.code(402).send({ error: 'Automação bloqueada: há fatura(s) vencida(s) em aberto. Regularize o pagamento para usar os terminais.' });
      }

      // iniciar / retomar. Recebe o SLOT do terminal (1..N) escolhido. Os
      // terminais da empresa usam o MESMO login CMD (CMD aceita várias sessões),
      // então resolvemos a conta CMD da empresa automaticamente.
      const body = (req.body ?? {}) as { terminal_slot?: number; clinic_account_id?: number };
      const slot = body.terminal_slot ? Number(body.terminal_slot) : null;

      // Conta CMD (login) para rodar: a explícita, a já no upload, ou a da empresa.
      let terminalId: number | null = body.clinic_account_id ? Number(body.clinic_account_id) : (up as any).clinic_account_id;
      if (terminalId) {
        const { data: ca } = await (supabaseAdmin as any)
          .from('clinic_accounts').select('id').eq('id', terminalId).eq('tenant_id', req.tenant!.id).maybeSingle();
        if (!ca) terminalId = null;
      }
      if (!terminalId && (up as any).empresa_id) {
        const { data: ca } = await (supabaseAdmin as any)
          .from('clinic_accounts').select('id').eq('empresa_id', (up as any).empresa_id).eq('tenant_id', req.tenant!.id)
          .order('is_enabled', { ascending: false }).order('id', { ascending: true }).limit(1).maybeSingle();
        terminalId = ca ? (ca as { id: number }).id : null;
      }
      if (!terminalId) {
        return reply.code(400).send({ error: 'A empresa desta lista ainda não tem um login CMD-COLETA conectado. Conecte em Configurações.' });
      }

      const patch: Record<string, unknown> = {};
      if (terminalId !== (up as any).clinic_account_id) {
        patch.clinic_account_id = terminalId;
        await (supabaseAdmin as any).from('patient_records').update({ clinic_account_id: terminalId }).eq('upload_id', id);
      }
      if (slot) patch.terminal_slot = slot;

      const upStatus = (up as any).status;
      const jaRodando = upStatus === 'registering' || upStatus === 'extracting';
      if (!jaRodando) {
        patch.status = 'extracted';
        patch.current_step = '';
      }
      if (Object.keys(patch).length > 0) await (supabaseAdmin as any).from('uploads').update(patch).eq('id', id);
      if (!jaRodando) {
        // ANTES de começar os cadastros: manda os duplicados para Pendências.
        const dups = await marcarDuplicados(id, req.tenant!.id);
        await registrationQueue().add('registrar', { uploadId: id });
        await registrarLog({ tenantId: req.tenant!.id, categoria: 'automacao', acao: 'automacao.iniciada', nivel: 'sucesso', ator: ator(req), descricao: `${atorNome(req)} iniciou a automação da lista "${nomeLista}"${slot ? ` no terminal ${slot}` : ''}${dups > 0 ? ` · ${dups} duplicado(s) enviado(s) para Pendências` : ''}.`, meta: { upload_id: id, terminal_slot: slot, duplicados: dups } });
      }
    }
    return { ok: true };
  });

  // ---- Atividade recente (log_entries) de um upload ------------------------
  app.get('/uploads/:id/logs', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });

    const { data: up } = await (supabaseAdmin as any)
      .from('uploads')
      .select('id, clinic_accounts(tenant_id), empresas(tenant_id)')
      .eq('id', id)
      .maybeSingle();

    if (!up) return reply.code(404).send({ error: 'upload não encontrado.' });
    const isOwner = (up as any).clinic_accounts?.tenant_id === req.tenant!.id || (up as any).empresas?.tenant_id === req.tenant!.id;
    if (!isOwner) return reply.code(404).send({ error: 'upload não encontrado.' });

    const { data } = await supabaseAdmin
      .from('log_entries')
      .select('level, message, timestamp')
      .eq('upload_id', id)
      .order('timestamp', { ascending: false })
      .limit(50);
    return (data ?? []).reverse();
  });
}
