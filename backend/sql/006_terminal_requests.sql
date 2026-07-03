-- =============================================================================
-- 006 — SOLICITAÇÃO DE TERMINAIS E LIMITES
-- Rodar este script no SQL Editor do Supabase.
-- =============================================================================

BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_terminais integer DEFAULT 1;

CREATE TABLE IF NOT EXISTS terminal_requests (
  id serial primary key,
  tenant_id integer not null references tenants(id) on delete cascade,
  status varchar(50) not null default 'pending', -- 'pending', 'approved', 'rejected'
  created_at timestamp not null default now(),
  resolved_at timestamp
);

COMMIT;
