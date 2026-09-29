/**
 * PROCEDIMENTOS (SIGTAP) gerados por ficha — as "etapas" de cada cadastro.
 *
 * Espelha PROCEDURE_CODES de workers/src/automation/web-automation.ts, que é
 * quem de fato preenche o CMD. Aqui só REPRODUZIMOS a regra para contar: o
 * sistema não grava um registro por procedimento, ele os deriva da modalidade
 * e da idade na hora do cadastro. Como a regra é determinística, o relatório
 * chega ao mesmo número sem precisar de tabela nova.
 *
 * Se a regra do worker mudar, este arquivo tem de mudar junto — por isso os
 * códigos estão repetidos aqui em vez de importados: os dois pacotes não
 * compartilham código, e uma cópia declarada é melhor do que um número mágico
 * espalhado pelo SQL.
 */

export interface Procedimento {
  codigo: string;
  descricao: string;
}

/** Facoemulsificação — único procedimento da cirurgia de catarata. */
export const PROC_CATARATA: Procedimento = {
  codigo: '0405050372',
  descricao: 'FACOEMULSIFICAÇÃO (cirurgia de catarata)',
};

/** Procedimentos comuns às duas faixas etárias da OCI. */
const COMUNS: Procedimento[] = [
  { codigo: '0211060020', descricao: 'BIOMICROSCOPIA DE FUNDO DE OLHO' },
  { codigo: '0211060127', descricao: 'MAPEAMENTO DE RETINA' },
  { codigo: '0211060259', descricao: 'TONOMETRIA' },
  { codigo: '0301010072', descricao: 'CONSULTA MÉDICA EM ATENÇÃO ESPECIALIZADA' },
];

/** OCI de 0 a 8 anos: 5 procedimentos (avaliação própria da faixa + comuns). */
export const PROC_OCI_0_8: Procedimento[] = [
  { codigo: '0905010019', descricao: 'OCI AVALIAÇÃO INICIAL EM OFTALMOLOGIA — 0 A 8 ANOS' },
  ...COMUNS,
];

/** OCI de 9 anos ou mais: 6 procedimentos (acrescenta o teste ortóptico). */
export const PROC_OCI_9_MAIS: Procedimento[] = [
  { codigo: '0905010035', descricao: 'OCI AVALIAÇÃO INICIAL EM OFTALMOLOGIA — A PARTIR DE 9 ANOS' },
  ...COMUNS,
  { codigo: '0211060232', descricao: 'TESTE ORTÓPTICO' },
];

/**
 * Procedimentos de uma ficha.
 *
 * Idade nula cai em 9+ pela mesma razão do worker: é a maioria, e a ficha sem
 * idade é barrada antes de cadastrar. Contar como 9+ mantém o relatório
 * alinhado com o que o robô tentaria fazer.
 */
export function procedimentosDaFicha(modalidade: string | null, idade: number | null): Procedimento[] {
  if (modalidade === 'catarata') return [PROC_CATARATA];
  return idade !== null && idade <= 8 ? PROC_OCI_0_8 : PROC_OCI_9_MAIS;
}

/** Quantos procedimentos a ficha gera — atalho para o quantitativo. */
export function qtdProcedimentos(modalidade: string | null, idade: number | null): number {
  return procedimentosDaFicha(modalidade, idade).length;
}

/** Catálogo completo, para montar a tabela do relatório sem repetir texto. */
export const CATALOGO: Procedimento[] = [
  PROC_OCI_9_MAIS[0]!,
  PROC_OCI_0_8[0]!,
  ...COMUNS,
  PROC_OCI_9_MAIS[PROC_OCI_9_MAIS.length - 1]!,
  PROC_CATARATA,
];
