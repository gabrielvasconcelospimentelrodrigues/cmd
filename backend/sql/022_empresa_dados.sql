-- DADOS CADASTRAIS DA EMPRESA (faturamento). Os terminais são ligados ao CNPJ
-- da empresa e o Asaas precisa do documento para emitir cobrança. cnpj já
-- existe; faltam contato e o cliente Asaas próprio da empresa.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS responsavel text;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS telefone text;
-- Cliente correspondente no Asaas, POR EMPRESA (cada CNPJ é um cliente lá).
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS asaas_customer_id text;

COMMENT ON COLUMN empresas.asaas_customer_id IS 'Cliente no Asaas desta empresa (usa o CNPJ da empresa nas cobranças).';
