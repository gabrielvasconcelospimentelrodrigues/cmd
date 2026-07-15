export interface Tenant {
  id: number;
  name: string;
  status: string;
  onboarding_concluido: boolean;
  custo_mensal_funcionario: string | number;
  max_terminais: number;
  created_at?: string;
  // Custos reais do funcionário (módulo de Economia):
  salario_bruto_medio: string | number;
  porcentagem_encargos: string | number;
  beneficios_mensais_total: string | number;
  custo_infra_estacao_trabalho: string | number;
  horas_uteis_mes: number;
  funcionarios_operacao: number;
  cadastros_dia_funcionario: number;
}

export interface TerminalRequest {
  id: number;
  tenant_id: number;
  empresa_id: number | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_at: string | null;
  tenants?: { name: string };
  empresas?: { nome: string };
}

export interface Me {
  user: { id: string; email: string };
  tenant: Tenant;
  // Preenchido quando o usuário logado é MEMBRO de equipe (não o titular).
  member: TenantMember | null;
  // Login é livre; a AUTOMAÇÃO depende do pagamento. Null = não avaliado.
  acesso_automacao?: AcessoAutomacao | null;
}

/** Por que a automação está bloqueada (o painel usa para abrir o aviso). */
export interface AcessoAutomacao {
  liberado: boolean;
  motivo: 'implantacao_pendente' | 'mensalidade_pendente' | 'inadimplente' | null;
  mensagem: string;
  valor_implantacao: number;
  valor_vencido: number;
}

export interface TenantMember {
  id: number;
  tenant_id: number;
  empresa_id: number | null;
  user_id: string;
  nome: string | null;
  email: string;
  role: string;
  created_at: string;
  cmd_conectado?: boolean; // se o membro já conectou a própria conta CMD
}

export interface ClinicAccount {
  id: number;
  label: string;
  cmd_username: string;
  member_user_id: string | null;
  is_enabled: boolean;
  busy_slots?: number[];
  empresa_id: number | null;
  cid_padrao: string;
  // Controles clínicos (perguntas do onboarding) — Terminologia é sempre CID-10.
  cid_oci_0_8: string;
  cid_9_mais: string;
  dias_execucao: number[];
  horario_inicio_execucao: string | null;
  horario_fim_execucao: string | null;
  pausa_inicio: string | null;
  pausa_fim: string | null;
  delay_inicio_minutos: number;
  last_run_at: string | null;
  last_run_status: string;
  created_at: string;
}

export interface Upload {
  id: number;
  original_filename: string;
  status: string;
  clinic_account_id: number | null;
  uploaded_by: string | null;
  empresa_id: number | null;
  name: string;
  terminal_slot: number | null;
  patients_found: number;
  patients_registered: number;
  patients_errored: number;
  current_step: string;
  uploaded_at: string;
  short_code: string;
  public_token: string;
  registro_iniciado_em: string | null;
  registro_concluido_em: string | null;
  tempo_ativo_segundos: number;
  sessao_iniciada_em: string | null;
}

export interface PatientRecord {
  id: number;
  nome: string;
  cns: string;
  data_nascimento: string | null;
  data_atendimento: string | null;
  cid10_codigo: string;
  medico_nome: string;
  status: string;
  campos_incertos: string[];
  error_message: string;
}

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

export interface EconomiaResp {
  custo_total_mensal: number;
  volume_execucoes: number;
  minutos_economizados: number;
  horas_economizadas: number;
  custo_minuto: number;
  valor_economizado: number;
  funcionarios_equivalentes: number;
}

export interface EmpresaPlano {
  id: number;
  nome: string;
  cnpj: string;
  taxa_empresa: number;
  taxa_paga: boolean;
  terminais: number; // contratados (faturados)
  configurados?: number; // contas CMD conectadas
  mensal: number;
  cancelar_terminais?: number; // terminais agendados para descontratar
  cancelar_em?: string | null; // data em que saem da conta
}

export interface Plano {
  tenant_id: number;
  tenant_nome: string;
  valor_terminal: number;
  valor_implantacao: number;
  implantacao_paga: boolean;
  empresas: EmpresaPlano[];
  total_terminais: number;
  nao_alocados: number;
  mensal: number;
  taxas_empresa: number;
  total_unico: number;
  proximo_terminal?: number;
  precos?: {
    implantacao: number;
    terminais: number[];
    adicional: number;
  };
}

export interface Fatura {
  id: number;
  tenant_id: number;
  empresa_id: number | null;
  tipo: string;
  descricao: string | null;
  referencia: string;
  valor: number;
  vencimento: string;
  status: 'aberto' | 'pago';
  pago_em: string | null;
  created_at: string;
  empresas?: { nome: string } | null;
}

export interface Ficha {
  id: number;
  upload_id: number;
  clinic_account_id: number | null;
  // Nested do /patients (uploads!inner) — usado no filtro por membro/empresa.
  uploads?: { empresa_id: number | null; uploaded_by: string | null; clinic_account_id?: number | null } | null;
  nome: string;
  cns: string;
  data_atendimento: string | null;
  cid10_codigo: string;
  medico_nome: string;
  /** 'oci' (padrão) ou 'catarata' (Cirurgia/FACO). */
  modalidade?: 'oci' | 'catarata' | null;
  status: string;
  error_message: string;
  created_at: string;
}
