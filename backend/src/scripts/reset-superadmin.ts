import { supabaseAdmin } from '../lib/supabase';

async function run() {
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) {
    console.error(listErr);
    return;
  }
  const sa = users.find(u => u.email === 'gdesignbrasil@gmail.com');
  if (!sa) {
    console.error('Super admin user not found');
    return;
  }

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
    sa.id,
    { password: 'SuperAdminPassword123!', email_confirm: true }
  );

  if (error) {
    console.error('Error resetting password:', error);
  } else {
    console.log('Password reset successfully for gdesignbrasil@gmail.com!');
  }
}

void run();
