import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import { registrarLog, ator, atorNome } from '../lib/audit';
import { getPrecos, precoTerminalNaPosicao } from '../lib/precos';

/**
 * Monta o resumo do PLANO de um assinante (tenant):
 *  - implantação (única) do assinante;
 *  - empresas, cada uma com sua taxa e seus terminais (= contas CMD);
 *  - mensalidade = total de terminais × valor por terminal.
 * Reusado pelo painel do assinante e pela gestão do super admin.
 */
/** Aplica cancelamentos de terminal cuja data já chegou: remove os terminais
 * agendados (reduz terminais_contratados) e zera o agendamento. Assim, depois
 * da data contratada, não gera mais cobrança. */
export async function aplicarCancelamentosVencidos(tenantId: number): Promise<void> {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: emps } = await (supabaseAdmin as any)
    .from('empresas').select('id, terminais_contratados, cancelar_terminais, cancelar_em').eq('tenant_id', tenantId);
  let removidos = 0;
  for (const e of (emps ?? []) as any[]) {
    const qtd = Number(e.cancelar_terminais ?? 0);
    if (qtd > 0 && e.cancelar_em && String(e.cancelar_em) <= hoje) {
      const novo = Math.max(0, Number(e.terminais_contratados ?? 0) - qtd);
      await (supabaseAdmin as any).from('empresas')
        .update({ terminais_contratados: novo, cancelar_terminais: 0, cancelar_em: null }).eq('id', e.id);
      removidos += Number(e.terminais_contratados ?? 0) - novo;
    }
  }
  // Reduz também a cota total (max_terminais) do assinante, coerente com o billing.
  if (removidos > 0) {
    const { data: t } = await supabaseAdmin.from('tenants').select('max_terminais').eq('id', tenantId).maybeSingle();
    const novoMax = Math.max(0, Number((t as any)?.max_terminais ?? 0) - removidos);
    await (supabaseAdmin as any).from('tenants').update({ max_terminais: novoMax }).eq('id', tenantId);
  }
}

