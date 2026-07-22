/**
 * ASAAS — cobrança online (PIX / boleto / cartão) das faturas do assinante.
 *
 * Papel no sistema: fecha o ciclo do dinheiro. Hoje o super admin dá baixa na
 * mão; com isto o cliente paga, o Asaas avisa por webhook e a fatura vira
 * 'pago' sozinha — e o gate de pagamento (lib/acesso.ts) libera a automação.
 *
 * Princípio de segurança adotado aqui: falha ao cobrar NUNCA quebra o fluxo de
 * faturamento. Se o Asaas estiver fora ou o cadastro do cliente incompleto, a
 * fatura é criada assim mesmo e o motivo fica em faturas.erro_cobranca — a
 * cobrança pode ser reemitida depois. O contrário (não emitir a fatura porque
 * o gateway caiu) faria o cliente sumir da régua de cobrança.
 */
import { env } from '../config/env';
import { supabaseAdmin } from './supabase';

export interface CobrancaCriada {
  asaas_payment_id: string;
  link_pagamento: string;
}

/** true quando há chave configurada — sem ela, seguimos com baixa manual. */
export function asaasAtivo(): boolean {
  return !!env.ASAAS_API_KEY;
}

async function chamar<T>(caminho: string, metodo: 'GET' | 'POST' | 'DELETE', corpo?: unknown): Promise<T> {
  const resp = await fetch(`${env.ASAAS_BASE_URL}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      access_token: env.ASAAS_API_KEY ?? '',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  const texto = await resp.text();
  let json: any = {};
  try { json = texto ? JSON.parse(texto) : {}; } catch { /* resposta não-JSON */ }

  if (!resp.ok) {
    // O Asaas devolve os problemas em errors[].description — bem mais útil que
    // "400 Bad Request" para quem for ler o log ou o erro_cobranca.
    const detalhe = Array.isArray(json?.errors) && json.errors.length
      ? json.errors.map((e: any) => e.description).join('; ')
      : texto.slice(0, 200);
    throw new Error(`Asaas ${resp.status}: ${detalhe}`);
  }
  return json as T;
}

export interface PixDaCobranca {
  encodedImage: string;   // QR Code em base64 (PNG)
  payload: string;        // copia-e-cola
  expirationDate?: string;
}

/**
 * QR Code + copia-e-cola do PIX de uma cobrança, para o checkout dentro do
 * painel. Devolve null em qualquer falha: o painel cai para a página do Asaas
 * em vez de deixar o cliente sem como pagar.
 */
export async function pixDaCobranca(paymentId: string): Promise<PixDaCobranca | null> {
  if (!asaasAtivo()) return null;
  try {
    return await chamar<PixDaCobranca>(`/payments/${paymentId}/pixQrCode`, 'GET');
  } catch (e) {
    console.error(`[asaas] falha ao obter PIX de ${paymentId}:`, (e as Error).message);
    return null;
  }
}

/** Linha digitável e código de barras do boleto, para exibir sem sair do painel. */
export async function boletoDaCobranca(paymentId: string): Promise<{ identificationField: string; barCode: string } | null> {
  if (!asaasAtivo()) return null;
  try {
    return await chamar(`/payments/${paymentId}/identificationField`, 'GET');
  } catch (e) {
    console.error(`[asaas] falha ao obter boleto de ${paymentId}:`, (e as Error).message);
    return null;
  }
}

export interface DadosCartao {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}
export interface TitularCartao {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone?: string;
}

/**
 * Paga a cobrança com CARTÃO (checkout transparente).
 *
 * ⚠️ SEGURANÇA: os dados do cartão apenas ATRAVESSAM esta função a caminho do
 * Asaas — nunca são gravados em banco, nem escritos em log, nem devolvidos ao
 * cliente. Qualquer erro é logado só com a mensagem do Asaas, jamais com o
 * corpo da requisição (que contém o número do cartão).
 */
export async function pagarComCartao(
  paymentId: string,
  cartao: DadosCartao,
  titular: TitularCartao,
  remoteIp: string,
): Promise<{ ok: true; status: string } | { ok: false; erro: string }> {
  if (!asaasAtivo()) return { ok: false, erro: 'Pagamento por cartão indisponível no momento.' };
  try {
    const r = await chamar<{ status: string }>(`/payments/${paymentId}/payWithCreditCard`, 'POST', {
      creditCard: cartao,
      creditCardHolderInfo: titular,
      remoteIp,
    });
    return { ok: true, status: r.status };
  } catch (e) {
    // Só a mensagem — nunca o payload.
    const erro = (e as Error).message.replace(/Asaas \d+: /, '');
    console.error(`[asaas] cartão recusado na cobrança ${paymentId}: ${erro}`);
    return { ok: false, erro };
  }
}

/**
 * Cria (ou substitui) a ASSINATURA mensal no cartão do cliente.
 *
 * É o que dá recorrência de verdade: o Asaas passa a cobrar sozinho todo mês e
 * avisa por webhook. Sem isso, cada mensalidade dependia de alguém lembrar de
 * gerar e do cliente lembrar de pagar — inadimplência por esquecimento.
 *
 * O cartão é enviado UMA vez; a partir daí o Asaas guarda o token e nós nunca
 * mais tocamos nesses dados.
 */
export async function criarAssinaturaCartao(opts: {
  tenantId: number;
  valorMensal: number;
  descricao: string;
  cartao: DadosCartao;
  titular: TitularCartao;
  remoteIp: string;
}): Promise<{ ok: true; subscriptionId: string } | { ok: false; erro: string }> {
  if (!asaasAtivo()) return { ok: false, erro: 'Cobrança indisponível no momento.' };
  try {
    const customer = await garantirClienteAsaas(opts.tenantId);

    // Cancela uma assinatura anterior para não cobrar duas vezes o mesmo mês
    // (ex.: cliente que trocou de cartão ou mudou de plano).
    const { data: t } = await (supabaseAdmin as any)
      .from('tenants').select('asaas_subscription_id').eq('id', opts.tenantId).maybeSingle();
    if (t?.asaas_subscription_id) {
      await chamar(`/subscriptions/${t.asaas_subscription_id}`, 'DELETE').catch(() => {});
    }

    // Próximo ciclo: um mês a partir de hoje (o mês atual já foi pago à vista).
    const prox = new Date();
    prox.setMonth(prox.getMonth() + 1);

    const assinatura = await chamar<{ id: string }>('/subscriptions', 'POST', {
      customer,
      billingType: 'CREDIT_CARD',
      cycle: 'MONTHLY',
      value: opts.valorMensal,
      nextDueDate: prox.toISOString().slice(0, 10),
      description: opts.descricao,
      creditCard: opts.cartao,
      creditCardHolderInfo: opts.titular,
      remoteIp: opts.remoteIp,
      externalReference: `tenant:${opts.tenantId}`,
    });

    await (supabaseAdmin as any)
      .from('tenants').update({ asaas_subscription_id: assinatura.id }).eq('id', opts.tenantId);

    return { ok: true, subscriptionId: assinatura.id };
  } catch (e) {
    const erro = (e as Error).message.replace(/Asaas \d+: /, '');
    console.error(`[asaas] falha ao criar assinatura do tenant ${opts.tenantId}: ${erro}`);
    return { ok: false, erro };
  }
}

/** Dados de uma cobrança (usado pelo webhook para faturar o que o Asaas gerou). */
export async function buscarCobranca(paymentId: string): Promise<any | null> {
  if (!asaasAtivo()) return null;
  try {
    return await chamar(`/payments/${paymentId}`, 'GET');
  } catch { return null; }
}

/** Só dígitos; CPF tem 11 e CNPJ 14 — o Asaas recusa qualquer outra coisa. */
export function documentoValido(doc: string | null | undefined): string | null {
  const d = String(doc ?? '').replace(/\D/g, '');
  return d.length === 11 || d.length === 14 ? d : null;
}

interface TenantParaCobranca {
  id: number;
  name: string;
  cnpj: string | null;
  responsavel: string | null;
  telefone: string | null;
  asaas_customer_id: string | null;
}

/**
 * Devolve o id do cliente no Asaas, criando-o na primeira vez e guardando em
 * tenants.asaas_customer_id. Reaproveitar é essencial: criar um cliente novo a
 * cada cobrança espalharia o histórico do assinante em vários cadastros.
 */
export async function garantirClienteAsaas(tenantId: number): Promise<string> {
  const { data: t } = await (supabaseAdmin as any)
    .from('tenants')
    .select('id, name, cnpj, responsavel, telefone, asaas_customer_id, owner_user_id')
    .eq('id', tenantId)
    .maybeSingle();

  if (!t) throw new Error(`Assinante #${tenantId} não encontrado.`);
  if (t.asaas_customer_id) return t.asaas_customer_id as string;

  const doc = documentoValido(t.cnpj);
  if (!doc) {
    throw new Error(
      `CPF/CNPJ do assinante "${t.name}" ausente ou inválido (valor atual: ${t.cnpj ?? 'vazio'}). ` +
      'O Asaas exige um documento válido — corrija em Configurações antes de cobrar.',
    );
  }

  // E-mail do titular: o Asaas usa para enviar a cobrança.
  const { data: u } = await (supabaseAdmin as any).auth.admin.getUserById(t.owner_user_id);
  const email = u?.user?.email ?? undefined;

  const criado = await chamar<{ id: string }>('/customers', 'POST', {
    name: t.name,
    cpfCnpj: doc,
    email,
    mobilePhone: String(t.telefone ?? '').replace(/\D/g, '') || undefined,
    // Liga o cliente do Asaas ao nosso assinante (facilita conferência lá).
    externalReference: `tenant:${t.id}`,
    notificationDisabled: false,
  });

  await (supabaseAdmin as any).from('tenants').update({ asaas_customer_id: criado.id }).eq('id', t.id);
  return criado.id;
}

/**
 * Cliente Asaas de uma EMPRESA (cada CNPJ é um cliente lá). Usado quando a
 * fatura é de uma empresa específica — os terminais são ligados ao CNPJ da
 * empresa, então a cobrança sai no documento dela, não no do assinante.
 * Cai para o cliente do assinante se a empresa não tiver CNPJ válido.
 */
export async function garantirClienteAsaasEmpresa(empresaId: number, tenantId: number): Promise<string> {
  const { data: e } = await (supabaseAdmin as any)
    .from('empresas').select('id, nome, cnpj, responsavel, telefone, asaas_customer_id, tenant_id')
    .eq('id', empresaId).maybeSingle();

  // Sem empresa ou sem CNPJ válido → usa o cliente do assinante (comportamento antigo).
  if (!e || !documentoValido(e.cnpj)) return garantirClienteAsaas(tenantId);
  if (e.asaas_customer_id) return e.asaas_customer_id as string;

  const { data: t } = await (supabaseAdmin as any)
    .from('tenants').select('owner_user_id').eq('id', e.tenant_id).maybeSingle();
  const { data: u } = t ? await (supabaseAdmin as any).auth.admin.getUserById(t.owner_user_id) : { data: null };
  const email = u?.user?.email ?? undefined;

  const criado = await chamar<{ id: string }>('/customers', 'POST', {
    name: e.nome,
    cpfCnpj: documentoValido(e.cnpj),
    email,
    mobilePhone: String(e.telefone ?? '').replace(/\D/g, '') || undefined,
    externalReference: `empresa:${e.id}`,
    notificationDisabled: false,
  });
  await (supabaseAdmin as any).from('empresas').update({ asaas_customer_id: criado.id }).eq('id', e.id);
  return criado.id;
}

interface FaturaParaCobranca {
  id: number;
  tenant_id: number;
  empresa_id?: number | null;
  valor: number | string;
  vencimento: string;
  descricao: string | null;
  tipo: string;
}

/**
 * Cria a cobrança da fatura e grava o id + link nela.
 *
 * billingType 'UNDEFINED': o Asaas mostra PIX, boleto e cartão e o cliente
 * escolhe — não faz sentido decidirmos por ele.
 *
 * NÃO lança: em caso de falha grava faturas.erro_cobranca e devolve null, para
 * que a emissão da fatura nunca dependa do gateway estar de pé.
 */
export async function criarCobrancaAsaas(fatura: FaturaParaCobranca): Promise<CobrancaCriada | null> {
  if (!asaasAtivo()) return null;

  try {
    // Fatura de uma empresa → cobra no CNPJ da empresa; senão, no do assinante.
    const customer = fatura.empresa_id
      ? await garantirClienteAsaasEmpresa(fatura.empresa_id, fatura.tenant_id)
      : await garantirClienteAsaas(fatura.tenant_id);
    const pagamento = await chamar<{ id: string; invoiceUrl: string }>('/payments', 'POST', {
      customer,
      billingType: 'UNDEFINED',
      value: Number(fatura.valor),
      dueDate: String(fatura.vencimento).slice(0, 10),
      description: fatura.descricao || fatura.tipo,
      // É por aqui que conferimos, no webhook, que a cobrança é nossa.
      externalReference: `fatura:${fatura.id}`,
    });

    await (supabaseAdmin as any).from('faturas').update({
      asaas_payment_id: pagamento.id,
      link_pagamento: pagamento.invoiceUrl,
      erro_cobranca: null,
    }).eq('id', fatura.id);

    return { asaas_payment_id: pagamento.id, link_pagamento: pagamento.invoiceUrl };
  } catch (e) {
    const motivo = (e as Error).message.slice(0, 500);
    console.error(`[asaas] falha ao cobrar fatura #${fatura.id}:`, motivo);
    await (supabaseAdmin as any).from('faturas').update({ erro_cobranca: motivo }).eq('id', fatura.id);
    return null;
  }
}
