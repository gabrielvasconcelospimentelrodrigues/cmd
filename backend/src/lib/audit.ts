import type { FastifyRequest } from 'fastify';
import { supabaseAdmin } from './supabase';

export type NivelLog = 'info' | 'sucesso' | 'alerta' | 'erro';

export interface AtorLog {
  usuario_id: string | null;
  actor_nome: string | null;
  actor_email: string | null;
  actor_role: string | null;
}

const localDoEmail = (email: string): string => email.split('@')[0] || email;

/** Nome amigável do ator para compor a frase do log. */
export function atorNome(req: FastifyRequest): string {
  const u = req.authUser;
  const base = u?.nome || (u?.email ? localDoEmail(u.email) : 'Alguém');
  return req.authRole === 'super_admin' ? `${base} (super admin)` : base;
}

/** Extrai o ator (quem fez a ação) de uma request autenticada. */
export function ator(req: FastifyRequest): AtorLog {
  const u = req.authUser;
  return {
    usuario_id: u?.id ?? null,
    actor_nome: u?.nome ?? (u?.email ? localDoEmail(u.email) : null),
    actor_email: u?.email ?? null,
    actor_role: req.authRole ?? null,
  };
}

export interface RegistrarLogInput {
  tenantId?: number | null;
  categoria: string;                 // auth | assinante | terminal | financeiro | automacao | empresa | sistema
  acao: string;                      // chave curta ex.: 'terminal.aprovado'
  descricao: string;                 // frase em linguagem natural
  nivel?: NivelLog;
  ator?: AtorLog;
  meta?: Record<string, unknown>;
}

/**
 * Grava um evento de auditoria em linguagem natural. Fire-and-forget: nunca
 * derruba a rota chamadora — se falhar, só loga no console.
 */
export async function registrarLog(input: RegistrarLogInput): Promise<void> {
  try {
    await (supabaseAdmin as any).from('audit_logs').insert({
      tenant_id: input.tenantId ?? null,
      usuario_id: input.ator?.usuario_id ?? null,
      categoria: input.categoria,
      acao: input.acao,
      descricao: input.descricao,
      nivel: input.nivel ?? 'info',
      actor_nome: input.ator?.actor_nome ?? null,
      actor_email: input.ator?.actor_email ?? null,
      actor_role: input.ator?.actor_role ?? null,
      meta: input.meta ?? null,
    });
  } catch (e) {
    req_console_warn(input.acao, e);
  }
}

function req_console_warn(acao: string, e: unknown): void {
  // eslint-disable-next-line no-console
  console.warn(`[audit] falha ao registrar '${acao}':`, (e as Error)?.message ?? e);
}
