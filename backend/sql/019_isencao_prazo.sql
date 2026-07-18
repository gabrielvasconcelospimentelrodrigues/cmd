-- PRAZO DA ISENÇÃO: período de teste tem fim; parceiro não.
--
-- Sem a data, toda isenção era eterna: um "teste de 15 dias" ficaria de graça
-- para sempre, porque nada faria a cobrança voltar.
-- NULL = indeterminado (parceiro). Data = último dia da cortesia.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS isento_ate date;

COMMENT ON COLUMN tenants.isento_ate IS
  'Fim da isencao (periodo de teste). NULL = indeterminado, ex.: parceiro.';
