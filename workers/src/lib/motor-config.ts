import { supabaseAdmin } from './supabase';

export interface MotorConfig {
  registration_concurrency: number;
  extraction_concurrency: number;
  max_rondas_retry: number;
  login_timeout_segundos: number;
  cadastro_timeout_segundos: number;
  watchdog_interval_minutos: number;
  automacao_simulada: boolean;
}

export const MOTOR_CONFIG_PADRAO: MotorConfig = {
  registration_concurrency: 4,
  extraction_concurrency: 2,
  max_rondas_retry: 3,
  login_timeout_segundos: 330, // ⚠️ PROVISÓRIO: comporta o laço de 5 min login→contatos (voltar p/ 150 ao desativar a regra)
  cadastro_timeout_segundos: 360,
  watchdog_interval_minutos: 5,
  automacao_simulada: true
};

export async function getMotorConfig(): Promise<MotorConfig> {
  const { data } = await (supabaseAdmin as any).from('configuracoes').select('valor').eq('chave', 'motor').maybeSingle();
  const v = data?.valor as Partial<MotorConfig> | undefined;
  if (!v) return MOTOR_CONFIG_PADRAO;
  return {
    registration_concurrency: Number(v.registration_concurrency ?? MOTOR_CONFIG_PADRAO.registration_concurrency),
    extraction_concurrency: Number(v.extraction_concurrency ?? MOTOR_CONFIG_PADRAO.extraction_concurrency),
    max_rondas_retry: Number(v.max_rondas_retry ?? MOTOR_CONFIG_PADRAO.max_rondas_retry),
    login_timeout_segundos: Number(v.login_timeout_segundos ?? MOTOR_CONFIG_PADRAO.login_timeout_segundos),
    cadastro_timeout_segundos: Number(v.cadastro_timeout_segundos ?? MOTOR_CONFIG_PADRAO.cadastro_timeout_segundos),
    watchdog_interval_minutos: Number(v.watchdog_interval_minutos ?? MOTOR_CONFIG_PADRAO.watchdog_interval_minutos),
    automacao_simulada: v.automacao_simulada === true || String(v.automacao_simulada) === 'true',
  };
}
