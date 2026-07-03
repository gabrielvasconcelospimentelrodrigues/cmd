-- =============================================================================
-- CMD SaaS — Schema inicial (PostgreSQL / Supabase)
-- Migrado de: cmd-coleta (Django) — apps `accounts` + `intake`
-- Otimizado para alta concorrência e baixo consumo de RAM/CPU:
--   • PKs bigint IDENTITY (8 bytes, índices compactos) — IDs públicos via UUID
--   • ENUMs nativos do Postgres (4 bytes) no lugar de varchar+choices
--   • Índices em TODAS as FKs (o Postgres NÃO indexa FKs automaticamente)
--   • Índices PARCIAIS nos status "quentes" que os workers BullMQ consultam
--   • jsonb (binário, indexável) no lugar de json textual
--
-- AUTENTICAÇÃO: usamos `auth.users` nativo do Supabase no lugar do model
-- Django `User` (AbstractUser). owner_user_id / uploaded_by / usuario_id
-- apontam para auth.users(id).
--
-- CRIPTOGRAFIA: cmd_password_encrypted e mfa_secret_encrypted continuam
-- recebendo TEXTO JÁ CIFRADO (Fernet) pela camada de aplicação (backend/
-- workers). No banco são apenas TEXT — a chave nunca toca o Postgres.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase.
-- =============================================================================

begin;

-- gen_random_uuid() — disponível no core do PG13+, mas garantimos a extensão:
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Tipos ENUM (compactos e validados no nível do banco)
-- -----------------------------------------------------------------------------
create type tenant_status as enum ('pending_approval', 'active', 'suspended');

create type upload_status as enum (
    'aguardando_mapeamento', 'extracting', 'extracted', 'extraction_failed',
    'needs_review', 'registering', 'paused', 'parado',
    'registration_failed', 'done'
);

create type upload_origem as enum ('ficha_completa', 'extrator', 'dados_importados');

create type patient_status as enum (
    'needs_review', 'pending_registration', 'registered', 'error',
    'verified_ok', 'verified_divergent', 'done_manually'
);

create type campo_direcao as enum ('abaixo', 'acima');

-- -----------------------------------------------------------------------------
-- Trigger genérico de updated_at (evita round-trip extra da aplicação)
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- =============================================================================
-- accounts.Tenant  ->  public.tenants
-- =============================================================================
create table tenants (
    id                        bigint generated always as identity primary key,
    name                      varchar(255) not null,
    -- OneToOne com o usuário dono (Supabase auth). Cascade: some o usuário,
    -- some a clínica.
    owner_user_id             uuid not null unique
                                  references auth.users(id) on delete cascade,
    status                    tenant_status not null default 'pending_approval',
    -- Modal de economia: custo de referência R$ 3.000/mês, ajustável.
    custo_mensal_funcionario  numeric(10,2) not null default 3000,
    -- NULL = sem limite de pacientes/mês.
    cota_mensal_pacientes     integer,
    onboarding_concluido      boolean not null default false,
    created_at                timestamptz not null default now(),

    constraint cota_mensal_pacientes_nao_negativa
        check (cota_mensal_pacientes is null or cota_mensal_pacientes >= 0)
);
comment on table tenants is 'Clínica cliente do SaaS (accounts.Tenant)';

-- =============================================================================
-- accounts.ClinicAccount  ->  public.clinic_accounts
-- =============================================================================
create table clinic_accounts (
    id                       bigint generated always as identity primary key,
    tenant_id                bigint not null
                                 references tenants(id) on delete cascade,
    label                    varchar(255) not null,
    cmd_username             varchar(255) not null,
    -- TEXTO JÁ CIFRADO (Fernet) — cifrado/decifrado na aplicação.
    cmd_password_encrypted   text not null,
    mfa_secret_encrypted     text not null,
    is_enabled               boolean not null default true,
    -- Janela de execução: 0=Segunda ... 6=Domingo. Fora dela, reagenda.
    dias_execucao            jsonb not null default '[0,1,2,3,4,5,6]'::jsonb,
    horario_inicio_execucao  time,
    horario_fim_execucao     time,
    -- Pausa diária recorrente (ex.: almoço) dentro da janela.
    pausa_inicio             time,
    pausa_fim                time,
    -- Espera (min) após extração antes de cadastrar; 0 = imediato.
    delay_inicio_minutos     integer not null default 0
                                 check (delay_inicio_minutos >= 0),
    last_run_at              timestamptz,
    last_run_status          varchar(30) not null default '',
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);
comment on table clinic_accounts is 'Conta/login do CMD-COLETA por clínica (accounts.ClinicAccount)';

create index idx_clinic_accounts_tenant on clinic_accounts(tenant_id);
-- Workers só agendam contas ligadas: índice parcial enxuto.
create index idx_clinic_accounts_enabled
    on clinic_accounts(tenant_id) where is_enabled;

create trigger trg_clinic_accounts_updated_at
    before update on clinic_accounts
    for each row execute function set_updated_at();

