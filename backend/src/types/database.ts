/**
 * Tipos do banco — espelham `backend/sql/001_init.sql`.
 * Mantidos à mão por enquanto (9 tabelas). Quando crescer, dá para gerar
 * automaticamente com `supabase gen types typescript`.
 *
 * Convenção: Row = como vem do banco; Insert = o que você manda ao criar
 * (campos com default/gerados viram opcionais).
 */

// ---- ENUMs -----------------------------------------------------------------
export type TenantStatus = 'pending_approval' | 'active' | 'suspended';

export type UploadStatus =
  | 'aguardando_mapeamento'
  | 'extracting'
  | 'extracted'
  | 'extraction_failed'
  | 'needs_review'
  | 'registering'
  | 'paused'
  | 'parado'
  | 'registration_failed'
  | 'done';

export type UploadOrigem = 'ficha_completa' | 'extrator' | 'dados_importados';

export type PatientStatus =
  | 'needs_review'
  | 'pending_registration'
  | 'registered'
  | 'error'
  | 'verified_ok'
  | 'verified_divergent'
  | 'done_manually';

export type CampoDirecao = 'abaixo' | 'acima';

// ---- Rows ------------------------------------------------------------------
export interface Tenant {
  id: number;
  name: string;
  owner_user_id: string; // uuid -> auth.users
  status: TenantStatus;
  custo_mensal_funcionario: string; // numeric vem como string no driver
  // Config do módulo de Economia (custo REAL do funcionário):
  salario_medio_funcionario: string; // legado
  horas_trabalhadas_mes: number; // legado
  salario_bruto_medio: string; // numeric → string
  porcentagem_encargos: string; // % sobre o salário (ex.: '80' = 80%)
  beneficios_mensais_total: string;
  custo_infra_estacao_trabalho: string;
  horas_uteis_mes: number; // padrão 176
  funcionarios_operacao: number; // quantos funcionários faziam a operação manual
  cadastros_dia_funcionario: number; // quantos cadastros/dia cada funcionário fazia (real)
  cota_mensal_pacientes: number | null;
  // Plano de assinatura (gerido pelo super admin):
  valor_terminal: string; // mensalidade por terminal/funcionário (numeric → string)
  valor_implantacao: string; // implantação única do assinante (numeric → string)
  implantacao_paga: boolean;
  /** true = roda automação sem pagar (parceiro / conta de teste). */
  isento_pagamento: boolean;
  /** Fim da isenção. null = indeterminado (parceiro); data = período de teste. */
  isento_ate: string | null;
  onboarding_concluido: boolean;
  cnpj: string | null;
  responsavel: string | null;
  telefone: string | null;
  cidade: string | null;
  created_at: string;
}

/** Empresa (companhia) sob o assinante. Um tenant tem 1+ empresas; cada
 * empresa tem 1+ terminais (clinic_accounts) e uma taxa própria. */
export interface Empresa {
  id: number;
  tenant_id: number;
  nome: string;
  cnpj: string;
  taxa_empresa: string; // taxa única de cadastro da empresa (numeric → string)
  taxa_paga: boolean;
  terminais_contratados: number; // terminais faturados (cada um = +valor_terminal/mês)
  created_at: string;
}

export interface ClinicAccount {
  id: number;
  tenant_id: number;
  empresa_id: number | null; // empresa dona deste terminal
  label: string;
  cmd_username: string;
  cmd_password_encrypted: string; // ciphertext Fernet
  mfa_secret_encrypted: string; // ciphertext Fernet
  cid_padrao: string; // CID-10 padrão (fallback quando a ficha não tem CID)
  // Controles clínicos (perguntas do onboarding) — Terminologia é sempre CID-10.
  cid_oci_0_8: string; // categoria do CID p/ pacientes de OCI 0–8 anos
  cid_9_mais: string; // categoria do CID p/ pacientes acima de 9 anos
  member_user_id: string | null; // membro de equipe dono deste terminal (null = do dono)
  is_enabled: boolean;
  dias_execucao: number[]; // jsonb [0..6]
  horario_inicio_execucao: string | null; // 'HH:MM:SS'
  horario_fim_execucao: string | null;
  pausa_inicio: string | null;
  pausa_fim: string | null;
  delay_inicio_minutos: number;
  last_run_at: string | null;
  last_run_status: string;
  created_at: string;
  updated_at: string;
}

