-- PAGAMENTO MANUAL: cliente pagou por fora (PIX direto, dinheiro) e o super
-- admin lança no plano dele. Não passa pelo Asaas.
--
-- Marca a fatura como manual para MOSTRAR ao cliente ("Pago manualmente") no
-- Meu Plano e no faturamento — o registro tem de ficar visível para ele.
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS pago_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN faturas.pago_manual IS
  'true = lançado manualmente pelo super admin (pago por fora do Asaas).';
