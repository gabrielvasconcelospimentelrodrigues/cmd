/**
 * Validação da chave 2FA (segredo TOTP) antes de gravar.
 *
 * A API aceitava qualquer texto aqui, inclusive string vazia. Um cliente
 * digitou o código de 6 dígitos do aplicativo no campo da chave: o código foi
 * cifrado no lugar do segredo permanente, a chave verdadeira se perdeu e a
 * automação passou a falhar no 2FA sem nenhum erro visível. A checagem mora no
 * servidor porque a tela não é a única porta de entrada.
 */

/** Piso de um segredo TOTP real (80 bits em base32). O do Acesso Saúde tem 32. */
const MIN_CHAVE = 16;

export type ChecagemChave =
  | { ok: true; valor: string }
  | { ok: false; erro: string };

/** Aceita a chave em blocos (com espaços ou hífens) e devolve normalizada. */
export function validarChave2FA(bruto: unknown): ChecagemChave {
  if (typeof bruto !== 'string') return { ok: false, erro: 'mfa_secret deve ser texto.' };
  const v = bruto.replace(/[\s-]+/g, '').toUpperCase();
  if (!v) return { ok: false, erro: 'Chave 2FA vazia.' };
  if (/^\d{6,8}$/.test(v)) {
    return { ok: false, erro: 'Esse é o código que o aplicativo mostra e troca a cada 30 segundos, não a chave. A chave aparece junto do QR code, tem 32 letras e números, e não muda.' };
  }
  if (!/^[A-Z2-7]+=*$/.test(v)) {
    return { ok: false, erro: 'A chave 2FA só tem letras de A a Z e números de 2 a 7.' };
  }
  if (v.replace(/=+$/, '').length < MIN_CHAVE) {
    return { ok: false, erro: `A chave 2FA ficou com ${v.length} caractere(s) — a do Acesso Saúde tem 32. Confira se foi copiada inteira.` };
  }
  return { ok: true, valor: v };
}
