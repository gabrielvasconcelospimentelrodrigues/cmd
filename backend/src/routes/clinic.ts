import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import { encrypt } from '../lib/crypto';
import { registrarLog, ator, atorNome } from '../lib/audit';
import type { Database } from '../types/database';

// Colunas seguras de clinic_accounts devolvidas ao cliente (sem cifras).
const SELECT_CONTA =
  'id, label, cmd_username, is_enabled, cid_padrao, member_user_id, ' +
  'cid_oci_0_8, cid_9_mais, dias_execucao, horario_inicio_execucao, ' +
  'horario_fim_execucao, pausa_inicio, pausa_fim, delay_inicio_minutos, ' +
  'empresa_id, last_run_at, last_run_status, created_at';

/** Extrai/normaliza os controles clínicos do body (onboarding e edição). Só
 * inclui as chaves presentes — serve tanto para insert quanto para patch. */
function controlesClinicosDoBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cid = (v: unknown) => String(v ?? '').trim().toUpperCase() || 'H53';
  if ('cid_oci_0_8' in body) out.cid_oci_0_8 = cid(body.cid_oci_0_8);
  if ('cid_9_mais' in body) out.cid_9_mais = cid(body.cid_9_mais);
  return out;
}

/**
 * Rotas da clínica do usuário autenticado: dados da própria clínica e as
 * contas CMD-COLETA. Credenciais cifradas NUNCA são retornadas.
 */
