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
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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