export interface TenantMember {
  id: number;
  tenant_id: number;
  empresa_id: number | null;
  user_id: string; // auth.users.id
  nome: string | null;
  email: string;
  role: string; // 'member'
  created_at: string;
}

export interface ApiUsageRecord {
  id: number;
  tenant_id: number;
  criado_em: string;
  tokens_entrada: number;
  tokens_saida: number;
  custo_estimado_usd: string; // numeric
  contexto: string;
}

export interface ApiToken {
  id: number;
  tenant_id: number;
  label: string;
  token: string;
  criado_em: string;
  ultimo_uso_em: string | null;
  ativo: boolean;
}

export interface AuditLog {
  id: number;
  tenant_id: number;
  usuario_id: string | null; // uuid -> auth.users
  acao: string;
  descricao: string;
  criado_em: string;
}

export interface Upload {
  id: number;
  clinic_account_id: number | null;
  empresa_id: number | null;
  name: string;
  origem: UploadOrigem;
  uploaded_by: string | null; // uuid -> auth.users
  original_filename: string;
  uploaded_at: string;
  file_path: string;
  deleted_at: string | null;
  status: UploadStatus;
  patients_found: number;
  patients_registered: number;
  patients_errored: number;
  current_step: string;
  job_id: string; // era celery_task_id (agora id de job BullMQ)
  mapeamento_campos: Record<string, string>;
  public_token: string; // uuid
  short_code: string;
  registro_iniciado_em: string | null;
  registro_concluido_em: string | null;
}

export interface PatientRecord {
  id: number;
  upload_id: number;
  clinic_account_id: number | null;
  nome: string;
  cns: string;
  data_nascimento: string | null;
  data_atendimento: string | null;
  cid10_codigo: string;
  medico_nome: string;
  extraction_method: Record<string, string>;
  status: PatientStatus;
  campos_incertos: string[];
  error_message: string;
  retry_count: number;
  divergencias: unknown[];
  automation_overrides: Record<string, string>;
  created_at: string;
  registered_at: string | null;
}

export interface LogEntry {
  id: number;
  upload_id: number;
  timestamp: string;
  level: string;
  message: string;
}

export interface CampoAprendido {
  id: number;
  tenant_id: number;
  campo_key: string;
  label_usado: string;
  direcao: CampoDirecao;
  atualizado_em: string;
}

// ---- Helper Insert (campos gerados/com default viram opcionais) ------------
type Generated = 'id' | 'created_at' | 'updated_at' | 'criado_em' | 'uploaded_at' | 'atualizado_em';
// Campos gerados + os listados em Extra viram opcionais: precisam ser OMITIDOS
// da parte obrigatória (Omit) e só aparecer no Partial — senão a interseção
// (obrigatório & parcial) os mantém obrigatórios.
// Simplify achata a interseção num único tipo-objeto — o supabase-js rejeita
// interseções (Omit & Partial) como tipo de insert (resolve para `never`).
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type Insert<T, Extra extends keyof T = never> = Simplify<
  Omit<T, (Generated & keyof T) | Extra> & Partial<Pick<T, (Generated & keyof T) | Extra>>
>;

