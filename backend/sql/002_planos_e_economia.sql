-- =============================================================================
-- 002 — PLANOS (empresas/terminais) + MÓDULO DE ECONOMIA
-- Aplicado em produção dev (Supabase) via pooler. Idempotente.
-- =============================================================================

-- ---- Tempo de cada cadastro (relatório) -------------------------------------
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS registro_iniciado_em timestamptz;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS registro_concluido_em timestamptz;

-- ---- CID-10 padrão por conta (fallback quando a ficha não traz CID) ---------
ALTER TABLE clinic_accounts ADD COLUMN IF NOT EXISTS cid_padrao text NOT NULL DEFAULT '';

-- ---- Plano de assinatura ----------------------------------------------------
-- Assinante: implantação única + mensalidade por terminal.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS valor_terminal numeric(10,2) NOT NULL DEFAULT 2000;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS valor_implantacao numeric(10,2) NOT NULL DEFAULT 20000;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS implantacao_paga boolean NOT NULL DEFAULT false;

-- Empresas (companhias) sob o assinante. Cada empresa tem 1+ terminais e taxa própria.
CREATE TABLE IF NOT EXISTS empresas (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  cnpj text NOT NULL DEFAULT '',
  taxa_empresa numeric(10,2) NOT NULL DEFAULT 0,
  taxa_paga boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Terminal (= conta CMD = funcionário) pertence a uma empresa.
ALTER TABLE clinic_accounts ADD COLUMN IF NOT EXISTS empresa_id bigint REFERENCES empresas(id) ON DELETE SET NULL;

-- =============================================================================
-- MÓDULO DE ECONOMIA (tempo, dinheiro, funcionários poupados)
-- =============================================================================

-- 1) Config do cliente: salário médio + horas trabalhadas/mês (padrão 176).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS salario_medio_funcionario numeric(10,2) NOT NULL DEFAULT 3000;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS horas_trabalhadas_mes integer NOT NULL DEFAULT 176;

-- 2) Tipos de automação/tarefa com o tempo manual estimado por execução.
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

-- 3) Métricas: 1 linha por execução (cadastro), com tenant/empresa p/ volume por cliente.
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
CREATE INDEX IF NOT EXISTS idx_execucoes_pr ON execucoes_automacao (patient_record_id);

-- 4a) VIEW: economia acumulada (todo período) por cliente.
CREATE OR REPLACE VIEW vw_economia_cliente AS
SELECT
  t.id   AS tenant_id,
  t.name AS tenant_nome,
  t.salario_medio_funcionario,
  t.horas_trabalhadas_mes,
  count(e.id)                                                     AS volume_execucoes,
  COALESCE(sum(ta.tempo_manual_estimado_minutos), 0)             AS minutos_economizados,
  ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0, 2) AS horas_economizadas,
  ROUND(t.salario_medio_funcionario / NULLIF(t.horas_trabalhadas_mes*60, 0), 4) AS custo_minuto,
  ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)
        * (t.salario_medio_funcionario / NULLIF(t.horas_trabalhadas_mes*60, 0)), 2) AS valor_economizado,
  ROUND((COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0)
        / NULLIF(t.horas_trabalhadas_mes, 0), 2)                 AS funcionarios_equivalentes
FROM tenants t
LEFT JOIN execucoes_automacao e ON e.tenant_id = t.id AND e.sucesso
LEFT JOIN tipos_automacao ta    ON ta.id = e.tipo_automacao_id
GROUP BY t.id, t.name, t.salario_medio_funcionario, t.horas_trabalhadas_mes;

-- 4b) RPC: economia por cliente com PERÍODO opcional (ex.: "este mês").
CREATE OR REPLACE FUNCTION economia_cliente(
  p_tenant_id bigint,
  p_inicio timestamptz DEFAULT NULL,
  p_fim    timestamptz DEFAULT NULL
)
RETURNS TABLE (
  tenant_id bigint,
  volume_execucoes bigint,
  minutos_economizados numeric,
  horas_economizadas numeric,
  custo_minuto numeric,
  valor_economizado numeric,
  funcionarios_equivalentes numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    t.id,
    count(e.id),
    COALESCE(sum(ta.tempo_manual_estimado_minutos), 0),
    ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0, 2),
    ROUND(t.salario_medio_funcionario / NULLIF(t.horas_trabalhadas_mes*60, 0), 4),
    ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)
          * (t.salario_medio_funcionario / NULLIF(t.horas_trabalhadas_mes*60, 0)), 2),
    ROUND((COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0)
          / NULLIF(t.horas_trabalhadas_mes, 0), 2)
  FROM tenants t
  LEFT JOIN execucoes_automacao e ON e.tenant_id = t.id AND e.sucesso
        AND (p_inicio IS NULL OR e.executed_at >= p_inicio)
        AND (p_fim    IS NULL OR e.executed_at <= p_fim)
  LEFT JOIN tipos_automacao ta ON ta.id = e.tipo_automacao_id
  WHERE t.id = p_tenant_id
  GROUP BY t.id, t.salario_medio_funcionario, t.horas_trabalhadas_mes;
$$;

-- Backfill do histórico: cada paciente já cadastrado vira 1 execução (idempotente).
INSERT INTO execucoes_automacao (tenant_id, empresa_id, clinic_account_id, tipo_automacao_id, upload_id, patient_record_id, sucesso, executed_at)
  SELECT ca.tenant_id, ca.empresa_id, ca.id,
         (SELECT id FROM tipos_automacao WHERE chave='cadastro_cmd'),
         pr.upload_id, pr.id, true, COALESCE(pr.registered_at, pr.created_at)
  FROM patient_records pr
  JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
  WHERE pr.status IN ('registered','verified_ok','verified_divergent','done_manually')
    AND NOT EXISTS (SELECT 1 FROM execucoes_automacao ea WHERE ea.patient_record_id = pr.id);
