-- Analítico por faixa etária (0-8 x 9+) na tela de Fichas.
--
-- Por que uma coluna nova: a data de nascimento quase nunca vem na planilha
-- (não é campo obrigatório). Quem preenche é o CADSUS, dentro do site do CMD,
-- depois da busca por CNS — a automação lê dali para escolher o procedimento e
-- o CID corretos, e depois descartava o dado. Sem gravar, não há como saber a
-- faixa etária de quem já foi cadastrado.
--
-- Guardamos a IDADE (e não só o nascimento) porque é a idade NA DATA DO
-- ATENDIMENTO que define a regra do CMD — e ela não muda com o tempo.
ALTER TABLE patient_records ADD COLUMN IF NOT EXISTS idade_no_atendimento smallint;

COMMENT ON COLUMN patient_records.idade_no_atendimento IS
  'Idade (anos completos) na data do atendimento, lida do CADSUS no cadastro. NULL = cadastros antigos, anteriores a esta coluna.';

-- Só os registros cadastrados a partir de agora terão o valor; o histórico
-- (~9.400 fichas) fica NULL e é exibido como "não informado".
CREATE INDEX IF NOT EXISTS idx_patient_records_idade ON patient_records (upload_id, idade_no_atendimento);
