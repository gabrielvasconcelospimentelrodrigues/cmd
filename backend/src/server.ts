import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env';
import authPlugin from './plugins/auth';
import { healthRoutes } from './routes/health';
import { uploadRoutes } from './routes/uploads';
import { clinicRoutes } from './routes/clinic';
import { onboardingRoutes } from './routes/onboarding';
import { adminRoutes } from './routes/admin';
import { empresaRoutes } from './routes/empresas';
import { economiaRoutes } from './routes/economia';
import { relatoriosRoutes } from './routes/relatorios';
import { liveRoutes } from './routes/live';
import { webhookRoutes } from './routes/webhooks';
import { closeRedis } from './lib/redis';
import { closePool } from './lib/db';
import { closeQueues } from './lib/queue';

/**
 * Bootstrap da API. Fastify é assíncrono e leve por padrão — sem middlewares
 * pesados desnecessários, alinhado ao foco de baixo consumo na VPS.
 */
async function buildServer() {
  const app = Fastify({
    logger: {
      level: (env.NODE_ENV === 'production' || process.env.VERCEL) ? 'info' : 'debug',
      // TRAVA DE SEGURANÇA: o checkout transparente recebe dados de CARTÃO no
      // corpo da requisição. O Fastify não loga corpo por padrão, mas isso
      // muda com uma linha — a redação garante que, mesmo se alguém ligar o
      // log de body ou de headers, número/CVV e credenciais saiam mascarados.
      redact: {
        paths: [
          'req.body.cartao', 'req.body.cartao.number', 'req.body.cartao.ccv',
          'req.body.titular', 'body.cartao', 'body.titular',
          // Credenciais CMD que o cliente envia ao conectar/editar conta.
          'req.body.cmd_password', 'req.body.mfa_secret', 'body.cmd_password', 'body.mfa_secret',
          'req.headers.authorization', 'req.headers["asaas-access-token"]',
        ],
        censor: '[REDACTED]',
      },
      transport:
        (env.NODE_ENV === 'development' && !process.env.VERCEL)
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    // Origens do env + o domínio de produção (garante o iacmd.com.br mesmo se
    // a env não estiver configurada). Preview URLs da Vercel entram via env.
    origin: [...new Set([...env.CORS_ORIGINS, 'https://iacmd.com.br', 'https://www.iacmd.com.br'])],
    credentials: true,
  });
  await app.register(multipart, {
    // 15MB é folgado para planilha de pacientes (dezenas de milhares de linhas
    // num .xlsx cabem em poucos MB). Limite alto abria espaço para zip-bomb:
    // um .xlsx (ZIP) de 50MB descomprime para vários GB e derruba o processo.
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });

  // RATE LIMIT — backstop contra abuso/DoS. Teto alto para não atrapalhar o uso
  // normal (o painel faz polling a cada 6s em várias abas). O webhook do Asaas
  // e o health ficam de fora (o Asaas reenvia eventos e não pode ser barrado).
  await app.register(rateLimit, {
    max: 1200,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/webhooks/') || req.url.startsWith('/health'),
    // Atrás do nginx, usa o IP real (trustProxy já está ligado).
    keyGenerator: (req) => req.ip,
  });

  await app.register(authPlugin);
  await app.register(healthRoutes);
  await app.register(onboardingRoutes);
  await app.register(clinicRoutes);
  await app.register(uploadRoutes);
  await app.register(adminRoutes);
  await app.register(empresaRoutes);
  await app.register(economiaRoutes);
  await app.register(relatoriosRoutes);
  await app.register(liveRoutes);
  // Sem autenticação de usuário: quem chama é o Asaas (valida por token próprio).
  await app.register(webhookRoutes);

  return app;
}

// Cache do servidor para Vercel Serverless
let cachedApp: any = null;

export default async function handler(req: any, res: any) {
  if (!cachedApp) {
    cachedApp = await buildServer();
  }
  await cachedApp.ready();
  
  await new Promise<void>((resolve, reject) => {
    res.on('close', resolve);
    res.on('finish', resolve);
    res.on('error', reject);
    cachedApp.server.emit('request', req, res);
  });
}


async function main() {
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info(`Recebido ${signal}, encerrando...`);
    await app.close();
    await closeQueues();
    await closeRedis();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Só roda o loop de escuta de porta local se não estiver na Vercel
if (!process.env.VERCEL) {
  void main();
}

