/**
 * E2E do fluxo de upload: cria conta de teste -> POST /uploads com um CSV ->
 * acompanha a extração -> confere os patient_records criados -> limpa.
 *
 * Pré-requisito: backend (npm run dev) E workers rodando em processos à parte.
 * Rodar:  npx tsx src/scripts/e2e-upload.ts
 */
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabase';
import { env } from '../config/env';

const API = 'http://localhost:3333';
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const rnd = Math.random().toString(36).slice(2, 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CSV = `Nome;CPF do paciente;Data de Atendimento;Profissional Executante;CID-10
Maria Silva;70565376420;01/06/2026;Dr. Joao Souza;J11
José Santos;12345678901;02/06/2026;Ana Lima;A09
`;

async function main() {
  console.log('\n=== E2E upload -> extração ===\n');
  let userId = '';
  let tenantId = 0;
  let clinicId = 0;
  let uploadId = 0;

  try {
    const { data: u, error: ue } = await supabaseAdmin.auth.admin.createUser({
      email: `e2eup+${rnd}@cmd.local`, password: `Teste-${rnd}-123`, email_confirm: true,
    });
    if (ue) throw ue;
    userId = u.user.id;

    const { data: t } = await supabaseAdmin
      .from('tenants').insert({ name: `Clínica ${rnd}`, owner_user_id: userId, status: 'active' })
      .select('id').single();
    tenantId = t!.id;

    const { data: c } = await supabaseAdmin
      .from('clinic_accounts').insert({
        tenant_id: tenantId, label: 'Conta E2E', cmd_username: 'u',
        cmd_password_encrypted: 'x', mfa_secret_encrypted: 'x',
        is_enabled: false, // pausa o registro (não decifra) — testamos só a extração
      })
      .select('id').single();
    clinicId = c!.id;

    // Login para obter o access_token (JWT) e autenticar nas rotas.
    const { data: sess, error: se } = await anon.auth.signInWithPassword({
      email: `e2eup+${rnd}@cmd.local`, password: `Teste-${rnd}-123`,
    });
    if (se || !sess.session) throw se ?? new Error('sem sessão');
    const authH = { Authorization: `Bearer ${sess.session.access_token}` };
    console.log(`setup ok: clinic=${clinicId}, autenticado`);

    // POST multipart /uploads
    const form = new FormData();
    form.append('clinic_account_id', String(clinicId));
    form.append('file', new Blob([CSV], { type: 'text/csv' }), 'pacientes.csv');
    const resp = await fetch(`${API}/uploads`, { method: 'POST', body: form, headers: authH });
    const body = (await resp.json()) as { id: number; status: string };
    if (!resp.ok) throw new Error(`POST /uploads ${resp.status}: ${JSON.stringify(body)}`);
    uploadId = body.id;
    console.log(`upload criado: #${uploadId} (status ${body.status})`);

    // Acompanha até os pacientes serem extraídos
    let found = 0;
    let status = '';
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const r = await fetch(`${API}/uploads/${uploadId}`, { headers: authH });
      const up = (await r.json()) as { status: string; patients_found: number };
      if (up.status !== status || up.patients_found !== found) {
        status = up.status;
        found = up.patients_found;
        console.log(`   [${i + 1}s] status=${status} patients_found=${found}`);
      }
      if (found > 0 && (status === 'extracted' || status === 'paused' || status === 'done')) break;
    }

    const { data: prs } = await supabaseAdmin
      .from('patient_records')
      .select('nome, cns, data_atendimento, cid10_codigo, medico_nome, status')
      .eq('upload_id', uploadId)
      .order('id', { ascending: true });

    console.log('\npatient_records criados:');
    (prs ?? []).forEach((p) =>
      console.log(`   - ${p.nome} | CNS ${p.cns} | ${p.data_atendimento} | CID ${p.cid10_codigo} | ${p.medico_nome} | ${p.status}`),
    );

    const ok = (prs?.length ?? 0) === 2 && prs?.[0]?.cns === '70565376420';
    console.log(ok ? '\n✅ EXTRAÇÃO E2E OK (2 patient_records via upload HTTP)' : '\n❌ Resultado inesperado');
  } catch (e) {
    console.error('\n❌ ERRO:', (e as Error).message);
  } finally {
    console.log('\nlimpando...');
    if (uploadId) await supabaseAdmin.from('uploads').delete().eq('id', uploadId);
    if (clinicId) await supabaseAdmin.from('clinic_accounts').delete().eq('id', clinicId);
    if (tenantId) await supabaseAdmin.from('tenants').delete().eq('id', tenantId);
    if (userId) await supabaseAdmin.auth.admin.deleteUser(userId);
    console.log('removido.');
    process.exit(0);
  }
}

void main();
