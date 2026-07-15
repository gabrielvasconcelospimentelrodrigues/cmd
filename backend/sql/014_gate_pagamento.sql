-- GATE DE PAGAMENTO: a automação só roda para quem pagou.
--
-- Contexto: o período de teste (acesso liberado sem pagamento) terminou em
-- 2026-07-15. A partir daqui, quem libera a automação é o pagamento:
-- implantação paga E mensalidade paga. O login continua liberado — o bloqueio
-- é só na automação.
--
-- isento_pagamento: contas INTERNAS (demonstração/teste) que rodam automação
-- sem pagar. É explícito de propósito: sem isso, a regra de pagamento também
-- bloquearia nossas próprias contas de demo.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS isento_pagamento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.isento_pagamento IS
  'true = roda automação sem pagar (contas internas de demo/teste). Não usar para cliente.';

-- 'faturas.status' aceita: aberto | pago | cancelado (texto livre, sem CHECK).
-- 'cancelado' = fatura anulada (ex.: mês que foi cortesia/teste) — não é dívida
-- e não conta como pagamento.
