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
  /** Modalidade do cadastro: 'oci' (padrão) ou 'catarata' (FACO). */
  modalidade?: 'oci' | 'catarata';
  /** Qual método extraiu cada campo fundamental (aqui sempre "planilha"). */
  extraction_method: Record<string, string>;
  /** Campos fundamentais ainda vazios — vão para revisão manual. */
  campos_incertos: string[];
  status: 'ok' | 'needs_review';
}

/**
 * Campos OBRIGATÓRIOS para o cadastro no CMD-COLETA: `cns` (aceita CPF ou CNS —
 * o aliases.ts mapeia ambos para este campo), `data_atendimento` (data de
 * admissão) e `medico_nome` (médico). `nome`, `data_nascimento` e `cid` ficam
 * DE FORA: o CMD-COLETA os busca a partir do CNS. Faltando qualquer um dos três
 * obrigatórios, a ficha cai em Pendências.
 */
export const CAMPOS_FUNDAMENTAIS = ['cns', 'data_atendimento', 'medico_nome'] as const;
export type CampoFundamental = (typeof CAMPOS_FUNDAMENTAIS)[number];
