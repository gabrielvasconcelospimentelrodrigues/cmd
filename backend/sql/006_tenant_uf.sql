-- UF (estado) do assinante — usado no mapa do Brasil da Visão geral.
alter table tenants add column if not exists uf varchar(2);
create index if not exists idx_tenants_uf on tenants (uf);
