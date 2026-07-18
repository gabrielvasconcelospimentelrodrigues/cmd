/**
 * GATE DE PAGAMENTO (worker) — espelha backend/src/lib/acesso.ts.
 *
 * Precisa existir AQUI também: a extração agenda o registro sozinha após o
 * upload (extraction.worker), sem passar pela rota /iniciar. Sem este gate, o
 * bloqueio seria burlado só subindo uma planilha.
 */
import { supabaseAdmin } from './supabase';

export interface AcessoAutomacao {
  liberado: boolean;
  motivo: 'implantacao_pendente' | 'mensalidade_pendente' | 'inadimplente' | null;
  mensagem: string;
}

/** Libera se ISENTO (conta interna), ou se implantação + mensalidade pagas e sem fatura vencida. */
export async function verificarAcessoAutomacao(tenantId: number): Promise<AcessoAutomacao> {
  const { data: tenant } = await (supabaseAdmin as any)
    .from('tenants')
    .select('id, isento_pagamento, isento_ate, implantacao_paga, valor_implantacao')
    .eq('id', tenantId)
    .maybeSingle();

  // Sem tenant não dá para afirmar que está bloqueado — não travamos a operação.
  if (!tenant) return { liberado: true, motivo: null, mensagem: '' };

  // Isenção vale enquanto vigente: sem checar a data, um período de teste com
  // prazo marcado nunca terminaria e o cliente ficaria de graça para sempre.
  if (tenant.isento_pagamento) {
    const vigente = !tenant.isento_ate
      || String(tenant.isento_ate).slice(0, 10) >= new Date().toISOString().slice(0, 10);
    if (vigente) return { liberado: true, motivo: null, mensagem: '' };
  }

  if (!tenant.implantacao_paga && Number(tenant.valor_implantacao ?? 0) > 0) {
    return {
      liberado: false,
      motivo: 'implantacao_pendente',
      mensagem: 'Automação bloqueada: o período de teste terminou e a implantação ainda não foi paga. Regularize para voltar a cadastrar.',
    };
  }

  // Comprova pagamento do uso dos terminais. 'terminal_proporcional' conta:
  // quem contrata no MEIO do mês paga o pró-rata e só recebe a 1ª mensalidade
  // cheia no ciclo seguinte — sem isso ficaria bloqueado mesmo pagando certo.
  const { data: pagas } = await (supabaseAdmin as any)
    .from('faturas')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('tipo', ['mensalidade', 'terminal_proporcional'])
    .eq('status', 'pago')
    .limit(1);

  if (!pagas || pagas.length === 0) {
    return {
      liberado: false,
      motivo: 'mensalidade_pendente',
      mensagem: 'Automação bloqueada: o período de teste terminou e não há mensalidade paga. Regularize para voltar a cadastrar.',
    };
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const { data: vencidas } = await (supabaseAdmin as any)
    .from('faturas')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'aberto')
    .lt('vencimento', hoje)
    .limit(1);

  if (vencidas && vencidas.length > 0) {
    return {
      liberado: false,
      motivo: 'inadimplente',
      mensagem: 'Automação bloqueada: há fatura(s) vencida(s) em aberto. Regularize o pagamento para usar os terminais.',
    };
  }

  return { liberado: true, motivo: null, mensagem: '' };
}
