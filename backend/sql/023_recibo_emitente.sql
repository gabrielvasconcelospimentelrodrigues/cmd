-- RECIBO DE PAGAMENTO: dados de quem EMITE o recibo (a operação que recebeu o
-- dinheiro). Ficam em configuracoes, mesmo padrão de 'precos' e 'motor', para
-- o super admin editar pela tela sem depender de deploy.
--
-- Por que não hardcode: o recibo é documento entregue ao cliente — razão
-- social, CNPJ e assinante mudam (mudança de endereço, troca de responsável) e
-- não podem exigir alteração de código.
INSERT INTO configuracoes (chave, valor, updated_at)
VALUES (
  'emitente',
  jsonb_build_object(
    'razao_social', '',
    'documento',    '',
    'endereco',     '',
    'cidade_uf',    '',
    'telefone',     '',
    'email',        '',
    'assinante',    '',
    'assinante_cargo', ''
  ),
  now()
)
ON CONFLICT (chave) DO NOTHING;

COMMENT ON TABLE configuracoes IS
  'Configurações globais em jsonb por chave: precos, motor, emitente (dados do recibo).';
