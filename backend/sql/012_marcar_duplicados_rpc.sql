-- =============================================================================
-- 012 — DEDUP RÁPIDA (função no banco) + índice
-- Antes: o worker baixava TODOS os cadastrados do tenant pro JS (limite 1000
-- do supabase-js → lento e incompleto). Agora a checagem roda numa query só.
-- Regra: um pendente é duplicado se (CNS + data de atendimento) já está
-- cadastrado no tenant, OU se repete dentro da própria lista (mantém o 1º).
-- =============================================================================

BEGIN;

-- Acelera a busca por (cns, data) entre os cadastrados.
CREATE INDEX IF NOT EXISTS idx_patient_records_cns_data
  ON patient_records (cns, data_atendimento);

CREATE OR REPLACE FUNCTION marcar_duplicados_upload(p_upload_id bigint, p_tenant_id bigint)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  WITH marcados AS (
    UPDATE patient_records pr
    SET status = 'needs_review',
        error_message = 'Cadastro duplicado — mesmo CNS já cadastrado nesta data de atendimento.'
    WHERE pr.upload_id = p_upload_id
      AND pr.status = 'pending_registration'
      AND pr.cns IS NOT NULL AND pr.data_atendimento IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM patient_records r
          JOIN clinic_accounts ca ON ca.id = r.clinic_account_id
          WHERE ca.tenant_id = p_tenant_id
            AND r.status IN ('registered','verified_ok','verified_divergent','done_manually')
            AND r.cns = pr.cns AND r.data_atendimento = pr.data_atendimento
        )
        OR EXISTS (
          SELECT 1 FROM patient_records d
          WHERE d.upload_id = pr.upload_id
            AND d.status = 'pending_registration'
            AND d.cns = pr.cns AND d.data_atendimento = pr.data_atendimento
            AND d.id < pr.id
        )
      )
    RETURNING 1
  )
  SELECT count(*) INTO n FROM marcados;
  RETURN n;
END;
$$;

COMMIT;
