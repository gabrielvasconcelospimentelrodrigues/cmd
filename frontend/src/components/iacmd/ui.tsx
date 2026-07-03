import { useState, useEffect, type ReactNode } from 'react';
import { Eye, EyeOff, Sun, Moon, Check, AlertCircle } from 'lucide-react';

/* ---- Tema (dark/light, persistido) ------------------------------------- */
export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('iacmd-theme') || 'light');
  useEffect(() => {
    localStorage.setItem('iacmd-theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

/* ---- Marca IACMD ------------------------------------------------------- */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 9,
        background: 'linear-gradient(135deg,#2563EB,#38BDF8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 6px 16px rgba(37,99,235,.4)', flex: 'none',
      }}
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2.4" /><circle cx="5" cy="5" r="1.6" /><circle cx="19" cy="5" r="1.6" />
        <circle cx="5" cy="19" r="1.6" /><circle cx="19" cy="19" r="1.6" />
        <path d="M6.4 6.4 10 10M17.6 6.4 14 10M6.4 17.6 10 14M17.6 17.6 14 14" />
      </svg>
    </div>
  );
}

/* ---- Shell: fundo + glow + topbar (logo + toggle tema) ----------------- */
export function Shell({ theme, onToggleTheme, children }: { theme: string; onToggleTheme: () => void; children: ReactNode }) {
  return (
    <div className="iacmd" data-theme={theme}>
      <div style={{ position: 'absolute', top: -160, right: -160, width: 620, height: 620, borderRadius: '50%', background: 'radial-gradient(circle,var(--c-glow),transparent 66%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <LogoMark />
          <span style={{ color: 'var(--c-ink)', fontWeight: 700, fontSize: 20, letterSpacing: '.02em' }}>IACMD</span>
        </div>
        <button onClick={onToggleTheme} title="Alternar tema" style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
      {children}
    </div>
  );
}

/* ---- Campos ------------------------------------------------------------ */
export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="ia-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {label}
        {hint && <span title={hint} style={{ cursor: 'help', width: 14, height: 14, borderRadius: '50%', border: '1px solid currentColor', opacity: 0.6, fontSize: 9, fontWeight: 700, display: 'inline-grid', placeItems: 'center' }}>?</span>}
      </label>
      {children}
      {error && <div style={{ color: 'var(--c-warn)', fontSize: 12, marginTop: 5 }}>{error}</div>}
    </div>
  );
}

export function PasswordField({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`ia-input ${mono ? 'ia-mono' : ''}`}
        style={{ paddingRight: 44 }}
      />
      <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

/* ---- Toast ------------------------------------------------------------- */
export interface ToastData {
  title: string;
  msg: string;
  kind: 'ok' | 'err';
}
export function useToast(): [ToastData | null, (t: ToastData) => void] {
  const [toast, setToast] = useState<ToastData | null>(null);
  const show = (t: ToastData) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 3600);
  };
  return [toast, show];
}
export function Toast({ data }: { data: ToastData | null }) {
  if (!data) return null;
  const ok = data.kind === 'ok';
  const bar = ok ? 'var(--c-ok)' : 'var(--c-warn)';
  return (
    <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 120, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderLeft: `3px solid ${bar}`, borderRadius: 12, padding: '14px 16px', boxShadow: 'var(--c-shadow)', display: 'flex', alignItems: 'center', gap: 12, maxWidth: 340, animation: 'ia-toast .26s cubic-bezier(.22,1,.36,1)' }}>
      <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 9, background: ok ? 'var(--c-oksoft)' : 'var(--c-warnsoft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: bar }}>
        {ok ? <Check size={17} /> : <AlertCircle size={17} />}
      </span>
      <div>
        <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{data.title}</div>
        <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{data.msg}</div>
      </div>
    </div>
  );
}
