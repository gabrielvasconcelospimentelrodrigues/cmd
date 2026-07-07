/**
 * Leitura dos CABEÇALHOS de uma planilha (CSV/Excel/XML) para a tela de
 * mapeamento manual de colunas. Espelha a lógica do worker (readers.ts +
 * mapped-import.ts) — aqui só precisamos das colunas + sugestão de mapa.
 */
import { parse as parseCsv } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';
import ExcelJS from 'exceljs';

/** Campos de destino do import mapeado (os que o worker/importarComMapa espera). */
export const CAMPOS_IMPORTACAO = ['cns', 'data_atendimento', 'profissional', 'nome', 'data_nascimento', 'modalidade'] as const;
export type CampoImportacao = (typeof CAMPOS_IMPORTACAO)[number];
/** Obrigatórios para o cadastro (sem eles cai em Pendências). */
export const CAMPOS_OBRIGATORIOS: CampoImportacao[] = ['cns', 'data_atendimento', 'profissional'];

const ALIASES: Record<CampoImportacao, string[]> = {
  modalidade: ['modalidade', 'tipo', 'tipo de cadastro', 'tipo cadastro', 'cirurgia', 'catarata', 'oci', 'tipo procedimento', 'tipo de procedimento', 'modalidade cadastro'],
  nome: ['nome', 'nome completo', 'nome do paciente', 'paciente'],
  cns: [
    'cns', 'cartao nacional de saude', 'numero do cns', 'cns do paciente',
    'cpf', 'cpf do paciente', 'numero cpf', 'numero do cpf', 'cpf paciente',
    'cpf/cns', 'cns/cpf', 'cpf ou cns', 'cns ou cpf',
    'documento', 'documento do paciente', 'cpf_cns', 'identificacao',
  ],
  data_nascimento: ['data de nascimento', 'data nascimento', 'nascimento', 'dt nascimento'],
  data_atendimento: [
    'data atendimento', 'data de atendimento', 'data do atendimento',
    'data do agendamento', 'data agendamento', 'data de agendamento',
    'agendamento', 'agendamentos', 'data agendada', 'data do procedimento',
    'agendado em', 'data e horario do atendimento', 'data hora atendimento',
    'atendimento', 'data consulta', 'data da consulta',
    'data de admissao', 'data do desfecho', 'data de realizacao',
    'data de realizacao do procedimento',
  ],
  profissional: [
    'profissional executante', 'medico', 'médico', 'profissional',
    'nome do medico', 'nome do profissional', 'medico executante',
  ],
};

/** Remove acentos, baixa caixa e tira espaços das pontas (== normalize do worker). */
function normalize(texto: unknown): string {
  return String(texto ?? '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .trim()
    .toLowerCase();
}

const ehXml = (f: string) => f.toLowerCase().endsWith('.xml');

function detectarDelimitador(amostra: string): string {
  const primeiraLinha = amostra.split(/\r?\n/)[0] ?? '';
  const cont = (ch: string) => primeiraLinha.split(ch).length - 1;
  const candidatos: Array<[string, number]> = [[';', cont(';')], [',', cont(',')], ['\t', cont('\t')]];
  candidatos.sort((a, b) => b[1] - a[1]);
  return candidatos[0] && candidatos[0][1] > 0 ? candidatos[0][0] : ',';
}

async function lerColunas(buffer: Buffer, filename: string): Promise<string[]> {
  if (ehXml(filename)) return colunasXml(buffer);

  if (filename.toLowerCase().endsWith('.csv')) {
    const texto = buffer.toString('utf8').replace(/^﻿/, '');
    const linhas = parseCsv(texto, { delimiter: detectarDelimitador(texto), relax_column_count: true, skip_empty_lines: true, trim: false, to: 1 }) as string[][];
    return (linhas[0] ?? []).map((c) => (c == null ? '' : String(c)));
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const arr = sheet.getRow(1).values as unknown[];
  const cols: string[] = [];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    cols.push(v == null ? '' : (typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v)));
  }
  return cols;
}

function colunasXml(buffer: Buffer): string[] {
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true, trimValues: true });
  const arvore = parser.parse(buffer.toString('utf8')) as Record<string, unknown>[];
  const tagDe = (n: Record<string, unknown>) => Object.keys(n).filter((k) => k !== ':@')[0] ?? null;
  const filhosArr = (n: Record<string, unknown>) => { const t = tagDe(n); return t && Array.isArray(n[t]) ? (n[t] as Record<string, unknown>[]) : []; };
  const raiz = arvore.find((n) => { const t = tagDe(n); return !!t && Array.isArray(n[t]) && t !== '#text'; });
  const filhosRaiz = raiz ? filhosArr(raiz) : [];
  const contagem = new Map<string, number>();
  for (const f of filhosRaiz) { const t = tagDe(f); if (t) contagem.set(t, (contagem.get(t) ?? 0) + 1); }
  let tagReg = ''; let maior = -1;
  for (const [t, q] of contagem) if (q > maior) { maior = q; tagReg = t; }
  const primeiro = tagReg ? filhosRaiz.find((f) => tagDe(f) === tagReg) : raiz;
  if (!primeiro) return [];
  return filhosArr(primeiro).map((c) => tagDe(c) ?? '').filter((t) => t && t !== '#text');
}

/** Pré-seleciona, por campo, a 1ª coluna cujo nome bate com um alias conhecido. */
function sugerirMapeamento(colunas: string[]): Partial<Record<CampoImportacao, string>> {
  const sugestao: Partial<Record<CampoImportacao, string>> = {};
  for (const campo of CAMPOS_IMPORTACAO) {
    const achou = colunas.find((c) => ALIASES[campo].includes(normalize(c)));
    if (achou) sugestao[campo] = achou;
  }
  return sugestao;
}

/** Lê as colunas do arquivo e já devolve a sugestão de mapeamento por aliases. */
export async function analisarColunas(buffer: Buffer, filename: string): Promise<{ colunas: string[]; sugestao: Partial<Record<CampoImportacao, string>> }> {
  const colunas = (await lerColunas(buffer, filename)).map((c) => c.trim()).filter(Boolean);
  return { colunas, sugestao: sugerirMapeamento(colunas) };
}
