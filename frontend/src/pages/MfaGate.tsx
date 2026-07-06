import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Moon, Sun } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { useTheme, useToast, Toast, LogoMark } from '../components/iacmd/ui';

/**
 * Desafio de 2FA no login: aparece quando a conta tem 2FA ativado e ainda está
 * em AAL1 (só passou pela senha). Só libera o app após validar o código TOTP.
 */
export default function MfaGate() {
  const { recheckMfa, signOut } = useAuth();
  const [theme, toggle] = useTheme();
  const [toast, showToast] = useToast();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [codigo, setCodigo] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Descobre o fator TOTP verificado da conta.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const totp = (data?.totp ?? []).find((f) => f.status === 'verified');
      setFactorId(totp?.id ?? null);
      setCarregando(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    })();
  }, []);

  const verificar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (codigo.length !== 6 || !factorId) return;
    setLoading(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo });
    if (error) {
      setLoading(false);
      setCodigo('');
      return showToast({ title: 'Código inválido', msg: error.message, kind: 'err' });
    }
    // Sessão agora é AAL2 — reavalia e o App libera o painel.
    await recheckMfa();
    setLoading(false);
  };

  return (
    <div className="iacmd" data-theme={theme} style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, position: 'relative' }}>
      <button onClick={toggle} title="Alternar tema" style={{ position: 'absolute', top: 20, right: 20, width: 38, height: 38, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>

      <form onSubmit={verificar} className="ia-card" style={{ width: 420, maxWidth: '100%', padding: '34px 32px', animation: 'ia-slide .25s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LogoMark size={30} />
          <span style={{ color: 'var(--c-ink)', fontWeight: 700, fontSize: 18 }}>IA-CMD</span>
        </div>

        <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--c-soft)', display: 'grid', placeItems: 'center', marginTop: 22 }}>
          <ShieldCheck size={24} style={{ color: 'var(--c-blue)' }} />
        </div>
        <h1 style={{ color: 'var(--c-ink)', fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', margin: '14px 0 0' }}>Verificação em duas etapas</h1>
        <p style={{ color: 'var(--c-ink3)', fontSize: 14, lineHeight: 1.5, margin: '8px 0 0' }}>
          Sua conta tem 2FA ativado. Digite o código de 6 dígitos do seu app autenticador para entrar.
        </p>

        {carregando ? (
          <div style={{ color: 'var(--c-ink3)', fontSize: 14, marginTop: 22 }}>Carregando…</div>
        ) : !factorId ? (
          <div style={{ color: 'var(--c-warn)', fontSize: 14, marginTop: 22 }}>Nenhum autenticador verificado foi encontrado nesta conta.</div>
        ) : (
          <>
            <input
              ref={inputRef}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              className="ia-input ia-mono"
              style={{ marginTop: 22, fontSize: 24, letterSpacing: '.4em', textAlign: 'center' }}
            />
            <button className="ia-btn" style={{ width: '100%', marginTop: 18 }} disabled={loading || codigo.length !== 6}>
              {loading ? 'Verificando…' : 'Confirmar e entrar'}
            </button>
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button type="button" onClick={() => void signOut()} className="ia-link" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
            Sair e usar outra conta
          </button>
        </div>
      </form>
      <Toast data={toast} />
    </div>
  );
}
