/**
 * Contrato comum de "paciente extraído" — produzido por TODOS os extratores
 * (planilha, import mapeado) e consumido pela automação de cadastro de forma
 * agnóstica à origem. Espelha o dict do sistema antigo (spreadsheet_extractor).
 *
 * Datas como 'YYYY-MM-DD' (ou null) — prontas para a coluna `date` do Postgres.
 */
export interface PatientData {
  nome: string;
  cns: string;
  data_nascimento: string | null;
  data_atendimento: string | null;
  cid10_codigo: string;
  medico_nome: string;
  /** Qual método extraiu cada campo fundamental (aqui sempre "planilha"). */
  extraction_method: Record<string, string>;
  /** Campos fundamentais ainda vazios — vão para revisão manual. */
  campos_incertos: string[];
  status: 'ok' | 'needs_review';
}

/**
 * Campos fundamentais para o cadastro no CMD-COLETA. `nome` e
 * `data_nascimento` ficam DE FORA de propósito: o CMD-COLETA os busca no
 * CADSUS a partir do CNS, então uma planilha sem essas colunas não bloqueia.
 */
export const CAMPOS_FUNDAMENTAIS = ['cns', 'data_atendimento', 'medico_nome'] as const;
export type CampoFundamental = (typeof CAMPOS_FUNDAMENTAIS)[number];
