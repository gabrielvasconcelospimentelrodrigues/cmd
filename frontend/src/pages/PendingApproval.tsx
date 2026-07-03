import { useState } from 'react';
import { Check, Clock, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Shell, useTheme } from '../components/iacmd/ui';

export default function PendingApproval({ onRecheck }: { onRecheck: () => Promise<void> }) {
  const { signOut } = useAuth();
  const [theme, toggle] = useTheme();
  const [checking, setChecking] = useState(false);

  const verificar = async () => {
    setChecking(true);
    await onRecheck();
    setChecking(false);
  };

  return (
    <Shell theme={theme} onToggleTheme={toggle}>
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 20px 60px' }}>
        <div className="ia-card" style={{ width: 520, maxWidth: '100%', padding: '44px 40px', textAlign: 'center', animation: 'ia-slide .25s ease' }}>
          <div style={{ position: 'relative', width: 74, height: 74, margin: '0 auto' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--c-soft)' }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--c-cyan)', animation: 'ia-ping 2s ease-out infinite' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-softfg)' }}>
              <Clock size={34} strokeWidth={1.8} />
            </div>
          </div>

          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 22, background: 'var(--c-warnsoft)', color: 'var(--c-warn)', fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 999, letterSpacing: '.04em' }}>AGUARDANDO AUTORIZAÇÃO</span>

          <h1 style={{ color: 'var(--c-ink)', fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', margin: '18px 0 0' }}>Quase lá. Falta a liberação do super admin.</h1>
          <p style={{ color: 'var(--c-ink2)', fontSize: 15, lineHeight: 1.6, margin: '12px auto 0', maxWidth: 400 }}>
            Recebemos sua configuração. Por segurança, a IA só começa a cadastrar depois que o super admin autoriza o acesso desta conta. Você recebe um aviso assim que for liberado.
          </p>

          <div style={{ marginTop: 24, background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 14, padding: 18, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Item ok>Conta CMD-COLETA conectada e criptografada</Item>
            <Item ok>Chave 2FA recebida</Item>
            <Item>Aguardando autorização do super admin</Item>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 26 }}>
            <button onClick={signOut} className="ia-btn-outline"><LogOut size={16} /> Sair</button>
            <button onClick={verificar} disabled={checking} className="ia-btn" style={{ padding: '13px 22px', fontSize: 14 }}>
              <RefreshCw size={16} style={checking ? { animation: 'ia-spin .8s linear infinite' } : undefined} /> Verificar liberação
            </button>
          </div>
          <div style={{ marginTop: 14, color: 'var(--c-ink3)', fontSize: 12 }}>Dúvidas? Fale com a gente pelo WhatsApp.</div>
        </div>
      </div>
    </Shell>
  );
}

function Item({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      {ok ? (
        <Check size={18} strokeWidth={2.4} style={{ color: 'var(--c-ok)', flex: 'none' }} />
      ) : (
        <span style={{ width: 18, height: 18, flex: 'none', borderRadius: '50%', border: '2px solid var(--c-warn)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-warn)' }} />
        </span>
      )}
      <span style={{ color: ok ? 'var(--c-ink)' : 'var(--c-ink2)', fontSize: 14 }}>{children}</span>
    </div>
  );
}
