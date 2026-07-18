-- AUTOATENDIMENTO DE TERMINAL: o cliente contrata, paga e o terminal libera
-- sozinho — sem depender de aprovação manual.
--
-- Liga a fatura ao pedido de terminal. É por este campo que o webhook do Asaas
-- sabe QUAL terminal liberar quando o pagamento entra: sem ele, saberíamos que
-- a fatura foi paga mas não o que ela dava direito.
ALTER TABLE faturas ADD COLUMN IF NOT EXISTS terminal_request_id integer;

COMMENT ON COLUMN faturas.terminal_request_id IS
  'Pedido de terminal que esta fatura paga; ao confirmar o pagamento, o terminal é liberado.';

CREATE INDEX IF NOT EXISTS idx_faturas_terminal_request ON faturas (terminal_request_id)
  WHERE terminal_request_id IS NOT NULL;
