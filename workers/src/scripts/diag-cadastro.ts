/**
 * Dry-run seguro (não grava no gov) usando o cid_padrao da conta. Captura o
 * que o site faz no campo Problema/Diagnóstico com o valor configurado.
 * Uso: npx tsx src/scripts/diag-cadastro.ts [uploadId]
 */
import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabase';
import { decrypt } from '../lib/crypto';
import { WebAutomator, type PatientData } from '../automation/web-automation';

const SHOT = 'C:/Users/WIN-10~1/AppData/Local/Temp/claude/c--Users-Win---10-Desktop-CMD/3cab9ef1-705b-4ce9-8913-a407a2c8965d/scratchpad';
const uploadId = Number(process.argv[2] || 11);

async function main() {
  const { data: p } = await supabaseAdmin
    .from('patient_records')
    .select('id, clinic_account_id, nome, cns, data_nascimento, data_atendimento, cid10_codigo, medico_nome, automation_overrides')
    .eq('upload_id', uploadId).eq('status', 'pending_registration')
    .order('id', { ascending: true }).limit(1).maybeSingle();
  if (!p) throw new Error(`nenhum paciente pendente no upload #${uploadId}`);

  const { data: conta } = await supabaseAdmin
    .from('clinic_accounts')
    .select('cmd_username, cmd_password_encrypted, mfa_secret_encrypted, cid_padrao')
    .eq('id', p.clinic_account_id).single();
  if (!conta) throw new Error('conta não encontrada');

  const cid = (p.cid10_codigo && p.cid10_codigo.trim()) ? p.cid10_codigo : (conta.cid_padrao || '');
  console.log(`Paciente: ${p.nome} | CNS ${p.cns} | CID usado: "${cid}" (padrão da conta: "${conta.cid_padrao}")`);

  const pd: PatientData = {
    cns: p.cns, nome: p.nome,
    dataNascimento: p.data_nascimento ? new Date(p.data_nascimento) : null,
    dataAtendimento: p.data_atendimento ? new Date(p.data_atendimento) : null,
    cid10Codigo: cid, medicoNome: p.medico_nome,
    overrides: (p.automation_overrides as Record<string, string>) ?? {},
  };

  const a = new WebAutomator({
    username: conta.cmd_username, password: decrypt(conta.cmd_password_encrypted),
    mfaSecret: decrypt(conta.mfa_secret_encrypted), uploadId: 99999, headless: true,
    onStep: (d) => console.log('  [passo]', d),
  });

  await a.start();
  try {
    await a.login();
    console.log('\n>>> DRY-RUN (não salva)...');
    await a.incluirContato(pd, true);
    console.log('\n✅ DRY-RUN COMPLETO — todos os passos rodaram com o CID "' + cid + '".');
    await a.page?.screenshot({ path: `${SHOT}/cadastro-dryrun.png`, fullPage: true }).catch(() => {});
  } catch (e) {
    console.log('\n❌ Parou em:', (e as Error).message.slice(0, 160));
    const page = a.page;
    if (page) {
      // O que o autocomplete de diagnóstico ofereceu para o valor digitado?
      const sugest = await page.locator('.autocomplete-overlay, .suggestions-container').allInnerTexts().catch(() => []);
      console.log('Sugestões visíveis no diagnóstico:', JSON.stringify(sugest.map((s) => s.replace(/\s+/g, ' ').trim()).slice(0, 8)));
      const modal = await page.locator('ion-alert .alert-message, .alert-message').allInnerTexts().catch(() => []);
      console.log('Modal/aviso na tela:', JSON.stringify(modal.map((s) => s.replace(/\s+/g, ' ').trim())));
      const diagVal = await page.locator('ng-autocomplete[formcontrolname="problemaDiagnostico"] input').first().inputValue().catch(() => '(n/a)');
      console.log('Valor no campo Problema/Diagnóstico:', JSON.stringify(diagVal));
      await page.screenshot({ path: `${SHOT}/cadastro-erro.png`, fullPage: true }).catch(() => {});
    }
  } finally {
    await a.close();
  }
  process.exit(0);
}
main();
