-- Configurações globais (key-value JSON). Guarda a TABELA DE PREÇOS:
-- implantação + valor escalonado por terminal (1º, 2º, 3º…, adicional).
create table if not exists configuracoes (
  chave       text primary key,
  valor       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Preços padrão (template com desconto progressivo) — edite pelo super admin.
insert into configuracoes (chave, valor)
values ('precos', '{"implantacao":20000,"terminais":[2000,1800,1600],"adicional":1500}'::jsonb)
on conflict (chave) do nothing;
