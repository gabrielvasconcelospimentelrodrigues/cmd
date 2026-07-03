-- =============================================================================
-- 009 — INICIALIZA AS CONFIGURAÇÕES DO MOTOR DE AUTOMAÇÃO
-- Rodar este script no SQL Editor do Supabase ou via runner.
-- =============================================================================

BEGIN;

INSERT INTO configuracoes (chave, valor)
VALUES ('motor', '{
  "registration_concurrency": 4,
  "extraction_concurrency": 2,
  "max_rondas_retry": 3,
  "login_timeout_segundos": 150,
  "cadastro_timeout_segundos": 360,
  "watchdog_interval_minutos": 5,
  "automacao_simulada": true
}'::jsonb)
ON CONFLICT (chave) DO NOTHING;

COMMIT;
