-- RECORRÊNCIA: assinatura no Asaas cobra a mensalidade automaticamente todo mês.
--
-- Sem isto, cada mensalidade dependia de alguém lembrar de gerar e do cliente
-- lembrar de pagar — inadimplência por esquecimento, não por falta de dinheiro.
-- Com a assinatura no cartão, o Asaas cobra sozinho e o webhook dá baixa.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS asaas_subscription_id text;

-- Na fatura, diz de qual assinatura aquela cobrança veio. Cobranças geradas
-- pelo Asaas não existem no nosso banco até o evento chegar — é por este campo
-- que a fatura criada pelo webhook se liga ao ciclo correto.
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS asaas_subscription_id text;

COMMENT ON COLUMN tenants.asaas_subscription_id IS 'Assinatura recorrente no Asaas: cobra a mensalidade sozinho todo mes.';
