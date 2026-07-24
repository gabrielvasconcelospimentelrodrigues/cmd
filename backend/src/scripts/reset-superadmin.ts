/**
 * Reseta a senha do super admin. A senha e o e-mail vêm de ARGUMENTOS/ENV —
 * NUNCA hardcoded no repositório (senha comitada = credencial de maior
 * privilégio exposta a quem vê o código).
 *
 * Uso:
 *   SA_EMAIL=voce@dominio.com SA_PASSWORD='nova-senha-forte' npx tsx src/scripts/reset-superadmin.ts
 *   ou: npx tsx src/scripts/reset-superadmin.ts voce@dominio.com 'nova-senha-forte'
 */
import { supabaseAdmin } from '../lib/supabase';

async function run() {
  const email = process.env.SA_EMAIL ?? process.argv[2];
  const senha = process.env.SA_PASSWORD ?? process.argv[3];
  if (!email || !senha) {
    console.error('Informe e-mail e senha (SA_EMAIL/SA_PASSWORD ou como argumentos). A senha não fica no código.');
    process.exit(1);
  }
  if (senha.length < 12) {
    console.error('Use uma senha com pelo menos 12 caracteres.');
    process.exit(1);
  }

  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) { console.error(listErr); process.exit(1); }
  const sa = users.find((u) => u.email === email);
  if (!sa) { console.error(`Usuário ${email} não encontrado.`); process.exit(1); }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(sa.id, { password: senha, email_confirm: true });
  if (error) { console.error('Erro ao resetar a senha:', error); process.exit(1); }
  console.log(`Senha do super admin (${email}) redefinida com sucesso.`);
}

void run();
