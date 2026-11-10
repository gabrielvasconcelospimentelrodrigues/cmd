-- Perfil a selecionar DENTRO do CMD-COLETA, por conta.
--
-- A conta do Instituto Mais Visão abre no perfil "Administrador - Unidades
-- Móveis", e nesse perfil a busca por profissional volta VAZIA: o robô não
-- achava o médico CIRO e mandava toda ficha para Pendências com "não
-- encontrado no portal". Trocando para "Faturista - Unidades Móveis" a tela
-- recarrega com os vínculos certos.
--
-- Fica como dado, e não como regra no código, porque é característica de uma
-- conta: outra conta amanhã pode precisar de outro perfil, sem novo deploy.
-- NULL = não mexe no perfil (comportamento de todas as outras contas).
ALTER TABLE clinic_accounts ADD COLUMN IF NOT EXISTS cmd_perfil text;

COMMENT ON COLUMN clinic_accounts.cmd_perfil IS
  'Perfil a selecionar no CMD-COLETA logo após o login (texto exato da opção). NULL = manter o perfil padrão da conta.';
