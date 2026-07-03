import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';
import type { Tenant } from '../types/database';

/**
 * Autenticação via JWT do Supabase Auth.
 * O frontend manda `Authorization: Bearer <access_token>`; verificamos com o
 * Supabase, resolvemos o usuário e a clínica (tenant) dele, e anexamos à
 * request. Rotas protegidas usam `{ preHandler: app.authenticate }`; o
 * onboarding (antes de existir clínica) usa `app.authenticateUser`.
 */
declare module 'fastify' {
  interface FastifyRequest {
    authUser: { id: string; email: string | undefined; nome: string | undefined } | null;
    authRole: string | null;
    tenant: Tenant | null;
  }
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
    authenticateUser: preHandlerHookHandler;
    authenticateSuperAdmin: preHandlerHookHandler;
    requireActive: preHandlerHookHandler;
  }
}

async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('authUser', null);
  app.decorateRequest('authRole', null);
  app.decorateRequest('tenant', null);

  // Verifica só o token e popula req.authUser. Não exige clínica.
  async function verifyUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      await reply.code(401).send({ error: 'Token de autenticação ausente.' });
      return;
    }
    const { data, error } = await supabaseAdmin.auth.getUser(header.slice(7));
    if (error || !data.user) {
      await reply.code(401).send({ error: 'Token inválido ou expirado.' });
      return;
    }
    const nome = (data.user.user_metadata as { full_name?: string } | null)?.full_name;
    req.authUser = { id: data.user.id, email: data.user.email, nome };
    req.authRole = (data.user.app_metadata as { role?: string } | null)?.role ?? null;
  }

  // Verifica o token E exige papel de super admin.
  async function verifySuperAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await verifyUser(req, reply);
    if (reply.sent) return;
    if (req.authRole !== 'super_admin') {
      await reply.code(403).send({ error: 'Acesso restrito ao super admin.' });
    }
  }

  // Verifica o token E exige uma clínica ativa.
  async function verifyTenant(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await verifyUser(req, reply);
    if (reply.sent) return;

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('owner_user_id', req.authUser!.id)
      .maybeSingle();

    if (!tenant) {
      await reply.code(403).send({ error: 'Usuário sem clínica associada.', code: 'NO_TENANT' });
      return;
    }
    // Tenant de QUALQUER status (inclui pending_approval) — necessário p/ o
    // onboarding. A exigência de "ativo" fica no requireActive.
    req.tenant = tenant;
  }

  // Exige clínica ATIVA (liberada pelo super admin). Use depois de authenticate.
  async function requireActive(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!req.tenant) {
      await reply.code(403).send({ error: 'Usuário sem clínica associada.', code: 'NO_TENANT' });
      return;
    }
    if (req.tenant.status !== 'active') {
      await reply.code(403).send({
        error: 'Clínica aguardando liberação do administrador.',
        code: 'NOT_ACTIVE',
      });
      return;
    }
  }

  app.decorate('authenticateUser', verifyUser);
  app.decorate('authenticateSuperAdmin', verifySuperAdmin);
  app.decorate('authenticate', verifyTenant);
  app.decorate('requireActive', requireActive);
}

export default fp(authPlugin, { name: 'auth' });
