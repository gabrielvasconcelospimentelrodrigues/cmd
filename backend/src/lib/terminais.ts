/**
 * TERMINAIS — preço do próximo terminal e liberação após o pagamento.
 *
 * Vive aqui, e não dentro de uma rota, porque duas portas chegam ao mesmo
 * lugar: o cliente que contrata e paga sozinho (webhook do Asaas libera) e o
 * super admin que libera na mão (cortesia). As duas têm de contar terminal e
 * preço exatamente igual — se divergirem, o cliente é cobrado por um valor e
 * recebe outro.
 */
import { supabaseAdmin } from './supabase';
import { getPrecos, precoTerminalNaPosicao } from './precos';

export interface ProporcionalTerminal {
  valor: number;
  referencia: string;   // 'YYYY-MM'
  vencimento: string;   // 'YYYY-MM-DD'
  descricao: string;
  posicao: number;      // qual terminal é este (1º, 2º…) — define o preço escalonado
}

/**
 * Preço do PRÓXIMO terminal, proporcional aos dias que faltam no mês.
 *
 * Cobra só o que resta do mês porque a mensalidade cheia do ciclo seguinte já
 * incluirá este terminal — sem o pró-rata, o cliente pagaria um mês inteiro por
 * poucos dias de uso.
 */
export async function calcularProporcionalProximoTerminal(tenantId: number): Promise<ProporcionalTerminal> {
  const precos = await getPrecos();
  const { data: emps } = await supabaseAdmin
    .from('empresas').select('terminais_contratados').eq('tenant_id', tenantId);
  const totalAtual = (emps ?? []).reduce(
    (s, e) => s + Number((e as { terminais_contratados?: number }).terminais_contratados ?? 0), 0,
  );

  // O terminal que está sendo contratado é o próximo da fila — é a POSIÇÃO
  // dele que define o preço (escalonado: 1º mais caro, 2º com desconto…).
  const posicao = totalAtual + 1;
  const valorCheio = precoTerminalNaPosicao(precos, posicao);

  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const diaAtual = hoje.getDate();
  const diasRestantes = diasNoMes - diaAtual + 1;
  const valor = Math.round(valorCheio * (diasRestantes / diasNoMes) * 100) / 100;
  const referencia = `${ano}-${String(mes + 1).padStart(2, '0')}`;
  // 5 dias para pagar (boleto); no PIX cai na hora.
  const vencimento = new Date(ano, mes, Math.min(diaAtual + 5, diasNoMes)).toISOString().slice(0, 10);

  return {
    valor,
    referencia,
    vencimento,
    posicao,
    descricao: `Novo terminal — proporcional (${diasRestantes}/${diasNoMes} dias de ${referencia})`,
  };
}

/**
 * Libera de fato o terminal: soma na empresa, na cota do assinante e marca a
 * solicitação como aprovada.
 *
 * IDEMPOTENTE — só age se a solicitação ainda estiver 'pending'. É essencial:
 * o webhook do Asaas reenvia o mesmo evento até receber 200, e o super admin
 * pode aprovar em paralelo. Sem essa trava, o cliente ganharia 2 terminais
 * pagando 1.
 */
export async function liberarTerminal(requestId: number, origem: string): Promise<boolean> {
  const { data: pedido } = await (supabaseAdmin as any)
    .from('terminal_requests')
    .select('id, tenant_id, empresa_id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (!pedido || pedido.status !== 'pending') return false;

  // Marca ANTES de somar: se algo falhar no meio, o pior caso é um terminal não
  // creditado (visível e corrigível) em vez de creditado duas vezes.
  const { data: travou } = await (supabaseAdmin as any)
    .from('terminal_requests')
    .update({ status: 'approved', resolved_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'pending') // trava otimista: só vence quem chegar primeiro
    .select('id')
    .maybeSingle();

  if (!travou) return false; // outro processo já liberou

  if (pedido.empresa_id) {
    const { data: emp } = await supabaseAdmin
      .from('empresas').select('terminais_contratados').eq('id', pedido.empresa_id).maybeSingle();
    await (supabaseAdmin as any)
      .from('empresas')
      .update({ terminais_contratados: Number((emp as any)?.terminais_contratados ?? 0) + 1 })
      .eq('id', pedido.empresa_id);
  }

  const { data: t } = await supabaseAdmin
    .from('tenants').select('max_terminais').eq('id', pedido.tenant_id).maybeSingle();
  await (supabaseAdmin as any)
    .from('tenants')
    .update({ max_terminais: Number((t as any)?.max_terminais ?? 0) + 1 })
    .eq('id', pedido.tenant_id);

  console.info(`[terminais] pedido #${requestId} liberado (${origem}).`);
  return true;
}
