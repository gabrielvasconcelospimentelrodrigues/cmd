import { supabaseAdmin } from './supabase';

/** Dados de quem EMITE o recibo — a operação que recebeu o pagamento. */
export interface Emitente {
  razao_social: string;
  documento: string;        // CNPJ ou CPF de quem recebe
  endereco: string;
  cidade_uf: string;
  telefone: string;
  email: string;
  assinante: string;        // quem assina o recibo
  assinante_cargo: string;
}

const VAZIO: Emitente = {
  razao_social: '', documento: '', endereco: '', cidade_uf: '',
  telefone: '', email: '', assinante: '', assinante_cargo: '',
};

/** Lê configuracoes.emitente. Campos ausentes viram string vazia — o recibo
 * simplesmente omite a linha em vez de imprimir "undefined". */
export async function getEmitente(): Promise<Emitente> {
  const { data } = await (supabaseAdmin as any)
    .from('configuracoes').select('valor').eq('chave', 'emitente').maybeSingle();
  const v = (data?.valor ?? {}) as Partial<Emitente>;
  const txt = (x: unknown) => String(x ?? '').trim();
  return {
    razao_social: txt(v.razao_social),
    documento: txt(v.documento),
    endereco: txt(v.endereco),
    cidade_uf: txt(v.cidade_uf),
    telefone: txt(v.telefone),
    email: txt(v.email),
    assinante: txt(v.assinante),
    assinante_cargo: txt(v.assinante_cargo),
  };
}

/** Sem razão social não existe recibo válido — é o mínimo para identificar
 * quem recebeu. O resto é opcional e some do documento se estiver vazio. */
export function emitenteConfigurado(e: Emitente): boolean {
  return e.razao_social.length > 0;
}

export { VAZIO as EMITENTE_VAZIO };
