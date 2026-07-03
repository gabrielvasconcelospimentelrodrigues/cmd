-- Enriquece audit_logs para virar o log de auditoria em LINGUAGEM NATURAL,
-- filtrável por usuário / categoria / nível / data.
-- Eventos globais (financeiro, usuários, sistema) não têm tenant — tornar opcional.
alter table audit_logs alter column tenant_id drop not null;
alter table audit_logs alter column usuario_id drop not null;
alter table audit_logs add column if not exists categoria    varchar(40) not null default 'sistema';
alter table audit_logs add column if not exists nivel        varchar(12) not null default 'info';  -- info | sucesso | alerta | erro
alter table audit_logs add column if not exists actor_nome   text;
alter table audit_logs add column if not exists actor_email  text;
alter table audit_logs add column if not exists actor_role   varchar(20);
alter table audit_logs add column if not exists meta         jsonb;

create index if not exists idx_audit_criado_em on audit_logs (criado_em desc);
create index if not exists idx_audit_usuario   on audit_logs (usuario_id);
create index if not exists idx_audit_categoria on audit_logs (categoria);
create index if not exists idx_audit_tenant    on audit_logs (tenant_id);

-- Índice para busca textual simples na descrição.
create index if not exists idx_audit_descricao on audit_logs using gin (to_tsvector('portuguese', coalesce(descricao,'')));

-- log_entries técnicos: acelera filtro por data/nível.
create index if not exists idx_log_entries_ts    on log_entries (timestamp desc);
create index if not exists idx_log_entries_level on log_entries (level);
