-- FORÇAR CADASTRO: o operador decide, na tela de Pendências, cadastrar mesmo o
-- que o sistema marcou como duplicado (ex.: os dois olhos da catarata que
-- caíram na mesma data, ou um caso legítimo que a regra não previu).
--
-- Marca o registro para PULAR toda a dedup (lote + por paciente + busca no CMD).
-- É por ficha, e decisão consciente do operador — por isso não é o padrão.
ALTER TABLE patient_records ADD COLUMN IF NOT EXISTS forcar_cadastro boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN patient_records.forcar_cadastro IS
  'true = operador mandou cadastrar ignorando a checagem de duplicidade.';
