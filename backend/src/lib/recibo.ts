import PDFDocument from 'pdfkit';
import { valorPorExtenso } from './extenso';
import type { Emitente } from './emitente';

/** Dados da fatura que entram no recibo (subconjunto da tabela faturas). */
export interface FaturaRecibo {
  id: number;
  tipo: string;
  descricao: string | null;
  referencia: string | null;
  valor: number | string;
  vencimento: string | null;
  status: string;
  pago_em: string | null;
  pago_manual: boolean;
  asaas_payment_id: string | null;
}

/** Quem PAGOU — o assinante (tenant), com a empresa opcional da fatura. */
export interface PagadorRecibo {
  nome: string;
  documento: string | null;
  endereco: string | null; // cidade/UF; o cadastro não guarda logradouro
  telefone: string | null;
  responsavel: string | null;
  empresa_nome?: string | null;
}

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** '2026-08-28T14:48:16Z' | '2026-08-28' -> '28/08/2026' */
function dataBR(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function dataHoraBR(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** '2026-08' -> 'agosto/2026'. Referências fora desse formato passam direto. */
function referenciaExtensa(ref: string | null): string {
  if (!ref) return '—';
  const m = ref.match(/^(\d{4})-(\d{2})$/);
  if (!m) return ref;
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const i = Number(m[2]) - 1;
  return `${meses[i] ?? m[2]}/${m[1]}`;
}

const ROTULO_TIPO: Record<string, string> = {
  mensalidade: 'Mensalidade',
  implantacao: 'Implantação',
  terminal: 'Terminal adicional',
};

const rotuloTipo = (tipo: string) => ROTULO_TIPO[tipo] ?? tipo;

/** Como o dinheiro entrou. O recibo precisa dizer a forma — é o que liga o
 * documento ao extrato bancário na hora da conferência. */
function formaPagamento(f: FaturaRecibo): string {
  if (f.pago_manual) return 'Pagamento direto (PIX/transferência), baixa manual';
  if (f.asaas_payment_id) return 'Cobrança online (PIX, boleto ou cartão)';
  return 'Não informada';
}

/** Número do recibo: derivado do id da fatura, que já é único e imutável.
 * Assim o recibo nº 000021 sempre aponta para a mesma fatura — reemitir gera o
 * mesmo número, e não uma segunda via com identidade diferente. */
export function numeroRecibo(faturaId: number): string {
  return String(faturaId).padStart(6, '0');
}

export function nomeArquivoRecibo(f: FaturaRecibo, pagador: PagadorRecibo): string {
  // NFD separa o acento da letra e o [^a-zA-Z0-9] descarta o acento junto com
  // os demais caracteres não seguros para nome de arquivo.
  const limpo = (s: string) =>
    s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  const ref = f.referencia ? limpo(f.referencia) : 'sem-ref';
  return `recibo-${numeroRecibo(f.id)}-${limpo(pagador.nome)}-${ref}.pdf`;
}

/** Monta o PDF do recibo e devolve o arquivo pronto em memória. */
export function gerarReciboPdf(
  fatura: FaturaRecibo,
  pagador: PagadorRecibo,
  emitente: Emitente,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Recibo ${numeroRecibo(fatura.id)}`,
        Author: emitente.razao_social,
        Subject: `${rotuloTipo(fatura.tipo)} — ${referenciaExtensa(fatura.referencia)}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const valor = Number(fatura.valor);
    const L = doc.page.margins.left;
    const R = doc.page.width - doc.page.margins.right;
    const largura = R - L;

    const TINTA = '#111827';
    const CINZA = '#6b7280';
    const LINHA = '#e5e7eb';

    // ---- Cabeçalho: emitente à esquerda, identificação do recibo à direita ---
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(15)
      .text(emitente.razao_social || 'Emitente não configurado', L, 50, { width: largura - 170 });

    const linhasEmitente = [
      emitente.documento ? `CNPJ/CPF: ${emitente.documento}` : '',
      emitente.endereco,
      emitente.cidade_uf,
      [emitente.telefone, emitente.email].filter(Boolean).join('  •  '),
    ].filter(Boolean);
    doc.font('Helvetica').fontSize(8.5).fillColor(CINZA);
    for (const linha of linhasEmitente) doc.text(linha, { width: largura - 170 });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(CINZA)
      .text('RECIBO DE PAGAMENTO', R - 160, 52, { width: 160, align: 'right' });
    doc.fontSize(16).fillColor(TINTA)
      .text(`Nº ${numeroRecibo(fatura.id)}`, R - 160, 64, { width: 160, align: 'right' });

    const yLinha = Math.max(doc.y, 112) + 10;
    doc.moveTo(L, yLinha).lineTo(R, yLinha).strokeColor(LINHA).lineWidth(1).stroke();

    // ---- Valor em destaque ---------------------------------------------------
    const yValor = yLinha + 18;
    doc.roundedRect(L, yValor, largura, 52, 6).fillColor('#f9fafb').fill();
    doc.fillColor(CINZA).font('Helvetica').fontSize(8.5).text('VALOR RECEBIDO', L + 16, yValor + 11);
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(22).text(brl(valor), L + 16, yValor + 22);
    doc.font('Helvetica').fontSize(8.5).fillColor(CINZA)
      .text(referenciaExtensa(fatura.referencia).toUpperCase(), R - 216, yValor + 11, { width: 200, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA)
      .text(rotuloTipo(fatura.tipo), R - 216, yValor + 24, { width: 200, align: 'right' });

    // ---- Declaração ----------------------------------------------------------
    const docPagador = pagador.documento ? `, inscrito(a) no CPF/CNPJ sob o nº ${pagador.documento}` : '';
    const declaracao =
      `Recebemos de ${pagador.nome}${docPagador} a importância de ${brl(valor)} ` +
      `(${valorPorExtenso(valor)}), referente a ${rotuloTipo(fatura.tipo).toLowerCase()} ` +
      `com competência ${referenciaExtensa(fatura.referencia)}, paga em ${dataBR(fatura.pago_em)}, ` +
      `dando plena e geral quitação do valor acima.`;

    doc.y = yValor + 74;
    doc.fillColor(TINTA).font('Helvetica').fontSize(10.5)
      .text(declaracao, L, doc.y, { width: largura, align: 'justify', lineGap: 3 });

    // ---- Detalhamento --------------------------------------------------------
    let y = doc.y + 22;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(CINZA).text('DETALHES DO PAGAMENTO', L, y);
    y += 14;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(LINHA).lineWidth(1).stroke();
    y += 8;

    const itens: [string, string][] = [
      ['Fatura', `#${fatura.id}`],
      ['Descrição', fatura.descricao || rotuloTipo(fatura.tipo)],
      ['Competência', referenciaExtensa(fatura.referencia)],
      ['Vencimento', dataBR(fatura.vencimento)],
      ['Data do pagamento', dataBR(fatura.pago_em)],
      ['Forma de pagamento', formaPagamento(fatura)],
    ];
    if (pagador.empresa_nome) itens.splice(2, 0, ['Unidade', pagador.empresa_nome]);

    for (const [rotulo, texto] of itens) {
      doc.font('Helvetica').fontSize(9.5).fillColor(CINZA).text(rotulo, L, y, { width: 150 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TINTA).text(texto, L + 150, y, { width: largura - 150 });
      y = doc.y + 6;
    }

    // ---- Pagador -------------------------------------------------------------
    y += 10;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(CINZA).text('PAGADOR', L, y);
    y += 14;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(LINHA).lineWidth(1).stroke();
    y += 8;
    const linhasPagador = [
      pagador.nome,
      pagador.documento ? `CPF/CNPJ: ${pagador.documento}` : '',
      pagador.responsavel ? `Responsável: ${pagador.responsavel}` : '',
      pagador.endereco,
      pagador.telefone,
    ].filter(Boolean);
    doc.font('Helvetica').fontSize(9.5).fillColor(TINTA);
    for (const linha of linhasPagador) {
      doc.text(linha as string, L, y, { width: largura });
      y = doc.y + 2;
    }

    // ---- Assinatura ----------------------------------------------------------
    // Fixada perto do rodapé para o recibo sair sempre com o mesmo desenho,
    // independentemente de a descrição da fatura ser curta ou longa.
    const yAssina = doc.page.height - doc.page.margins.bottom - 96;
    const larguraAssina = 260;
    const xAssina = L + (largura - larguraAssina) / 2;

    const local = emitente.cidade_uf ? `${emitente.cidade_uf}, ` : '';
    doc.font('Helvetica').fontSize(9.5).fillColor(CINZA)
      .text(`${local}${dataBR(new Date().toISOString())}.`, L, yAssina - 26, { width: largura, align: 'center' });

    doc.moveTo(xAssina, yAssina).lineTo(xAssina + larguraAssina, yAssina).strokeColor('#9ca3af').lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TINTA)
      .text(emitente.assinante || emitente.razao_social, xAssina, yAssina + 6, { width: larguraAssina, align: 'center' });
    const sub = [emitente.assinante_cargo, emitente.documento ? `CNPJ/CPF ${emitente.documento}` : ''].filter(Boolean).join(' — ');
    if (sub) {
      doc.font('Helvetica').fontSize(8.5).fillColor(CINZA)
        .text(sub, xAssina, doc.y + 1, { width: larguraAssina, align: 'center' });
    }

    // ---- Rodapé --------------------------------------------------------------
    doc.font('Helvetica').fontSize(7.5).fillColor('#9ca3af').text(
      `Documento gerado eletronicamente em ${dataHoraBR(new Date().toISOString())}. ` +
      `Recibo nº ${numeroRecibo(fatura.id)} vinculado à fatura #${fatura.id}. Este recibo não é documento fiscal.`,
      L, doc.page.height - doc.page.margins.bottom - 24, { width: largura, align: 'center' },
    );

    doc.end();
  });
}
