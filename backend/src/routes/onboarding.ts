import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';

/**
 * Garante que o assinante já nasça com 1 TERMINAL contratado e auto-aprovado
 * (custo mensal de 1 terminal — R$ 2.000 na tabela padrão), para o onboarding
 * conseguir criar a conta CMD sem esbarrar na cota `max_terminais` (que nasce 0).
 * O USO segue bloqueado até o super admin aprovar a conta (requireActive).
 *
 * Idempotente: se o tenant já tem empresa, apenas devolve a primeira (para
 * alocar a conta). Só provisiona quando ainda não há nenhuma empresa.
 * Retorna o id da empresa onde a conta CMD deve ser alocada (ou null).
 */
async function garantirTerminalInicial(tenantId: number, nomeEmpresa: string): Promise<number | null> {
  const { data: emps } = await (supabaseAdmin as any)
    .from('empresas')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('id', { ascending: true });
  if (emps && emps.length > 0) return (emps[0] as { id: number }).id;

  // Cria a empresa padrão com 1 terminal contratado (auto-aprovado, faturável).
  const { data: emp } = await (supabaseAdmin as any)
    .from('empresas')
    .insert({ tenant_id: tenantId, nome: (nomeEmpresa || 'Minha operação').slice(0, 120), terminais_contratados: 1 })
    .select('id')
    .single();

  // Sobe a cota total para liberar a conexão da conta CMD (1º terminal).
  const { data: t } = await supabaseAdmin.from('tenants').select('max_terminais').eq('id', tenantId).maybeSingle();
  const novoMax = Math.max(1, Number((t as any)?.max_terminais ?? 0));
  await (supabaseAdmin as any).from('tenants').update({ max_terminais: novoMax }).eq('id', tenantId);

  return (emp as { id: number } | null)?.id ?? null;
}

/**
 * Onboarding: cria a clínica (tenant) do usuário recém-cadastrado. Idempotente
 * — se já existe, devolve a existente. Usa authenticateUser (não exige clínica).
 */
export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/onboarding', { preHandler: app.authenticateUser }, async (req, reply) => {
    const userId = req.authUser!.id;
    const body = (req.body ?? {}) as {
      name?: string; cnpj?: string; responsavel?: string; telefone?: string; cidade?: string;
    };
    const name = (body.name ?? '').trim() || `Clínica de ${req.authUser!.email ?? 'usuário'}`;
    const extra = {
      cnpj: body.cnpj?.trim() || null,
      responsavel: body.responsavel?.trim() || null,
      telefone: body.telefone?.trim() || null,
      cidade: body.cidade?.trim() || null,
    };

    const { data: existente } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('owner_user_id', userId)
      .maybeSingle();
    if (existente) {
      // Idempotente: atualiza os dados da clínica se reenviado no onboarding.
      const { data: upd } = await supabaseAdmin
        .from('tenants')
        .update({ name, ...extra })
        .eq('id', existente.id)
        .select('*')
        .single();
      const empresaId = await garantirTerminalInicial(existente.id, name);
      return { ...(upd ?? existente), default_empresa_id: empresaId };
    }

    // Nasce PENDENTE — o super admin precisa liberar (status -> active).
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .insert({ name, owner_user_id: userId, status: 'pending_approval', ...extra })
      .select('*')
      .single();
    if (error || !data) {
      req.log.error(error);
      return reply.code(500).send({ error: 'Falha ao criar a clínica.' });
    }
    // Já contrata + aprova 1 terminal (R$ 2.000/mês) para o onboarding conseguir
    // conectar a conta CMD. O uso continua travado até a aprovação do super admin.
    const empresaId = await garantirTerminalInicial(data.id, name);
    return reply.code(201).send({ ...data, default_empresa_id: empresaId });
  });
}
