-- =============================================================================
-- 003 — MÓDULO DE ECONOMIA com CUSTO REAL do funcionário
-- (salário bruto + encargos + benefícios + infra da estação de trabalho).
-- Idempotente: pode rodar no Supabase quantas vezes quiser.
-- =============================================================================

-- ---- 1) Novas colunas de custo real no perfil/config do cliente (tenants) ----
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS salario_bruto_medio          numeric(12,2) NOT NULL DEFAULT 3000;
-- porcentagem_encargos: percentual sobre o salário (ex.: 80 = 80%).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS porcentagem_encargos         numeric(6,2)  NOT NULL DEFAULT 80;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS beneficios_mensais_total     numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custo_infra_estacao_trabalho numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS horas_uteis_mes              integer       NOT NULL DEFAULT 176;

-- Carrega o salário base a partir do que já existia (se houver), só na 1ª vez.
UPDATE tenants
   SET salario_bruto_medio = salario_medio_funcionario
 WHERE salario_medio_funcionario IS NOT NULL
   AND salario_medio_funcionario > 0
   AND salario_bruto_medio = 3000;

-- ---- Garante as estruturas do módulo (caso 002 não tenha rodado) -------------
CREATE TABLE IF NOT EXISTS tipos_automacao (
  id bigserial PRIMARY KEY,
  chave text UNIQUE NOT NULL,
  nome text NOT NULL,
  tempo_manual_estimado_minutos numeric(6,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tipos_automacao (chave, nome, tempo_manual_estimado_minutos)
  VALUES ('cadastro_cmd', 'Cadastro de paciente no CMD-COLETA', 14)
  ON CONFLICT (chave) DO NOTHING;

CREATE TABLE IF NOT EXISTS execucoes_automacao (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empresa_id bigint REFERENCES empresas(id) ON DELETE SET NULL,
  clinic_account_id bigint REFERENCES clinic_accounts(id) ON DELETE SET NULL,
  tipo_automacao_id bigint NOT NULL REFERENCES tipos_automacao(id),
  upload_id bigint REFERENCES uploads(id) ON DELETE SET NULL,
  patient_record_id bigint,
  sucesso boolean NOT NULL DEFAULT true,
  executed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_execucoes_tenant_data ON execucoes_automacao (tenant_id, executed_at);

-- =============================================================================
-- CUSTO REAL MENSAL do funcionário:
--   salario_bruto_medio * (1 + porcentagem_encargos/100)
--   + beneficios_mensais_total
--   + custo_infra_estacao_trabalho
-- custo por minuto = custo_total_mensal / (horas_uteis_mes * 60)
-- =============================================================================

-- DROP antes: a 002 criou a view/função com colunas diferentes, e
-- CREATE OR REPLACE não muda a estrutura de colunas/retorno existente.
DROP VIEW IF EXISTS vw_economia_cliente;
DROP FUNCTION IF EXISTS economia_cliente(bigint, timestamptz, timestamptz);

-- ---- 2) VIEW: economia acumulada por cliente (custo real) --------------------
CREATE OR REPLACE VIEW vw_economia_cliente AS
WITH custo AS (
  SELECT
    t.id,
    t.name,
    t.horas_uteis_mes,
    ( t.salario_bruto_medio * (1 + t.porcentagem_encargos / 100.0)
      + t.beneficios_mensais_total
      + t.custo_infra_estacao_trabalho ) AS custo_total_mensal
  FROM tenants t
)
SELECT
  c.id   AS tenant_id,
  c.name AS tenant_nome,
  c.custo_total_mensal,
  c.horas_uteis_mes,
  count(e.id)                                                       AS volume_execucoes,
  COALESCE(sum(ta.tempo_manual_estimado_minutos), 0)               AS minutos_economizados,
  ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0, 2) AS horas_economizadas,
  ROUND(c.custo_total_mensal / NULLIF(c.horas_uteis_mes*60, 0), 4) AS custo_minuto,
  ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)
        * (c.custo_total_mensal / NULLIF(c.horas_uteis_mes*60, 0)), 2) AS valor_economizado,
  ROUND((COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0)
        / NULLIF(c.horas_uteis_mes, 0), 2)                         AS funcionarios_equivalentes
FROM custo c
LEFT JOIN execucoes_automacao e ON e.tenant_id = c.id AND e.sucesso
LEFT JOIN tipos_automacao ta    ON ta.id = e.tipo_automacao_id
GROUP BY c.id, c.name, c.custo_total_mensal, c.horas_uteis_mes;

-- ---- 3) FUNÇÃO (RPC): economia por cliente com PERÍODO opcional --------------
CREATE OR REPLACE FUNCTION economia_cliente(
  p_tenant_id bigint,
  p_inicio timestamptz DEFAULT NULL,
  p_fim    timestamptz DEFAULT NULL
)
RETURNS TABLE (
  tenant_id bigint,
  custo_total_mensal numeric,
  volume_execucoes bigint,
  minutos_economizados numeric,
  horas_economizadas numeric,
  custo_minuto numeric,
  valor_economizado numeric,
  funcionarios_equivalentes numeric
)
LANGUAGE sql STABLE AS $$
  WITH custo AS (
    SELECT
      t.id,
      t.horas_uteis_mes,
      ( t.salario_bruto_medio * (1 + t.porcentagem_encargos / 100.0)
        + t.beneficios_mensais_total
        + t.custo_infra_estacao_trabalho ) AS custo_total_mensal
    FROM tenants t
    WHERE t.id = p_tenant_id
  )
  SELECT
    c.id,
    c.custo_total_mensal,
    count(e.id),
    COALESCE(sum(ta.tempo_manual_estimado_minutos), 0),
    ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0, 2),
    ROUND(c.custo_total_mensal / NULLIF(c.horas_uteis_mes*60, 0), 4),
    ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)
          * (c.custo_total_mensal / NULLIF(c.horas_uteis_mes*60, 0)), 2),
    ROUND((COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0)
          / NULLIF(c.horas_uteis_mes, 0), 2)
  FROM custo c
  LEFT JOIN execucoes_automacao e ON e.tenant_id = c.id AND e.sucesso
        AND (p_inicio IS NULL OR e.executed_at >= p_inicio)
        AND (p_fim    IS NULL OR e.executed_at <= p_fim)
  LEFT JOIN tipos_automacao ta ON ta.id = e.tipo_automacao_id
  GROUP BY c.id, c.horas_uteis_mes, c.custo_total_mensal;
$$;
