/**
 * Aliases de coluna, normalização e parsing de data — porta fiel de
 * spreadsheet_extractor.py (_ALIASES_COLUNA, _normalize, _parse_data).
 */

/** Cada campo aceita várias variações de nome de coluna (normalizadas). */
export const ALIASES_COLUNA: Record<string, readonly string[]> = {
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
    'agendado em',
    'data e horario do atendimento', 'data hora atendimento',
    'atendimento', 'data consulta', 'data da consulta',
    'data de admissao', 'data do desfecho', 'data de realizacao',
    'data de realizacao do procedimento',
  ],
  cid10_codigo: ['cid-10', 'cid 10', 'cid10', 'cid', 'problema', 'diagnostico', 'problema/diagnostico'],
  modalidade: ['modalidade', 'tipo', 'tipo de cadastro', 'tipo cadastro', 'cirurgia', 'catarata', 'oci', 'tipo procedimento', 'tipo de procedimento', 'modalidade cadastro'],
  medico_nome: [
    'profissional executante', 'medico', 'médico', 'profissional',
    'nome do medico', 'nome do profissional', 'medico executante',
  ],
};

/**
 * Remove acentos, baixa caixa e tira espaços das pontas. Equivale ao
 * _normalize do Python: NFKD + encode('ascii','ignore') (= dropa todo
 * caractere não-ASCII, que após o NFKD são justamente os diacríticos).
 */
export function normalize(texto: unknown): string {
  return String(texto ?? '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '') // dropa não-ASCII (diacríticos separados pelo NFKD)
    .trim()
    .toLowerCase();
}

/**
 * Remove o registro do conselho (CRM/CRO/COREN/…) e o número do nome do médico.
 * Ex.: "Lucas Eduardo da Silva Martins - CRM AM 10408" -> "Lucas Eduardo da Silva Martins".
 * O CMD busca o profissional só pelo NOME; o "- CRM …" fazia a busca falhar.
 */
export function limparNomeMedico(nome: unknown): string {
  const s = String(nome ?? '').trim();
  if (!s) return s;
  return s
    .replace(/[\s\-/,;.|]*\b(CRM|CRO|COREN|CRF|CRP|CREFITO|CRN|CRBM|CRMV|CRFA|RQE)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Converte um valor de célula em data 'YYYY-MM-DD' (ou null). Aceita Date,
 * e strings nos formatos d/m/Y, Y-m-d, d-m-Y. Remove horário se presente.
 */
export function parseData(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null;

  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return toISO(valor.getFullYear(), valor.getMonth() + 1, valor.getDate());
  }

  let texto = String(valor).trim();
  if (texto.includes(' ')) texto = texto.split(' ')[0] ?? texto; // tira horário

  // d/m/Y  ou  d-m-Y
  const dmy = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return toISO(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  // Y-m-d
  const ymd = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) return toISO(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  return null;
}

function toISO(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}
