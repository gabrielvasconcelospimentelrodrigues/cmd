/** Monta a URI otpauth:// (TOTP) para gerar o QR code do app autenticador. */
export function otpauthUri(secret: string, account: string, issuer = 'CMD-COLETA'): string {
  const s = secret.replace(/\s+/g, '').toUpperCase();
  const label = encodeURIComponent(`${issuer}:${account || 'conta'}`);
  return `otpauth://totp/${label}?secret=${s}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
