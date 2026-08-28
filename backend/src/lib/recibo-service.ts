import { supabaseAdmin } from './supabase';
import { getEmitente, emitenteConfigurado } from './emitente';
import { gerarReciboPdf, nomeArquivoRecibo, type FaturaRecibo, type PagadorRecibo } from './recibo';

export type MotivoRecibo = 'nao_encontrada' | 'nao_paga' | 'emitente_ausente';

export interface ReciboPronto {
  ok: true;
  pdf: Buffer;
  arquivo: string;
  tenantId: number;
  descricao: string;
  valor: number;
}

export interface ReciboRecusado {
  ok: false;
  motivo: MotivoRecibo;
}

const MENSAGEM: Record<MotivoRecibo, string> = {
  nao_encontrada: 'Fatura não encontrada.',
  nao_paga: 'O recibo só existe depois que a fatura é paga.',
  emitente_ausente: 'Preencha os dados do emitente antes de emitir recibos (Super admin → Recibo).',
};

export const mensagemRecusa = (m: MotivoRecibo) => MENSAGEM[m];

/** Código HTTP de cada recusa: 404 some, 409 é estado errado, 412 é
 * configuração faltando — o front distingue "não existe" de "falta ajustar". */
export const httpRecusa = (m: MotivoRecibo): number =>
  m === 'nao_encontrada' ? 404 : m === 'nao_paga' ? 409 : 412;

/**
 * Monta o PDF do recibo de uma fatura PAGA.
 *
 * `tenantId` restringe ao assinante dono da fatura (uso do cliente). Passar
 * null libera qualquer fatura — só para as rotas de super admin, onde a
 * checagem de permissão já foi feita pelo preHandler.
 */
export async function montarRecibo(
  faturaId: number,
  tenantId: number | null,
): Promise<ReciboPronto | ReciboRecusado> {
  let q = (supabaseAdmin as any)
    .from('faturas')
    .select('id, tenant_id, tipo, descricao, referencia, valor, vencimento, status, pago_em, pago_manual, asaas_payment_id, empresas(nome)')
    .eq('id', faturaId);
  if (tenantId !== null) q = q.eq('tenant_id', tenantId);

  const { data: f } = await q.maybeSingle();
  if (!f) return { ok: false, motivo: 'nao_encontrada' };
  // Recibo é prova de quitação: fatura aberta ou cancelada não gera nenhum.
  if (f.status !== 'pago') return { ok: false, motivo: 'nao_paga' };

  const emitente = await getEmitente();
  if (!emitenteConfigurado(emitente)) return { ok: false, motivo: 'emitente_ausente' };

  const { data: t } = await (supabaseAdmin as any)
    .from('tenants')
    .select('name, cnpj, responsavel, telefone, cidade, uf')
    .eq('id', f.tenant_id)
    .maybeSingle();

  const cidadeUf = [t?.cidade, t?.uf].filter(Boolean).join(' — ');
  const pagador: PagadorRecibo = {
    nome: t?.name ?? 'Assinante',
    documento: t?.cnpj ?? null,
    endereco: cidadeUf || null,
    telefone: t?.telefone ?? null,
    responsavel: t?.responsavel ?? null,
    empresa_nome: f.empresas?.nome ?? null,
  };

  const fatura: FaturaRecibo = {
    id: Number(f.id),
    tipo: f.tipo,
    descricao: f.descricao,
    referencia: f.referencia,
    valor: f.valor,
    vencimento: f.vencimento,
    status: f.status,
    pago_em: f.pago_em,
    pago_manual: !!f.pago_manual,
    asaas_payment_id: f.asaas_payment_id,
  };

  const pdf = await gerarReciboPdf(fatura, pagador, emitente);
  return {
    ok: true,
    pdf,
    arquivo: nomeArquivoRecibo(fatura, pagador),
    tenantId: Number(f.tenant_id),
    descricao: f.descricao || f.tipo,
    valor: Number(f.valor),
  };
}
