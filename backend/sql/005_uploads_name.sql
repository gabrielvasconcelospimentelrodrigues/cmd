-- =============================================================================
-- 005 — ADICIONA NOME PERSONALIZADO ÀS LISTAS DE UPLOAD
-- Rodar este script no SQL Editor do Supabase.
-- =============================================================================

BEGIN;

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS name varchar(255) DEFAULT '';

COMMIT;
