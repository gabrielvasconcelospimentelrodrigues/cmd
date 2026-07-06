-- =============================================================================
-- 011 — EQUIPE (membros de empresa com login próprio e CMD próprio)
-- Cada membro é um usuário auth vinculado a um tenant + empresa. Cada membro
-- opera a PRÓPRIA conta CMD (terminal). O dono (owner_user_id) enxerga tudo;
-- o membro enxerga só o próprio terminal.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_members (
  id          bigserial PRIMARY KEY,
  tenant_id   bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empresa_id  bigint REFERENCES empresas(id) ON DELETE SET NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome        text,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'member', -- 'member'
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_empresa ON tenant_members(empresa_id);

-- Conta CMD (terminal) pode pertencer a um MEMBRO específico. NULL = do dono.
ALTER TABLE clinic_accounts
  ADD COLUMN IF NOT EXISTS member_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_clinic_accounts_member ON clinic_accounts(member_user_id);

COMMIT;
