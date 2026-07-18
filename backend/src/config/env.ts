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

  // ---- Asaas (cobrança online) --------------------------------------------
  // Opcionais: sem a chave, o sistema segue funcionando com baixa manual — só
  // não gera cobrança. Assim um deploy sem as variáveis não derruba a API.
  ASAAS_API_KEY: z.string().optional(),
  // Sandbox por padrão: cobra de mentira. Trocar para a URL de produção só
  // depois de validar o fluxo ponta a ponta.
  ASAAS_BASE_URL: z.string().url().default('https://api-sandbox.asaas.com/v3'),
  // Token que o Asaas envia no header 'asaas-access-token' de cada webhook.
  // É o que impede um terceiro de forjar "pagamento recebido" e liberar
  // automação sem pagar — sem ele, o webhook é recusado.
  ASAAS_WEBHOOK_TOKEN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
