/**
 * GATE DE PAGAMENTO — fonte ÚNICA da verdade sobre "esta clínica pode rodar
 * automação?". O período de teste acabou: o que libera a automação é o
 * pagamento (implantação + mensalidade). O LOGIN segue livre — bloqueamos
 * apenas a automação.
 *
 * Usado no backend (rota /iniciar e /me). O worker tem a MESMA regra em
 * workers/src/lib/acesso.ts — o gate precisa existir nos dois porque a extração
 * agenda o registro sozinha após o upload, sem passar pela rota /iniciar.
 */
import { supabaseAdmin } from './supabase';

export type MotivoBloqueio = 'implantacao_pendente' | 'mensalidade_pendente' | 'inadimplente';

export interface AcessoAutomacao {
  liberado: boolean;
  motivo: MotivoBloqueio | null;
  /** Texto curto para log/erro de API (o modal do painel tem o texto próprio). */
  mensagem: string;
  valor_implantacao: number;
  /** Total vencido em aberto (só preenchido quando motivo = 'inadimplente'). */
  valor_vencido: number;
}

const LIBERADO: AcessoAutomacao = { liberado: true, motivo: null, mensagem: '', valor_implantacao: 0, valor_vencido: 0 };

/** Tenant já carregado (o authenticate faz select('*')) — evita re-buscar. */
export interface TenantAcesso {
  id: number;
  isento_pagamento?: boolean | null;
  implantacao_paga?: boolean | null;
  valor_implantacao?: number | string | null;
}

/**
 * Regra: libera se ISENTO, ou se (implantação paga E mensalidade paga E sem
 * fatura vencida). Ordem importa — devolvemos o motivo mais "à frente" na
 * jornada de cobrança primeiro (implantação antes de mensalidade).
 */
export async function verificarAcessoAutomacao(tenant: TenantAcesso): Promise<AcessoAutomacao> {
  // Contas internas (demo/teste) rodam sem pagar.
  if (tenant.isento_pagamento) return LIBERADO;

  const valorImplantacao = Number(tenant.valor_implantacao ?? 0);

  // 1) Implantação. Curto-circuito: quem não pagou a implantação já está
  // bloqueado, então nem consultamos faturas (economiza egress no /me, que o
  // painel chama a cada 6s).
  if (!tenant.implantacao_paga && valorImplantacao > 0) {
    return {
      liberado: false,
      motivo: 'implantacao_pendente',
      mensagem: 'Automação bloqueada: a implantação ainda não foi paga.',
      valor_implantacao: valorImplantacao,
      valor_vencido: 0,
    };
  }

  // 2) Mensalidade: precisa de ao menos uma fatura de mensalidade PAGA.
  const { data: pagas } = await (supabaseAdmin as any)
    .from('faturas')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('tipo', 'mensalidade')
    .eq('status', 'pago')
    .limit(1);

  if (!pagas || pagas.length === 0) {
    return {
      liberado: false,
      motivo: 'mensalidade_pendente',
      mensagem: 'Automação bloqueada: nenhuma mensalidade paga.',
      valor_implantacao: valorImplantacao,
      valor_vencido: 0,
    };
  }

  // 3) Inadimplência (regra que já existia): fatura em aberto e vencida.
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: vencidas } = await (supabaseAdmin as any)
    .from('faturas')
    .select('valor')
    .eq('tenant_id', tenant.id)
    .eq('status', 'aberto')
    .lt('vencimento', hoje);

  if (vencidas && vencidas.length > 0) {
    const total = (vencidas as { valor: number | string }[]).reduce((s, f) => s + Number(f.valor), 0);
    return {
      liberado: false,
      motivo: 'inadimplente',
      mensagem: 'Automação bloqueada: há fatura(s) vencida(s) em aberto. Regularize o pagamento para usar os terminais.',
      valor_implantacao: valorImplantacao,
      valor_vencido: total,
    };
  }

  return { ...LIBERADO, valor_implantacao: valorImplantacao };
}
