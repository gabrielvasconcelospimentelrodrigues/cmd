/* Testa os extratores de tabela (CSV, Excel, XML) — 100% offline. */
import ExcelJS from 'exceljs';
import { extrairPlanilha } from '../extractors/spreadsheet';
import { descobrirColunas, sugerirMapeamento, importarComMapa } from '../extractors/mapped-import';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) falhas++;
};

async function main() {
  // ---- 1. CSV com separador ';' (comum em pt-BR) e aliases variados --------
  const csv = Buffer.from(
    'Nome;CPF do paciente;Data de Atendimento;Profissional Executante;CID-10\n' +
      'Maria Silva;70565376420;01/06/2026 11:15;Dr. Joao Souza;J11\n' +
      'José Santos;12345678901;2026-06-02;Ana Lima;\n',
    'utf8',
  );
  const p1 = await extrairPlanilha(csv, 'pacientes.csv');
  ok(p1.length === 2, `CSV: 2 pacientes (got ${p1.length})`);
  ok(p1[0]?.cns === '70565376420', `CSV: CNS mapeado de "CPF do paciente"`);
  ok(p1[0]?.data_atendimento === '2026-06-01', `CSV: data d/m/Y c/ hora -> ${p1[0]?.data_atendimento}`);
  ok(p1[0]?.cid10_codigo === 'J11', `CSV: CID-10 maiúsculo`);
  ok(p1[0]?.status === 'ok', `CSV: linha completa -> ok`);
  ok(p1[1]?.data_atendimento === '2026-06-02', `CSV: data Y-m-d -> ${p1[1]?.data_atendimento}`);
  ok(
    p1[1]?.status === 'ok' && p1[1]?.extraction_method.medico_nome === 'planilha',
    `CSV: medico via alias "Profissional Executante"`,
  );

  // ---- 2. CSV faltando campo fundamental -> needs_review -------------------
  const csv2 = Buffer.from('nome;cns\nSem Medico;111\n', 'utf8');
  const p2 = await extrairPlanilha(csv2, 'x.csv');
  ok(
    p2[0]?.status === 'needs_review' &&
      p2[0]?.campos_incertos.includes('data_atendimento') &&
      p2[0]?.campos_incertos.includes('medico_nome'),
    `CSV: faltando data/medico -> needs_review (${p2[0]?.campos_incertos.join(',')})`,
  );

  // ---- 3. Excel (.xlsx) round-trip -----------------------------------------
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('p');
  ws.addRow(['Nome', 'CNS', 'Data Atendimento', 'Medico']);
  ws.addRow(['Carlos Souza', '99988877766', '15/03/2026', 'Dra. Paula']);
  const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());
  const p3 = await extrairPlanilha(xlsxBuf, 'planilha.xlsx');
  ok(p3.length === 1 && p3[0]?.cns === '99988877766', `Excel: lê CNS`);
  ok(p3[0]?.data_atendimento === '2026-03-15', `Excel: data -> ${p3[0]?.data_atendimento}`);

  // ---- 4. XML com mapeamento manual ----------------------------------------
  const xml = Buffer.from(
    '<registros>' +
      '<registro><paciente>Fulano</paciente><doc>0012345678</doc><quando>10/01/2026</quando><prof>Dr X</prof></registro>' +
      '<registro><paciente>Beltrano</paciente><doc>98765432100</doc><quando>11/01/2026</quando><prof>Dra Y</prof></registro>' +
      '</registros>',
    'utf8',
  );
  const cols = await descobrirColunas(xml, 'dados.xml');
  ok(
    cols.join(',') === 'paciente,doc,quando,prof',
    `XML: colunas descobertas = ${cols.join(',')}`,
  );
  const sug = sugerirMapeamento(cols);
  // "paciente" é alias de nome (sugerido); "doc" NÃO é alias de cns (por isso
  // existe o mapeamento manual) -> sug.cns fica indefinido. Comportamento certo.
  ok(sug.nome === 'paciente' && sug.cns === undefined, `XML: sugere nome=paciente, não adivinha cns="doc"`);
  const imp = await importarComMapa(xml, 'dados.xml', {
    nome: 'paciente', cns: 'doc', data_atendimento: 'quando', profissional: 'prof',
  });
  ok(imp.length === 2, `XML: 2 registros importados`);
  ok(imp[0]?.cns === '00012345678', `XML: CPF com zfill(11) -> ${imp[0]?.cns}`);
  ok(imp[0]?.data_atendimento === '2026-01-10', `XML: data importada -> ${imp[0]?.data_atendimento}`);

  console.log(falhas === 0 ? '\n✅ Todos os testes de extração passaram.' : `\n❌ ${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

void main();
