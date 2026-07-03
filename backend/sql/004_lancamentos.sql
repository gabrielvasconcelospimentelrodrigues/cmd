-- Lançamentos financeiros da OPERAÇÃO (nossos custos e receitas avulsas),
-- para apurar o LUCRO real = receita recebida (faturas) - custos de operação.
create table if not exists lancamentos (
  id           bigserial primary key,
  tipo         text not null default 'custo',   -- 'custo' | 'receita'
  categoria    text not null default 'outro',   -- infra | terminal_nuvem | banco | imposto | salario | marketing | outro
  descricao    text not null,
  valor        numeric(12,2) not null,
  competencia  text not null,                    -- 'YYYY-MM' (mês de referência)
  recorrente   boolean not null default false,  -- true = custo fixo mensal (conta em todo mês a partir da competência)
  created_at   timestamptz not null default now()
);

create index if not exists idx_lancamentos_competencia on lancamentos (competencia);
create index if not exists idx_lancamentos_recorrente on lancamentos (recorrente);
