import { supabaseAdmin } from './supabase';

export interface Precos {
  implantacao: number;
  terminais: number[]; // [preço do 1º, 2º, 3º...]
  adicional: number;   // preço de cada terminal além da lista
}

const PADRAO: Precos = { implantacao: 20000, terminais: [2000], adicional: 2000 };

/** Lê a tabela de preços global (configuracoes.precos). */
export async function getPrecos(): Promise<Precos> {
  const { data } = await (supabaseAdmin as any).from('configuracoes').select('valor').eq('chave', 'precos').maybeSingle();
  const v = data?.valor as Partial<Precos> | undefined;
  if (!v) return PADRAO;
  return {
    implantacao: Number(v.implantacao ?? PADRAO.implantacao),
    terminais: Array.isArray(v.terminais) && v.terminais.length ? v.terminais.map(Number) : PADRAO.terminais,
    adicional: Number(v.adicional ?? PADRAO.adicional),
  };
}

/** Preço do terminal na POSIÇÃO p (1-indexado), conforme os tiers. */
export function precoTerminalNaPosicao(precos: Precos, posicao: number): number {
  if (posicao <= 0) return 0;
  return precos.terminais[posicao - 1] ?? precos.adicional;
}

/** Soma dos preços dos terminais das posições 1..n (mensalidade escalonada). */
export function mensalidadeParaN(precos: Precos, n: number): number {
  let total = 0;
  for (let p = 1; p <= n; p++) total += precoTerminalNaPosicao(precos, p);
  return total;
}
