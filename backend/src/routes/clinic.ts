import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import { encrypt } from '../lib/crypto';
import { registrarLog, ator, atorNome } from '../lib/audit';
import type { Database } from '../types/database';

/**
 * Rotas da clínica do usuário autenticado: dados da própria clínica e as
 * contas CMD-COLETA. Credenciais cifradas NUNCA são retornadas.
 */
export async function clinicRoutes(app: FastifyInstance): Promise<void> {
  // Quem sou eu + minha clínica.
  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    return { user: req.authUser, tenant: req.tenant };
  });

  // Contas CMD-COLETA da clínica (sem expor senha/MFA cifrados).
  app.get('/clinic-accounts', { preHandler: app.authenticate }, async (req) => {
    const { data } = await supabaseAdmin
      .from('clinic_accounts')
      .select(
        'id, label, cmd_username, is_enabled, cid_padrao, dias_execucao, horario_inicio_execucao, ' +
          'horario_fim_execucao, pausa_inicio, pausa_fim, delay_inicio_minutos, ' +
          'empresa_id, last_run_at, last_run_status, created_at',
      )
      .eq('tenant_id', req.tenant!.id)
      .order('created_at', { ascending: true });
    return data ?? [];
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

    // Check terminal limit
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('max_terminais')
      .eq('id', req.tenant!.id)
      .maybeSingle();

    const maxTerminais = Number((tenant as any)?.max_terminais ?? 1);

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
      })
      .select('id, label, cmd_username, is_enabled, empresa_id, created_at')
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

    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'Nada para atualizar.' });

    const { data, error } = await supabaseAdmin
      .from('clinic_accounts')
      .update(patch as Database['public']['Tables']['clinic_accounts']['Update'])
      .eq('id', id)
      .eq('tenant_id', req.tenant!.id)
      .select('id, label, cmd_username, is_enabled, cid_padrao, dias_execucao, horario_inicio_execucao, horario_fim_execucao, pausa_inicio, pausa_fim, delay_inicio_minutos, empresa_id, last_run_at, last_run_status, created_at')
      .maybeSingle();
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
    const { error } = await supabaseAdmin
      .from('clinic_accounts')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenant!.id);
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
