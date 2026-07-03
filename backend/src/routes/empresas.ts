import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import { registrarLog, ator, atorNome } from '../lib/audit';

/**
 * Monta o resumo do PLANO de um assinante (tenant):
 *  - implantação (única) do assinante;
 *  - empresas, cada uma com sua taxa e seus terminais (= contas CMD);
 *  - mensalidade = total de terminais × valor por terminal.
 * Reusado pelo painel do assinante e pela gestão do super admin.
 */
export async function montarPlano(tenantId: number) {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, name, valor_terminal, valor_implantacao, implantacao_paga')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return null;

  const [{ data: empresas }, { data: contas }] = await Promise.all([
    supabaseAdmin.from('empresas').select('id, nome, cnpj, taxa_empresa, taxa_paga, terminais_contratados').eq('tenant_id', tenantId).order('id', { ascending: true }),
    supabaseAdmin.from('clinic_accounts').select('id, empresa_id').eq('tenant_id', tenantId),
  ]);

  // Contas CMD (terminais) efetivamente CONFIGURADAS por empresa.
  const configuradasPorEmpresa = new Map<number, number>();
  for (const c of contas ?? []) {
    if (c.empresa_id != null) configuradasPorEmpresa.set(c.empresa_id, (configuradasPorEmpresa.get(c.empresa_id) ?? 0) + 1);
  }

  const valorTerminal = Number(tenant.valor_terminal);
  const empresasOut = (empresas ?? []).map((e) => {
    // Faturamento é pelo CONTRATADO (cada terminal aprovado = +1 funcionário).
    const terminais = Number((e as { terminais_contratados?: number }).terminais_contratados ?? 0);
    const configurados = configuradasPorEmpresa.get(e.id) ?? 0;
    return {
      id: e.id,
      nome: e.nome,
      cnpj: e.cnpj,
      taxa_empresa: Number(e.taxa_empresa),
      taxa_paga: e.taxa_paga,
      terminais, // contratados (faturados)
      configurados, // contas CMD já conectadas
      mensal: terminais * valorTerminal,
    };
  });

  const totalTerminais = empresasOut.reduce((s, e) => s + e.terminais, 0);
  // Contas CMD sem empresa (órfãs) — atenção operacional, não entram na conta.
  const naoAlocados = (contas ?? []).filter((c) => c.empresa_id == null).length;
  const taxasEmpresa = empresasOut.reduce((s, e) => s + e.taxa_empresa, 0);
  const valorImplantacao = Number(tenant.valor_implantacao);

  return {
    tenant_id: tenant.id,
    tenant_nome: tenant.name,
    valor_terminal: valorTerminal,
    valor_implantacao: valorImplantacao,
    implantacao_paga: tenant.implantacao_paga,
    empresas: empresasOut,
    total_terminais: totalTerminais,
    nao_alocados: naoAlocados,
    mensal: totalTerminais * valorTerminal,
    taxas_empresa: taxasEmpresa,
    total_unico: valorImplantacao + taxasEmpresa, // implantação + taxas das empresas
  };
}

/** Rotas do ASSINANTE: ver o próprio plano e cadastrar empresas. */
export async function empresaRoutes(app: FastifyInstance): Promise<void> {
  // Resumo do plano do assinante logado.
  app.get('/plano', { preHandler: [app.authenticate] }, async (req) => {
    return (await montarPlano(req.tenant!.id)) ?? {};
  });

  // Faturas REAIS do assinante logado (histórico de faturamento).
  app.get('/minhas-faturas', { preHandler: [app.authenticate] }, async (req) => {
    const { data } = await (supabaseAdmin as any)
      .from('faturas')
      .select('id, tipo, descricao, referencia, valor, vencimento, status, pago_em, empresas(nome)')
      .eq('tenant_id', req.tenant!.id)
      .order('vencimento', { ascending: false });
    return data ?? [];
  });

  // Empresas do assinante.
  app.get('/empresas', { preHandler: [app.authenticate] }, async (req) => {
    const { data } = await supabaseAdmin
      .from('empresas')
      .select('id, nome, cnpj, taxa_empresa, taxa_paga, terminais_contratados, created_at')
      .eq('tenant_id', req.tenant!.id)
      .order('id', { ascending: true });
    return data ?? [];
  });

  // Cadastrar nova empresa (a taxa é definida depois pelo super admin).
  app.post('/empresas', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const body = (req.body ?? {}) as { nome?: string; cnpj?: string };
    if (!body.nome || !body.nome.trim()) return reply.code(400).send({ error: 'nome da empresa é obrigatório.' });
    const { data, error } = await supabaseAdmin
      .from('empresas')
      .insert({ tenant_id: req.tenant!.id, nome: body.nome.trim(), cnpj: (body.cnpj ?? '').trim() })
      .select('id, nome, cnpj, taxa_empresa, taxa_paga, created_at')
      .single();
    if (error || !data) {
      req.log.error(error);
      return reply.code(500).send({ error: 'falha ao cadastrar a empresa.' });
    }
    await registrarLog({
      tenantId: req.tenant!.id, categoria: 'empresa', acao: 'empresa.criada', nivel: 'sucesso', ator: ator(req),
      descricao: `${atorNome(req)} cadastrou a empresa ${data.nome}.`,
      meta: { empresa_id: data.id },
    });
    return reply.code(201).send(data);
  });
}
