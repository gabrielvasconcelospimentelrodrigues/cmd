import 'dotenv/config';
import { z } from 'zod';

/**
 * Valida e tipa todas as variáveis de ambiente no boot. Se algo essencial
 * faltar, o processo morre cedo com mensagem clara (em vez de quebrar em
 * runtime no meio de uma request).
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  DATABASE_URL: z.string().url().optional(),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Opcional aqui — obrigatória só nos workers que cifram credenciais.
  FIELD_ENCRYPTION_KEY: z.string().optional(),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
