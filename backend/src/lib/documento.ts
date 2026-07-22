/**
 * Validação de CPF/CNPJ no backend — porta fiel de frontend/src/lib/documento.ts.
 *
 * Confere os DÍGITOS VERIFICADORES, não só o tamanho: foi um CNPJ com um número
 * a menos (13 dígitos) que travou a cobrança de um cliente sem ninguém perceber.
 * O front valida na digitação; o backend valida de novo porque é a autoridade
 * (ninguém deve gravar documento inválido chamando a API direto).
 */
export function soDigitos(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '');
}

export function validaCpf(v: string): boolean {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let r = (soma * 10) % 11;
  if (r === 10) r = 0;
  if (r !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  r = (soma * 10) % 11;
  if (r === 10) r = 0;
  return r === Number(d[10]);
}

export function validaCnpj(v: string): boolean {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (pesos: number[]) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += Number(d[i]) * pesos[i]!;
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) !== Number(d[12])) return false;
  return calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13]);
}

/** true se for um CPF (11) ou CNPJ (14) válido pelos dígitos verificadores. */
export function validaCpfCnpj(v: string | null | undefined): boolean {
  const n = soDigitos(v).length;
  if (n === 11) return validaCpf(String(v));
  if (n === 14) return validaCnpj(String(v));
  return false;
}
