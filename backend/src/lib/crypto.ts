import Fernet from 'fernet';
import { env } from '../config/env';

/**
 * Cifra credenciais (senha CMD, segredo MFA) com Fernet — MESMO algoritmo e
 * chave dos workers, para que o que o backend cifra os workers decifrem.
 */
function secret(): InstanceType<typeof Fernet.Secret> {
  if (!env.FIELD_ENCRYPTION_KEY) {
    throw new Error('FIELD_ENCRYPTION_KEY não configurada (necessária para cifrar credenciais).');
  }
  return new Fernet.Secret(env.FIELD_ENCRYPTION_KEY);
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;
  return new Fernet.Token({ secret: secret() }).encode(plaintext);
}
