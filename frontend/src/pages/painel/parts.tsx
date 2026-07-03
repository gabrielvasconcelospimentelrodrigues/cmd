import type { ReactNode } from 'react';

export type Tone = 'ok' | 'proc' | 'warn';

export function fichaTone(status: string): Tone {
  if (['registered', 'verified_ok', 'verified_divergent', 'done_manually', 'done'].includes(status)) return 'ok';
  if (['pending_registration', 'registering', 'extracting', 'extracted'].includes(status)) return 'proc';
  return 'warn';
}
export function toneLabel(t: Tone): string {
  return t === 'ok' ? 'Cadastrada' : t === 'proc' ? 'Processando' : 'Pendência';
}
const TONE: Record<Tone, { fg: string; bg: string; dot: string }> = {
  ok: { fg: 'var(--c-okfg)', bg: 'var(--c-oksoft)', dot: 'var(--c-ok)' },
  proc: { fg: 'var(--c-softfg)', bg: 'var(--c-soft)', dot: 'var(--c-blue)' },
  warn: { fg: 'var(--c-warnfg)', bg: 'var(--c-warnsoft)', dot: 'var(--c-warn)' },
};

export function StatusPill({ tone, label }: { tone: Tone; label?: string }) {
  const t = TONE[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: t.fg, background: t.bg }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot }} />
      {label ?? toneLabel(tone)}
    </span>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 14, ...style }}>{children}</div>;
}

export function MetricCard({ label, value, delta, deltaColor, icon, iconBg }: { label: string; value: string; delta: string; deltaColor: string; icon: ReactNode; iconBg: string }) {
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
        <span style={{ fontSize: 12, fontWeight: 600, color: deltaColor }}>{delta}</span>
      </div>
      <div style={{ color: 'var(--c-ink)', fontSize: 28, fontWeight: 700, marginTop: 12, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ color: 'var(--c-ink3)', fontSize: 13, marginTop: 2 }}>{label}</div>
    </Card>
  );
}

export function ProgressRing({ pct }: { pct: number }) {
  const off = 226 - (226 * Math.min(100, Math.max(0, pct))) / 100;
  return (
    <svg width="84" height="84" viewBox="0 0 84 84">
      <circle cx="42" cy="42" r="36" fill="none" stroke="var(--c-surface2)" strokeWidth="8" />
      <circle cx="42" cy="42" r="36" fill="none" stroke="url(#ringg)" strokeWidth="8" strokeLinecap="round" strokeDasharray="226" strokeDashoffset={off} transform="rotate(-90 42 42)" style={{ transition: 'stroke-dashoffset .5s ease' }} />
      <defs>
        <linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563EB" /><stop offset="1" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
      <text x="42" y="47" textAnchor="middle" style={{ fill: 'var(--c-ink)', fontSize: 18, fontWeight: 700 }}>{pct}%</text>
    </svg>
  );
}

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 10, background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, background: 'linear-gradient(90deg,#2563EB,#38BDF8)', borderRadius: 999, transition: 'width .5s ease' }} />
    </div>
  );
}

export function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', background: on ? 'var(--c-blued)' : 'var(--c-border2)', position: 'relative', transition: 'background .2s ease', flex: 'none' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s ease' }} />
    </button>
  );
}

export function Modal({ title, sub, onClose, children, width = 460 }: { title: string; sub?: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'ia-slide .2s ease' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: '100%', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', padding: 26, animation: 'ia-slide .22s ease' }}>
        <h3 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, margin: 0 }}>{title}</h3>
        {sub && <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export function fmtMilhar(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Economia: 14 min/cadastro manual; custo/hora = custo mensal / 225h. */
export function economia(qtd: number, custoMensal: number): { horas: number; minutos: number; valor: number } {
  const totalMin = qtd * 14;
  const custoHora = custoMensal / 225;
  return {
    horas: Math.floor(totalMin / 60),
    minutos: totalMin % 60,
    valor: (totalMin / 60) * custoHora,
  };
}
export function maskDoc(cns: string): string {
  if (!cns) return '—';
  if (cns.length <= 4) return cns;
  return `***.${cns.slice(-7, -4)}.${cns.slice(-4, -1)}-**`.replace(/\.\./g, '.');
}
