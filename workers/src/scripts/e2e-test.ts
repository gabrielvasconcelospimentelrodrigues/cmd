/**
 * Teste end-to-end da ORQUESTRAÇÃO (não da automação real, ainda stub):
 * cria dados de teste -> enfileira extração -> acompanha o pipeline
 * extração→registro→verificação gravando no banco -> limpa tudo.
 *
 * Pré-requisito: os workers precisam estar RODANDO (npm run dev) num processo
 * à parte, consumindo a mesma fila.
 *
 * Rodar:  npx tsx src/scripts/e2e-test.ts
 */
import { supabaseAdmin } from '../lib/supabase';
import { extractionQueue, closeQueues } from '../queues';
import { encrypt } from '../lib/crypto';
import { connection } from '../lib/redis';

const rnd = Math.random().toString(36).slice(2, 8);
const shortCode = Math.random().toString(36).slice(2, 8); // 6 chars
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n=== E2E orquestração ===\n');
  let userId = '';
  let tenantId = 0;
  let clinicId = 0;
  let uploadId = 0;

  try {
    // 1. Usuário (auth.users) — dono da clínica
    const { data: u, error: ue } = await supabaseAdmin.auth.admin.createUser({
      email: `e2e+${rnd}@cmd.local`,
      password: `Teste-${rnd}-123`,
      email_confirm: true,
    });
    if (ue) throw ue;
    userId = u.user.id;
    console.log('1. auth user criado:', userId);

    // 2. Tenant
    const { data: t, error: te } = await supabaseAdmin
      .from('tenants')
      .insert({ name: `Clínica E2E ${rnd}`, owner_user_id: userId, status: 'active' })
      .select('id')
      .single();
    if (te) throw te;
    tenantId = t.id;
    console.log('2. tenant criado:', tenantId);

    // 3. Conta CMD (com credenciais cifradas)
    const { data: c, error: ce } = await supabaseAdmin
      .from('clinic_accounts')
      .insert({
        tenant_id: tenantId,
        label: 'Conta E2E',
        cmd_username: 'usuario_teste',
        cmd_password_encrypted: encrypt('senha_teste'),
        mfa_secret_encrypted: encrypt('JBSWY3DPEHPK3PXP'),
        is_enabled: true,
      })
      .select('id')
      .single();
    if (ce) throw ce;
    clinicId = c.id;
    console.log('3. clinic_account criado:', clinicId);

    // 4. Upload
    const { data: up, error: upe } = await supabaseAdmin
      .from('uploads')
      .insert({
        clinic_account_id: clinicId,
        original_filename: 'e2e.pdf',
        status: 'extracting',
        short_code: shortCode,
      })
      .select('id')
      .single();
    if (upe) throw upe;
    uploadId = up.id;
    console.log('4. upload criado:', uploadId);

    // 5. Enfileira a extração
    const job = await extractionQueue.add('extrair', { uploadId });
    console.log('5. job de extração enfileirado:', job.id);

    // 6. Acompanha o status até 'done' (ou timeout)
    console.log('\n6. acompanhando pipeline...');
    let status = '';
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      const { data } = await supabaseAdmin.from('uploads').select('status').eq('id', uploadId).single();
      if (data && data.status !== status) {
        status = data.status;
        console.log(`   [${i + 1}s] status -> ${status}`);
      }
      if (status === 'done') break;
    }

    // 7. Logs gravados
    const { data: logs } = await supabaseAdmin
      .from('log_entries')
      .select('level, message')
      .eq('upload_id', uploadId)
      .order('timestamp', { ascending: true });
    console.log('\n7. log_entries gravados:');
    (logs ?? []).forEach((l) => console.log(`   [${l.level}] ${l.message}`));

    console.log(status === 'done' ? '\n✅ PIPELINE COMPLETOU (status=done)' : `\n⚠️ Pipeline parou em '${status}'`);
  } catch (e) {
    console.error('\n❌ ERRO:', (e as Error).message);
  } finally {
    // 8. Limpeza (cascata remove patient_records/log_entries do upload)
    console.log('\n8. limpando dados de teste...');
    if (uploadId) await supabaseAdmin.from('uploads').delete().eq('id', uploadId);
    if (clinicId) await supabaseAdmin.from('clinic_accounts').delete().eq('id', clinicId);
    if (tenantId) await supabaseAdmin.from('tenants').delete().eq('id', tenantId);
    if (userId) await supabaseAdmin.auth.admin.deleteUser(userId);
    console.log('   removido.');

    await closeQueues();
    await connection.quit();
    process.exit(0);
  }
}

void main();
