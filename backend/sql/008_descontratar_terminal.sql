-- Descontratar terminal (cancelamento AGENDADO): o assinante cancela um
-- terminal mas segue pagando até o fim do período (cancelar_em); depois dessa
-- data o terminal sai da conta e não gera mais cobrança.
alter table empresas add column if not exists cancelar_terminais integer not null default 0;
alter table empresas add column if not exists cancelar_em date;
