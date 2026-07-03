import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { env } from './config/env';
import authPlugin from './plugins/auth';
import { healthRoutes } from './routes/health';
import { uploadRoutes } from './routes/uploads';
import { clinicRoutes } from './routes/clinic';
import { onboardingRoutes } from './routes/onboarding';
import { adminRoutes } from './routes/admin';
import { empresaRoutes } from './routes/empresas';
import { economiaRoutes } from './routes/economia';
import { liveRoutes } from './routes/live';
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
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 }, // 50MB, 1 arquivo
  });

  await app.register(authPlugin);
  await app.register(healthRoutes);
  await app.register(onboardingRoutes);
  await app.register(clinicRoutes);
  await app.register(uploadRoutes);
  await app.register(adminRoutes);
  await app.register(empresaRoutes);
  await app.register(economiaRoutes);
  await app.register(liveRoutes);

  return app;
}

// Cache do servidor para Vercel Serverless
let cachedApp: any = null;

export default async function handler(req: any, res: any) {
  if (!cachedApp) {
    cachedApp = await buildServer();
  }
  await cachedApp.ready();
  cachedApp.server.emit('request', req, res);
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

