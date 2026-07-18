/**
 * WEBHOOK DO ASAAS — dá baixa automática quando o cliente paga.
 *
 * É a única rota do sistema que NÃO exige login: quem chama é o Asaas, não um
 * usuário. Por isso a autenticação é o token combinado no painel do Asaas e
 * enviado no header 'asaas-access-token'. Sem essa checagem, qualquer um
 * poderia forjar "pagamento recebido" e liberar a automação sem pagar.
 */
import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import { env } from '../config/env';
import { registrarLog } from '../lib/audit';

/** A baixa não tem um usuário por trás — quem agiu foi o gateway. */
const ATOR_ASAAS = { usuario_id: null, actor_nome: 'Asaas (automático)', actor_email: null, actor_role: 'sistema' };

/** Eventos que significam dinheiro entrando. */
const EVENTOS_PAGOS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);
/** Eventos que desfazem o pagamento — a fatura volta a dever. */
const EVENTOS_ESTORNO = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_DELETED', 'PAYMENT_RESTORED']);

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/asaas', async (req, reply) => {
    // 1) Autentica a origem.
    const token = req.headers['asaas-access-token'];
    if (!env.ASAAS_WEBHOOK_TOKEN || token !== env.ASAAS_WEBHOOK_TOKEN) {
      req.log.warn('[asaas] webhook recusado: token ausente ou inválido.');
      return reply.code(401).send({ error: 'não autorizado' });
    }

    const corpo = (req.body ?? {}) as { event?: string; payment?: { id?: string; value?: number } };
    const evento = corpo.event ?? '';
    const pagamentoId = corpo.payment?.id;
    if (!pagamentoId) return { ok: true, ignorado: 'sem payment.id' };

    // 2) Acha a fatura pelo id da cobrança. Se não for nossa, ignoramos com 200:
    // devolver erro faria o Asaas reenviar o evento indefinidamente.
    const { data: fatura } = await (supabaseAdmin as any)
      .from('faturas')
      .select('id, tenant_id, status, valor, descricao, tipo')
      .eq('asaas_payment_id', pagamentoId)
      .maybeSingle();

    if (!fatura) {
      req.log.warn(`[asaas] evento ${evento} de cobrança desconhecida (${pagamentoId}).`);
      return { ok: true, ignorado: 'fatura não encontrada' };
    }

    if (EVENTOS_PAGOS.has(evento)) {
      // IDEMPOTENTE: o Asaas reenvia o evento até receber 200, e manda
      // CONFIRMED e depois RECEIVED para o mesmo pagamento. Sem esta guarda,
      // a mesma fatura seria "paga" várias vezes e poluiria o log financeiro.
      if (fatura.status === 'pago') return { ok: true, ja_estava: 'pago' };

      await (supabaseAdmin as any)
        .from('faturas')
        .update({ status: 'pago', pago_em: new Date().toISOString() })
        .eq('id', fatura.id);

      await registrarLog({
        tenantId: fatura.tenant_id,
        categoria: 'financeiro',
        acao: 'fatura.baixa_automatica',
        nivel: 'sucesso',
        ator: ATOR_ASAAS,
        descricao: `Pagamento confirmado pelo Asaas — baixa automática da fatura "${fatura.descricao || fatura.tipo}" (R$ ${Number(fatura.valor).toFixed(2)}).`,
        meta: { fatura_id: fatura.id, asaas_payment_id: pagamentoId, evento },
      });

      req.log.info(`[asaas] fatura #${fatura.id} baixada por ${evento}.`);
      return { ok: true, baixada: fatura.id };
    }

    if (EVENTOS_ESTORNO.has(evento)) {
      // Estorno/exclusão: volta a dever. Importante para o gate — senão um
      // pagamento estornado seguiria liberando a automação.
      if (fatura.status !== 'pago') return { ok: true, ja_estava: fatura.status };

      await (supabaseAdmin as any)
        .from('faturas')
        .update({ status: 'aberto', pago_em: null })
        .eq('id', fatura.id);

      await registrarLog({
        tenantId: fatura.tenant_id,
        categoria: 'financeiro',
        acao: 'fatura.estorno',
        nivel: 'alerta',
        ator: ATOR_ASAAS,
        descricao: `Asaas informou ${evento} — a fatura "${fatura.descricao || fatura.tipo}" voltou para em aberto.`,
        meta: { fatura_id: fatura.id, asaas_payment_id: pagamentoId, evento },
      });

      req.log.warn(`[asaas] fatura #${fatura.id} reaberta por ${evento}.`);
      return { ok: true, reaberta: fatura.id };
    }

    // Demais eventos (criada, vencida, etc.) não mudam o status aqui.
    return { ok: true, ignorado: evento };
  });
}
