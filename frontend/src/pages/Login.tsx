import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Shell, Field, PasswordField, useTheme, useToast, Toast } from '../components/iacmd/ui';

const center = { position: 'relative' as const, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px 60px' };
const emailRe = /.+@.+\..+/;

export default function Login() {
  const nav = useNavigate();
  const [theme, toggle] = useTheme();
  const [toast, showToast] = useToast();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mfa, setMfa] = useState<{ factorId: string } | null>(null); // etapa do 2FA
  const [codigo, setCodigo] = useState('');
  const emailBad = !emailRe.test(email);

  // Após a senha, verifica se a conta exige 2FA (aal2). Se sim, mostra o
  // campo do código; senão, entra direto.
  const seguirAposSenha = async (): Promise<void> => {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      const { data: fs } = await supabase.auth.mfa.listFactors();
      const totp = (fs?.totp ?? []).find((f) => f.status === 'verified');
      if (totp) { setMfa({ factorId: totp.id }); return; }
    }
    nav('/');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (emailBad || !pass) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) { setLoading(false); return showToast({ title: 'Não foi possível entrar', msg: error.message, kind: 'err' }); }
    await seguirAposSenha();
    setLoading(false);
  };

  const verificarMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (codigo.length !== 6 || !mfa) return;
    setLoading(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfa.factorId, code: codigo });
    setLoading(false);
    if (error) return showToast({ title: 'Código inválido', msg: error.message, kind: 'err' });
    nav('/');
  };

  const cancelarMfa = async () => { await supabase.auth.signOut(); setMfa(null); setCodigo(''); setPass(''); };

  return (
    <Shell theme={theme} onToggleTheme={toggle}>
      <div style={center}>
        {mfa ? (
          <form onSubmit={verificarMfa} className="ia-card" style={{ width: 420, maxWidth: '100%', padding: '36px 32px', animation: 'ia-slide .25s ease' }}>
            <h1 style={{ color: 'var(--c-ink)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', margin: 0 }}>Verificação em duas etapas</h1>
            <p style={{ color: 'var(--c-ink3)', fontSize: 14, margin: '8px 0 0' }}>Digite o código de 6 dígitos do seu app autenticador.</p>
            <input autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="ia-input ia-mono" style={{ marginTop: 22, fontSize: 24, letterSpacing: '.4em', textAlign: 'center' }} />
            <button className="ia-btn" style={{ width: '100%', marginTop: 20 }} disabled={loading || codigo.length !== 6}>{loading ? 'Verificando…' : 'Confirmar'}</button>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button type="button" onClick={cancelarMfa} className="ia-link" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>Voltar</button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit} className="ia-card" style={{ width: 420, maxWidth: '100%', padding: '36px 32px', animation: 'ia-slide .25s ease' }}>
            <h1 style={{ color: 'var(--c-ink)', fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', margin: 0 }}>Entrar na IACMD</h1>
            <p style={{ color: 'var(--c-ink3)', fontSize: 14, margin: '8px 0 0' }}>Acesse o painel da sua operação.</p>

            <div style={{ marginTop: 24 }}>
              <Field label="E-mail" error={touched && emailBad ? 'Confira o e-mail.' : undefined}>
                <input className={`ia-input ${touched && emailBad ? 'err' : ''}`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@clinica.com.br" />
              </Field>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="ia-label" style={{ margin: 0 }}>Senha</label>
                <Link to="/esqueci-senha" className="ia-link" style={{ fontSize: 12 }}>Esqueci a senha</Link>
              </div>
              <PasswordField value={pass} onChange={setPass} placeholder="••••••••" />
            </div>

            <button className="ia-btn" style={{ width: '100%', marginTop: 24 }} disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button>
            <div style={{ textAlign: 'center', marginTop: 20, color: 'var(--c-ink3)', fontSize: 14 }}>
              Ainda não tem conta? <Link to="/registro" className="ia-link">Criar conta</Link>
            </div>
          </form>
        )}
      </div>
      <Toast data={toast} />
    </Shell>
  );
}
