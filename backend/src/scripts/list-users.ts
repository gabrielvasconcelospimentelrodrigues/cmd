import { supabaseAdmin } from '../lib/supabase';

async function run() {
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) {
    console.error('Error listing users:', error);
    return;
  }

  console.log('--- Database Users ---');
  for (const u of users) {
    console.log(`Email: ${u.email} | ID: ${u.id} | Role: ${u.app_metadata?.role}`);
  }
}

void run();
