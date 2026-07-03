import { supabaseAdmin } from './supabase';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Gera um short_code de 6 chars único na tabela uploads (igual ao Django). */
export async function gerarShortCode(): Promise<string> {
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
    }
    const { data } = await supabaseAdmin.from('uploads').select('id').eq('short_code', code).maybeSingle();
    if (!data) return code;
  }
  throw new Error('Não foi possível gerar short_code único.');
}
