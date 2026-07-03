/**
 * Extrator de planilha — porta de spreadsheet_extractor.py.
 * Lê CSV/Excel, ADIVINHA as colunas pelos aliases e produz PatientData[].
 */
import { ALIASES_COLUNA, normalize, parseData } from './aliases';
import { lerCsv, lerExcel, type Matriz } from './readers';
import { CAMPOS_FUNDAMENTAIS, type PatientData } from './types';

/** Associa cada campo conhecido ao índice da coluna correspondente. */
export function mapearColunas(cabecalho: (string | null)[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  cabecalho.forEach((titulo, indice) => {
    const norm = normalize(titulo);
    for (const [campo, aliases] of Object.entries(ALIASES_COLUNA)) {
      if (aliases.includes(norm) && !(campo in mapa)) mapa[campo] = indice;
    }
  });
  return mapa;
}

/** Monta o PatientData de uma linha, no formato do contrato comum. */
function linhaParaPaciente(mapa: Record<string, number>, linha: (string | null)[]): PatientData {
  const valor = (campo: string): string | null => {
    const indice = mapa[campo];
    if (indice === undefined || indice >= linha.length) return null;
    const v = linha[indice];
    return v !== null && v !== undefined ? String(v).trim() : null;
  };

  const nome = valor('nome') ?? '';
  const cns = (valor('cns') ?? '').trim();
  const cid10_codigo = (valor('cid10_codigo') ?? '').trim().toUpperCase();
  const medico_nome = valor('medico_nome') ?? '';
  const data_nascimento = parseData(valor('data_nascimento'));
  const data_atendimento = parseData(valor('data_atendimento'));

  const campos: Record<string, unknown> = { nome, cns, data_nascimento, data_atendimento, cid10_codigo, medico_nome };

  const extraction_method: Record<string, string> = {};
  for (const campo of CAMPOS_FUNDAMENTAIS) {
    if (campos[campo]) extraction_method[campo] = 'planilha';
  }
  const campos_incertos = CAMPOS_FUNDAMENTAIS.filter((campo) => !campos[campo]);

  return {
    nome, cns, data_nascimento, data_atendimento, cid10_codigo, medico_nome,
    extraction_method,
    campos_incertos,
    status: campos_incertos.length ? 'needs_review' : 'ok',
  };
}

function matrizParaPacientes(linhas: Matriz): PatientData[] {
  if (!linhas.length) return [];
  const [cabecalho, ...dados] = linhas;
  const mapa = mapearColunas(cabecalho ?? []);
  return dados
    .filter((linha) => linha.some((c) => c !== null && c !== undefined && String(c).trim() !== ''))
    .map((linha) => linhaParaPaciente(mapa, linha));
}

/** Lê pacientes de um buffer de planilha (CSV ou Excel) detectado por extensão. */
export async function extrairPlanilha(buffer: Buffer, filename: string): Promise<PatientData[]> {
  const linhas = filename.toLowerCase().endsWith('.csv') ? lerCsv(buffer) : await lerExcel(buffer);
  return matrizParaPacientes(linhas);
}
