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
    <Shell theme={theme} onToggleTheme={toggle}>
      <div style={center}>
        <form onSubmit={submit} className="ia-card" style={{ width: 440, maxWidth: '100%', padding: '36px 32px', animation: 'ia-slide .25s ease' }}>
          <h1 style={{ color: 'var(--c-ink)', fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', margin: 0 }}>Criar conta</h1>
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
      <Toast data={toast} />
    </Shell>
  );
}
