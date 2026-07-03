-- =============================================================================
-- 004 — VINCULAÇÃO DE UPLOADS A EMPRESAS E SELEÇÃO DE TERMINAL NO PLAY
-- Rodar este script no SQL Editor do Supabase.
-- =============================================================================

BEGIN;

-- 1) Torna a conta clínica (terminal) opcional no upload (será preenchida ao dar Play)
ALTER TABLE uploads ALTER COLUMN clinic_account_id DROP NOT NULL;

-- 2) Adiciona a associação com a empresa no upload (definida ao importar)
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS empresa_id bigint REFERENCES empresas(id) ON DELETE SET NULL;

-- 3) Torna o terminal opcional nos registros de paciente (será preenchido ao iniciar a automação)
ALTER TABLE patient_records ALTER COLUMN clinic_account_id DROP NOT NULL;

COMMIT;