-- =============================================================================
-- accounts.ApiUsageRecord  ->  public.api_usage_records
-- =============================================================================
create table api_usage_records (
    id                   bigint generated always as identity primary key,
    tenant_id            bigint not null references tenants(id) on delete cascade,
    criado_em            timestamptz not null default now(),
    tokens_entrada       integer not null default 0 check (tokens_entrada >= 0),
    tokens_saida         integer not null default 0 check (tokens_saida >= 0),
    custo_estimado_usd   numeric(10,4) not null default 0,
    contexto             varchar(100) not null default 'extracao_ficha'
);
comment on table api_usage_records is 'Uso da API de IA por upload processado (accounts.ApiUsageRecord)';

-- Relatório de custo por clínica ordenado por data (ordering = -criado_em).
create index idx_api_usage_tenant_data
    on api_usage_records(tenant_id, criado_em desc);

-- =============================================================================
-- accounts.ApiToken  ->  public.api_tokens
-- =============================================================================
create table api_tokens (
    id            bigint generated always as identity primary key,
    tenant_id     bigint not null references tenants(id) on delete cascade,
    label         varchar(255) not null,
    -- token_urlsafe(32) ~= 43 chars; folga até 64.
    token         varchar(64) not null unique,
    criado_em     timestamptz not null default now(),
    ultimo_uso_em timestamptz,
    ativo         boolean not null default true
);
comment on table api_tokens is 'Token de API somente-leitura por clínica (accounts.ApiToken)';

create index idx_api_tokens_tenant on api_tokens(tenant_id);
-- Autenticação por token: lookup só de tokens ativos.
create index idx_api_tokens_ativo on api_tokens(token) where ativo;

-- =============================================================================
-- accounts.AuditLog  ->  public.audit_logs
-- =============================================================================
create table audit_logs (
    id         bigint generated always as identity primary key,
    tenant_id  bigint not null references tenants(id) on delete cascade,
    -- Sobrevive à exclusão do usuário (SET NULL), ao contrário do Upload.
    usuario_id uuid references auth.users(id) on delete set null,
    acao       varchar(50) not null,
    descricao  text not null,
    criado_em  timestamptz not null default now()
);
comment on table audit_logs is 'Auditoria de ações relevantes; sobrevive à exclusão do Upload (accounts.AuditLog)';

create index idx_audit_logs_tenant_data on audit_logs(tenant_id, criado_em desc);

-- =============================================================================
-- intake.Upload  ->  public.uploads
-- =============================================================================
create table uploads (
    id                    bigint generated always as identity primary key,
    clinic_account_id     bigint not null
                              references clinic_accounts(id) on delete cascade,
    origem                upload_origem not null default 'ficha_completa',
    -- Quem subiu (Supabase auth). SET NULL: histórico sobrevive ao usuário.
    uploaded_by           uuid references auth.users(id) on delete set null,
    original_filename     varchar(255) not null,
    uploaded_at           timestamptz not null default now(),
    -- Caminho temporário do arquivo; limpo após extração confirmada.
    file_path             varchar(500) not null default '',
    deleted_at            timestamptz,
    status                upload_status not null default 'extracting',
    patients_found        integer not null default 0 check (patients_found >= 0),
    patients_registered   integer not null default 0 check (patients_registered >= 0),
    patients_errored      integer not null default 0 check (patients_errored >= 0),
    -- Passo atual (só com status='registering'); modal de tempo real.
    current_step          varchar(255) not null default '',
    -- Era celery_task_id no Django; agora guarda o JOB ID do BullMQ
    -- (usado para revogar/parar o job da automação).
    job_id                varchar(255) not null default '',
    -- Mapa de campos confirmado em "Dados importados" (auditoria).
    mapeamento_campos     jsonb not null default '{}'::jsonb,
    public_token          uuid not null unique default gen_random_uuid(),
    short_code            varchar(6) not null unique
);
comment on table uploads is 'Arquivo enviado para processamento (intake.Upload)';
comment on column uploads.job_id is 'BullMQ job id (era celery_task_id no Django)';

create index idx_uploads_clinic_account on uploads(clinic_account_id);
-- Painel/workers filtram por status ativo o tempo todo; soft-delete fora.
create index idx_uploads_status
    on uploads(status) where deleted_at is null;

-- =============================================================================
-- intake.PatientRecord  ->  public.patient_records
-- =============================================================================
create table patient_records (
    id                    bigint generated always as identity primary key,
    upload_id             bigint not null
                              references uploads(id) on delete cascade,
    -- Desnormalizado do upload p/ filtrar por clínica sem join (intencional).
    clinic_account_id     bigint not null
                              references clinic_accounts(id) on delete cascade,
    nome                  varchar(255) not null default '',
    cns                   varchar(20) not null default '',
    data_nascimento       date,
    data_atendimento      date,
    cid10_codigo          varchar(10) not null default '',
    medico_nome           varchar(255) not null default '',
    -- Qual método extraiu cada campo crítico.
    extraction_method     jsonb not null default '{}'::jsonb,
    status                patient_status not null default 'pending_registration',
    -- Campos ainda incertos após extração + verificação por IA.
    campos_incertos       jsonb not null default '[]'::jsonb,
    error_message         text not null default '',
    retry_count           smallint not null default 0 check (retry_count >= 0),
    divergencias          jsonb not null default '[]'::jsonb,
    -- Overrides manuais válidos SÓ para este paciente.
    automation_overrides  jsonb not null default '{}'::jsonb,
    created_at            timestamptz not null default now(),
    registered_at         timestamptz
);
comment on table patient_records is 'Paciente extraído de um Upload (intake.PatientRecord)';

