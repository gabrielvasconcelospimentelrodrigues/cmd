import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Shell, Field, useTheme, useToast, Toast } from '../components/iacmd/ui';

const center = { position: 'relative' as const, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px 60px' };

export default function ForgotPassword() {
  const [theme, toggle] = useTheme();
  const [toast, showToast] = useToast();
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` });
    setLoading(false);
    if (error) return showToast({ title: 'Erro', msg: error.message, kind: 'err' });
    setEnviado(true);
  };

  return (
    <Shell theme={theme} onToggleTheme={toggle}>
      <div style={center}>
        <form onSubmit={submit} className="ia-card" style={{ width: 420, maxWidth: '100%', padding: '36px 32px', animation: 'ia-slide .25s ease' }}>
          <Link to="/login" className="ia-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--c-ink3)' }}>
            <ArrowLeft size={15} /> Voltar ao login
          </Link>
          <h1 style={{ color: 'var(--c-ink)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', margin: '18px 0 0' }}>Recuperar senha</h1>
          <p style={{ color: 'var(--c-ink3)', fontSize: 14, margin: '8px 0 0' }}>Enviaremos um link de redefinição para seu e-mail.</p>

          {enviado ? (
            <div style={{ marginTop: 22, borderRadius: 12, border: '1px solid var(--c-border)', background: 'var(--c-oksoft)', padding: 16, fontSize: 14, color: 'var(--c-okfg)' }}>
              Se existe uma conta com <b>{email}</b>, o link foi enviado. Verifique sua caixa de entrada.
            </div>
          ) : (
            <>
              <div style={{ marginTop: 22 }}>
                <Field label="E-mail">
                  <input className="ia-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@clinica.com.br" />
                </Field>
              </div>
              <button className="ia-btn" style={{ width: '100%', marginTop: 22 }} disabled={loading}>{loading ? 'Enviando…' : 'Enviar link'}</button>
            </>
          )}
        </form>
      </div>
      <Toast data={toast} />
    </Shell>
  );
}
