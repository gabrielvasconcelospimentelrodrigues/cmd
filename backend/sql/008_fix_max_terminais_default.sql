-- =============================================================================
-- 008 — DEFINE LIMITE DE TERMINAIS INICIAL COMO 0 E CORRIGE COTAS EXISTENTES
-- Rodar este script no SQL Editor do Supabase ou via runner.
-- =============================================================================

BEGIN;

-- 1) Altera o valor padrão de max_terminais para 0 na tabela tenants
ALTER TABLE tenants ALTER COLUMN max_terminais SET DEFAULT 0;

-- 2) Corrige as cotas de tenants existentes para bater com a soma das suas empresas
UPDATE tenants t
SET max_terminais = COALESCE((
  SELECT SUM(terminais_contratados)
  FROM empresas e
  WHERE e.tenant_id = t.id
), 0);

COMMIT;