export async function clinicRoutes(app: FastifyInstance): Promise<void> {
  // Quem sou eu + minha clínica.
  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    // member != null → é membro de equipe (acesso restrito ao próprio terminal).
    return { user: req.authUser, tenant: req.tenant, member: req.member };
  });

  // Contas CMD-COLETA da clínica (sem expor senha/MFA cifrados).
  app.get('/clinic-accounts', { preHandler: app.authenticate }, async (req) => {
    let q = supabaseAdmin
      .from('clinic_accounts')
      .select(SELECT_CONTA)
      .eq('tenant_id', req.tenant!.id);
    // Membro enxerga os terminais DESIGNADOS a ele + os LIVRES da empresa dele.
    if (req.member) {
      const empFiltro = req.member.empresa_id == null ? 'empresa_id.is.null' : `empresa_id.eq.${req.member.empresa_id}`;
      q = q.or(`member_user_id.eq.${req.member.user_id},and(member_user_id.is.null,${empFiltro})`);
    }
    const { data } = await q.order('created_at', { ascending: true });

    // Busca quais slots estão ocupados no momento para este tenant.
    const { data: active } = await (supabaseAdmin as any)
      .from('uploads')
      .select('clinic_account_id, terminal_slot')
      .in('status', ['registering', 'extracting'])
      .is('deleted_at', null);

    const occupiedMap = new Map<number, number[]>();
    for (const act of (active ?? []) as { clinic_account_id: number | null; terminal_slot: number | null }[]) {
      if (act.clinic_account_id && act.terminal_slot) {
        const caId = Number(act.clinic_account_id);
        const slot = Number(act.terminal_slot);
        if (!occupiedMap.has(caId)) occupiedMap.set(caId, []);
        occupiedMap.get(caId)!.push(slot);
      }
    }

    return (data ?? []).map((ca: any) => ({
      ...ca,
      busy_slots: occupiedMap.get(Number(ca.id)) ?? []
    }));
  });

  // Conecta uma nova conta CMD-COLETA (credenciais cifradas em repouso).
  app.post('/clinic-accounts', { preHandler: app.authenticate }, async (req, reply) => {
    const body = (req.body ?? {}) as {
      label?: string;
      cmd_username?: string;
      cmd_password?: string;
      mfa_secret?: string;
      empresa_id?: number | null;
    };
    if (!body.label || !body.cmd_username || !body.cmd_password) {
      return reply.code(400).send({ error: 'label, cmd_username e cmd_password são obrigatórios.' });
    }

    // MEMBRO de equipe: a conta que ele conecta é designada a ele, na empresa
    // dele. A cota (max_terminais) já limita o total; sem limite fixo por membro.
    if (req.member) {
      body.empresa_id = req.member.empresa_id; // sempre a empresa do membro
    }

    // Check terminal limit
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('max_terminais')
      .eq('id', req.tenant!.id)
      .maybeSingle();

    const maxTerminais = Number((tenant as any)?.max_terminais ?? 0);

    const { count, error: countErr } = await supabaseAdmin
      .from('clinic_accounts')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', req.tenant!.id);

    if (countErr) {
      return reply.code(500).send({ error: 'Erro ao verificar cota de terminais.' });
    }

    if ((count ?? 0) >= maxTerminais) {
      return reply.code(400).send({ error: `Você atingiu o limite de ${maxTerminais} terminal(is) contratado(s). Solicite a contratação de novos terminais na aba Planos.` });
    }

    if (body.empresa_id) {
      const { data: emp } = await supabaseAdmin
        .from('empresas')
        .select('id')
        .eq('id', Number(body.empresa_id))
        .eq('tenant_id', req.tenant!.id)
        .maybeSingle();
      if (!emp) {
        return reply.code(400).send({ error: 'Empresa inválida ou não pertence a esta clínica.' });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('clinic_accounts')
      .insert({
        tenant_id: req.tenant!.id,
        label: body.label,
        cmd_username: body.cmd_username,
        cmd_password_encrypted: encrypt(body.cmd_password),
        mfa_secret_encrypted: encrypt(body.mfa_secret ?? ''),
        empresa_id: body.empresa_id ? Number(body.empresa_id) : null,
        // Vincula ao membro quando quem conecta é membro de equipe.
        member_user_id: req.member ? req.member.user_id : null,
        // Controles clínicos vindos do onboarding (usa defaults do banco se ausentes).
        ...controlesClinicosDoBody(req.body as Record<string, unknown>),
      })
      .select(SELECT_CONTA)
      .single();
    if (error || !data) {
      req.log.error(error);
      return reply.code(500).send({ error: 'Falha ao criar a conta CMD.' });
    }
    return reply.code(201).send(data);
  });

  // Atualiza uma conta CMD (ligar/desligar, janela de execução, delay…).
  app.patch('/clinic-accounts/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Whitelist de campos editáveis.
    const permitidos = [
      'label', 'is_enabled', 'dias_execucao', 'horario_inicio_execucao',
      'horario_fim_execucao', 'pausa_inicio', 'pausa_fim', 'delay_inicio_minutos',
      'cid_padrao', 'empresa_id',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const k of permitidos) if (k in body) patch[k] = body[k];
    // Controles clínicos (alta + CID por tipo de paciente).
    Object.assign(patch, controlesClinicosDoBody(body));

    if (body.empresa_id !== undefined) {
      if (body.empresa_id !== null) {
        const { data: emp } = await supabaseAdmin
          .from('empresas')
          .select('id')
          .eq('id', Number(body.empresa_id))
          .eq('tenant_id', req.tenant!.id)
          .maybeSingle();
        if (!emp) {
          return reply.code(400).send({ error: 'Empresa inválida ou não pertence a esta clínica.' });
        }
        patch.empresa_id = Number(body.empresa_id);
      } else {
        patch.empresa_id = null;
      }
    }

    // Edição de credenciais (cifra senha/MFA).
    if (typeof body.cmd_username === 'string') patch.cmd_username = body.cmd_username;
    if (typeof body.cmd_password === 'string' && body.cmd_password) patch.cmd_password_encrypted = encrypt(body.cmd_password);
    if (typeof body.mfa_secret === 'string') patch.mfa_secret_encrypted = encrypt(body.mfa_secret);

    // Membro não muda a empresa do próprio terminal (fica na empresa dele).
    if (req.member) delete patch.empresa_id;

    // DESIGNAÇÃO: só o DONO designa um terminal a um membro (ou o deixa livre).
    // member_user_id = null → terminal livre (compartilhado); = <uuid> → exclusivo.
    if (!req.member && 'member_user_id' in body) {
      const alvo = body.member_user_id;
      if (alvo === null || alvo === '') {
        patch.member_user_id = null;
      } else {
        // Valida: o alvo é membro deste tenant e da MESMA empresa do terminal.
        const { data: conta } = await supabaseAdmin.from('clinic_accounts').select('empresa_id').eq('id', id).eq('tenant_id', req.tenant!.id).maybeSingle();
        const { data: mem } = await (supabaseAdmin as any).from('tenant_members').select('empresa_id').eq('tenant_id', req.tenant!.id).eq('user_id', String(alvo)).maybeSingle();
        if (!mem) return reply.code(400).send({ error: 'Membro inválido.' });
        if ((conta as any)?.empresa_id && (mem as any).empresa_id && (conta as any).empresa_id !== (mem as any).empresa_id) {
          return reply.code(400).send({ error: 'O terminal e o membro precisam ser da mesma empresa.' });
        }
        patch.member_user_id = String(alvo);
      }
    }

    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'Nada para atualizar.' });

    let upd = supabaseAdmin
      .from('clinic_accounts')
      .update(patch as Database['public']['Tables']['clinic_accounts']['Update'])
      .eq('id', id)
      .eq('tenant_id', req.tenant!.id);
    if (req.member) upd = upd.eq('member_user_id', req.member.user_id); // só o próprio terminal
    const { data, error } = await upd.select(SELECT_CONTA).maybeSingle();
    if (error) {
      req.log.error(error);
      return reply.code(500).send({ error: 'Falha ao atualizar a conta.' });
    }
    if (!data) return reply.code(404).send({ error: 'Conta não encontrada.' });
    return data;
  });

  // Remove uma conta CMD.
  app.delete('/clinic-accounts/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    let del = supabaseAdmin
      .from('clinic_accounts')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenant!.id);
    if (req.member) del = del.eq('member_user_id', req.member.user_id); // só o próprio terminal
    const { error } = await del;
    if (error) {
      req.log.error(error);
      return reply.code(500).send({ error: 'Falha ao remover a conta.' });
    }
    return reply.code(204).send();
  });

  // Atualiza os dados da própria clínica (como custo de funcionário).
  app.patch('/clinic', { preHandler: app.authenticate }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (body.custo_mensal_funcionario !== undefined) {
      const val = Number(body.custo_mensal_funcionario);
      if (Number.isNaN(val) || val < 0) {
        return reply.code(400).send({ error: 'custo_mensal_funcionario deve ser um número não negativo.' });
      }
      patch.custo_mensal_funcionario = val;
    }
    // Custos REAIS do funcionário (módulo de Economia). Todos numéricos >= 0.
    const camposCusto = ['salario_bruto_medio', 'porcentagem_encargos', 'beneficios_mensais_total', 'custo_infra_estacao_trabalho'] as const;
    for (const c of camposCusto) {
      if (body[c] !== undefined) {
        const val = Number(body[c]);
        if (Number.isNaN(val) || val < 0) return reply.code(400).send({ error: `${c} inválido.` });
        patch[c] = val;
      }
    }
    if (body.horas_uteis_mes !== undefined) {
      const val = Number(body.horas_uteis_mes);
      if (Number.isNaN(val) || val <= 0) return reply.code(400).send({ error: 'horas_uteis_mes deve ser maior que zero.' });
      patch.horas_uteis_mes = Math.round(val);
    }
    if (body.funcionarios_operacao !== undefined) {
      const val = Number(body.funcionarios_operacao);
      if (Number.isNaN(val) || val < 0) return reply.code(400).send({ error: 'funcionarios_operacao inválido.' });
      patch.funcionarios_operacao = Math.round(val);
    }
    if (body.cadastros_dia_funcionario !== undefined) {
      const val = Number(body.cadastros_dia_funcionario);
      if (Number.isNaN(val) || val < 0) return reply.code(400).send({ error: 'cadastros_dia_funcionario inválido.' });
      patch.cadastros_dia_funcionario = Math.round(val);
    }

    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: 'Nada para atualizar.' });
    }

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .update(patch as Database['public']['Tables']['tenants']['Update'])
      .eq('id', req.tenant!.id)
      .select('*')
      .single();

    return data;
  });

  // ---- Solicitações de terminais (contratação) -----------------------------
  app.get('/terminal-requests', { preHandler: app.authenticate }, async (req) => {
    const { data } = await (supabaseAdmin as any)
      .from('terminal_requests')
      .select('*')
      .eq('tenant_id', req.tenant!.id)
      .order('created_at', { ascending: false });
    return data ?? [];
  });

  app.post('/terminal-requests', { preHandler: app.authenticate }, async (req, reply) => {
    const body = (req.body ?? {}) as { empresa_id?: number };
    let empresaId = body.empresa_id ? Number(body.empresa_id) : null;

    if (empresaId) {
      const { data: emp } = await supabaseAdmin
        .from('empresas').select('id').eq('id', empresaId).eq('tenant_id', req.tenant!.id).maybeSingle();
      if (!emp) return reply.code(400).send({ error: 'Empresa inválida ou não pertence a esta clínica.' });
    } else {
      // Sem empresa informada → usa a 1ª empresa do assinante.
      const { data: emp } = await supabaseAdmin
        .from('empresas').select('id').eq('tenant_id', req.tenant!.id).order('id', { ascending: true }).limit(1).maybeSingle();
      if (!emp) return reply.code(400).send({ error: 'Cadastre uma empresa antes de contratar um terminal.' });
      empresaId = emp.id;
    }

    // Bloqueia se já há pedido pendente para ESTA empresa.
    const { data: pending } = await (supabaseAdmin as any)
      .from('terminal_requests')
      .select('id')
      .eq('tenant_id', req.tenant!.id)
      .eq('empresa_id', empresaId)
      .eq('status', 'pending')
      .maybeSingle();

    if (pending) {
      return reply.code(400).send({ error: 'Já há uma solicitação de terminal pendente para esta empresa.' });
    }

    const { data, error } = await (supabaseAdmin as any)
      .from('terminal_requests')
      .insert({
        tenant_id: req.tenant!.id,
        empresa_id: empresaId,
        status: 'pending'
      })
      .select('*')
      .single();

    if (error || !data) {
      req.log.error(error);
      return reply.code(500).send({ error: 'Falha ao criar solicitação de terminal.' });
    }
    await registrarLog({
      tenantId: req.tenant!.id, categoria: 'terminal', acao: 'terminal.solicitado', nivel: 'info', ator: ator(req),
      descricao: `${atorNome(req)} solicitou um novo terminal (aguardando aprovação do super admin).`,
      meta: { empresa_id: empresaId },
    });
    return reply.code(201).send(data);
  });
}