create index idx_patient_records_upload on patient_records(upload_id);
create index idx_patient_records_clinic on patient_records(clinic_account_id);
-- Worker de registro varre pendentes: índice parcial pequeno e quentíssimo.
create index idx_patient_records_pendentes
    on patient_records(clinic_account_id)
    where status = 'pending_registration';
-- registered_at tinha db_index=True (relatórios por período).
create index idx_patient_records_registered_at
    on patient_records(registered_at) where registered_at is not null;

-- =============================================================================
-- intake.LogEntry  ->  public.log_entries
-- =============================================================================
create table log_entries (
    id        bigint generated always as identity primary key,
    upload_id bigint not null references uploads(id) on delete cascade,
    "timestamp" timestamptz not null default now(),
    level     varchar(10) not null default 'INFO',
    message   text not null
);
comment on table log_entries is 'Linha de log de execução visível no painel (intake.LogEntry)';

-- ordering = ['timestamp']; lê sempre logs de UM upload em ordem.
create index idx_log_entries_upload_ts on log_entries(upload_id, "timestamp");

-- =============================================================================
-- intake.CampoAprendido  ->  public.campos_aprendidos
-- =============================================================================
create table campos_aprendidos (
    id           bigint generated always as identity primary key,
    tenant_id    bigint not null references tenants(id) on delete cascade,
    campo_key    varchar(30) not null,
    label_usado  varchar(100) not null,
    direcao      campo_direcao not null default 'abaixo',
    atualizado_em timestamptz not null default now(),

    constraint uq_campo_aprendido_tenant_campo unique (tenant_id, campo_key)
);
comment on table campos_aprendidos is 'Memória de aprendizado do Extrator por clínica/campo (intake.CampoAprendido)';
-- (unique já cria índice em (tenant_id, campo_key) — cobre os lookups.)

create trigger trg_campos_aprendidos_updated_at
    before update on campos_aprendidos
    for each row execute function set_updated_at();
-- Obs.: o trigger acima atualiza updated_at; CampoAprendido usa atualizado_em.
-- Ajuste fino se quiser auto-touch — deixei manual p/ não criar coluna a mais.

commit;

-- =============================================================================
-- OPCIONAL — Row Level Security (defesa em profundidade)
-- -----------------------------------------------------------------------------
-- A API Fastify usa a SERVICE_ROLE key, que IGNORA RLS — então habilitar RLS
-- NÃO quebra o backend e protege caso uma chave anon/authenticated vaze ou
-- toque o banco direto. Rode este bloco se quiser essa camada extra.
--
-- begin;
-- alter table tenants            enable row level security;
-- alter table clinic_accounts    enable row level security;
-- alter table api_usage_records  enable row level security;
-- alter table api_tokens         enable row level security;
-- alter table audit_logs         enable row level security;
-- alter table uploads            enable row level security;
-- alter table patient_records    enable row level security;
-- alter table log_entries        enable row level security;
-- alter table campos_aprendidos  enable row level security;
--
-- -- Dono enxerga só a própria clínica:
-- create policy tenant_owner_rw on tenants
--     using (owner_user_id = auth.uid())
--     with check (owner_user_id = auth.uid());
--
-- -- Tabelas com tenant_id direto:
-- create policy ca_owner on clinic_accounts using (
--     tenant_id in (select id from tenants where owner_user_id = auth.uid()));
-- create policy au_owner on api_usage_records using (
--     tenant_id in (select id from tenants where owner_user_id = auth.uid()));
-- create policy at_owner on api_tokens using (
--     tenant_id in (select id from tenants where owner_user_id = auth.uid()));
-- create policy al_owner on audit_logs using (
--     tenant_id in (select id from tenants where owner_user_id = auth.uid()));
-- create policy cap_owner on campos_aprendidos using (
--     tenant_id in (select id from tenants where owner_user_id = auth.uid()));
--
-- -- Tabelas que chegam ao tenant via clinic_account:
-- create policy up_owner on uploads using (
--     clinic_account_id in (
--         select ca.id from clinic_accounts ca
--         join tenants t on t.id = ca.tenant_id
--         where t.owner_user_id = auth.uid()));
-- create policy pr_owner on patient_records using (
--     clinic_account_id in (
--         select ca.id from clinic_accounts ca
--         join tenants t on t.id = ca.tenant_id
--         where t.owner_user_id = auth.uid()));
-- create policy le_owner on log_entries using (
--     upload_id in (
--         select u.id from uploads u
--         join clinic_accounts ca on ca.id = u.clinic_account_id
--         join tenants t on t.id = ca.tenant_id
--         where t.owner_user_id = auth.uid()));
-- commit;
-- =============================================================================
