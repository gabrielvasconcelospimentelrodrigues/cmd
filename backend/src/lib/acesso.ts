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

/**
 * Faturas que comprovam pagamento do USO DOS TERMINAIS. São os dois únicos
 * tipos que o sistema emite:
 *  - 'mensalidade': o ciclo mensal cheio;
 *  - 'terminal_proporcional': quem contrata no MEIO do mês paga o pró-rata, e a
 *    1ª mensalidade cheia só vem no ciclo seguinte. Sem este tipo aqui, um
 *    cliente que contratou e pagou certinho ficaria bloqueado até virar o mês.
 */
const TIPOS_USO_TERMINAL = ['mensalidade', 'terminal_proporcional'];

/** Tenant já carregado (o authenticate faz select('*')) — evita re-buscar. */
export interface TenantAcesso {
  id: number;
  isento_pagamento?: boolean | null;
  /** Fim da isenção. null = indeterminado (parceiro); data = período de teste. */
  isento_ate?: string | null;
  implantacao_paga?: boolean | null;
  valor_implantacao?: number | string | null;
}

/**
 * Isenção VIGENTE hoje. Sem esta checagem, um período de teste com data
 * marcada nunca terminaria — o cliente ficaria isento para sempre e o
 * bloqueio por pagamento jamais voltaria a valer.
 */
export function isencaoVigente(tenant: TenantAcesso): boolean {
  if (!tenant.isento_pagamento) return false;
  if (!tenant.isento_ate) return true; // indeterminado (parceiro)
  return String(tenant.isento_ate).slice(0, 10) >= new Date().toISOString().slice(0, 10);
}

/**
 * Regra: libera se ISENTO, ou se (implantação paga E mensalidade paga E sem
 * fatura vencida). Ordem importa — devolvemos o motivo mais "à frente" na
 * jornada de cobrança primeiro (implantação antes de mensalidade).
 */
export async function verificarAcessoAutomacao(tenant: TenantAcesso): Promise<AcessoAutomacao> {
  // Isento (parceiro/teste) roda sem pagar — enquanto a isenção estiver vigente.
  if (isencaoVigente(tenant)) return LIBERADO;

  const valorImplantacao = Number(tenant.valor_implantacao ?? 0);

  // 1) Implantação. Curto-circuito: quem não pagou a implantação já está
  // bloqueado, então nem consultamos faturas (economiza egress no /me, que o
  // painel chama a cada 6s).
  if (!tenant.implantacao_paga && valorImplantacao > 0) {
    return {
      liberado: false,
      motivo: 'implantacao_pendente',
      mensagem: 'Você não tem permissão para realizar automação: é necessário fazer a contratação (terminais + implantação).',
      valor_implantacao: valorImplantacao,
      valor_vencido: 0,
    };
  }

  // 2) Em dia com as faturas. A mensalidade deixou de ser uma exigência à parte:
  // liberar a implantação já dá acesso, e a recorrência é cobrada por faturas
  // COM DATA. Enquanto nenhuma vencer, o acesso segue; a 1ª que passar do
  // vencimento bloqueia (inadimplência). Assim o pagamento parcelado da
  // implantação e a mensalidade paga por fora se resolvem só com lançamentos.
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
