-- CIDADE DA LISTA (relatórios). Até aqui a cidade só existia dentro do NOME do
-- envio ("Cirúrgico Recife", "PENDENCIAS JUAZEIRO"), o que impede qualquer
-- recorte confiável: nome é texto livre e várias listas não citam cidade.
--
-- Fica no UPLOAD, não no paciente: uma lista é sempre de um mutirão/município,
-- e pedir a cidade por ficha seria digitação repetida de milhares de linhas.
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS cidade text;

COMMENT ON COLUMN uploads.cidade IS
  'Município da lista, informado na importação. Alimenta o filtro por cidade nos relatórios.';

-- Busca por cidade num único tenant é seletiva o bastante com índice simples.
CREATE INDEX IF NOT EXISTS idx_uploads_cidade ON uploads (cidade) WHERE cidade IS NOT NULL;
