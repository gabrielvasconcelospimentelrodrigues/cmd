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
 * Rota PÚBLICA por `public_token` (não vaza dados — é só o vídeo do robô e o
 * token é um uuid imprevisível), para a tela "Ver Robô Ao Vivo" abrir sem
 * cabeçalho de auth (o EventSource do browser não envia Authorization).
 */
export async function liveRoutes(app: FastifyInstance): Promise<void> {
  app.get('/live/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;

    const { data: up } = await supabaseAdmin
      .from('uploads')
      .select('id')
      .eq('public_token', token)
      .is('deleted_at', null)
      .maybeSingle();
    if (!up) return reply.code(404).send({ error: 'transmissão não encontrada.' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write('retry: 3000\n\n');
    reply.sent = true;

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

    // Mantém a rota ativa enquanto o cliente estiver conectado
    await new Promise<void>((resolve) => {
      req.raw.on('close', () => resolve());
    });
  });
}
