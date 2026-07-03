/**
 * Extrai a chave TOTP (base32) de um QR code lido. Aceita:
 *  - otpauth://totp/Label?secret=XXXX...        (QR de uma conta)
 *  - otpauth-migration://offline?data=<base64>  (QR de "Exportar contas" do
 *    Google Authenticator — payload protobuf com a(s) conta(s)).
 * Retorna a chave em base32 (formato JBSWY3DPEHPK3PXP) ou null.
 */
export function extractSecretFromQr(text: string): string | null {
  if (!text) return null;

  // Formato simples otpauth://totp/...?secret=XXXX
  const m = text.match(/[?&]secret=([A-Za-z2-7]+)/);
  if (m && m[1]) return m[1].toUpperCase();

  // Formato de migração do Google Authenticator
  if (text.startsWith('otpauth-migration://')) {
    const dataMatch = text.match(/[?&]data=([^&]+)/);
    if (!dataMatch || !dataMatch[1]) return null;
    try {
      const b64 = decodeURIComponent(dataMatch[1]);
      const bytes = base64ToBytes(b64);
      return extractFromMigration(bytes);
    } catch {
      return null;
    }
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let i = pos;
  for (; i < buf.length; i++) {
    const b = buf[i]!;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      i++;
      break;
    }
    shift += 7;
  }
  return [result >>> 0, i];
}

function skipField(buf: Uint8Array, pos: number, wire: number): number {
  if (wire === 0) return readVarint(buf, pos)[1];
  if (wire === 2) {
    const [len, p] = readVarint(buf, pos);
    return p + len;
  }
  if (wire === 5) return pos + 4;
  if (wire === 1) return pos + 8;
  return buf.length;
}

/** Parseia o protobuf MigrationPayload e devolve a 1ª chave (base32). */
function extractFromMigration(bytes: Uint8Array): string | null {
  let i = 0;
  while (i < bytes.length) {
    const [tag, ni] = readVarint(bytes, i);
    i = ni;
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      // otp_parameters (repeated message)
      const [len, nj] = readVarint(bytes, i);
      i = nj;
      const msg = bytes.subarray(i, i + len);
      i += len;
      let j = 0;
      while (j < msg.length) {
        const [t2, nj2] = readVarint(msg, j);
        j = nj2;
        const f2 = t2 >> 3;
        const w2 = t2 & 7;
        if (f2 === 1 && w2 === 2) {
          // secret (bytes)
          const [slen, nk] = readVarint(msg, j);
          j = nk;
          return base32Encode(msg.subarray(j, j + slen));
        }
        j = skipField(msg, j, w2);
      }
    } else {
      i = skipField(bytes, i, wire);
    }
  }
  return null;
}

function base32Encode(buf: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
