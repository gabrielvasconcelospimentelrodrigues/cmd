-- INTEGRAÇÃO ASAAS: cobrança online (PIX/boleto/cartão) com baixa automática.
--
-- Fluxo: fatura criada -> cobrança no Asaas -> cliente paga -> webhook do Asaas
-- -> fatura vira 'pago' -> o gate de pagamento libera a automação sozinho.
-- Hoje esse "vira pago" é manual (super admin dá baixa).

-- Cliente correspondente no Asaas. Criado uma vez por assinante e reaproveitado
-- em todas as cobranças — o Asaas casa pagamento com cliente por este id.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS asaas_customer_id text;

-- Cobrança correspondente no Asaas.
-- asaas_payment_id é a CHAVE que o webhook usa para achar a fatura: o Asaas
-- avisa "o pagamento X foi recebido" e é por ele que sabemos qual fatura baixar.
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS asaas_payment_id text;
-- Página de pagamento (PIX/boleto/cartão) que o cliente abre pelo painel.
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS link_pagamento text;
-- Guarda o motivo quando a cobrança não pôde ser criada (ex.: CPF/CNPJ ausente
-- ou inválido). Sem isso a falha ficaria invisível e a fatura pareceria normal,
-- só que sem link para o cliente pagar.
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS erro_cobranca text;

-- O webhook busca por este campo a cada evento — e ele precisa ser único para
-- não haver risco de baixar a fatura errada.
CREATE UNIQUE INDEX IF NOT EXISTS idx_faturas_asaas_payment
  ON faturas (asaas_payment_id) WHERE asaas_payment_id IS NOT NULL;

COMMENT ON COLUMN faturas.asaas_payment_id IS 'Id da cobrança no Asaas; chave usada pelo webhook para dar baixa.';
COMMENT ON COLUMN faturas.erro_cobranca IS 'Motivo de a cobrança não ter sido criada (NULL = sem erro).';
