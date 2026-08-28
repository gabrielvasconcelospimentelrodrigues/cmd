/** Valor por extenso em português — exigência clássica de recibo ("a quantia
 * de R$ 2.000,00 (dois mil reais)"). Cobre até bilhões, que é muito além de
 * qualquer mensalidade, e trata os casos irregulares do português: "cem" x
 * "cento", "mil" sem "um" na frente, e o "e" entre centena/dezena/unidade. */

const UNI = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZ_QUEBRADA = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0..999 por extenso (string vazia para 0 — quem chama decide o que fazer). */
function ate999(n: number): string {
  if (n <= 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CEM[c] ?? '');
  if (resto > 0) {
    if (resto < 10) partes.push(UNI[resto] ?? '');
    else if (resto < 20) partes.push(DEZ_QUEBRADA[resto - 10] ?? '');
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DEZ[d] ?? ''} e ${UNI[u] ?? ''}` : (DEZ[d] ?? ''));
    }
  }
  return partes.join(' e ');
}

const ESCALAS: { divisor: number; sing: string; plur: string }[] = [
  { divisor: 1_000_000_000, sing: 'bilhão', plur: 'bilhões' },
  { divisor: 1_000_000, sing: 'milhão', plur: 'milhões' },
  { divisor: 1_000, sing: 'mil', plur: 'mil' },
];

/** Parte inteira por extenso, sem a moeda. */
function inteiroPorExtenso(n: number): string {
  if (n === 0) return 'zero';
  const partes: string[] = [];
  let resto = n;
  for (const e of ESCALAS) {
    const q = Math.floor(resto / e.divisor);
    if (q > 0) {
      // "mil" não leva "um" na frente: 1.000 = "mil", não "um mil".
      const prefixo = e.divisor === 1_000 && q === 1 ? '' : `${ate999(q)} `;
      partes.push(`${prefixo}${q === 1 ? e.sing : e.plur}`.trim());
      resto %= e.divisor;
    }
  }
  if (resto > 0) partes.push(ate999(resto));
  // "e" antes do último grupo quando ele é menor que cem ou centena redonda
  // (mil e quinhentos / dois mil e trinta), senão vírgula seria estranho.
  if (partes.length > 1 && resto > 0 && (resto < 100 || resto % 100 === 0)) {
    const ultimo = partes.pop() as string;
    return `${partes.join(', ')} e ${ultimo}`;
  }
  return partes.join(', ');
}

/** "2000.00" -> "dois mil reais"; "1234.56" -> "mil, duzentos e trinta e
 * quatro reais e cinquenta e seis centavos". */
export function valorPorExtenso(valor: number): string {
  const centavosTotais = Math.round(Math.abs(valor) * 100);
  const inteiro = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;

  const partes: string[] = [];
  if (inteiro > 0) partes.push(`${inteiroPorExtenso(inteiro)} ${inteiro === 1 ? 'real' : 'reais'}`);
  if (centavos > 0) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  if (partes.length === 0) return 'zero reais';
  return partes.join(' e ');
}
