import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Shell, Field, PasswordField, useTheme, useToast, Toast } from '../components/iacmd/ui';

const center = { position: 'relative' as const, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 20px 60px' };
const emailRe = /.+@.+\..+/;

export default function Register() {
  const nav = useNavigate();
  const [theme, toggle] = useTheme();
  const [toast, showToast] = useToast();
  const [nome, setNome] = useState('');
  const [clinica, setClinica] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);

  const erros = {
    nome: !nome.trim(),
    clinica: !clinica.trim(),
    email: !emailRe.test(email),
    pass: pass.length < 8,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(erros).some(Boolean)) return;
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password: pass,
      options: { data: { full_name: nome.trim(), clinic_name: clinica.trim() } },
    });
    setLoading(false);
    if (error) return showToast({ title: 'Não foi possível criar a conta', msg: error.message, kind: 'err' });
    if (data.session) {
      nav('/'); // logado → segue para o onboarding
    } else {
      showToast({ title: 'Conta criada', msg: 'Confirme seu e-mail para continuar.', kind: 'ok' });
    }
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
            <button onClick={() => nav('/')} className="ia-btn-outline" style={{ padding: '8px 14px', fontSize: 13, gap: 6 }}>
              <ArrowLeft size={14} /> Voltar para o site
            </button>
            <button onClick={toggle} title="Alternar tema" style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          </div>
        </div>

        {/* Centro do Formulário */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '30px 0' }}>
          <form onSubmit={submit} className="ia-card" style={{ width: 440, maxWidth: '100%', padding: '36px 32px', animation: 'ia-slide .25s ease', boxShadow: 'none', border: 'none', background: 'transparent' }}>
            <h1 style={{ color: 'var(--c-ink)', fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', margin: 0 }}>Criar conta</h1>
            <p style={{ color: 'var(--c-ink3)', fontSize: 14, margin: '8px 0 0' }}>Leva 1 minuto. Depois você conecta a IA.</p>

            <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Seu nome" error={touched && erros.nome ? 'Falta seu nome.' : undefined}>
                <input className={`ia-input ${touched && erros.nome ? 'err' : ''}`} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: João Pereira" />
              </Field>
              <Field label="Nome da clínica / operação" error={touched && erros.clinica ? 'Informe o nome da operação.' : undefined}>
                <input className={`ia-input ${touched && erros.clinica ? 'err' : ''}`} value={clinica} onChange={(e) => setClinica(e.target.value)} placeholder="Ex: Saúde Itinerante LTDA" />
              </Field>
              <Field label="E-mail" error={touched && erros.email ? 'Confira o e-mail.' : undefined}>
                <input className={`ia-input ${touched && erros.email ? 'err' : ''}`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@clinica.com.br" />
              </Field>
              <Field label="Senha" error={touched && erros.pass ? 'A senha precisa de pelo menos 8 caracteres.' : undefined}>
                <PasswordField value={pass} onChange={setPass} placeholder="Mínimo 8 caracteres" />
              </Field>
            </div>

            <button className="ia-btn" style={{ width: '100%', marginTop: 22 }} disabled={loading}>{loading ? 'Criando…' : 'Criar conta e configurar'}</button>
            <div style={{ textAlign: 'center', marginTop: 18, color: 'var(--c-ink3)', fontSize: 14 }}>
              Já tem conta? <Link to="/login" className="ia-link">Entrar</Link>
            </div>
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
