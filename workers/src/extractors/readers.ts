/**
 * Leitura bruta de arquivos tabulares em "matriz de linhas" (string[][]),
 * a partir de um Buffer (ex.: arquivo baixado do Supabase Storage).
 * Suporta CSV (detecção de separador), Excel (.xlsx) e XML.
 */
import { parse as parseCsv } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';
import ExcelJS from 'exceljs';

export type Matriz = (string | null)[][];

/** Detecta o separador mais provável na 1ª linha (vírgula, ponto-e-vírgula, tab). */
function detectarDelimitador(amostra: string): string {
  const primeiraLinha = amostra.split(/\r?\n/)[0] ?? '';
  const cont = (ch: string) => primeiraLinha.split(ch).length - 1;
  const candidatos: Array<[string, number]> = [
    [';', cont(';')],
    [',', cont(',')],
    ['\t', cont('\t')],
  ];
  candidatos.sort((a, b) => b[1] - a[1]);
  return candidatos[0] && candidatos[0][1] > 0 ? candidatos[0][0] : ',';
}

export function lerCsv(buffer: Buffer): Matriz {
  // utf-8-sig: remove BOM se houver.
  const texto = buffer.toString('utf8').replace(/^﻿/, '');
  const delimiter = detectarDelimitador(texto);
  const linhas = parseCsv(texto, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: false,
  }) as string[][];
  return linhas;
}

export async function lerExcel(buffer: Buffer): Promise<Matriz> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const linhas: Matriz = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const valores: (string | null)[] = [];
    // row.values é 1-indexed (índice 0 é vazio).
    const arr = row.values as unknown[];
    for (let i = 1; i < arr.length; i++) {
      const v = arr[i];
      if (v === null || v === undefined) valores.push(null);
      else if (v instanceof Date) valores.push(v.toISOString());
      else if (typeof v === 'object' && 'text' in (v as object)) valores.push(String((v as { text: unknown }).text));
      else valores.push(String(v));
    }
    linhas.push(valores);
  });
  return linhas;
}

/**
 * XML → (colunas, linhas-como-dict). Heurística: o "registro" é a tag que
 * mais se repete entre os filhos diretos da raiz (padrão <registros><registro>).
 * Usa preserveOrder para contar/ordenar tags fielmente (igual ao ElementTree).
 */
export function lerXml(buffer: Buffer): { colunas: string[]; linhas: Record<string, string>[] } {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: true,
    trimValues: true,
  });
  const arvore = parser.parse(buffer.toString('utf8')) as PreservedNode[];

  // arvore = [ { rootTag: [ ...filhos ] } ] (ignorando nós de texto no topo)
  const raiz = arvore.find((n) => temFilhos(n));
  const filhosRaiz = raiz ? primeiroValorArray(raiz) : [];

  // Conta as tags dos filhos diretos.
  const contagem = new Map<string, number>();
  for (const filho of filhosRaiz) {
    const tag = tagDe(filho);
    if (tag) contagem.set(tag, (contagem.get(tag) ?? 0) + 1);
  }
  let tagRegistro = '';
  let maior = -1;
  for (const [tag, qtd] of contagem) {
    if (qtd > maior) {
      maior = qtd;
      tagRegistro = tag;
    }
  }

  const registros = tagRegistro
    ? filhosRaiz.filter((f) => tagDe(f) === tagRegistro)
    : raiz
      ? [raiz]
      : [];
  if (!registros.length) return { colunas: [], linhas: [] };

  const colunas = filhosDe(registros[0]!).map((c) => tagDe(c) ?? '').filter(Boolean);
  const linhas = registros.map((reg) => {
    const obj: Record<string, string> = {};
    for (const campo of filhosDe(reg)) {
      const tag = tagDe(campo);
      if (tag) obj[tag] = textoDe(campo);
    }
    return obj;
  });
  return { colunas, linhas };
}

// ---- helpers do formato preserveOrder do fast-xml-parser --------------------
type PreservedNode = Record<string, unknown>;

function tagDe(node: PreservedNode): string | null {
  const keys = Object.keys(node).filter((k) => k !== ':@');
  return keys[0] ?? null;
}
function temFilhos(node: PreservedNode): boolean {
  const tag = tagDe(node);
  return !!tag && Array.isArray(node[tag]) && tag !== '#text';
}
function primeiroValorArray(node: PreservedNode): PreservedNode[] {
  const tag = tagDe(node);
  return tag && Array.isArray(node[tag]) ? (node[tag] as PreservedNode[]) : [];
}
function filhosDe(node: PreservedNode): PreservedNode[] {
  return primeiroValorArray(node).filter((c) => tagDe(c) !== '#text');
}
function textoDe(node: PreservedNode): string {
  const tag = tagDe(node);
  if (!tag) return '';
  const filhos = node[tag];
  if (!Array.isArray(filhos)) return '';
  const textNode = filhos.find((c: PreservedNode) => '#text' in c);
  return textNode ? String((textNode as { '#text': unknown })['#text'] ?? '').trim() : '';
}
