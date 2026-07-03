export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  // Datas 'YYYY-MM-DD' (sem hora) — evita shift de fuso.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  return new Date(iso).toLocaleDateString('pt-BR');
}

export const STATUS_LABEL: Record<string, string> = {
  aguardando_mapeamento: 'Aguardando mapeamento',
  extracting: 'Extraindo',
  extracted: 'Extraído',
  extraction_failed: 'Falha na extração',
  needs_review: 'Revisão manual',
  registering: 'Registrando',
  paused: 'Pausado',
  parado: 'Parado',
  registration_failed: 'Falha no registro',
  done: 'Concluído',
  pending_registration: 'A registrar',
  registered: 'Registrado',
  error: 'Erro',
  verified_ok: 'Verificado',
  verified_divergent: 'Divergência',
  done_manually: 'Feito manualmente',
};

// Tom de cor por status (fundo suave + texto + ponto).
export const STATUS_TONE: Record<string, string> = {
  extracting: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  extracted: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  extraction_failed: 'bg-red-50 text-red-700 ring-red-600/20',
  needs_review: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  registering: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  paused: 'bg-neutral-100 text-neutral-600 ring-neutral-500/20',
  parado: 'bg-neutral-100 text-neutral-600 ring-neutral-500/20',
  registration_failed: 'bg-red-50 text-red-700 ring-red-600/20',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending_registration: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  registered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  error: 'bg-red-50 text-red-700 ring-red-600/20',
  verified_ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  verified_divergent: 'bg-amber-50 text-amber-700 ring-amber-600/20',
};

export function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s;
}
export function statusTone(s: string): string {
  return STATUS_TONE[s] ?? 'bg-neutral-100 text-neutral-600 ring-neutral-500/20';
}
