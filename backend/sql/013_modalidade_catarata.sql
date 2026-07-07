-- Modalidade do cadastro por paciente: 'oci' (padrão, pacote por idade) ou
-- 'catarata' (FACOEMULSIFICAÇÃO — sem checkbox OCI e procedimento único 0405050372).
-- NÃO altera o comportamento das OCIs já existentes (default 'oci').
ALTER TABLE patient_records
  ADD COLUMN IF NOT EXISTS modalidade text NOT NULL DEFAULT 'oci';

-- Índice leve para relatórios/filtros por modalidade (opcional).
CREATE INDEX IF NOT EXISTS idx_patient_records_modalidade ON patient_records (modalidade);
