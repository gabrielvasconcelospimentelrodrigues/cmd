/**
 * Import com mapeamento MANUAL de colunas (CSV/Excel/XML) — porta de
 * importador_mapeado.py. O usuário vê as colunas/tags e escolhe qual é qual,
 * necessário para formatos de outros sistemas que os aliases não reconhecem.
 */
import { ALIASES_COLUNA, normalize, parseData } from './aliases';
import { lerCsv, lerExcel, lerXml } from './readers';

/** Campos de destino do import mapeado (medico_nome lá == "profissional" aqui). */
export const CAMPOS_IMPORTACAO = ['nome', 'cns', 'data_nascimento', 'profissional', 'data_atendimento', 'modalidade'] as const;
export type CampoImportacao = (typeof CAMPOS_IMPORTACAO)[number];

const ALIASES_MAPEADO: Record<CampoImportacao, readonly string[]> = {
  nome: ALIASES_COLUNA.nome!,
  cns: ALIASES_COLUNA.cns!,
  data_nascimento: ALIASES_COLUNA.data_nascimento!,
  profissional: ALIASES_COLUNA.medico_nome!,
  data_atendimento: ALIASES_COLUNA.data_atendimento!,
  modalidade: ALIASES_COLUNA.modalidade!,
};

/** Linha importada (datas já em 'YYYY-MM-DD' | null). */
export interface LinhaImportada {
  nome: string;
  cns: string;
  data_nascimento: string | null;
  profissional: string;
  data_atendimento: string | null;
  modalidade: string;
}

const ehXml = (f: string) => f.toLowerCase().endsWith('.xml');

/** Lê o arquivo como (colunas, linhas-dict) independentemente do formato. */
async function lerArquivo(
  buffer: Buffer,
  filename: string,
): Promise<{ colunas: string[]; linhas: Record<string, string>[] }> {
  if (ehXml(filename)) return lerXml(buffer);

  const matriz = filename.toLowerCase().endsWith('.csv') ? lerCsv(buffer) : await lerExcel(buffer);
  if (!matriz.length) return { colunas: [], linhas: [] };
  const [cab, ...dados] = matriz;
  const colunas = (cab ?? []).map((c) => (c !== null && c !== undefined ? String(c) : ''));
  const linhas = dados
    .filter((l) => l.some((c) => c !== null && c !== undefined && String(c).trim() !== ''))
    .map((l) => {
      const obj: Record<string, string> = {};
      colunas.forEach((col, i) => {
        const v = l[i];
        obj[col] = v !== null && v !== undefined ? String(v) : '';
      });
      return obj;
    });
  return { colunas, linhas };
}

/** Lista as colunas/tags do arquivo para montar a tela de mapeamento. */
export async function descobrirColunas(buffer: Buffer, filename: string): Promise<string[]> {
  return (await lerArquivo(buffer, filename)).colunas;
}

/** Pré-seleciona, por campo, a 1ª coluna cujo nome bate com um alias conhecido. */
export function sugerirMapeamento(colunas: string[]): Partial<Record<CampoImportacao, string>> {
  const sugestao: Partial<Record<CampoImportacao, string>> = {};
  for (const campo of CAMPOS_IMPORTACAO) {
    const aliases = ALIASES_MAPEADO[campo];
    const achou = colunas.find((c) => aliases.includes(normalize(c)));
    if (achou) sugestao[campo] = achou;
  }
  return sugestao;
}

/** Importa usando exatamente o mapa escolhido pelo usuário (sem heurística). */
export async function importarComMapa(
  buffer: Buffer,
  filename: string,
  mapa: Partial<Record<CampoImportacao, string>>,
): Promise<LinhaImportada[]> {
  const { linhas } = await lerArquivo(buffer, filename);

  return linhas.map((linha) => {
    const get = (campo: CampoImportacao): string => {
      const colOrigem = mapa[campo];
      const v = colOrigem ? linha[colOrigem] : '';
      return v !== null && v !== undefined ? String(v).trim() : '';
    };

    let cns = get('cns');
    // Excel/Sheets removem zeros à esquerda de CPF — restaura para 11 dígitos.
    if (cns && /^\d+$/.test(cns) && cns.length < 11) cns = cns.padStart(11, '0');

    return {
      nome: get('nome'),
      cns,
      data_nascimento: parseData(get('data_nascimento')),
      profissional: get('profissional'),
      data_atendimento: parseData(get('data_atendimento')),
      modalidade: get('modalidade'),
    };
  });
}
