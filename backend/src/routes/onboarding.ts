import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../lib/supabase';

/**
 * Onboarding: cria a clínica (tenant) do usuário recém-cadastrado. Idempotente
 * — se já existe, devolve a existente. Usa authenticateUser (não exige clínica).
 */
export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/onboarding', { preHandler: app.authenticateUser }, async (req, reply) => {
    const userId = req.authUser!.id;
    const body = (req.body ?? {}) as {
      name?: string; cnpj?: string; responsavel?: string; telefone?: string; cidade?: string;
    };
    const name = (body.name ?? '').trim() || `Clínica de ${req.authUser!.email ?? 'usuário'}`;
    const extra = {
      cnpj: body.cnpj?.trim() || null,
      responsavel: body.responsavel?.trim() || null,
      telefone: body.telefone?.trim() || null,
      cidade: body.cidade?.trim() || null,
    };

    const { data: existente } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('owner_user_id', userId)
      .maybeSingle();
    if (existente) {
      // Idempotente: atualiza os dados da clínica se reenviado no onboarding.
      const { data: upd } = await supabaseAdmin
        .from('tenants')
        .update({ name, ...extra })
        .eq('id', existente.id)
        .select('*')
        .single();
      return upd ?? existente;
    }

    // Nasce PENDENTE — o super admin precisa liberar (status -> active).
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .insert({ name, owner_user_id: userId, status: 'pending_approval', ...extra })
      .select('*')
      .single();
    if (error || !data) {
      req.log.error(error);
      return reply.code(500).send({ error: 'Falha ao criar a clínica.' });
    }
    return reply.code(201).send(data);
  });
}
