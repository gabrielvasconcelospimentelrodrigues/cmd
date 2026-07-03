/**
 * Cria uma conta DEMO pronta para uso (e-mail já confirmado, ignora a
 * confirmação do Supabase) com dados de exemplo, para visualização rápida.
 * Idempotente: pode rodar várias vezes.
 *
 * Rodar:  npx tsx src/scripts/seed-demo.ts
 */
import { supabaseAdmin } from '../lib/supabase';
import { encrypt } from '../lib/crypto';

const EMAIL = 'demo@cmdsaas.app';
const SENHA = 'cmddemo123';

async function acharOuCriarUsuario(): Promise<string> {
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existente = data.users.find((u) => u.email === EMAIL);
  if (existente) return existente.id;
  const { data: novo, error } = await supabaseAdmin.auth.admin.createUser({
    email: EMAIL, password: SENHA, email_confirm: true,
  });
  if (error || !novo.user) throw error ?? new Error('falha ao criar usuário');
  return novo.user.id;
}

async function main() {
  const userId = await acharOuCriarUsuario();

  // Tenant
  let { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('owner_user_id', userId).maybeSingle();
  if (!tenant) {
    const r = await supabaseAdmin.from('tenants')
      .insert({ name: 'Clínica Demonstração', owner_user_id: userId, status: 'active' })
      .select('id').single();
    tenant = r.data;
  }
  const tenantId = tenant!.id;

  // Conta CMD (desligada — só p/ visual; registro fica pausado)
  let { data: conta } = await supabaseAdmin.from('clinic_accounts').select('id').eq('tenant_id', tenantId).maybeSingle();
  if (!conta) {
    const r = await supabaseAdmin.from('clinic_accounts').insert({
      tenant_id: tenantId, label: 'Unidade Centro (demo)', cmd_username: 'demo.gov',
      cmd_password_encrypted: encrypt('demo'), mfa_secret_encrypted: encrypt('JBSWY3DPEHPK3PXP'),
      is_enabled: false,
    }).select('id').single();
    conta = r.data;
  }
  const clinicId = conta!.id;

  // Upload de exemplo + pacientes (inseridos direto, sem passar pela fila)
  const { data: jaTem } = await supabaseAdmin.from('uploads').select('id').eq('clinic_account_id', clinicId).limit(1);
  if (!jaTem || jaTem.length === 0) {
    const code = Math.random().toString(36).slice(2, 8);
    const { data: up } = await supabaseAdmin.from('uploads').insert({
      clinic_account_id: clinicId, original_filename: 'pacientes_demo.csv',
      file_path: `${clinicId}/${code}_pacientes_demo.csv`, status: 'extracted',
      short_code: code, patients_found: 3,
    }).select('id').single();
    await supabaseAdmin.from('patient_records').insert([
      { upload_id: up!.id, clinic_account_id: clinicId, nome: 'Maria Silva', cns: '70565376420', data_atendimento: '2026-06-01', cid10_codigo: 'J11', medico_nome: 'Dr. João Souza', status: 'pending_registration', extraction_method: { cns: 'planilha' } },
      { upload_id: up!.id, clinic_account_id: clinicId, nome: 'José Santos', cns: '12345678901', data_atendimento: '2026-06-02', cid10_codigo: 'A09', medico_nome: 'Ana Lima', status: 'pending_registration', extraction_method: { cns: 'planilha' } },
      { upload_id: up!.id, clinic_account_id: clinicId, nome: 'Carla Souza', cns: '98765432100', data_atendimento: '2026-06-02', cid10_codigo: '', medico_nome: '', status: 'needs_review', campos_incertos: ['data_atendimento', 'medico_nome'] },
    ]);
  }

  console.log('\n✅ Conta demo pronta:');
  console.log(`   e-mail: ${EMAIL}`);
  console.log(`   senha:  ${SENHA}`);
  console.log(`   clínica/tenant: ${tenantId} | conta CMD: ${clinicId}\n`);
  process.exit(0);
}

void main();
