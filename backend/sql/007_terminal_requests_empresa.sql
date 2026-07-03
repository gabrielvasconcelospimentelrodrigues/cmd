-- =============================================================================
-- 007 — ASSOCIA SOLICITAÇÃO DE TERMINAL A UMA EMPRESA ESPECÍFICA
-- Rodar este script no SQL Editor do Supabase.
-- =============================================================================

BEGIN;

ALTER TABLE terminal_requests ADD COLUMN IF NOT EXISTS empresa_id integer REFERENCES empresas(id) ON DELETE CASCADE;

COMMIT;
