import 'dotenv/config';
import { z } from 'zod';

/**
 * Envs dos workers. Aqui o FIELD_ENCRYPTION_KEY é OBRIGATÓRIO — os workers
 * precisam decifrar a senha/MFA da clínica para logar no CMD-COLETA.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  FIELD_ENCRYPTION_KEY: z.string().min(40, 'Chave Fernet inválida (esperado base64 de 32 bytes).'),

  REGISTRATION_CONCURRENCY: z.coerce.number().int().positive().default(4),
  EXTRACTION_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Enquanto o cadastro Playwright real não está validado contra o gov.br,
  // o registro roda em SIMULAÇÃO (marca os pacientes como cadastrados para
  // demonstrar o fluxo). Mude para 'false' quando o motor estiver pronto.
  AUTOMACAO_SIMULADA: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas (workers):');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