export async function montarPlano(tenantId: number) {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, name, valor_terminal, valor_implantacao, implantacao_paga')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return null;

  // Aplica cancelamentos cuja data já passou antes de calcular a conta.
  await aplicarCancelamentosVencidos(tenantId);

  const [{ data: empresas }, { data: contas }] = await Promise.all([
    (supabaseAdmin as any).from('empresas').select('id, nome, cnpj, taxa_empresa, taxa_paga, terminais_contratados, cancelar_terminais, cancelar_em').eq('tenant_id', tenantId).order('id', { ascending: true }),
    supabaseAdmin.from('clinic_accounts').select('id, empresa_id').eq('tenant_id', tenantId),
  ]);

  // Contas CMD (terminais) efetivamente CONFIGURADAS por empresa.
  const configuradasPorEmpresa = new Map<number, number>();
  for (const c of contas ?? []) {
    if (c.empresa_id != null) configuradasPorEmpresa.set(c.empresa_id, (configuradasPorEmpresa.get(c.empresa_id) ?? 0) + 1);
  }

  // Preços ESCALONADOS (globais): 1º terminal, 2º com desconto, etc. As
  // posições são contadas em sequência pelo total do assinante (as empresas
  // são percorridas em ordem).
  const precos = await getPrecos();
  let pos = 0;
  const empresasOut = ((empresas ?? []) as any[]).map((e: any) => {
    const terminais = Number((e as { terminais_contratados?: number }).terminais_contratados ?? 0);
    const configurados = configuradasPorEmpresa.get(e.id) ?? 0;
    let mensalEmp = 0;
    for (let i = 0; i < terminais; i++) { pos += 1; mensalEmp += precoTerminalNaPosicao(precos, pos); }
    return {
      id: e.id,
      nome: e.nome,
      cnpj: e.cnpj,
      taxa_empresa: Number(e.taxa_empresa),
      taxa_paga: e.taxa_paga,
      terminais, // contratados (faturados)
      cancelar_terminais: Number((e as { cancelar_terminais?: number }).cancelar_terminais ?? 0),
      cancelar_em: (e as { cancelar_em?: string | null }).cancelar_em ?? null,
      configurados, // contas CMD já conectadas
      mensal: mensalEmp, // soma escalonada dos terminais desta empresa
    };
  });

  const totalTerminais = pos;
  // Contas CMD sem empresa (órfãs) — atenção operacional, não entram na conta.
  const naoAlocados = (contas ?? []).filter((c) => c.empresa_id == null).length;
  const taxasEmpresa = empresasOut.reduce((s, e) => s + e.taxa_empresa, 0);
  const valorImplantacao = precos.implantacao;
  const mensal = empresasOut.reduce((s, e) => s + e.mensal, 0);

  return {
    tenant_id: tenant.id,
    tenant_nome: tenant.name,
    valor_terminal: precoTerminalNaPosicao(precos, 1), // preço base (1º terminal) p/ referência
    valor_implantacao: valorImplantacao,
    implantacao_paga: tenant.implantacao_paga,
    precos, // tabela de preços vigente
    proximo_terminal: precoTerminalNaPosicao(precos, totalTerminais + 1), // quanto custa o próximo
    empresas: empresasOut,
    total_terminais: totalTerminais,
    nao_alocados: naoAlocados,
    mensal,
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

  // Descontratar (cancelar) 1 terminal — cobrança segue até o fim do período
  // atual e, a partir daí, o terminal sai da conta (não gera mais cobrança).
  app.post('/empresas/:id/descontratar-terminal', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    const { data: emp } = await (supabaseAdmin as any)
      .from('empresas').select('id, nome, terminais_contratados, cancelar_terminais')
      .eq('id', id).eq('tenant_id', req.tenant!.id).maybeSingle();
    if (!emp) return reply.code(404).send({ error: 'empresa não encontrada.' });
    const ativos = Number(emp.terminais_contratados ?? 0) - Number(emp.cancelar_terminais ?? 0);
    if (ativos <= 0) return reply.code(400).send({ error: 'Não há terminal ativo para descontratar nesta empresa.' });
    // Vale até o fim do mês atual; some da conta no 1º dia do mês que vem.
    const hoje = new Date();
    const cancelarEm = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1).toISOString().slice(0, 10);
    await (supabaseAdmin as any).from('empresas')
      .update({ cancelar_terminais: Number(emp.cancelar_terminais ?? 0) + 1, cancelar_em: cancelarEm }).eq('id', id);
    await registrarLog({
      tenantId: req.tenant!.id, categoria: 'terminal', acao: 'terminal.descontratado', nivel: 'alerta', ator: ator(req),
      descricao: `${atorNome(req)} descontratou 1 terminal de ${emp.nome} (cobrança até o fim do mês; sai da conta em ${cancelarEm}).`,
      meta: { empresa_id: id, cancelar_em: cancelarEm },
    });
    return { ok: true, cancelar_em: cancelarEm };
  });

  // Desfazer um cancelamento agendado (enquanto ainda não venceu).
  app.post('/empresas/:id/desfazer-cancelamento', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    const { data: emp } = await (supabaseAdmin as any)
      .from('empresas').select('id, nome, cancelar_terminais').eq('id', id).eq('tenant_id', req.tenant!.id).maybeSingle();
    if (!emp) return reply.code(404).send({ error: 'empresa não encontrada.' });
    const qtd = Number(emp.cancelar_terminais ?? 0);
    if (qtd <= 0) return reply.code(400).send({ error: 'Não há cancelamento agendado para desfazer.' });
    const novo = qtd - 1;
    await (supabaseAdmin as any).from('empresas')
      .update({ cancelar_terminais: novo, cancelar_em: novo > 0 ? undefined : null }).eq('id', id);
    await registrarLog({
      tenantId: req.tenant!.id, categoria: 'terminal', acao: 'terminal.cancelamento_desfeito', nivel: 'info', ator: ator(req),
      descricao: `${atorNome(req)} desfez o cancelamento de 1 terminal de ${emp.nome}.`,
      meta: { empresa_id: id },
    });
    return { ok: true };
  });
}
