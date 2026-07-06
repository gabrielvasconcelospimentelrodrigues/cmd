-- =============================================================================
-- 010 — CONTROLES CLÍNICOS POR TERMINAL (perguntas do onboarding)
-- Alta no mesmo dia? / dias pós-atendimento até a alta.
-- Categoria do CID por tipo de paciente (OCI 0-8, 9+, cirurgia de catarata).
-- Terminologia do problema é sempre CID-10 (padrão do CMD-COLETA).
-- =============================================================================

BEGIN;

ALTER TABLE clinic_accounts
  -- Alta no mesmo dia do atendimento? (true = mesmo dia; false = usa dias abaixo)
  ADD COLUMN IF NOT EXISTS alta_mesmo_dia boolean NOT NULL DEFAULT true,
  -- Quantos dias após o atendimento o paciente recebe alta (só quando NÃO é mesmo dia)
  ADD COLUMN IF NOT EXISTS dias_pos_atendimento_alta integer,
  -- Categoria do CID usada para pacientes de OCI de 0 a 8 anos
  ADD COLUMN IF NOT EXISTS cid_oci_0_8 text NOT NULL DEFAULT 'H53',
  -- Categoria do CID usada para pacientes acima de 9 anos
  ADD COLUMN IF NOT EXISTS cid_9_mais text NOT NULL DEFAULT 'H53',
  -- Categoria do CID usada para pacientes que realizaram cirurgia de catarata
  ADD COLUMN IF NOT EXISTS cid_catarata text NOT NULL DEFAULT 'H53';

COMMIT;