// ---- Shape para o supabase-js (createClient<Database>) ----------------------
// O supabase-js exige a forma canônica de schema (Tables com Relationships +
// Views/Functions/Enums/CompositeTypes). Sem isso, o client resolve a tabela
// como `never` e quebra insert/select tipados.
// Simplify<R> no Row: interfaces não têm index signature implícita e não
// satisfazem o `Record<string, unknown>` exigido pelo supabase-js (resolve
// para `never`); o mapped type do Simplify resolve isso.
type Tbl<R, I, U> = { Row: Simplify<R>; Insert: I; Update: Simplify<U>; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      tenants: Tbl<Tenant, Insert<Tenant, 'status' | 'custo_mensal_funcionario' | 'salario_medio_funcionario' | 'horas_trabalhadas_mes' | 'salario_bruto_medio' | 'porcentagem_encargos' | 'beneficios_mensais_total' | 'custo_infra_estacao_trabalho' | 'horas_uteis_mes' | 'funcionarios_operacao' | 'cadastros_dia_funcionario' | 'cota_mensal_pacientes' | 'valor_terminal' | 'valor_implantacao' | 'implantacao_paga' | 'isento_pagamento' | 'isento_ate' | 'onboarding_concluido' | 'cnpj' | 'responsavel' | 'telefone' | 'cidade'>, Partial<Tenant>>;
      empresas: Tbl<Empresa, Insert<Empresa, 'cnpj' | 'taxa_empresa' | 'taxa_paga' | 'terminais_contratados'>, Partial<Empresa>>;
      clinic_accounts: Tbl<ClinicAccount, Insert<ClinicAccount, 'empresa_id' | 'cid_padrao' | 'cid_oci_0_8' | 'cid_9_mais' | 'member_user_id' | 'is_enabled' | 'dias_execucao' | 'horario_inicio_execucao' | 'horario_fim_execucao' | 'pausa_inicio' | 'pausa_fim' | 'delay_inicio_minutos' | 'last_run_at' | 'last_run_status'>, Partial<ClinicAccount>>;
      tenant_members: Tbl<TenantMember, Insert<TenantMember, 'empresa_id' | 'nome' | 'role'>, Partial<TenantMember>>;
      api_usage_records: Tbl<ApiUsageRecord, Insert<ApiUsageRecord, 'tokens_entrada' | 'tokens_saida' | 'custo_estimado_usd' | 'contexto'>, Partial<ApiUsageRecord>>;
      api_tokens: Tbl<ApiToken, Insert<ApiToken, 'token' | 'ultimo_uso_em' | 'ativo'>, Partial<ApiToken>>;
      audit_logs: Tbl<AuditLog, Insert<AuditLog, 'usuario_id'>, Partial<AuditLog>>;
      uploads: Tbl<Upload, Insert<Upload, 'clinic_account_id' | 'empresa_id' | 'name' | 'origem' | 'uploaded_by' | 'file_path' | 'deleted_at' | 'status' | 'patients_found' | 'patients_registered' | 'patients_errored' | 'current_step' | 'job_id' | 'mapeamento_campos' | 'public_token' | 'short_code' | 'registro_iniciado_em' | 'registro_concluido_em'>, Partial<Upload>>;
      patient_records: Tbl<PatientRecord, Insert<PatientRecord, 'clinic_account_id' | 'nome' | 'cns' | 'data_nascimento' | 'data_atendimento' | 'cid10_codigo' | 'medico_nome' | 'extraction_method' | 'status' | 'campos_incertos' | 'error_message' | 'retry_count' | 'divergencias' | 'automation_overrides' | 'registered_at'>, Partial<PatientRecord>>;
      log_entries: Tbl<LogEntry, Insert<LogEntry, 'level'>, Partial<LogEntry>>;
      campos_aprendidos: Tbl<CampoAprendido, Insert<CampoAprendido, 'direcao'>, Partial<CampoAprendido>>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      tenant_status: TenantStatus;
      upload_status: UploadStatus;
      upload_origem: UploadOrigem;
      patient_status: PatientStatus;
      campo_direcao: CampoDirecao;
    };
    CompositeTypes: Record<string, never>;
  };
}
