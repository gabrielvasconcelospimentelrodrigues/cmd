import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { supabaseAdmin } from '../lib/supabase';
import { env } from '../config/env';

/**
 * Transmissão AO VIVO do robô (screencast do navegador) via SSE.
 *
 * O worker (WebAutomator) publica os frames JPEG do Chromium no canal Redis
 * `live:{uploadId}` enquanto opera o gov.br. Aqui assinamos esse canal e
 * repassamos cada frame ao navegador do assinante como evento SSE.
 *
 * A tela mostra dados de paciente sendo digitados (nome/CNS), então NÃO é
 * pública: além do `public_token` (seletor da transmissão), exige o token de
 * sessão do usuário via query `?auth=` (o EventSource do browser não envia
 * Authorization) e confere que o upload é do MESMO assinante.
 */
export async function liveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/live/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;

    // 1) Autentica o usuário pelo access token do Supabase (na query).
    const jwt = String((req.query as { auth?: string }).auth ?? '');
    if (!jwt) return reply.code(401).send({ error: 'não autorizado.' });
    const { data: userData } = await supabaseAdmin.auth.getUser(jwt);
    const uid = userData?.user?.id;
    if (!uid) return reply.code(401).send({ error: 'sessão inválida.' });

    // 2) Resolve o tenant do usuário (titular OU membro de equipe).
    let tenantId: number | null = null;
    const { data: dono } = await (supabaseAdmin as any).from('tenants').select('id').eq('owner_user_id', uid).maybeSingle();
    if (dono) tenantId = dono.id;
    else {
      const { data: membro } = await (supabaseAdmin as any).from('tenant_members').select('tenant_id').eq('user_id', uid).maybeSingle();
      tenantId = membro?.tenant_id ?? null;
    }
    if (!tenantId) return reply.code(403).send({ error: 'acesso negado.' });

    // 3) O upload precisa ser do tenant do usuário (senão é PII de outro cliente).
    const { data: up } = await (supabaseAdmin as any)
      .from('uploads')
      .select('id, clinic_accounts(tenant_id), empresas(tenant_id)')
      .eq('public_token', token)
      .is('deleted_at', null)
      .maybeSingle();
    if (!up) return reply.code(404).send({ error: 'transmissão não encontrada.' });
    const donoUpload = up.clinic_accounts?.tenant_id ?? up.empresas?.tenant_id ?? null;
    if (donoUpload !== tenantId) return reply.code(403).send({ error: 'acesso negado.' });

    // hijack(): assumimos o controle total da resposta (SSE via reply.raw). Sem
    // isso, quando o handler async retorna, o Fastify tenta enviar a resposta e,
    // como os headers já foram escritos, dispara ERR_HTTP_HEADERS_SENT — que
    // NÃO era tratado e DERRUBAVA o processo (backend em crash-loop → 502).
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write('retry: 3000\n\n');

    // Conexão dedicada ao modo subscriber (ioredis não permite outros comandos
    // numa conexão já inscrita — por isso não reusamos a conexão do BullMQ).
    const sub = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: (t) => (t > 5 ? null : Math.min(t * 200, 2000)),
    });
    sub.on('error', () => { /* silencioso — fecha no close */ });

    const canal = `live:${up.id}`;
    try {
      await sub.connect();
      await sub.subscribe(canal);
    } catch {
      reply.raw.end();
      void sub.quit().catch(() => {});
      return;
    }

    sub.on('message', (_ch, frame) => {
      // Frame é base64 JPEG; uma linha `data:` só (sem quebras internas).
      reply.raw.write(`data: ${frame}\n\n`);
    });

    // Heartbeat para manter a conexão viva atrás de proxies.
    const hb = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { /* fechado */ }
    }, 15_000);

    const encerrar = () => {
      clearInterval(hb);
      void sub.unsubscribe(canal).catch(() => {});
      void sub.quit().catch(() => {});
    };
    req.raw.on('close', encerrar);
    req.raw.on('error', encerrar);
  });
}
