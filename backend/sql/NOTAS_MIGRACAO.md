# Notas de Migração — Banco Antigo → Novo (Supabase)

Levantamento feito por inspeção read-only do banco de produção atual
(projeto Supabase antigo, ref `cbusvgkwpunyjcigiesc`) via API REST (anon key).
RLS está **desligado** nas tabelas (criadas pelo Django).

## Volume real (baixo — migração trivial)

| Tabela antiga (Django)      | Linhas | Tabela nova            |
|-----------------------------|-------:|------------------------|
| accounts_user               |      8 | → `auth.users` (⚠️ ver nota) |
| accounts_tenant             |      4 | tenants                |
| accounts_clinicaccount      |      3 | clinic_accounts        |
| accounts_apiusagerecord     |      0 | api_usage_records      |
| accounts_apitoken           |      0 | api_tokens             |
| accounts_auditlog           |     13 | audit_logs             |
| intake_upload               |     15 | uploads                |
| intake_patientrecord        |  1 368 | patient_records        |
| intake_logentry             |  2 398 | log_entries            |
| intake_campoaprendido       |      4 | campos_aprendidos      |

## Validação de tipos (confirmado com dados reais)

- `dias_execucao` → array de int `[0,1,2,3,4,5,6]` → **jsonb** ✓
- `mapeamento_campos`, `extraction_method`, `automation_overrides` → objetos JSON → **jsonb** ✓
- `campos_incertos`, `divergencias` → arrays JSON → **jsonb** ✓
- `cmd_password_encrypted` (~100 chars) / `mfa_secret_encrypted` (~140 chars) → ciphertext Fernet → **text** ✓
- `public_token` → UUID ✓  | `short_code` → 6 chars ✓
- `data_nascimento` → date ✓  | horários/pausas → time (podem ser null) ✓
- status patient_record reais: registered, verified_ok, pending_registration, verified_divergent ✓

## ⚠️ Pontos de atenção para a migração de DADOS (etapa futura)

1. **Usuários (`accounts_user`, 8 linhas):** são contas Django com senha em hash
   PBKDF2. **Não dá para importar o hash direto no Supabase Auth.** Opções:
   - Recriar os 8 usuários via Admin API do Supabase (`auth.admin.createUser`)
     e disparar reset de senha, OU
   - Recriar com senha temporária. Mapear `accounts_user.id` (int) → novo
     `auth.users.id` (uuid) para religar `owner_user_id`, `uploaded_by`, `usuario_id`.

2. **`celery_task_id` → `job_id`:** campo transitório (id de task Celery, ex.:
   `377b87fe-...`). Não precisa migrar — vira id de job do BullMQ no novo sistema.

3. **IDs:** o banco antigo usa PK int sequencial. Na migração, ou preservamos os
   ids (ajustando a sequence) ou remapeamos. Como o volume é baixo, qualquer
   abordagem serve.

4. **Ordem de inserção (respeitar FKs):** users → tenants → clinic_accounts →
   uploads → patient_records / log_entries; api_*/audit/campos_aprendidos depois.
