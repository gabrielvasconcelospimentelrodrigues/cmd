import Fernet from 'fernet';
import { env } from '../config/env';

/**
 * Cifra/decifra credenciais (senha CMD, segredo MFA) com Fernet — MESMO
 * algoritmo do Django antigo (EncryptedTextField), para que o ciphertext
 * migrado do banco antigo continue decifrável aqui.
 *
 * A chave (FIELD_ENCRYPTION_KEY) é base64 urlsafe de 32 bytes.
 */
const secret = new Fernet.Secret(env.FIELD_ENCRYPTION_KEY);

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ciphertext;
  const token = new Fernet.Token({ secret, token: ciphertext, ttl: 0 });
  return token.decode();
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;
  // `time`/`iv` omitidos -> a lib gera; setamos só o secret.
  const token = new Fernet.Token({ secret });
  return token.encode(plaintext);
}
