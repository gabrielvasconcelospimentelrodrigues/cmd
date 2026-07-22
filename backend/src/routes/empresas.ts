import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import { registrarLog, ator, atorNome } from '../lib/audit';
import { getPrecos, precoTerminalNaPosicao } from '../lib/precos';
import { pixDaCobranca, boletoDaCobranca, pagarComCartao, criarAssinaturaCartao } from '../lib/asaas';
import { validaCpfCnpj, soDigitos } from '../lib/documento';

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
    .select('id, name, valor_terminal, valor_implantacao, implantacao_paga, isento_pagamento, isento_ate')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return null;

  // Aplica cancelamentos cuja data já passou antes de calcular a conta.
  await aplicarCancelamentosVencidos(tenantId);

  const [{ data: empresas }, { data: contas }] = await Promise.all([
    (supabaseAdmin as any).from('empresas').select('id, nome, cnpj, responsavel, telefone, taxa_empresa, taxa_paga, terminais_contratados, cancelar_terminais, cancelar_em').eq('tenant_id', tenantId).order('id', { ascending: true }),
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
      responsavel: e.responsavel ?? null,
      telefone: e.telefone ?? null,
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
    // true = parceiro/teste: usa a automação sem pagar.
    isento_pagamento: (tenant as any).isento_pagamento ?? false,
    // null = indeterminado (parceiro); data = fim do período de teste.
    isento_ate: (tenant as any).isento_ate ?? null,
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
      // pago_manual: fatura lançada pelo super admin (pago por fora do Asaas).
      .select('id, tipo, descricao, referencia, valor, vencimento, status, pago_em, link_pagamento, pago_manual, empresas(nome)')
      .eq('tenant_id', req.tenant!.id)
      .order('vencimento', { ascending: false });
    return data ?? [];
  });

  /**
   * PIX da fatura (QR Code + copia-e-cola) para pagar SEM sair do painel.
   *
   * Mandar o cliente para a página do Asaas funciona, mas tira ele do produto
   * no momento mais sensível. Aqui devolvemos os dados crus e o painel desenha
   * o checkout — o pagamento continua sendo processado pelo Asaas.
   */
  app.get('/minhas-faturas/:id/pix', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });

    // Só a fatura DESTE assinante — o filtro por tenant é a checagem de dono.
    const { data: f } = await (supabaseAdmin as any)
      .from('faturas')
      .select('id, valor, status, descricao, vencimento, asaas_payment_id, link_pagamento')
      .eq('id', id)
      .eq('tenant_id', req.tenant!.id)
      .maybeSingle();

    if (!f) return reply.code(404).send({ error: 'Fatura não encontrada.' });
    if (f.status === 'pago') return { pago: true };
    if (!f.asaas_payment_id) {
      return reply.code(409).send({ error: 'Esta fatura ainda não tem cobrança emitida. Fale com o suporte.' });
    }

    const pix = await pixDaCobranca(f.asaas_payment_id);
    if (!pix) {
      // Sem QR (ex.: Asaas fora do ar) o cliente ainda paga pela página deles.
      return reply.code(502).send({ error: 'Não foi possível gerar o PIX agora.', link_pagamento: f.link_pagamento });
    }

    return {
      pago: false,
      valor: Number(f.valor),
      descricao: f.descricao,
      vencimento: f.vencimento,
      qr_base64: pix.encodedImage,
      copia_e_cola: pix.payload,
      expira_em: pix.expirationDate ?? null,
      // Boleto e cartão seguem na página do Asaas.
      link_pagamento: f.link_pagamento,
    };
  });

  /** Boleto: linha digitável e código de barras, para copiar sem sair do painel. */
  app.get('/minhas-faturas/:id/boleto', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    const { data: f } = await (supabaseAdmin as any)
      .from('faturas').select('id, status, asaas_payment_id, link_pagamento')
      .eq('id', id).eq('tenant_id', req.tenant!.id).maybeSingle();
    if (!f) return reply.code(404).send({ error: 'Fatura não encontrada.' });
    if (f.status === 'pago') return { pago: true };
    if (!f.asaas_payment_id) return reply.code(409).send({ error: 'Cobrança ainda não emitida.' });

    const b = await boletoDaCobranca(f.asaas_payment_id);
    if (!b) return reply.code(502).send({ error: 'Não foi possível gerar o boleto agora.', link_pagamento: f.link_pagamento });
    return { pago: false, linha_digitavel: b.identificationField, codigo_barras: b.barCode, link_pagamento: f.link_pagamento };
  });

  /**
   * CARTÃO — checkout transparente.
   *
   * ⚠️ Os dados do cartão só passam por aqui a caminho do Asaas: não são
   * gravados, não entram em log e não voltam na resposta. Por isso a rota
   * devolve apenas ok/erro.
   */
  app.post('/minhas-faturas/:id/cartao', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });

    const { data: f } = await (supabaseAdmin as any)
      .from('faturas').select('id, status, valor, asaas_payment_id')
      .eq('id', id).eq('tenant_id', req.tenant!.id).maybeSingle();
    if (!f) return reply.code(404).send({ error: 'Fatura não encontrada.' });
    if (f.status === 'pago') return { ok: true, ja_pago: true };
    if (!f.asaas_payment_id) return reply.code(409).send({ error: 'Cobrança ainda não emitida.' });

    const b = (req.body ?? {}) as any;
    const c = b.cartao ?? {};
    const t = b.titular ?? {};
    const faltando = ['holderName', 'number', 'expiryMonth', 'expiryYear', 'ccv'].filter((k) => !String(c[k] ?? '').trim());
    if (faltando.length) return reply.code(400).send({ error: 'Preencha todos os dados do cartão.' });
    for (const k of ['name', 'email', 'cpfCnpj', 'postalCode', 'addressNumber'] as const) {
      if (!String(t[k] ?? '').trim()) return reply.code(400).send({ error: 'Preencha todos os dados do titular.' });
    }

    const r = await pagarComCartao(
      f.asaas_payment_id,
      {
        holderName: String(c.holderName).trim(),
        number: String(c.number).replace(/\D/g, ''),
        expiryMonth: String(c.expiryMonth).padStart(2, '0'),
        expiryYear: String(c.expiryYear).length === 2 ? `20${c.expiryYear}` : String(c.expiryYear),
        ccv: String(c.ccv).trim(),
      },
      {
        name: String(t.name).trim(),
        email: String(t.email).trim(),
        cpfCnpj: String(t.cpfCnpj).replace(/\D/g, ''),
        postalCode: String(t.postalCode).replace(/\D/g, ''),
        addressNumber: String(t.addressNumber).trim(),
        phone: String(t.phone ?? '').replace(/\D/g, '') || undefined,
      },
      // O Asaas usa o IP na análise antifraude.
      String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0]!.trim(),
    );

    if (!r.ok) return reply.code(400).send({ error: r.erro });

    // RECORRÊNCIA: parte do plano, não opção — pagar no cartão deixa a
    // mensalidade no automático. Só vale para a mensalidade; proporcional de
    // terminal é cobrança única e não deve recorrer.
    // Falhar aqui NÃO invalida o pagamento já aprovado: o cliente pagou, o
    // acesso libera, e a recorrência pode ser refeita depois.
    let recorrencia: { ativa: boolean; erro?: string } = { ativa: false };
    if (f.tipo === 'mensalidade') {
      const plano = await montarPlano(req.tenant!.id);
      const mensal = Number(plano?.mensal ?? 0);
      if (mensal > 0) {
        const a = await criarAssinaturaCartao({
          tenantId: req.tenant!.id,
          valorMensal: mensal,
          descricao: `Mensalidade IA-CMD — ${plano?.total_terminais ?? 1} terminal(is)`,
          cartao: {
            holderName: String(c.holderName).trim(),
            number: String(c.number).replace(/\D/g, ''),
            expiryMonth: String(c.expiryMonth).padStart(2, '0'),
            expiryYear: String(c.expiryYear).length === 2 ? `20${c.expiryYear}` : String(c.expiryYear),
            ccv: String(c.ccv).trim(),
          },
          titular: {
            name: String(t.name).trim(),
            email: String(t.email).trim(),
            cpfCnpj: String(t.cpfCnpj).replace(/\D/g, ''),
            postalCode: String(t.postalCode).replace(/\D/g, ''),
            addressNumber: String(t.addressNumber).trim(),
            phone: String(t.phone ?? '').replace(/\D/g, '') || undefined,
          },
          remoteIp: String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0]!.trim(),
        });
        recorrencia = a.ok ? { ativa: true } : { ativa: false, erro: a.erro };
      }
    }

    // A baixa em si vem pelo webhook (fonte única da verdade), como no PIX.
    return { ok: true, status: r.status, recorrencia };
  });

  /** Status da fatura — o checkout consulta para fechar sozinho ao ser pago. */
  app.get('/minhas-faturas/:id/status', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    const { data: f } = await (supabaseAdmin as any)
      .from('faturas').select('status').eq('id', id).eq('tenant_id', req.tenant!.id).maybeSingle();
    if (!f) return reply.code(404).send({ error: 'Fatura não encontrada.' });
    return { status: f.status, pago: f.status === 'pago' };
  });

  // Empresas do assinante.
  app.get('/empresas', { preHandler: [app.authenticate] }, async (req) => {
    let query = supabaseAdmin
      .from('empresas')
      .select('id, nome, cnpj, responsavel, telefone, taxa_empresa, taxa_paga, terminais_contratados, created_at')
      .eq('tenant_id', req.tenant!.id);

    if (req.member) {
      if (req.member.empresa_id == null) {
        return [];
      }
      query = query.eq('id', req.member.empresa_id);
    }

    const { data } = await query.order('id', { ascending: true });
    return data ?? [];
  });

  // Cadastrar nova empresa (a taxa é definida depois pelo super admin).
  app.post('/empresas', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const body = (req.body ?? {}) as { nome?: string; cnpj?: string };
    if (!body.nome || !body.nome.trim()) return reply.code(400).send({ error: 'nome da empresa é obrigatório.' });
    // CNPJ é opcional na criação (o cliente pode completar depois pelo alerta),
    // mas se vier, tem de ser válido — a cobrança do Asaas depende dele.
    if (body.cnpj && body.cnpj.trim() && !validaCpfCnpj(body.cnpj)) {
      return reply.code(400).send({ error: 'CPF/CNPJ inválido. Confira os dígitos.' });
    }
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

  /**
   * EDITAR EMPRESA — dados cadastrais de faturamento (nome, CNPJ, contato).
   * Não existia edição; o cliente não tinha como corrigir um CNPJ errado.
   * O CNPJ é validado pelos dígitos verificadores porque a cobrança do Asaas
   * depende dele. Trocar o documento zera o cliente Asaas da empresa (o Asaas
   * casa pagamento por esse id; manter o antigo cobraria com o dado errado).
   */
  app.patch('/empresas/:id', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });
    const { data: emp } = await (supabaseAdmin as any)
      .from('empresas').select('id, cnpj').eq('id', id).eq('tenant_id', req.tenant!.id).maybeSingle();
    if (!emp) return reply.code(404).send({ error: 'Empresa não encontrada.' });

    const body = (req.body ?? {}) as { nome?: string; cnpj?: string; responsavel?: string; telefone?: string };
    const patch: Record<string, unknown> = {};
    if (body.nome !== undefined) {
      if (!body.nome.trim()) return reply.code(400).send({ error: 'O nome da empresa não pode ficar vazio.' });
      patch.nome = body.nome.trim();
    }
    if (body.cnpj !== undefined) {
      const doc = body.cnpj.trim();
      if (doc && !validaCpfCnpj(doc)) return reply.code(400).send({ error: 'CPF/CNPJ inválido. Confira os dígitos — falta ou sobra algum número.' });
      patch.cnpj = doc;
    }
    if (body.responsavel !== undefined) patch.responsavel = body.responsavel.trim() || null;
    if (body.telefone !== undefined) patch.telefone = body.telefone.trim() || null;
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'Nada para atualizar.' });

    const { data, error } = await (supabaseAdmin as any)
      .from('empresas').update(patch).eq('id', id).select('id, nome, cnpj, responsavel, telefone').single();
    if (error) return reply.code(400).send({ error: error.message });

    // Documento mudou → o cliente Asaas da empresa ficou defasado.
    if (body.cnpj !== undefined && soDigitos(body.cnpj) !== soDigitos(emp.cnpj)) {
      await (supabaseAdmin as any).from('empresas').update({ asaas_customer_id: null }).eq('id', id);
    }
    await registrarLog({
      tenantId: req.tenant!.id, categoria: 'empresa', acao: 'empresa.editada', nivel: 'info', ator: ator(req),
      descricao: `${atorNome(req)} atualizou os dados da empresa ${data.nome}.`,
      meta: { empresa_id: id },
    });
    return data;
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

  // ---- EQUIPE: membros da empresa (login e conta CMD próprios) — DONO apenas --

  // Lista os membros de uma empresa (com flag de CMD já conectado).
  app.get('/empresas/:id/membros', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.member) return reply.code(403).send({ error: 'Apenas o titular gerencia a equipe.' });
    const empresaId = Number((req.params as { id: string }).id);
    const { data: emp } = await supabaseAdmin.from('empresas').select('id').eq('id', empresaId).eq('tenant_id', req.tenant!.id).maybeSingle();
    if (!emp) return reply.code(404).send({ error: 'empresa não encontrada.' });

    const { data: membros } = await (supabaseAdmin as any)
      .from('tenant_members')
      .select('id, user_id, nome, email, role, created_at')
      .eq('tenant_id', req.tenant!.id).eq('empresa_id', empresaId)
      .order('created_at', { ascending: true });
    const lista = (membros ?? []) as any[];

    // Quem já conectou a própria conta CMD.
    const conectados = new Set<string>();
    if (lista.length) {
      const { data: contas } = await supabaseAdmin
        .from('clinic_accounts').select('member_user_id')
        .in('member_user_id', lista.map((m) => m.user_id));
      for (const c of contas ?? []) if ((c as any).member_user_id) conectados.add((c as any).member_user_id);
    }
    return lista.map((m) => ({ ...m, cmd_conectado: conectados.has(m.user_id) }));
  });

  // Cria um membro (login próprio) na empresa; reserva/contrata 1 terminal.
  app.post('/empresas/:id/membros', { preHandler: [app.authenticate, app.requireActive] }, async (req, reply) => {
    if (req.member) return reply.code(403).send({ error: 'Apenas o titular gerencia a equipe.' });
    const empresaId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { nome?: string; email?: string; senha?: string };
    const email = (body.email ?? '').trim().toLowerCase();
    const senha = body.senha ?? '';
    if (!email || !senha) return reply.code(400).send({ error: 'e-mail e senha são obrigatórios.' });
    if (senha.length < 6) return reply.code(400).send({ error: 'a senha deve ter ao menos 6 caracteres.' });

    const { data: emp } = await supabaseAdmin.from('empresas').select('id, nome').eq('id', empresaId).eq('tenant_id', req.tenant!.id).maybeSingle();
    if (!emp) return reply.code(404).send({ error: 'empresa não encontrada.' });

    // Cria o usuário de auth (login próprio, já confirmado).
    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email, password: senha, email_confirm: true, user_metadata: { full_name: body.nome?.trim() || email },
    });
    if (cErr || !created?.user) {
      const jaExiste = (cErr?.message ?? '').toLowerCase().includes('already') || (cErr as any)?.code === 'email_exists';
      return reply.code(400).send({ error: jaExiste ? 'Já existe um usuário com esse e-mail.' : (cErr?.message || 'Falha ao criar o login do membro.') });
    }
    const userId = created.user.id;

    const { data: membro, error: mErr } = await (supabaseAdmin as any)
      .from('tenant_members')
      .insert({ tenant_id: req.tenant!.id, empresa_id: empresaId, user_id: userId, nome: body.nome?.trim() || null, email })
      .select('id, user_id, nome, email, role, created_at').single();
    if (mErr || !membro) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {}); // rollback do login
      return reply.code(500).send({ error: 'Falha ao vincular o membro.' });
    }

    // Não designa terminal aqui: o membro usa os terminais LIVRES da empresa e o
    // admin pode designar terminais específicos a ele (aba Configurações).

    await registrarLog({
      tenantId: req.tenant!.id, categoria: 'equipe', acao: 'membro.criado', nivel: 'sucesso', ator: ator(req),
      descricao: `${atorNome(req)} adicionou ${email} à equipe de ${emp.nome}.`,
      meta: { empresa_id: empresaId, user_id: userId },
    });
    return reply.code(201).send({ ...(membro as any), cmd_conectado: false });
  });

  // Remove um membro: apaga o login, o vínculo e os terminais dele.
  app.delete('/membros/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.member) return reply.code(403).send({ error: 'Apenas o titular gerencia a equipe.' });
    const id = Number((req.params as { id: string }).id);
    const { data: m } = await (supabaseAdmin as any)
      .from('tenant_members').select('id, user_id, email').eq('id', id).eq('tenant_id', req.tenant!.id).maybeSingle();
    if (!m) return reply.code(404).send({ error: 'membro não encontrado.' });
    await supabaseAdmin.from('clinic_accounts').delete().eq('tenant_id', req.tenant!.id).eq('member_user_id', (m as any).user_id);
    await (supabaseAdmin as any).from('tenant_members').delete().eq('id', id).eq('tenant_id', req.tenant!.id);
    await supabaseAdmin.auth.admin.deleteUser((m as any).user_id).catch(() => {});
    await registrarLog({
      tenantId: req.tenant!.id, categoria: 'equipe', acao: 'membro.removido', nivel: 'alerta', ator: ator(req),
      descricao: `${atorNome(req)} removeu ${(m as any).email} da equipe.`,
      meta: { user_id: (m as any).user_id },
    });
    return { ok: true };
  });

  // Remove uma empresa: desvincula terminais, membros, uploads, execuções e remove a empresa
  app.delete('/empresas/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.member) return reply.code(403).send({ error: 'Apenas o titular pode excluir empresas.' });
    const id = Number((req.params as { id: string }).id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'id inválido.' });

    const { data: emp } = await supabaseAdmin
      .from('empresas')
      .select('id, nome, terminais_contratados')
      .eq('id', id)
      .eq('tenant_id', req.tenant!.id)
      .maybeSingle();

    if (!emp) return reply.code(404).send({ error: 'empresa não encontrada.' });

    // Desvincula referências com segurança para evitar erros de FK
    await Promise.all([
      supabaseAdmin.from('clinic_accounts').update({ empresa_id: null }).eq('empresa_id', id).eq('tenant_id', req.tenant!.id),
      supabaseAdmin.from('tenant_members').update({ empresa_id: null }).eq('empresa_id', id).eq('tenant_id', req.tenant!.id),
      (supabaseAdmin as any).from('uploads').update({ empresa_id: null }).eq('empresa_id', id),
      (supabaseAdmin as any).from('execucoes_automacao').update({ empresa_id: null }).eq('empresa_id', id),
      (supabaseAdmin as any).from('faturas').update({ empresa_id: null }).eq('empresa_id', id).eq('tenant_id', req.tenant!.id),
    ]);

    const { error: delErr } = await supabaseAdmin
      .from('empresas')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenant!.id);

    if (delErr) {
      req.log.error(delErr);
      return reply.code(500).send({ error: 'Falha ao excluir a empresa.' });
    }

    const terminaisExcluidos = Number(emp.terminais_contratados ?? 0);
    if (terminaisExcluidos > 0) {
      const { data: t } = await supabaseAdmin.from('tenants').select('max_terminais').eq('id', req.tenant!.id).maybeSingle();
      if (t) {
        const novoMax = Math.max(0, Number((t as any).max_terminais ?? 0) - terminaisExcluidos);
        await (supabaseAdmin as any).from('tenants').update({ max_terminais: novoMax }).eq('id', req.tenant!.id);
      }
    }

    await registrarLog({
      tenantId: req.tenant!.id, categoria: 'empresa', acao: 'empresa.excluida', nivel: 'alerta', ator: ator(req),
      descricao: `${atorNome(req)} excluiu a empresa ${emp.nome} (removidos ${terminaisExcluidos} terminal(is) contratado(s)).`,
      meta: { empresa_id: id },
    });

    return { ok: true };
  });

  // Todos os membros do tenant (para designar terminais nas Configurações). Dono.
  app.get('/equipe', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.member) return reply.code(403).send({ error: 'Apenas o titular gerencia a equipe.' });
    const { data } = await (supabaseAdmin as any)
      .from('tenant_members')
      .select('id, user_id, nome, email, empresa_id, created_at')
      .eq('tenant_id', req.tenant!.id)
      .order('created_at', { ascending: true });
    return data ?? [];
  });
}
