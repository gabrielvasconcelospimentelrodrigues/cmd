import { supabase } from './supabase';

// URL da API — vem da env VITE_API_URL (setada no projeto Vercel do frontend).
// Em dev cai para o backend local.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3333';

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  // Se o access token já expirou (ou expira em <60s), renova ANTES de chamar a
  // API — evita o "token inválido ou expirado" quando o refresh automático não
  // rodou (PC dormiu, aba inativa por muito tempo).
  if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60_000) {
    const r = await supabase.auth.refreshSession();
    session = r.data.session ?? session;
  }
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let redirecionando = false;
async function toError(res: Response): Promise<ApiError> {
  let msg = res.statusText;
  let code: string | undefined;
  try {
    const j = await res.json();
    msg = j.error ?? msg;
    code = j.code;
  } catch {
    /* corpo não-JSON */
  }
  // 401 = sessão morta (token inválido/expirado e sem refresh possível).
  // Desloga e manda pro login, em vez de deixar a tela de erro travada.
  if (res.status === 401 && typeof window !== 'undefined' && !redirecionando) {
    redirecionando = true;
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    if (!/\/(login|registro|esqueci-senha)/.test(window.location.pathname)) {
      window.location.href = '/login';
    }
  }
  const e = new Error(msg) as ApiError;
  e.status = res.status;
  e.code = code;
  return e;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeader() });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: await authHeader() });
  if (!res.ok) throw await toError(res);
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: await authHeader(),
    body: form,
  });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}
