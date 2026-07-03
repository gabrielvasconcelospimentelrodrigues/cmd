import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sun, Moon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LogoMark, Field, useTheme, useToast, Toast } from '../components/iacmd/ui';
import { AgentSphere } from '../components/iacmd/AgentSphere';

export default function ForgotPassword() {
  const nav = useNavigate();
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
    <div className="iacmd ia-login-split" data-theme={theme}>
      {/* Esquerda: Banner / Imagem / Animação */}
      <div className="ia-login-banner">
        {/* Glow de fundo */}
        <div style={{ position: 'absolute', top: -160, right: -160, width: 680, height: 680, borderRadius: '50%', background: 'radial-gradient(circle,var(--c-glow),transparent 66%)', pointerEvents: 'none' }} />
        
        {/* Header no Banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer', position: 'relative', zIndex: 5 }} onClick={() => nav('/')}>
          <LogoMark size={34} />
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 20, letterSpacing: '.02em' }}>IA-CMD</span>
        </div>

        {/* Centro do Banner */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 32, position: 'relative', zIndex: 5 }}>
          <AgentSphere active={true} size={280} />
          <div style={{ textAlign: 'center', maxWidth: 440 }}>
            <h2 style={{ color: '#fff', fontSize: 28, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-.02em', margin: 0 }}>
              As fichas dos seus pacientes, cadastradas <span style={{ background: 'linear-gradient(120deg,var(--c-cyan),var(--c-blued))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>sozinhas.</span>
            </h2>
            <p style={{ color: '#B7C2DA', fontSize: 15, lineHeight: 1.6, marginTop: 12, padding: '0 20px' }}>
              A IA preenche e envia cada ficha no sistema do governo em até 24 horas. Sem digitador, sem atrasos.
            </p>
          </div>
        </div>

        {/* Rodapé do Banner */}
        <div style={{ color: '#7A89A6', fontSize: 13, position: 'relative', zIndex: 5 }}>
          © {new Date().getFullYear()} IA-CMD. Credenciais seguras e criptografadas.
        </div>
      </div>

      {/* Direita: Formulário */}
      <div className="ia-login-form-side">
        {/* Topbar do Formulário (botão voltar / toggle tema) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', position: 'relative', zIndex: 5 }}>
          {/* Logo visível no Mobile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} className="lp-hide-lg" onClick={() => nav('/')}>
            <LogoMark size={30} />
            <span style={{ color: 'var(--c-ink)', fontWeight: 700, fontSize: 18 }}>IA-CMD</span>
          </div>
          
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            <button onClick={() => nav('/login')} className="ia-btn-outline" style={{ padding: '8px 14px', fontSize: 13, gap: 6 }}>
              <ArrowLeft size={14} /> Voltar ao login
            </button>
            <button onClick={toggle} title="Alternar tema" style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </div>

        {/* Centro do Formulário */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '40px 0' }}>
          <form onSubmit={submit} className="ia-card" style={{ width: 420, maxWidth: '100%', padding: '36px 32px', animation: 'ia-slide .25s ease', boxShadow: 'none', border: 'none', background: 'transparent' }}>
            <h1 style={{ color: 'var(--c-ink)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', margin: 0 }}>Recuperar senha</h1>
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

        {/* Rodapé do Formulário */}
        <div style={{ color: 'var(--c-ink3)', fontSize: 12, textAlign: 'center', width: '100%' }}>
          Área segura protegida por criptografia de ponta a ponta.
        </div>
      </div>
      <Toast data={toast} />
    </div>
  );
}

