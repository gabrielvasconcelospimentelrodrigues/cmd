import { useCallback, useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import {
  LayoutDashboard, ShieldCheck, Building2, Users, CreditCard, ScrollText, SlidersHorizontal,
  LogOut, Sun, Moon, Check, X, Shield, Cpu, Wallet, Loader2, MoreVertical, KeyRound, Pencil, Ban, Trash2, UserPlus, Copy, Menu, Eye, EyeOff,
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useTheme, LogoMark, useToast, Toast, PasswordField, type ToastData } from '../components/iacmd/ui';
import ProfileSecurity from '../components/iacmd/ProfileSecurity';
import WhatsAppFab from '../components/iacmd/WhatsAppFab';
import { apiGet, apiPost, apiPatch, apiDelete, apiPut } from '../lib/api';
import { Switch, brl } from './painel/parts';
import type { Plano, TerminalRequest, Fatura } from '../lib/types';

type Page = 'overview' | 'auth' | 'empresas' | 'usuarios' | 'financeiro' | 'planos' | 'infra' | 'logs' | 'regras';
interface T { id: number; name: string; status: string; responsavel: string | null; cidade: string | null; created_at: string; empresas?: { id: number; nome: string }[]; membros?: { id: number; nome: string | null; email: string }[] }
interface U { id: string; nome: string; email: string; empresa: string; empresas_list?: string[]; tenant_id: number | null; tenant_status: string | null; role: string; role_key: string; ativo: boolean; banido: boolean; confirmado: boolean; ultimo_acesso: string | null; criado_em: string | null }
interface Stats { empresasAtivas: number; pendentes: number; totalEmpresas: number; fichasRede: number }

const NAV: { key: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { key: 'auth', label: 'Autorizações', icon: ShieldCheck },
  { key: 'empresas', label: 'Empresas', icon: Building2 },
  { key: 'usuarios', label: 'Usuários', icon: Users },
  { key: 'financeiro', label: 'Financeiro', icon: Wallet },
  { key: 'planos', label: 'Planos', icon: CreditCard },
  { key: 'infra', label: 'Infraestrutura', icon: Cpu },
  { key: 'logs', label: 'Logs do sistema', icon: ScrollText },
  { key: 'regras', label: 'Regras', icon: SlidersHorizontal },
];
const TITLES: Record<Page, [string, string]> = {
  overview: ['Visão geral', 'Estado de toda a rede IACMD'],
  auth: ['Autorizações pendentes', 'Liberação de novas contas'],
  empresas: ['Empresas', 'Clientes da rede IACMD'],
  usuarios: ['Usuários', 'Pessoas com acesso ao sistema'],
  financeiro: ['Financeiro', 'Receita, recebimentos e inadimplência'],
  planos: ['Planos', 'Assinaturas e receita'],
  infra: ['Infraestrutura & Escala', 'Métricas de servidores, latência e regras para escalar recursos'],
  logs: ['Logs do sistema', 'Auditoria de ações'],
  regras: ['Regras', 'Comportamento da automação'],
};
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const initials = (s: string) => (s || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function SuperAdmin() {
  const { session, signOut } = useAuth();
  const [theme, toggle] = useTheme();
  const [toast, showToast] = useToast();
  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem('iacmd:superadmin:tab');
    const valid: Page[] = ['overview', 'auth', 'empresas', 'usuarios', 'financeiro', 'planos', 'infra', 'logs', 'regras'];
    return (saved && valid.includes(saved as Page)) ? (saved as Page) : 'overview';
  });
  const [tenants, setTenants] = useState<T[]>([]);
  const [users, setUsers] = useState<U[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [terminalRequests, setTerminalRequests] = useState<TerminalRequest[]>([]);
  const [confirm, setConfirm] = useState<{ t: T; tipo: 'approve' | 'suspend' } | null>(null);
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('iacmd:superadmin:tab', page);
  }, [page]);

  const carregar = useCallback(async () => {
    const [t, u, s, tr] = await Promise.all([
      apiGet<T[]>('/admin/tenants'),
      apiGet<U[]>('/admin/users').catch(() => []),
      apiGet<Stats>('/admin/stats'),
      apiGet<TerminalRequest[]>('/admin/terminal-requests').catch(() => [])
    ]);
    setTenants(t); setUsers(u); setStats(s); setTerminalRequests(tr);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const approveTerminal = async (r: TerminalRequest) => {
    try {
      await apiPost(`/admin/terminal-requests/${r.id}/approve`, {});
      await carregar();
      showToast({ title: 'Terminal liberado', msg: 'A cota do cliente foi incrementada em +1.', kind: 'ok' });
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    }
  };

  const rejectTerminal = async (r: TerminalRequest) => {
    try {
      await apiPost(`/admin/terminal-requests/${r.id}/reject`, {});
      await carregar();
      showToast({ title: 'Solicitação recusada', msg: 'A solicitação do cliente foi arquivada.', kind: 'err' });
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    }
  };

  const pend = tenants.filter((t) => t.status === 'pending_approval');
  const doConfirm = async () => {
    if (!confirm) return;
    try {
      await apiPost(`/admin/tenants/${confirm.t.id}/${confirm.tipo}`, {});
      await carregar();
      showToast({ title: confirm.tipo === 'approve' ? 'Acesso autorizado' : 'Solicitação recusada', msg: confirm.t.name, kind: confirm.tipo === 'approve' ? 'ok' : 'err' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); }
    setConfirm(null);
  };

  const [title, sub] = TITLES[page];

  return (
    <div className="iacmd ia-shell" data-theme={theme} data-menu={menuOpen ? 'open' : 'closed'} style={{ display: 'grid', gridTemplateColumns: '248px 1fr', height: '100vh', overflow: 'hidden' }}>
      {menuOpen && <div className="ia-shell-backdrop" onClick={() => setMenuOpen(false)} />}
      {/* sidebar */}
      <aside style={{ display: 'flex', flexDirection: 'column', background: 'var(--c-side)', borderRight: '1px solid var(--c-side-border)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '18px 20px' }}>
          <LogoMark size={34} />
          <div><div style={{ color: 'var(--c-side-ink)', fontWeight: 700, fontSize: 18 }}>IA-CMD</div><div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--c-warnfg)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em' }}><Shield size={11} /> SUPER ADMIN</div></div>
        </div>
        <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(({ key, label, icon: Icon }) => {
            const pendingTerminalsCount = terminalRequests.filter(r => r.status === 'pending').length;
            const active = page === key;
            return (
              <button key={key} onClick={() => { setPage(key); setMenuOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', fontSize: 14, fontWeight: active ? 600 : 500, color: active ? 'var(--c-side-active-ink)' : 'var(--c-side-ink2)', background: active ? 'var(--c-side-active-bg)' : 'transparent' }}>
                <Icon size={18} /><span style={{ flex: 1 }}>{label}</span>
                {key === 'auth' && (pend.length + pendingTerminalsCount) > 0 && <span style={{ background: 'var(--c-warn)', color: '#3A2A00', fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999 }}>{pend.length + pendingTerminalsCount}</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ flexShrink: 0, padding: 12, borderTop: '1px solid var(--c-side-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setPerfilAberto(true)} title="Perfil e segurança" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', padding: 0, textAlign: 'left' }}>
            <div style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', background: 'linear-gradient(135deg,#1D4ED8,#7DD3FC)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 13 }}>{initials((session?.user?.user_metadata as { full_name?: string } | undefined)?.full_name || 'SA')}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ color: 'var(--c-side-ink)', fontSize: 13, fontWeight: 600 }}>Super admin</div><div style={{ color: 'var(--c-side-ink3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session?.user.email}</div></div>
          </button>
          <button onClick={signOut} title="Sair" style={{ width: 32, height: 32, flex: 'none', borderRadius: 9, border: '1px solid var(--c-side-border)', background: 'transparent', color: 'var(--c-side-ink2)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><LogOut size={15} /></button>
        </div>
      </aside>

      {/* main */}
      <main style={{ minWidth: 0, overflowY: 'auto' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 30, minHeight: 64, background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
          <button className="ia-hamburger" onClick={() => setMenuOpen(true)} title="Menu" style={{ width: 38, height: 38, flex: 'none', borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer', placeItems: 'center' }}><Menu size={18} /></button>
          <div style={{ minWidth: 0 }}><h1 style={{ color: 'var(--c-ink)', fontSize: 19, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h1><div style={{ color: 'var(--c-ink3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div></div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="lp-hide-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--c-oksoft)', color: 'var(--c-okfg)', fontSize: 13, fontWeight: 600, padding: '8px 13px', borderRadius: 10, border: '1px solid var(--c-border)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--c-ok)' }} /> Sistema operacional</span>
            <button onClick={toggle} title="Tema" style={iconBtn}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
          </div>
        </div>

        <div className="ia-main-pad" style={{ maxWidth: 1200, margin: '0 auto', padding: 24, animation: 'ia-slide .25s ease' }}>
          {page === 'overview' && <Overview stats={stats} pend={pend} onGo={setPage} onApprove={(t) => setConfirm({ t, tipo: 'approve' })} />}
          {page === 'auth' && (
            <Auth
              pend={pend}
              terminalRequests={terminalRequests}
              onApprove={(t) => setConfirm({ t, tipo: 'approve' })}
              onReject={(t) => setConfirm({ t, tipo: 'suspend' })}
              onApproveTerminal={approveTerminal}
              onRejectTerminal={rejectTerminal}
            />
          )}
          {page === 'empresas' && <Empresas tenants={tenants} showToast={showToast} onReload={carregar} onAction={(t, tipo) => setConfirm({ t, tipo })} onVerPlano={() => setPage('planos')} />}
          {page === 'usuarios' && <Usuarios users={users} showToast={showToast} onReload={carregar} meId={session?.user?.id} />}
          {page === 'financeiro' && <Financeiro showToast={showToast} onVerPlano={() => setPage('planos')} />}
          {page === 'planos' && <Planos tenants={tenants} showToast={showToast} />}
          {page === 'infra' && <Infra />}
          {page === 'logs' && <Logs users={users} tenants={tenants} />}
          {page === 'regras' && <Regras showToast={showToast} />}
        </div>
      </main>

      {confirm && (
        <div onClick={() => setConfirm(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: '100%', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', padding: 26 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: confirm.tipo === 'approve' ? 'var(--c-soft)' : 'var(--c-errsoft)', display: 'grid', placeItems: 'center', color: confirm.tipo === 'approve' ? 'var(--c-blue)' : 'var(--c-err)' }}>{confirm.tipo === 'approve' ? <Check size={24} /> : <X size={24} />}</div>
            <h3 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, margin: '16px 0 0' }}>{confirm.tipo === 'approve' ? 'Autorizar esta conta?' : 'Recusar esta solicitação?'}</h3>
            <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>{confirm.tipo === 'approve' ? `${confirm.t.name} poderá rodar a automação imediatamente.` : `${confirm.t.name} ficará suspensa. Você pode reativar depois.`}</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={() => setConfirm(null)} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
              <button onClick={doConfirm} className="ia-btn" style={{ flex: 1, padding: 12, background: confirm.tipo === 'approve' ? 'var(--c-blued)' : 'var(--c-err)' }}>{confirm.tipo === 'approve' ? 'Autorizar' : 'Recusar'}</button>
            </div>
          </div>
        </div>
      )}
      {perfilAberto && <ProfileSecurity onClose={() => setPerfilAberto(false)} showToast={showToast} papelLabel="Super admin" />}
      <WhatsAppFab />
      <Toast data={toast} />
    </div>
  );
}
const iconBtn: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' };

function Card({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) { return <div className={className} style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 14, ...style }}>{children}</div>; }

/* ---- Mapa do Brasil (tile grid dos 27 estados) ------------------------- */
// [linha, coluna] aproximando a geografia do país (norte em cima, leste à direita).
const BRASIL_GRID: Record<string, [number, number]> = {
  RR: [0, 3], AP: [0, 5],
  AM: [1, 2], PA: [1, 4], MA: [1, 5], CE: [1, 6], RN: [1, 7],
  AC: [2, 1], RO: [2, 2], TO: [2, 4], PI: [2, 5], PE: [2, 6], PB: [2, 7],
  MT: [3, 3], DF: [3, 4], BA: [3, 5], SE: [3, 6], AL: [3, 7],
  MS: [4, 3], GO: [4, 4], MG: [4, 5], ES: [4, 6],
  SP: [5, 4], RJ: [5, 5],
  PR: [6, 4], SC: [6, 5],
  RS: [7, 4],
};
const UF_NOME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

interface MapaEstado { ativos: number; inativos: number; total: number; assinantes: { name: string; cidade: string | null; ativo: boolean; membros: { nome: string; online: boolean }[]; empresas?: string[]; realizandoAutomacao?: boolean }[] }
interface MapaResp { estados: Record<string, MapaEstado>; resumo: { total: number; ativos: number; inativos: number; sem_uf: number; estados_com_uso: number } }

function BrazilMap({ estados, maxAtivos, onHover, hover }: { estados: Record<string, MapaEstado>; maxAtivos: number; onHover: (uf: string | null) => void; hover: string | null }) {
  const CELL = 54, TILE = 48;
  const cols = 7, rows = 8;
  const corEstado = (uf: string): { bg: string; fg: string; bd: string } => {
    const e = estados[uf];
    if (!e || e.total === 0) return { bg: 'var(--c-surface2)', fg: 'var(--c-ink3)', bd: 'var(--c-border)' };
    if (e.ativos > 0) {
      const t = 0.28 + 0.62 * (maxAtivos > 0 ? e.ativos / maxAtivos : 1);
      return { bg: `color-mix(in srgb, var(--c-ok) ${Math.round(t * 100)}%, transparent)`, fg: '#04231a', bd: 'var(--c-ok)' };
    }
    return { bg: 'var(--c-warnsoft)', fg: 'var(--c-warnfg)', bd: 'var(--c-warn)' };
  };
  return (
    <div style={{ position: 'relative', width: cols * CELL, height: rows * CELL, margin: '0 auto' }}>
      {Object.entries(BRASIL_GRID).map(([uf, [r, c]]) => {
        const e = estados[uf];
        const col = corEstado(uf);
        const ativo = hover === uf;
        return (
          <div
            key={uf}
            onMouseEnter={() => onHover(uf)}
            onMouseLeave={() => onHover(null)}
            style={{ position: 'absolute', left: (c - 1) * CELL, top: r * CELL, width: TILE, height: TILE, borderRadius: 9, background: col.bg, border: `1.5px solid ${ativo ? 'var(--c-blue)' : col.bd}`, display: 'grid', placeItems: 'center', cursor: 'default', transition: 'transform .1s', transform: ativo ? 'scale(1.12)' : 'none', zIndex: ativo ? 5 : 1, boxShadow: ativo ? 'var(--c-shadow)' : 'none' }}
          >
            <span style={{ color: col.fg, fontSize: 12, fontWeight: 800, letterSpacing: '.02em' }}>{uf}</span>
            {e && e.total > 0 && <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999, background: e.ativos > 0 ? 'var(--c-ok)' : 'var(--c-warn)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{e.total}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Overview({ stats, pend, onGo, onApprove }: { stats: Stats | null; pend: T[]; onGo: (p: Page) => void; onApprove: (t: T) => void }) {
  const cards = [
    { label: 'Empresas ativas', value: fmt(stats?.empresasAtivas ?? 0), delta: 'na rede', icBg: 'var(--c-soft)', icFg: 'var(--c-blue)', icon: <Building2 size={18} /> },
    { label: 'Aguardando liberação', value: fmt(stats?.pendentes ?? 0), delta: 'pendentes', icBg: 'var(--c-warnsoft)', icFg: 'var(--c-warn)', icon: <ShieldCheck size={18} /> },
    { label: 'Total de empresas', value: fmt(stats?.totalEmpresas ?? 0), delta: 'cadastradas', icBg: 'var(--c-soft)', icFg: 'var(--c-blue)', icon: <Users size={18} /> },
    { label: 'Fichas na rede', value: fmt(stats?.fichasRede ?? 0), delta: 'total', icBg: 'var(--c-oksoft)', icFg: 'var(--c-ok)', icon: <Check size={18} /> },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="r-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        {cards.map((c) => (
          <Card key={c.label} style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ width: 36, height: 36, borderRadius: 10, background: c.icBg, color: c.icFg, display: 'grid', placeItems: 'center' }}>{c.icon}</span><span style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600 }}>{c.delta}</span></div>
            <div style={{ color: 'var(--c-ink)', fontSize: 28, fontWeight: 700, marginTop: 14 }}>{c.value}</div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 13 }}>{c.label}</div>
          </Card>
        ))}
      </div>
      <MapaBrasilSection onGo={onGo} />

      <Card style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: 'var(--c-ink)', fontSize: 15, fontWeight: 600 }}>Autorizações pendentes</span><span style={{ background: 'var(--c-warnsoft)', color: 'var(--c-warnfg)', fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }}>{pend.length}</span></div>
          <span onClick={() => onGo('auth')} className="ia-link" style={{ fontSize: 13, cursor: 'pointer' }}>Ver todas ›</span>
        </div>
        {pend.length === 0 ? <div style={{ padding: 34, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhuma autorização pendente. Tudo em dia.</div> : pend.slice(0, 5).map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 20px', borderBottom: '1px solid var(--c-border)' }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--c-soft)', color: 'var(--c-blue)', fontWeight: 700, fontSize: 13, display: 'grid', placeItems: 'center' }}>{initials(t.name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{t.name}</div><div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{t.cidade || '—'} · {t.responsavel || '—'}</div></div>
            <button onClick={() => onApprove(t)} className="ia-btn" style={{ padding: '8px 14px', fontSize: 13 }}>Autorizar</button>
          </div>
        ))}
      </Card>
    </div>
  );
}

function MapaBrasilSection({ onGo }: { onGo: (p: Page) => void }) {
  const [d, setD] = useState<MapaResp | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => { (async () => { try { setD(await apiGet<MapaResp>('/admin/mapa')); } catch { setD(null); } })(); }, []);

  const estados = d?.estados ?? {};
  const maxAtivos = Math.max(1, ...Object.values(estados).map((e) => e.ativos));
  const ranking = Object.entries(estados).sort((a, b) => b[1].total - a[1].total);
  const eHover = hover ? estados[hover] : null;

  return (
    <Card style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--c-border)', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ color: 'var(--c-ink)', fontSize: 15, fontWeight: 700 }}>Mapa de uso — Brasil</div>
          <div style={{ color: 'var(--c-ink3)', fontSize: 12.5, marginTop: 1 }}>Onde estão os assinantes, por estado. Passe o mouse num estado para detalhes.</div>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Legenda cor="var(--c-ok)" txt="ativos" />
          <Legenda cor="var(--c-warn)" txt="inativos" />
          <Legenda cor="var(--c-border)" txt="sem uso" />
          <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
            <button onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))} style={zoomBtn}>−</button>
            <button onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.25) * 100) / 100))} style={zoomBtn}>+</button>
          </div>
        </div>
      </div>

      <div className="r-split" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 0 }}>
        {/* Mapa com zoom */}
        <div style={{ position: 'relative', padding: 20, overflow: 'auto', maxHeight: 520, borderRight: '1px solid var(--c-border)' }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform .15s', width: 'fit-content', margin: '0 auto' }}>
            {d ? <BrazilMap estados={estados} maxAtivos={maxAtivos} onHover={setHover} hover={hover} /> : <div style={{ padding: 40, color: 'var(--c-ink3)' }}>Carregando mapa…</div>}
          </div>
          {zoom > 1 && <span style={{ position: 'absolute', bottom: 10, right: 14, color: 'var(--c-ink3)', fontSize: 11 }}>zoom {zoom.toFixed(2)}×</span>}
        </div>

        {/* Painel lateral: resumo + detalhe do estado sob o mouse + ranking */}
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 520, overflowY: 'auto' }}>
          <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <MiniStat label="Ativos" value={String(d?.resumo.ativos ?? 0)} tone="ok" />
            <MiniStat label="Inativos" value={String(d?.resumo.inativos ?? 0)} tone="warn" />
            <MiniStat label="Estados atendidos" value={String(d?.resumo.estados_com_uso ?? 0)} tone="accent" />
            <MiniStat label="Sem localização" value={String(d?.resumo.sem_uf ?? 0)} />
          </div>

          {eHover && hover ? (
            <div style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 14 }}>
              <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700 }}>{UF_NOME[hover]} <span style={{ color: 'var(--c-ink3)', fontWeight: 500 }}>({hover})</span></div>
              <div style={{ display: 'flex', gap: 14, margin: '6px 0 10px' }}>
                <span style={{ color: 'var(--c-okfg)', fontSize: 13, fontWeight: 700 }}>{eHover.ativos} ativo(s)</span>
                <span style={{ color: 'var(--c-warnfg)', fontSize: 13, fontWeight: 700 }}>{eHover.inativos} inativo(s)</span>
              </div>
              {eHover.assinantes.slice(0, 6).map((a, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0', borderBottom: i < eHover.assinantes.slice(0, 6).length - 1 ? '1px dashed var(--c-border)' : 'none' }}>
                  <style>{`
                    @keyframes ia-pulse-glowing {
                      0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); opacity: 0.8; }
                      50% { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); opacity: 1; }
                      100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); opacity: 0.8; }
                    }
                  `}</style>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.ativo ? 'var(--c-ok)' : 'var(--c-warn)', flex: 'none' }} />
                    <span style={{ color: 'var(--c-ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}{a.cidade ? ` · ${a.cidade}` : ''}</span>
                    {a.realizandoAutomacao && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        background: 'var(--c-oksoft)',
                        color: 'var(--c-okfg)',
                        padding: '2px 7px',
                        borderRadius: 999,
                        marginLeft: 'auto',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        flex: 'none'
                      }}>
                        <span style={{ 
                          width: 5, 
                          height: 5, 
                          borderRadius: '50%', 
                          background: 'var(--c-ok)', 
                          animation: 'ia-pulse-glowing 1.4s infinite' 
                        }} />
                        rodando
                      </span>
                    )}
                  </div>
                  {a.empresas && a.empresas.length > 0 && (
                    <div style={{ color: 'var(--c-ink3)', fontSize: 11.5, paddingLeft: 14, fontWeight: 500 }}>
                      Empresas: {a.empresas.join(', ')}
                    </div>
                  )}
                  {a.membros && a.membros.length > 0 && (
                    <div style={{ fontSize: 11, paddingLeft: 14, display: 'flex', flexWrap: 'wrap', gap: '4px 8px', marginTop: 3 }}>
                      {a.membros.map((m, idx) => (
                        <span key={idx} style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          gap: 4, 
                          color: m.online ? 'var(--c-okfg)' : 'var(--c-ink3)', 
                          fontWeight: m.online ? 700 : 400 
                        }}>
                          <span style={{ 
                            width: 5, 
                            height: 5, 
                            borderRadius: '50%', 
                            background: m.online ? 'var(--c-ok)' : '#7C808C',
                            boxShadow: m.online ? '0 0 3px var(--c-ok)' : 'none',
                            flex: 'none'
                          }} />
                          {m.nome}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Ranking por estado</div>
              {ranking.length === 0 ? (
                <div style={{ color: 'var(--c-ink3)', fontSize: 13, lineHeight: 1.6 }}>
                  Nenhum assinante com estado definido ainda. Abra um assinante em <span className="ia-link" style={{ cursor: 'pointer' }} onClick={() => onGo('empresas')}>Empresas</span> e informe a UF para ele aparecer no mapa.
                </div>
              ) : ranking.map(([uf, e]) => (
                <div key={uf} onMouseEnter={() => setHover(uf)} onMouseLeave={() => setHover(null)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--c-border)', cursor: 'default' }}>
                  <span style={{ width: 30, color: 'var(--c-ink)', fontSize: 13, fontWeight: 700 }}>{uf}</span>
                  <span style={{ flex: 1, color: 'var(--c-ink3)', fontSize: 12 }}>{UF_NOME[uf]}</span>
                  <span style={{ color: 'var(--c-okfg)', fontSize: 12, fontWeight: 700 }}>{e.ativos}</span>
                  <span style={{ color: 'var(--c-ink3)', fontSize: 12 }}>/</span>
                  <span style={{ color: 'var(--c-warnfg)', fontSize: 12, fontWeight: 700 }}>{e.inativos}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

const zoomBtn: CSSProperties = { width: 30, height: 30, borderRadius: 8, border: '1px solid var(--c-border)', background: 'var(--c-surface)', color: 'var(--c-ink)', cursor: 'pointer', fontSize: 17, fontWeight: 700, lineHeight: 1 };
function Legenda({ cor, txt }: { cor: string; txt: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--c-ink3)', fontSize: 12 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: cor }} />{txt}</span>;
}
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'accent' }) {
  const cor = tone === 'ok' ? 'var(--c-okfg)' : tone === 'warn' ? 'var(--c-warnfg)' : tone === 'accent' ? 'var(--c-softfg)' : 'var(--c-ink)';
  return (
    <div style={{ background: 'var(--c-surface2)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ color: cor, fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div style={{ color: 'var(--c-ink3)', fontSize: 11.5 }}>{label}</div>
    </div>
  );
}

function Auth({
  pend,
  terminalRequests,
  onApprove,
  onReject,
  onApproveTerminal,
  onRejectTerminal
}: {
  pend: T[];
  terminalRequests: TerminalRequest[];
  onApprove: (t: T) => void;
  onReject: (t: T) => void;
  onApproveTerminal: (r: TerminalRequest) => void;
  onRejectTerminal: (r: TerminalRequest) => void;
}) {
  const pendingTerminals = terminalRequests.filter(r => r.status === 'pending');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Novos Clientes */}
      <div>
        <h3 style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>Novos Clientes (Onboarding)</h3>
        <p style={{ color: 'var(--c-ink2)', fontSize: 13, margin: '0 0 14px', maxWidth: 620 }}>Contas que concluíram o onboarding e aguardam liberação para a IA começar a cadastrar. Revise antes de autorizar.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {pend.length === 0 ? (
            <Card style={{ padding: 26, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhum novo cliente aguardando liberação.</Card>
          ) : pend.map((t) => (
            <Card key={t.id} style={{ padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--c-soft)', color: 'var(--c-blue)', fontWeight: 700, fontSize: 15, display: 'grid', placeItems: 'center' }}>{initials(t.name)}</div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span style={{ color: 'var(--c-ink)', fontSize: 17, fontWeight: 700 }}>{t.name}</span><span style={{ background: 'var(--c-warnsoft)', color: 'var(--c-warnfg)', fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999 }}>aguardando</span></div>
                  <div style={{ color: 'var(--c-ink3)', fontSize: 13, marginTop: 3 }}>{t.responsavel || '—'} · {t.cidade || '—'} · solicitado {new Date(t.created_at).toLocaleDateString('pt-BR')}</div>
                  <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--c-ink2)', fontSize: 13 }}><Check size={15} style={{ color: 'var(--c-ok)' }} /> CMD-COLETA conectado</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--c-ink2)', fontSize: 13 }}><Check size={15} style={{ color: 'var(--c-ok)' }} /> 2FA recebido</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button onClick={() => onReject(t)} className="ia-btn-outline">Recusar</button>
                  <button onClick={() => onApprove(t)} className="ia-btn" style={{ padding: '11px 20px' }}><Check size={16} /> Autorizar acesso</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Solicitações de terminais */}
      <div>
        <h3 style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>Solicitações de Novos Terminais</h3>
        <p style={{ color: 'var(--c-ink2)', fontSize: 13, margin: '0 0 14px', maxWidth: 620 }}>Assinantes que solicitaram a liberação de mais um terminal de automação (cota de contas CMD-COLETA).</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {pendingTerminals.length === 0 ? (
            <Card style={{ padding: 26, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhuma solicitação de terminal pendente.</Card>
          ) : pendingTerminals.map((r) => (
            <Card key={r.id} style={{ padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--c-soft)', color: 'var(--c-warnfg)', fontWeight: 700, fontSize: 15, display: 'grid', placeItems: 'center' }}><Cpu size={20} /></div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span style={{ color: 'var(--c-ink)', fontSize: 17, fontWeight: 700 }}>{r.tenants?.name || 'Assinante'}</span><span style={{ background: 'var(--c-warnsoft)', color: 'var(--c-warnfg)', fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999 }}>pendente</span></div>
                  <div style={{ color: 'var(--c-ink3)', fontSize: 13, marginTop: 3 }}>
                    Solicitado em {new Date(r.created_at).toLocaleDateString('pt-BR')} às {new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button onClick={() => onRejectTerminal(r)} className="ia-btn-outline">Recusar</button>
                  <button onClick={() => onApproveTerminal(r)} className="ia-btn" style={{ padding: '11px 20px' }}><Check size={16} /> Liberar Terminal</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function statusPill(s: string) {
  if (s === 'active') return { fg: 'var(--c-okfg)', bg: 'var(--c-oksoft)', dot: 'var(--c-ok)', label: 'Ativa' };
  if (s === 'pending_approval') return { fg: 'var(--c-warnfg)', bg: 'var(--c-warnsoft)', dot: 'var(--c-warn)', label: 'Aguardando' };
  return { fg: 'var(--c-err)', bg: 'var(--c-errsoft)', dot: 'var(--c-err)', label: 'Suspensa' };
}

function Empresas({ tenants, showToast, onReload, onAction, onVerPlano }: { tenants: T[]; showToast: (t: ToastData) => void; onReload: () => Promise<void>; onAction: (t: T, tipo: 'approve' | 'suspend') => void; onVerPlano: () => void }) {
  const [status, setStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<number | null>(null);

  const filtrados = tenants.filter((t) => {
    if (status !== 'todos' && t.status !== status) return false;
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      const hasMemberMatch = t.membros?.some((m) =>
        `${m.nome || ''} ${m.email}`.toLowerCase().includes(q)
      );
      if (
        !(`${t.name} ${t.responsavel ?? ''} ${t.cidade ?? ''}`.toLowerCase().includes(q)) &&
        !hasMemberMatch
      ) {
        return false;
      }
    }
    return true;
  });
  const cont = (s: string) => tenants.filter((t) => t.status === s).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filtros */}
      <Card style={{ padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {([['todos', `Todos (${tenants.length})`], ['active', `Ativos (${cont('active')})`], ['pending_approval', `Pendentes (${cont('pending_approval')})`], ['suspended', `Suspensos (${cont('suspended')})`]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setStatus(k)} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: status === k ? 700 : 500, padding: '6px 12px', borderRadius: 8, background: status === k ? 'var(--c-soft)' : 'var(--c-surface2)', color: status === k ? 'var(--c-softfg)' : 'var(--c-ink3)' }}>{lbl}</button>
          ))}
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, responsável, cidade ou operador…" className="ia-input" style={{ flex: '1 1 200px', minWidth: 180, height: 38, fontSize: 13, marginLeft: 'auto' }} />
        </div>
      </Card>

      <Card className="r-scroll-x" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr .9fr 120px 150px', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)', fontSize: 12, fontWeight: 600, color: 'var(--c-ink3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <span>Empresa</span><span>Responsável</span><span>Cidade</span><span>Status</span><span style={{ textAlign: 'right' }}>Ações</span>
        </div>
        {filtrados.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-ink3)' }}>Nenhuma empresa neste filtro.</div> : filtrados.map((t) => {
          const p = statusPill(t.status);
          return (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr .9fr 120px 150px', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--c-border)', alignItems: 'center' }}>
              <button onClick={() => setAberto(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--c-soft)', color: 'var(--c-blue)', fontWeight: 700, fontSize: 12, display: 'grid', placeItems: 'center', flex: 'none' }}>{initials(t.name)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  {t.membros && t.membros.length > 0 && (
                    <span style={{ color: 'var(--c-ink3)', fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Operadores: {t.membros.map((m) => m.nome || m.email.split('@')[0]).join(', ')}
                    </span>
                  )}
                </div>
              </button>
              <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>{t.responsavel || '—'}</span>
              <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>{t.cidade || '—'}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: p.fg, background: p.bg, fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 999, justifySelf: 'start' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot }} />{p.label}</span>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => setAberto(t.id)} className="ia-btn-outline" style={{ padding: '0 10px', height: 30, fontSize: 12 }}>Detalhes</button>
                {t.status !== 'active'
                  ? <button onClick={() => onAction(t, 'approve')} className="ia-btn-outline" style={{ padding: '0 10px', height: 30, fontSize: 12, color: 'var(--c-okfg)' }}>Liberar</button>
                  : <button onClick={() => onAction(t, 'suspend')} className="ia-btn-outline" style={{ padding: '0 10px', height: 30, fontSize: 12, color: 'var(--c-errfg)' }}>Suspender</button>}
              </div>
            </div>
          );
        })}
      </Card>

      {aberto != null && <EmpresaModal tenantId={aberto} onClose={() => setAberto(null)} showToast={showToast} onReload={onReload} onVerPlano={onVerPlano} />}
    </div>
  );
}

/* ---- Dossiê da empresa (modal) ----------------------------------------- */
interface Dossie {
  tenant: { id: number; name: string; status: string; cnpj: string | null; responsavel: string | null; telefone: string | null; cidade: string | null; uf: string | null; created_at: string; valor_terminal: number; valor_implantacao: number; implantacao_paga: boolean };
  plano: { mensal: number; total_terminais: number; nao_alocados: number; valor_terminal: number; valor_implantacao: number; implantacao_paga: boolean; empresas: { id: number; nome: string; terminais: number; mensal: number }[] } | null;
  resumo: { envios_total: number; envios_concluidos: number; cadastrados: number; erros: number; encontrados: number; taxa_pct: number; tempo_ativo_segundos: number; terminais_conectados: number; em_aberto: number; vencido: number; inadimplente: boolean; proxima_vencimento: { descricao: string; valor: number; vencimento: string; vencida: boolean } | null };
  faturas: { id: number; tipo: string; descricao: string | null; referencia: string; valor: number; vencimento: string; status: string; empresa_nome: string | null; vencida: boolean }[];
  terminais: { id: number; label: string | null; cmd_username: string | null; cmd_password?: string | null; mfa_secret?: string | null; is_enabled: boolean; empresa_nome: string | null; membro_nome: string | null; last_run_at: string | null; last_run_status: string | null; cid_padrao: string | null; cid_oci_0_8?: string | null; cid_9_mais?: string | null }[];
  envios: { id: number; nome: string; status: string; empresa_nome: string | null; uploaded_at: string; encontrados: number; cadastrados: number; erros: number; concluido_em: string | null; retry_rounds: number; tempo_ativo_segundos: number }[];
  membros: { id: number; user_id: string; nome: string | null; email: string; role: string; empresa_id: number | null; cmd_conectado?: boolean }[];
  atividades: { id: number; categoria: string; acao: string; descricao: string; nivel: string; actor_nome: string | null; criado_em: string }[];
}
type AbaDossie = 'geral' | 'onboarding' | 'membros' | 'faturas' | 'terminais' | 'envios' | 'atividades';

const dmy = (iso: string | null) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
const dmyHora = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return `${dmy(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const duracao = (seg: number) => { const h = Math.floor(seg / 3600); const m = Math.floor((seg % 3600) / 60); return h > 0 ? `${h}h ${m}min` : `${m}min`; };

function EmpresaModal({ tenantId, onClose, showToast, onReload, onVerPlano }: { tenantId: number; onClose: () => void; showToast: (t: ToastData) => void; onReload: () => Promise<void>; onVerPlano: () => void }) {
  const [d, setD] = useState<Dossie | null>(null);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<AbaDossie>('geral');
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try { setD(await apiGet<Dossie>(`/admin/tenants/${tenantId}/dossie`)); }
    catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); }
    finally { setLoading(false); }
  }, [tenantId, showToast]);
  useEffect(() => { void carregar(); }, [carregar]);

  const mudarStatus = async (tipo: 'approve' | 'suspend') => {
    setBusy(true);
    try {
      await apiPost(`/admin/tenants/${tenantId}/${tipo}`, {});
      await Promise.all([carregar(), onReload()]);
      showToast({ title: tipo === 'approve' ? 'Assinante liberado' : 'Assinante suspenso', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(false); }
  };

  const t = d?.tenant;
  const p = t ? statusPill(t.status) : null;
  const ABAS: [AbaDossie, string][] = [
    ['geral', 'Visão geral'],
    ['onboarding', 'Dados do Onboarding'],
    ['membros', `Operadores${d ? ` (${d.membros.length})` : ''}`],
    ['faturas', `Faturas${d ? ` (${d.faturas.length})` : ''}`],
    ['terminais', `Terminais${d ? ` (${d.terminais.length})` : ''}`],
    ['envios', `Envios${d ? ` (${d.envios.length})` : ''}`],
    ['atividades', `Atividades${d ? ` (${d.atividades.length})` : ''}`]
  ];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 940, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', overflow: 'hidden' }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 22px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--c-soft)', color: 'var(--c-blue)', fontWeight: 700, fontSize: 15, display: 'grid', placeItems: 'center', flex: 'none' }}>{initials(t?.name ?? '…')}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'var(--c-ink)', fontSize: 18, fontWeight: 700 }}>{t?.name ?? 'Carregando…'}</span>
              {p && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: p.fg, background: p.bg, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot }} />{p.label}</span>}
              {d?.resumo.inadimplente && <span style={{ color: 'var(--c-errfg)', background: 'var(--c-errsoft)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>inadimplente</span>}
            </div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12.5, marginTop: 2 }}>{t?.cnpj || 'sem CNPJ'} · cliente desde {dmy(t?.created_at ?? null)}</div>
          </div>
          {t && (t.status !== 'active'
            ? <button onClick={() => mudarStatus('approve')} disabled={busy} className="ia-btn-outline" style={{ height: 34, padding: '0 12px', fontSize: 13, color: 'var(--c-okfg)' }}>Liberar</button>
            : <button onClick={() => mudarStatus('suspend')} disabled={busy} className="ia-btn-outline" style={{ height: 34, padding: '0 12px', fontSize: 13, color: 'var(--c-errfg)' }}>Suspender</button>)}
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer', display: 'grid', placeItems: 'center', flex: 'none' }}><X size={18} /></button>
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 18px 0', borderBottom: '1px solid var(--c-border)', overflowX: 'auto' }}>
          {ABAS.map(([k, lbl]) => (
            <button key={k} onClick={() => setAba(k)} style={{ border: 'none', borderBottom: aba === k ? '2px solid var(--c-blue)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: aba === k ? 700 : 500, padding: '8px 12px', background: 'transparent', color: aba === k ? 'var(--c-ink)' : 'var(--c-ink3)', whiteSpace: 'nowrap' }}>{lbl}</button>
          ))}
        </div>

        {/* Corpo */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          {loading || !d ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-ink3)' }}>Carregando dossiê…</div> : (
            <>
              {aba === 'geral' && <DossieGeral d={d} onVerPlano={() => { onClose(); onVerPlano(); }} onSaved={carregar} showToast={showToast} />}
              {aba === 'onboarding' && <DossieOnboarding d={d} showToast={showToast} />}
              {aba === 'membros' && <DossieMembros membros={d.membros} plano={d.plano} />}
              {aba === 'faturas' && <DossieFaturas faturas={d.faturas} />}
              {aba === 'terminais' && <DossieTerminais terminais={d.terminais} />}
              {aba === 'envios' && <DossieEnvios envios={d.envios} />}
              {aba === 'atividades' && <DossieAtividades atividades={d.atividades} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const UF_LISTA = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

function DossieGeral({ d, onVerPlano, onSaved, showToast }: { d: Dossie; onVerPlano: () => void; onSaved: () => Promise<void>; showToast: (t: ToastData) => void }) {
  const r = d.resumo; const t = d.tenant;
  const [uf, setUf] = useState(t.uf ?? '');
  const [cidade, setCidade] = useState(t.cidade ?? '');
  const [savingLocal, setSavingLocal] = useState(false);
  const localMudou = (uf || '') !== (t.uf ?? '') || (cidade || '') !== (t.cidade ?? '');

  const salvarLocal = async () => {
    setSavingLocal(true);
    try {
      await apiPatch(`/admin/tenants/${t.id}/local`, { uf: uf || null, cidade: cidade || null });
      await onSaved();
      showToast({ title: 'Localização salva', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setSavingLocal(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="r-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        <Kpi label="Cadastros feitos" value={String(r.cadastrados)} tone="ok" sub={`${r.envios_total} envio(s)`} />
        <Kpi label="Taxa de acerto" value={`${r.taxa_pct}%`} tone={r.taxa_pct >= 95 ? 'ok' : 'warn'} sub={`${r.erros} erro(s)`} />
        <Kpi label="Terminais conectados" value={String(r.terminais_conectados)} tone="accent" sub={`${d.plano?.total_terminais ?? 0} contratado(s)`} />
        <Kpi label="Tempo em automação" value={duracao(r.tempo_ativo_segundos)} />
      </div>

      <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Dados</div>
          <InfoLinha k="Responsável" v={t.responsavel || '—'} />
          <InfoLinha k="Telefone" v={t.telefone || '—'} />
          <InfoLinha k="CNPJ" v={t.cnpj || '—'} />
          <InfoLinha k="Cliente desde" v={dmy(t.created_at)} />
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c-border)' }}>
            <div style={{ color: 'var(--c-ink3)', fontSize: 11.5, fontWeight: 600, marginBottom: 7 }}>Localização (aparece no mapa do Brasil)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={uf} onChange={(e) => setUf(e.target.value)} className="ia-input" style={{ width: 92, flex: 'none' }}>
                <option value="">UF</option>
                {UF_LISTA.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Cidade" className="ia-input" style={{ flex: 1 }} />
              <button onClick={salvarLocal} disabled={savingLocal || !localMudou} className="ia-btn-outline" style={{ padding: '0 12px', flex: 'none' }}>{savingLocal ? '…' : 'Salvar'}</button>
            </div>
          </div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Plano &amp; vencimentos</span>
            <button onClick={onVerPlano} className="ia-btn-outline" style={{ height: 28, padding: '0 10px', fontSize: 12 }}>Gerir plano</button>
          </div>
          <InfoLinha k="Mensalidade" v={brl(d.plano?.mensal ?? 0)} />
          <InfoLinha k="Terminais" v={`${d.plano?.total_terminais ?? 0}${(d.plano?.nao_alocados ?? 0) > 0 ? ` (${d.plano?.nao_alocados} não alocado)` : ''}`} />
          <InfoLinha k="Implantação" v={`${brl(t.valor_implantacao)} · ${t.implantacao_paga ? 'paga' : 'pendente'}`} />
          <InfoLinha k="Em aberto" v={brl(r.em_aberto)} cor={r.em_aberto > 0 ? 'var(--c-warnfg)' : undefined} />
          <InfoLinha k="Vencido" v={brl(r.vencido)} cor={r.vencido > 0 ? 'var(--c-errfg)' : undefined} />
          {r.proxima_vencimento && <InfoLinha k="Próxima fatura" v={`${brl(r.proxima_vencimento.valor)} · vence ${dmy(r.proxima_vencimento.vencimento)}`} cor={r.proxima_vencimento.vencida ? 'var(--c-errfg)' : undefined} />}
        </Card>
      </div>
    </div>
  );
}

function InfoLinha({ k, v, cor }: { k: string; v: string; cor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--c-border)' }}>
      <span style={{ color: 'var(--c-ink3)', fontSize: 13 }}>{k}</span>
      <span style={{ color: cor ?? 'var(--c-ink)', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function DossieOnboarding({ d, showToast }: { d: Dossie; showToast: (t: ToastData) => void }) {
  const t = d.tenant;
  const t0 = d.terminais[0] || null; // O terminal inicial cadastrado no onboarding
  const [verSenha, setVerSenha] = useState(false);
  const [verMfa, setVerMfa] = useState(false);

  const copiar = (texto: string, desc: string) => {
    navigator.clipboard.writeText(texto);
    showToast({ title: 'Copiado', msg: `${desc} copiado para a área de transferência.`, kind: 'ok' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 14 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
            🏢 DADOS CADASTRAIS DA CLÍNICA
          </div>
          <InfoLinha k="Nome da Clínica" v={t.name || '—'} />
          <InfoLinha k="CPF ou CNPJ" v={t.cnpj || '—'} />
          <InfoLinha k="Responsável" v={t.responsavel || '—'} />
          <InfoLinha k="Telefone / WhatsApp" v={t.telefone || '—'} />
          <InfoLinha k="Cidade / UF" v={t.cidade ? `${t.cidade} / ${t.uf || ''}` : '—'} />
          <InfoLinha k="Data de Cadastro" v={dmy(t.created_at)} />
        </Card>

        <Card style={{ padding: 16 }}>
          <div style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
            🤖 CONTA DE AUTOMAÇÃO INICIAL (CMD)
          </div>
          {t0 ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <InfoLinha k="Identificador (Label)" v={t0.label || '—'} />
              <InfoLinha k="Usuário CMD-COLETA" v={t0.cmd_username || '—'} />
              
              {/* Senha CMD */}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--c-border)', alignItems: 'center' }}>
                <span style={{ color: 'var(--c-ink3)', fontSize: 13 }}>Senha CMD-COLETA</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--c-ink)', fontSize: 13, fontWeight: 600, fontFamily: verSenha ? 'monospace' : 'inherit' }}>
                    {verSenha ? (t0.cmd_password || '—') : '••••••••'}
                  </span>
                  {t0.cmd_password && (
                    <>
                      <button onClick={() => setVerSenha(!verSenha)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--c-ink3)', display: 'grid', placeItems: 'center', padding: 2 }}>
                        {verSenha ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button onClick={() => copiar(t0.cmd_password || '', 'Senha')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--c-ink3)', display: 'grid', placeItems: 'center', padding: 2 }}>
                        <Copy size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Chave 2FA */}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--c-border)', alignItems: 'center' }}>
                <span style={{ color: 'var(--c-ink3)', fontSize: 13 }}>Chave 2FA (MFA Secret)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="ia-mono" style={{ color: 'var(--c-ink)', fontSize: 12, fontWeight: 600 }}>
                    {verMfa ? (t0.mfa_secret || '—') : '••••••••'}
                  </span>
                  {t0.mfa_secret && (
                    <>
                      <button onClick={() => setVerMfa(!verMfa)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--c-ink3)', display: 'grid', placeItems: 'center', padding: 2 }}>
                        {verMfa ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button onClick={() => copiar(t0.mfa_secret || '', 'Chave 2FA')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--c-ink3)', display: 'grid', placeItems: 'center', padding: 2 }}>
                        <Copy size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Parâmetros de CID */}
              <InfoLinha k="CID OCI (0 a 8 anos)" v={t0.cid_oci_0_8 || 'Não configurado'} />
              <InfoLinha k="CID (Acima de 9 anos)" v={t0.cid_9_mais || 'Não configurado'} />
              <InfoLinha k="CID Padrão" v={t0.cid_padrao || 'Não configurado'} />
            </div>
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-ink3)', fontSize: 13 }}>
              Nenhuma credencial/terminal CMD cadastrada no onboarding.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function DossieFaturas({ faturas }: { faturas: Dossie['faturas'] }) {
  if (faturas.length === 0) return <Vazio>Nenhuma fatura emitida.</Vazio>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {faturas.map((f) => {
        const cor = f.status === 'pago' ? 'var(--c-okfg)' : f.vencida ? 'var(--c-errfg)' : 'var(--c-ink3)';
        return (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 4px', borderBottom: '1px solid var(--c-border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{f.descricao || f.tipo}</div>
              <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>ref {f.referencia} · vence {dmy(f.vencimento)}{f.empresa_nome ? ` · ${f.empresa_nome}` : ''}</div>
            </div>
            <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700, width: 100, textAlign: 'right' }}>{brl(f.valor)}</span>
            <span style={{ width: 74, textAlign: 'center', fontSize: 12, fontWeight: 700, color: cor }}>{f.status === 'pago' ? 'pago' : f.vencida ? 'vencida' : 'aberto'}</span>
          </div>
        );
      })}
    </div>
  );
}

function DossieMembros({ membros, plano }: { membros: Dossie['membros']; plano: Dossie['plano'] }) {
  if (membros.length === 0) return <Vazio>Nenhum operador cadastrado.</Vazio>;
 
  const empNomes = new Map<number, string>();
  for (const e of plano?.empresas ?? []) empNomes.set(e.id, e.nome);
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {membros.map((m) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 4px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#2563EB,#38BDF8)', color: '#fff', fontWeight: 700, fontSize: 12, display: 'grid', placeItems: 'center', flex: 'none' }}>{initials(m.nome || m.email)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{m.nome || m.email.split('@')[0]}</div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>
              {m.email} · Empresa: <strong>{m.empresa_id ? (empNomes.get(m.empresa_id) || 'Carregando...') : 'Todas'}</strong>
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: m.role === 'admin' ? 'var(--c-warnfg)' : 'var(--c-softfg)', background: m.role === 'admin' ? 'var(--c-warnsoft)' : 'var(--c-soft)', padding: '3px 10px', borderRadius: 999 }}>
            {m.role === 'admin' ? 'Admin' : 'Operador'}
          </span>
        </div>
      ))}
    </div>
  );
}
 
function DossieTerminais({ terminais }: { terminais: Dossie['terminais'] }) {
  if (terminais.length === 0) return <Vazio>Nenhum terminal (login CMD) conectado.</Vazio>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {terminais.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 4px', borderBottom: '1px solid var(--c-border)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: t.is_enabled ? 'var(--c-ok)' : 'var(--c-ink3)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{t.label || t.cmd_username || `terminal #${t.id}`}</div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>
              {t.empresa_nome || 'sem empresa'}
              {t.membro_nome ? ` · Operador: ${t.membro_nome}` : ' · Livre para todos'}
              {t.cid_padrao ? ` · CID ${t.cid_padrao}` : ''}
              {' · última execução ' + dmyHora(t.last_run_at)}
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: t.is_enabled ? 'var(--c-okfg)' : 'var(--c-ink3)' }}>{t.is_enabled ? 'ativo' : 'desativado'}</span>
        </div>
      ))}
    </div>
  );
}

function DossieEnvios({ envios }: { envios: Dossie['envios'] }) {
  if (envios.length === 0) return <Vazio>Nenhum envio (lista) importado.</Vazio>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {envios.map((e) => {
        const base = e.cadastrados + e.erros;
        const taxa = base > 0 ? Math.round((e.cadastrados / base) * 100) : 0;
        const concluido = !!e.concluido_em;
        return (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 4px', borderBottom: '1px solid var(--c-border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.nome}</div>
              <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{e.empresa_nome || '—'} · {dmy(e.uploaded_at)}{e.retry_rounds > 0 ? ` · ${e.retry_rounds} rodada(s) de retry` : ''}{e.tempo_ativo_segundos > 0 ? ` · ${duracao(e.tempo_ativo_segundos)}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right', width: 130, flex: 'none' }}>
              <div style={{ color: 'var(--c-ink)', fontSize: 13, fontWeight: 700 }}>{e.cadastrados}/{e.encontrados || base} <span style={{ color: 'var(--c-ink3)', fontWeight: 500 }}>cadastrados</span></div>
              <div style={{ fontSize: 12, color: e.erros > 0 ? 'var(--c-warnfg)' : 'var(--c-ink3)' }}>{e.erros} erro(s) · {taxa}%</div>
            </div>
            <span style={{ width: 88, textAlign: 'center', fontSize: 12, fontWeight: 700, color: concluido ? 'var(--c-okfg)' : 'var(--c-softfg)' }}>{concluido ? 'concluído' : e.status}</span>
          </div>
        );
      })}
    </div>
  );
}

function DossieAtividades({ atividades }: { atividades: Dossie['atividades'] }) {
  if (atividades.length === 0) return <Vazio>Nenhuma atividade registrada.</Vazio>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {atividades.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 12, padding: '10px 4px', borderBottom: '1px solid var(--c-border)' }}>
          <span style={{ width: 4, flex: 'none', borderRadius: 2, background: nivelCor(a.nivel), alignSelf: 'stretch' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--c-ink)', fontSize: 13.5 }}>{a.descricao}</div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 2 }}><span style={{ color: catCor(a.categoria), fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>{a.categoria}</span> · {dmyHora(a.criado_em)}{a.actor_nome ? ` · ${a.actor_nome}` : ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>{children}</div>;
}

function Usuarios({ users, showToast, onReload, meId }: { users: U[]; showToast: (t: ToastData) => void; onReload: () => Promise<void>; meId?: string }) {
  const [papel, setPapel] = useState('todos');
  const [status, setStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [filtroEmpresa, setFiltroEmpresa] = useState('');
  const [editar, setEditar] = useState<U | 'novo' | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [link, setLink] = useState<{ titulo: string; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const filtrados = users.filter((u) => {
    if (papel !== 'todos' && u.role_key !== papel) return false;
    if (status === 'ativos' && !u.ativo) return false;
    if (status === 'bloqueados' && u.ativo) return false;
    if (filtroEmpresa && u.empresa !== filtroEmpresa) return false;
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      const matchTags = u.empresas_list?.some((tag) => tag.toLowerCase().includes(q));
      if (!`${u.nome} ${u.email} ${u.empresa}`.toLowerCase().includes(q) && !matchTags) return false;
    }
    return true;
  });

  const acao = async (u: U, tipo: 'bloquear' | 'desbloquear' | 'reset' | 'excluir') => {
    setMenu(null); setBusy(u.id);
    try {
      if (tipo === 'bloquear' || tipo === 'desbloquear') {
        await apiPost(`/admin/users/${u.id}/acesso`, { ativo: tipo === 'desbloquear' });
        showToast({ title: tipo === 'desbloquear' ? 'Acesso liberado' : 'Acesso bloqueado', msg: u.email, kind: 'ok' });
      } else if (tipo === 'reset') {
        const r = await apiPost<{ link: string | null }>(`/admin/users/${u.id}/senha`, {});
        if (r.link) setLink({ titulo: `Link de redefinição de senha — ${u.email}`, url: r.link });
        else showToast({ title: 'Link gerado', msg: 'Enviado por e-mail.', kind: 'ok' });
      } else if (tipo === 'excluir') {
        if (!window.confirm(`Excluir o usuário ${u.email}? Esta ação é irreversível.`)) { setBusy(null); return; }
        await apiDelete(`/admin/users/${u.id}`);
        showToast({ title: 'Usuário excluído', msg: u.email, kind: 'ok' });
      }
      await onReload();
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(null); }
  };

  const cont = (fn: (u: U) => boolean) => users.filter(fn).length;
  const uniqueEmpresas = Array.from(new Set(users.map((u) => u.empresa).filter((emp) => emp && emp !== '—')));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onClick={() => setMenu(null)}>
      {/* Filtros + novo */}
      <Card style={{ padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {([['todos', `Todos (${users.length})`], ['admin', `Admins (${cont((u) => u.role_key === 'admin')})`], ['super_admin', `Super admins (${cont((u) => u.role_key === 'super_admin')})`]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setPapel(k)} style={pillBtn(papel === k)}>{lbl}</button>
          ))}
          <span style={{ width: 1, height: 22, background: 'var(--c-border)', margin: '0 2px' }} />
          {([['todos', 'Todos'], ['ativos', `Ativos (${cont((u) => u.ativo)})`], ['bloqueados', `Bloqueados (${cont((u) => !u.ativo)})`]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setStatus(k)} style={pillBtn(status === k)}>{lbl}</button>
          ))}
          
          <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} className="ia-input" style={{ width: 180, height: 38, fontSize: 13, padding: '0 8px', borderRadius: 8 }}>
            <option value="">Todas as empresas</option>
            {uniqueEmpresas.map((emp) => (
              <option key={emp} value={emp}>{emp}</option>
            ))}
          </select>

          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, e-mail, empresa ou tag…" className="ia-input" style={{ flex: '1 1 180px', minWidth: 160, height: 38, fontSize: 13 }} />
          <button onClick={() => setEditar('novo')} className="ia-btn" style={{ height: 38, padding: '0 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7 }}><UserPlus size={16} /> Novo usuário</button>
        </div>
      </Card>

      <Card className="r-scroll-x" style={{ overflow: 'visible' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.1fr 120px 120px 46px', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)', fontSize: 12, fontWeight: 600, color: 'var(--c-ink3)', textTransform: 'uppercase', letterSpacing: '.04em', borderRadius: '14px 14px 0 0' }}>
          <span>Usuário</span><span>Empresa / Tags</span><span>Papel</span><span>Status</span><span />
        </div>
        {filtrados.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-ink3)' }}>Nenhum usuário neste filtro.</div> : filtrados.map((u) => (
          <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.1fr 120px 120px 46px', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--c-border)', alignItems: 'center', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#2563EB,#38BDF8)', color: '#fff', fontWeight: 700, fontSize: 12, display: 'grid', placeItems: 'center', flex: 'none' }}>{initials(u.nome)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{u.nome}{u.id === meId && <span style={{ color: 'var(--c-ink3)', fontWeight: 500, fontSize: 12 }}> · você</span>}</div>
                <div className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ color: 'var(--c-ink2)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.empresa}</span>
              {u.empresas_list && u.empresas_list.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {u.empresas_list.map((empName) => (
                    <span key={empName} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--c-soft)', color: 'var(--c-softfg)' }}>
                      {empName}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span style={{ color: u.role_key === 'super_admin' ? 'var(--c-warnfg)' : 'var(--c-softfg)', background: u.role_key === 'super_admin' ? 'var(--c-warnsoft)' : 'var(--c-soft)', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, justifySelf: 'start' }}>{u.role}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: u.ativo ? 'var(--c-okfg)' : 'var(--c-errfg)', fontSize: 12, fontWeight: 600 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: u.ativo ? 'var(--c-ok)' : 'var(--c-err)' }} />{u.ativo ? 'Ativo' : 'Bloqueado'}</span>
            <div style={{ justifySelf: 'end', position: 'relative' }}>
              <button onClick={(e) => { e.stopPropagation(); setMenu(menu === u.id ? null : u.id); }} disabled={busy === u.id} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink2)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>{busy === u.id ? <Loader2 size={15} style={{ animation: 'ia-spin .8s linear infinite' }} /> : <MoreVertical size={16} />}</button>
              {menu === u.id && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 36, right: 0, zIndex: 40, width: 210, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 12, boxShadow: 'var(--c-shadow)', overflow: 'hidden', padding: 4 }}>
                  <MenuItem icon={<Pencil size={15} />} onClick={() => { setMenu(null); setEditar(u); }}>Editar nome / papel</MenuItem>
                  <MenuItem icon={<KeyRound size={15} />} onClick={() => acao(u, 'reset')}>Redefinir senha</MenuItem>
                  {u.ativo
                    ? <MenuItem icon={<Ban size={15} />} onClick={() => acao(u, 'bloquear')} tone="warn" disabled={u.id === meId}>Bloquear acesso</MenuItem>
                    : <MenuItem icon={<Check size={15} />} onClick={() => acao(u, 'desbloquear')} tone="ok">Desbloquear acesso</MenuItem>}
                  <MenuItem icon={<Trash2 size={15} />} onClick={() => acao(u, 'excluir')} tone="err" disabled={u.id === meId}>Excluir usuário</MenuItem>
                </div>
              )}
            </div>
          </div>
        ))}
      </Card>

      {editar && <UserModal alvo={editar} onClose={() => setEditar(null)} showToast={showToast} onReload={onReload} onLink={setLink} />}
      {link && <LinkModal titulo={link.titulo} url={link.url} onClose={() => setLink(null)} showToast={showToast} />}
    </div>
  );
}

const pillBtn = (on: boolean): CSSProperties => ({ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 500, padding: '6px 12px', borderRadius: 8, background: on ? 'var(--c-soft)' : 'var(--c-surface2)', color: on ? 'var(--c-softfg)' : 'var(--c-ink3)' });

function MenuItem({ icon, children, onClick, tone, disabled }: { icon: ReactNode; children: ReactNode; onClick: () => void; tone?: 'ok' | 'warn' | 'err'; disabled?: boolean }) {
  const cor = disabled ? 'var(--c-ink3)' : tone === 'err' ? 'var(--c-errfg)' : tone === 'warn' ? 'var(--c-warnfg)' : tone === 'ok' ? 'var(--c-okfg)' : 'var(--c-ink2)';
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '9px 10px', border: 'none', background: 'transparent', color: cor, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 13.5, borderRadius: 8, opacity: disabled ? 0.5 : 1 }}>{icon}{children}</button>
  );
}

function UserModal({ alvo, onClose, showToast, onReload, onLink }: { alvo: U | 'novo'; onClose: () => void; showToast: (t: ToastData) => void; onReload: () => Promise<void>; onLink: (l: { titulo: string; url: string }) => void }) {
  const novo = alvo === 'novo';
  const u = novo ? null : alvo;
  const [nome, setNome] = useState(u?.nome ?? '');
  const [email, setEmail] = useState(u?.email ?? '');
  const [role, setRole] = useState<'admin' | 'super_admin'>((u?.role_key as 'admin' | 'super_admin') ?? 'admin');
  const [senha, setSenha] = useState('');
  const [busy, setBusy] = useState(false);

  const salvar = async () => {
    setBusy(true);
    try {
      if (novo) {
        if (!email.includes('@')) throw new Error('Informe um e-mail válido.');
        const r = await apiPost<{ id: string; link: string | null }>('/admin/users', { email, nome, role, senha: senha || undefined });
        if (r.link) onLink({ titulo: `Link para ${email} definir a senha`, url: r.link });
        showToast({ title: 'Usuário criado', msg: email, kind: 'ok' });
      } else {
        await apiPatch(`/admin/users/${u!.id}`, { nome, role });
        if (senha) await apiPost(`/admin/users/${u!.id}/senha`, { senha });
        showToast({ title: 'Usuário atualizado', msg: u!.email, kind: 'ok' });
      }
      await onReload(); onClose();
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 96, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ color: 'var(--c-ink)', fontSize: 18, fontWeight: 700, margin: 0 }}>{novo ? 'Novo usuário' : 'Editar usuário'}</h3>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><X size={17} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="ia-label">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" className="ia-input" />
          </div>
          <div>
            <label className="ia-label">E-mail</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={!novo} placeholder="email@dominio.com" className="ia-input ia-mono" style={{ opacity: novo ? 1 : 0.6 }} />
          </div>
          <div>
            <label className="ia-label">Papel</label>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'super_admin')} className="ia-input">
              <option value="admin">Admin (assinante)</option>
              <option value="super_admin">Super admin (IACMD)</option>
            </select>
          </div>
          <div>
            <label className="ia-label">{novo ? 'Senha (opcional)' : 'Nova senha (opcional)'}</label>
            <PasswordField value={senha} onChange={setSenha} placeholder={novo ? 'deixe vazio p/ enviar link' : 'deixe vazio p/ manter'} mono />
            <div style={{ color: 'var(--c-ink3)', fontSize: 11.5, marginTop: 5 }}>{novo ? 'Sem senha, geramos um link para o usuário definir a dele.' : 'Preencha só para trocar a senha agora.'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button onClick={onClose} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
          <button onClick={salvar} disabled={busy} className="ia-btn" style={{ flex: 1, padding: 12 }}>{busy ? 'Salvando…' : novo ? 'Criar' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}

function LinkModal({ titulo, url, onClose, showToast }: { titulo: string; url: string; onClose: () => void; showToast: (t: ToastData) => void }) {
  const copiar = () => { navigator.clipboard?.writeText(url).then(() => showToast({ title: 'Copiado', msg: '', kind: 'ok' })).catch(() => {}); };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 97, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '100%', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', padding: 24 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--c-soft)', color: 'var(--c-blue)', display: 'grid', placeItems: 'center' }}><KeyRound size={22} /></div>
        <h3 style={{ color: 'var(--c-ink)', fontSize: 17, fontWeight: 700, margin: '14px 0 4px' }}>{titulo}</h3>
        <p style={{ color: 'var(--c-ink3)', fontSize: 13, margin: '0 0 14px' }}>Envie este link ao usuário. Ele expira conforme a política do Supabase.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={url} className="ia-input ia-mono" style={{ flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
          <button onClick={copiar} className="ia-btn" style={{ padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 7 }}><Copy size={15} /> Copiar</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} className="ia-btn-outline" style={{ padding: '10px 20px' }}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

interface FinResumo {
  mrr: number; faturado_mes: number; recebido_mes: number; recebido_total: number;
  em_aberto: number; vencido: number; implantacoes_pendentes: number; inadimplentes: number; assinantes: number;
  custos_mes: number; custos_recorrentes: number; receitas_avulsas_mes: number;
  entradas_mes: number; lucro_mes: number; margem_pct: number; custos_por_categoria: Record<string, number>;
}
interface FinTenant { tenant_id: number; nome: string; status: string; mensal: number; em_aberto: number; vencido: number; inadimplente: boolean }
interface FinFatura { id: number; tenant_id: number; tenant_nome: string; tipo: string; descricao: string | null; referencia: string; valor: number; vencimento: string; status: 'aberto' | 'pago'; pago_em: string | null; empresa_nome: string | null; vencida: boolean }
interface FinResp { resumo: FinResumo; por_tenant: FinTenant[]; faturas: FinFatura[] }
interface Lancamento { id: number; tipo: 'custo' | 'receita'; categoria: string; descricao: string; valor: number; competencia: string; recorrente: boolean; created_at: string }

const CATEGORIAS: { key: string; label: string }[] = [
  { key: 'infra', label: 'Infra (DigitalOcean)' },
  { key: 'terminal_nuvem', label: 'Terminal na nuvem (VPS)' },
  { key: 'banco', label: 'Banco de dados (Supabase)' },
  { key: 'frontend', label: 'Frontend (Vercel)' },
  { key: 'imposto', label: 'Impostos' },
  { key: 'salario', label: 'Salários / equipe' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'outro', label: 'Outro' },
];
const catLabel = (k: string) => CATEGORIAS.find((c) => c.key === k)?.label ?? k;

/* ---- Blocos reutilizáveis do Financeiro -------------------------------- */
function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 2px' }}>
      <h3 style={{ color: 'var(--c-ink2)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', margin: 0 }}>{children}</h3>
      <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
      {right}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'err' | 'accent' }) {
  const cor = tone === 'ok' ? 'var(--c-okfg)' : tone === 'warn' ? 'var(--c-warnfg)' : tone === 'err' ? 'var(--c-errfg)' : tone === 'accent' ? 'var(--c-softfg)' : 'var(--c-ink)';
  const dot = tone === 'ok' ? 'var(--c-ok)' : tone === 'warn' ? 'var(--c-warn)' : tone === 'err' ? 'var(--c-err)' : tone === 'accent' ? 'var(--c-blue)' : 'transparent';
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {tone && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />}
        <span style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{label}</span>
      </div>
      <div style={{ color: cor, fontSize: 22, fontWeight: 800, marginTop: 4, letterSpacing: '-.01em' }}>{value}</div>
      {sub && <div style={{ color: 'var(--c-ink3)', fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}

function EqCell({ label, value, tone, big }: { label: string; value: string; tone: 'ok' | 'warn' | 'result'; big?: boolean }) {
  const cor = tone === 'ok' ? 'var(--c-okfg)' : tone === 'warn' ? 'var(--c-warnfg)' : value.trim().startsWith('-') ? 'var(--c-errfg)' : 'var(--c-okfg)';
  return (
    <div style={{ padding: big ? '4px 8px' : '4px 4px' }}>
      <div style={{ color: 'var(--c-ink3)', fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ color: cor, fontSize: big ? 30 : 20, fontWeight: 800, marginTop: 3, letterSpacing: '-.01em' }}>{value}</div>
    </div>
  );
}
function Op({ children }: { children: ReactNode }) {
  return <div data-op style={{ color: 'var(--c-ink3)', fontSize: 22, fontWeight: 400, textAlign: 'center', padding: '0 4px' }}>{children}</div>;
}

const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesExtenso = (ref: string) => { const [a, m] = ref.split('-'); return `${MESES_PT[Number(m) - 1]} de ${a}`; };

function Financeiro({ showToast, onVerPlano }: { showToast: (t: { title: string; msg: string; kind: 'ok' | 'err' }) => void; onVerPlano: () => void }) {
  const [data, setData] = useState<FinResp | null>(null);
  const [lancs, setLancs] = useState<Lancamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'aberto' | 'vencida' | 'pago'>('todas');
  const refMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [fin, ls] = await Promise.all([
        apiGet<FinResp>('/admin/financeiro'),
        apiGet<Lancamento[]>(`/admin/lancamentos?competencia=${refMes}`).catch(() => []),
      ]);
      setData(fin); setLancs(ls);
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); }
    finally { setLoading(false); }
  }, [showToast, refMes]);
  useEffect(() => { void carregar(); }, [carregar]);

  const [addBusy, setAddBusy] = useState(false);
  const addLanc = async (l: { tipo: 'custo' | 'receita'; categoria: string; descricao: string; valor: number; recorrente: boolean }) => {
    setAddBusy(true);
    try {
      await apiPost('/admin/lancamentos', { ...l, competencia: refMes });
      await carregar();
      showToast({ title: 'Lançamento adicionado', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setAddBusy(false); }
  };
  const removerLanc = async (id: number) => {
    setBusy(id);
    try { await apiDelete(`/admin/lancamentos/${id}`); await carregar(); showToast({ title: 'Lançamento removido', msg: '', kind: 'ok' }); }
    catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(null); }
  };

  const baixa = async (f: FinFatura) => {
    setBusy(f.id);
    try {
      await apiPost(`/admin/faturas/${f.id}/${f.status === 'pago' ? 'reabrir' : 'baixa'}`, {});
      await carregar();
      showToast({ title: f.status === 'pago' ? 'Fatura reaberta' : 'Baixa registrada', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(null); }
  };

  if (loading || !data) return <Card style={{ padding: 30, color: 'var(--c-ink3)', fontSize: 14 }}>Carregando financeiro…</Card>;
  const r = data.resumo;
  const faturas = data.faturas.filter((f) => filtro === 'todas' ? true : filtro === 'vencida' ? f.vencida : f.status === filtro && !(filtro === 'aberto' && f.vencida));

  const temInad = data.por_tenant.some((t) => t.inadimplente);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* 1. RESULTADO DO MÊS — DRE em destaque */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--c-border)' }}>
          <div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Resultado da operação</div>
            <div style={{ color: 'var(--c-ink2)', fontSize: 13, marginTop: 1 }}>{mesExtenso(refMes)}</div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: r.lucro_mes >= 0 ? 'var(--c-oksoft)' : 'var(--c-errsoft)', color: r.lucro_mes >= 0 ? 'var(--c-okfg)' : 'var(--c-errfg)' }}>
            {r.margem_pct}% de margem
          </span>
        </div>
        <div className="r-eq" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1.4fr', alignItems: 'center', padding: '20px 24px', gap: 4 }}>
          <EqCell label="Entradas (recebido)" value={brl(r.entradas_mes)} tone="ok" />
          <Op>−</Op>
          <EqCell label="Custos de operação" value={brl(r.custos_mes)} tone="warn" />
          <Op>=</Op>
          <div style={{ padding: '10px 16px', borderRadius: 12, background: r.lucro_mes >= 0 ? 'var(--c-oksoft)' : 'var(--c-errsoft)' }}>
            <EqCell label="Lucro do mês" value={brl(r.lucro_mes)} tone="result" big />
          </div>
        </div>
      </Card>

      {/* 2. RECEITA */}
      <div>
        <SectionTitle>Receita</SectionTitle>
        <div className="r-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 10 }}>
          <Kpi label="Receita recorrente (MRR)" value={brl(r.mrr)} tone="accent" sub="mensalidade contratada" />
          <Kpi label="Faturado no mês" value={brl(r.faturado_mes)} sub={`competência ${refMes.split('-').reverse().join('/')}`} />
          <Kpi label="Recebido no mês" value={brl(r.recebido_mes)} tone="ok" />
          <Kpi label="Recebido (acumulado)" value={brl(r.recebido_total)} tone="ok" sub="histórico total" />
        </div>
      </div>

      {/* 3. COBRANÇA & RISCO */}
      <div>
        <SectionTitle>Cobrança &amp; risco</SectionTitle>
        <div className="r-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 10 }}>
          <Kpi label="A receber (em aberto)" value={brl(r.em_aberto)} tone={r.em_aberto > 0 ? 'warn' : undefined} />
          <Kpi label="Vencido" value={brl(r.vencido)} tone={r.vencido > 0 ? 'err' : undefined} />
          <Kpi label="Implantações pendentes" value={brl(r.implantacoes_pendentes)} tone={r.implantacoes_pendentes > 0 ? 'warn' : undefined} />
          <Kpi label="Inadimplentes" value={`${r.inadimplentes} / ${r.assinantes}`} tone={r.inadimplentes > 0 ? 'err' : 'ok'} sub={r.inadimplentes > 0 ? 'automação bloqueada' : 'todos em dia'} />
        </div>
        {temInad && (
          <Card style={{ overflow: 'hidden', marginTop: 12, borderColor: 'var(--c-err)' }}>
            <div style={{ padding: '11px 20px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-errsoft)', color: 'var(--c-errfg)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Assinantes com automação bloqueada</div>
            {data.por_tenant.filter((t) => t.inadimplente).map((t) => (
              <div key={t.tenant_id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', borderTop: '1px solid var(--c-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{t.nome}</div>
                  <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{brl(t.mensal)}/mês contratado</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'var(--c-errfg)', fontSize: 14, fontWeight: 700 }}>{brl(t.vencido)} vencido</div>
                  <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{brl(t.em_aberto)} em aberto</div>
                </div>
                <button onClick={onVerPlano} className="ia-btn-outline" style={{ padding: '0 12px', height: 32, fontSize: 13 }}>Ver plano</button>
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* 4. CUSTOS DE OPERAÇÃO */}
      <div>
        <SectionTitle right={<span style={{ color: 'var(--c-ink3)', fontSize: 12 }}>fixos {brl(r.custos_recorrentes)}/mês</span>}>Custos de operação · {refMes.split('-').reverse().join('/')}</SectionTitle>
        <Card className="r-scroll-x" style={{ overflow: 'hidden', marginTop: 10 }}>
          <LancForm onAdd={addLanc} busy={addBusy} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 120px 90px', padding: '9px 20px', borderTop: '1px solid var(--c-border)', background: 'var(--c-surface2)', fontSize: 11, fontWeight: 700, color: 'var(--c-ink3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            <span>Descrição</span><span>Categoria</span><span style={{ textAlign: 'right' }}>Valor</span><span />
          </div>
          {lancs.length === 0 ? (
            <div style={{ padding: 18, color: 'var(--c-ink3)', fontSize: 13, borderTop: '1px solid var(--c-border)' }}>Nenhum lançamento neste mês. Registre infra, terminais na nuvem, banco, impostos, salários…</div>
          ) : lancs.map((l) => (
            <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 120px 90px', alignItems: 'center', gap: 8, padding: '11px 20px', borderTop: '1px solid var(--c-border)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.descricao}</div>
                {l.recorrente && <span style={{ display: 'inline-block', marginTop: 3, padding: '1px 7px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: 'var(--c-soft)', color: 'var(--c-softfg)' }}>fixo mensal</span>}
              </div>
              <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>{catLabel(l.categoria)}</span>
              <span style={{ color: l.tipo === 'receita' ? 'var(--c-okfg)' : 'var(--c-warnfg)', fontSize: 14, fontWeight: 700, textAlign: 'right' }}>{l.tipo === 'receita' ? '+' : '−'}{brl(l.valor)}</span>
              <div style={{ textAlign: 'right' }}>
                <button onClick={() => removerLanc(l.id)} disabled={busy === l.id} className="ia-btn-outline" style={{ padding: '0 10px', height: 30, fontSize: 12 }}>{busy === l.id ? '…' : 'Remover'}</button>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* 5. FATURAS */}
      <div>
        <SectionTitle right={
          <div style={{ display: 'flex', gap: 4 }}>
            {(['todas', 'aberto', 'vencida', 'pago'] as const).map((k) => (
              <button key={k} onClick={() => setFiltro(k)} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: filtro === k ? 700 : 500, padding: '4px 10px', borderRadius: 7, background: filtro === k ? 'var(--c-soft)' : 'transparent', color: filtro === k ? 'var(--c-softfg)' : 'var(--c-ink3)' }}>{k[0].toUpperCase() + k.slice(1)}</button>
            ))}
          </div>
        }>Faturas emitidas</SectionTitle>
        <Card className="r-scroll-x" style={{ overflow: 'hidden', marginTop: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px 84px 96px', padding: '9px 20px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)', fontSize: 11, fontWeight: 700, color: 'var(--c-ink3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            <span>Assinante / fatura</span><span style={{ textAlign: 'right' }}>Valor</span><span style={{ textAlign: 'center' }}>Status</span><span />
          </div>
          {faturas.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--c-ink3)', fontSize: 13 }}>Nenhuma fatura neste filtro.</div>
          ) : faturas.map((f) => {
            const cor = f.status === 'pago' ? 'var(--c-okfg)' : f.vencida ? 'var(--c-errfg)' : 'var(--c-ink3)';
            return (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 96px 84px 96px', alignItems: 'center', gap: 8, padding: '11px 20px', borderBottom: '1px solid var(--c-border)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{f.tenant_nome}</div>
                  <div style={{ color: 'var(--c-ink3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.descricao || f.tipo} · vence {f.vencimento.split('-').reverse().join('/')}</div>
                </div>
                <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700, textAlign: 'right' }}>{brl(f.valor)}</span>
                <span style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: cor }}>{f.status === 'pago' ? 'pago' : f.vencida ? 'vencida' : 'aberto'}</span>
                <div style={{ textAlign: 'right' }}>
                  <button onClick={() => baixa(f)} disabled={busy === f.id} className="ia-btn-outline" style={{ padding: '0 10px', height: 30, fontSize: 12, width: 88 }}>{busy === f.id ? '…' : f.status === 'pago' ? 'Reabrir' : 'Dar baixa'}</button>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}

function LancForm({ onAdd, busy }: { onAdd: (l: { tipo: 'custo' | 'receita'; categoria: string; descricao: string; valor: number; recorrente: boolean }) => void; busy: boolean }) {
  const [tipo, setTipo] = useState<'custo' | 'receita'>('custo');
  const [categoria, setCategoria] = useState('infra');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [recorrente, setRecorrente] = useState(true);

  const submit = () => {
    const v = Number(valor.replace(',', '.'));
    if (!descricao.trim() || !v || v <= 0) return;
    onAdd({ tipo, categoria, descricao: descricao.trim(), valor: v, recorrente });
    setDescricao(''); setValor('');
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '14px 20px', background: 'var(--c-surface2)' }}>
      <select value={tipo} onChange={(e) => setTipo(e.target.value as 'custo' | 'receita')} className="ia-input" style={{ width: 'auto', flex: '0 0 auto' }}>
        <option value="custo">Custo</option>
        <option value="receita">Receita</option>
      </select>
      <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="ia-input" style={{ width: 'auto', flex: '0 0 auto' }}>
        {CATEGORIAS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (ex.: Droplet API + Redis)" className="ia-input" style={{ flex: '1 1 200px', minWidth: 160 }} />
      <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0,00" className="ia-input ia-mono" style={{ width: 120, flex: '0 0 auto' }} />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--c-ink2)', fontSize: 13, cursor: 'pointer', flex: '0 0 auto' }} title="Custo fixo que se repete todo mês (infra, VPS, Supabase…)">
        <input type="checkbox" checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} /> fixo mensal
      </label>
      <button onClick={submit} disabled={busy} className="ia-btn" style={{ padding: '0 16px', height: 38, flex: '0 0 auto' }}>{busy ? 'Salvando…' : 'Lançar'}</button>
    </div>
  );
}

interface Precos { implantacao: number; terminais: number[]; adicional: number }
const ordinal = (n: number) => `${n}º`;

function TabelaPrecos({ showToast, onSaved }: { showToast: (t: { title: string; msg: string; kind: 'ok' | 'err' }) => void; onSaved: () => void }) {
  const [p, setP] = useState<Precos | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => { try { setP(await apiGet<Precos>('/admin/precos')); } catch { setP(null); } })(); }, []);

  const salvar = async () => {
    if (!p) return;
    setSaving(true);
    try {
      const novo = await apiPut<Precos>('/admin/precos', p);
      setP(novo); onSaved();
      showToast({ title: 'Tabela de preços salva', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setSaving(false); }
  };

  if (!p) return <Card style={{ padding: 20, color: 'var(--c-ink3)', fontSize: 14 }}>Carregando tabela de preços…</Card>;

  const setTier = (i: number, v: string) => { const t = [...p.terminais]; t[i] = Math.max(0, Number(v) || 0); setP({ ...p, terminais: t }); };
  const addTier = () => setP({ ...p, terminais: [...p.terminais, p.terminais[p.terminais.length - 1] ?? 0] });
  const rmTier = (i: number) => { if (p.terminais.length <= 1) return; setP({ ...p, terminais: p.terminais.filter((_, j) => j !== i) }); };
  const exemplo = (n: number) => { let s = 0; for (let k = 1; k <= n; k++) s += p.terminais[k - 1] ?? p.adicional; return s; };
  const inp: React.CSSProperties = { boxSizing: 'border-box', width: '100%', height: 40, background: 'var(--c-input)', border: '1.5px solid var(--c-border2)', borderRadius: 10, padding: '0 12px', color: 'var(--c-ink)', fontFamily: 'inherit', fontSize: 14 };

  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
        <div>
          <div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700 }}>Tabela de preços</div>
          <div style={{ color: 'var(--c-ink3)', fontSize: 12.5, marginTop: 1 }}>Valor escalonado por terminal (desconto progressivo) + implantação. Vale para todos os assinantes.</div>
        </div>
        <button onClick={salvar} disabled={saving} className="ia-btn" style={{ padding: '10px 18px' }}>{saving ? 'Salvando…' : 'Salvar tabela'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, marginTop: 14, alignItems: 'start' }} className="r-cols-side">
        {/* Implantação + adicional */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="ia-label">Implantação (única, R$)</label>
            <input value={p.implantacao} onChange={(e) => setP({ ...p, implantacao: Math.max(0, Number(e.target.value) || 0) })} className="ia-mono" style={inp} />
          </div>
          <div>
            <label className="ia-label">Do {ordinal(p.terminais.length + 1)} em diante (R$)</label>
            <input value={p.adicional} onChange={(e) => setP({ ...p, adicional: Math.max(0, Number(e.target.value) || 0) })} className="ia-mono" style={inp} />
            <div style={{ color: 'var(--c-ink3)', fontSize: 11.5, marginTop: 5 }}>Preço de cada terminal além da lista ao lado.</div>
          </div>
        </div>

        {/* Faixas por terminal */}
        <div>
          <label className="ia-label">Preço por posição do terminal</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {p.terminais.map((v, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', top: -8, left: 8, background: 'var(--c-surface)', padding: '0 5px', color: 'var(--c-softfg)', fontSize: 11, fontWeight: 700 }}>{ordinal(i + 1)} terminal</div>
                <input value={v} onChange={(e) => setTier(i, e.target.value)} className="ia-mono" style={{ ...inp, paddingRight: p.terminais.length > 1 ? 30 : 12 }} />
                {p.terminais.length > 1 && <button onClick={() => rmTier(i)} title="Remover faixa" style={{ position: 'absolute', right: 6, top: 10, width: 20, height: 20, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><X size={14} /></button>}
              </div>
            ))}
            <button onClick={addTier} className="ia-btn-outline" style={{ height: 40, fontSize: 13, borderStyle: 'dashed' }}>+ faixa</button>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14, color: 'var(--c-ink3)', fontSize: 12.5 }}>
            <span>Exemplos:</span>
            {[1, 2, 3, 5].map((n) => <span key={n}><b style={{ color: 'var(--c-ink2)' }}>{n} term.</b> = {brl(exemplo(n))}/mês</span>)}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Planos({ tenants, showToast }: { tenants: T[]; showToast: (t: { title: string; msg: string; kind: 'ok' | 'err' }) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [loading, setLoading] = useState(false);
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [busy, setBusy] = useState<number | 'gerar' | 'terminais' | null>(null);
  const [lancar, setLancar] = useState(false); // modal de lançamento manual

  const carregarFaturas = useCallback(async (id: number) => {
    try { setFaturas(await apiGet<Fatura[]>(`/admin/tenants/${id}/faturas`)); } catch { setFaturas([]); }
  }, []);

  const abrir = useCallback(async (id: number) => {
    setSel(id); setLoading(true); setPlano(null); setFaturas([]);
    try {
      const p = await apiGet<Plano>(`/admin/tenants/${id}/plano`);
      setPlano(p);
      await carregarFaturas(id);
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setLoading(false); }
  }, [showToast, carregarFaturas]);

  const patchTenant = async (body: Record<string, unknown>) => {
    try { await apiPatch(`/admin/tenants/${sel}/plano`, body); if (sel) await abrir(sel); showToast({ title: 'Plano atualizado', msg: '', kind: 'ok' }); }
    catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); }
  };

  const revogarTerminal = async (empresaId: number) => {
    if (!window.confirm('Revogar 1 terminal desta empresa? A cota diminui e a mensalidade reduz no próximo ciclo.')) return;
    setBusy(empresaId);
    try {
      await apiPost(`/admin/empresas/${empresaId}/revogar-terminal`, {});
      if (sel) await abrir(sel);
      showToast({ title: 'Terminal revogado', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(null); }
  };

  const baixa = async (f: Fatura, pago: boolean) => {
    setBusy(f.id);
    try {
      await apiPost(`/admin/faturas/${f.id}/${pago ? 'baixa' : 'reabrir'}`, {});
      if (sel) await carregarFaturas(sel);
      showToast({ title: pago ? 'Baixa registrada' : 'Fatura reaberta', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(null); }
  };

  /** Concede/remove terminais sem gerar fatura (conta de teste ou parceiro). */
  const concederTerminais = async (quantidade: number) => {
    if (!sel) return;
    const acao = quantidade > 0 ? `Conceder ${quantidade} terminal(is)` : 'Remover 1 terminal';
    if (!window.confirm(`${acao} SEM cobrança para este assinante?`)) return;
    setBusy('terminais');
    try {
      await apiPost(`/admin/tenants/${sel}/terminais`, { quantidade });
      await abrir(sel);
      showToast({ title: quantidade > 0 ? 'Terminais concedidos' : 'Terminal removido', msg: 'Sem cobrança.', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(null); }
  };

  const lancarPagamento = async (dados: Record<string, unknown>) => {
    if (!sel) return;
    await apiPost(`/admin/tenants/${sel}/lancamento`, dados);
    await abrir(sel);
    await carregarFaturas(sel);
    setLancar(false);
    showToast({ title: 'Lançamento registrado', msg: 'A fatura aparece também no painel do cliente.', kind: 'ok' });
  };

  const gerarMensalidade = async () => {
    if (!sel) return;
    setBusy('gerar');
    try {
      await apiPost(`/admin/tenants/${sel}/gerar-mensalidade`, {});
      await carregarFaturas(sel);
      showToast({ title: 'Mensalidade gerada', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Não gerada', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TabelaPrecos showToast={showToast} onSaved={() => { if (sel) void abrir(sel); }} />
      <div className="r-cols-side" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
      <Card style={{ padding: 8 }}>
        <div style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', padding: '8px 10px' }}>Assinantes</div>
        {tenants.length === 0 ? <div style={{ padding: 14, color: 'var(--c-ink3)', fontSize: 13 }}>Nenhum.</div> : tenants.map((t) => (
          <button key={t.id} onClick={() => abrir(t.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: sel === t.id ? 700 : 500, color: sel === t.id ? 'var(--c-softfg)' : 'var(--c-ink2)', background: sel === t.id ? 'var(--c-soft)' : 'transparent' }}>{t.name}</button>
        ))}
      </Card>

      <div>
        {!sel ? (
          <Card style={{ padding: 30, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Selecione um assinante para gerir o plano.</Card>
        ) : loading || !plano ? (
          <Card style={{ padding: 30, color: 'var(--c-ink3)', fontSize: 14 }}>Carregando…</Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(() => {
              // Status de acesso (mesma regra do gate): mostra AO super admin o
              // porquê de o cliente estar liberado ou bloqueado, para saber o
              // que lançar.
              const hoje = new Date().toISOString().slice(0, 10);
              const ate = (plano as any).isento_ate as string | null;
              const isentoVig = !!(plano as any).isento_pagamento && (!ate || ate >= hoje);
              const implOk = plano.implantacao_paga || Number(plano.valor_implantacao) === 0;
              const vencidas = faturas.filter((f) => f.status === 'aberto' && f.vencimento < hoje);
              const liberado = isentoVig || (implOk && vencidas.length === 0);
              const motivo = isentoVig ? 'isento' : !implOk ? 'implantação não liberada' : vencidas.length ? `${vencidas.length} fatura(s) vencida(s)` : 'em dia';
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 15px', borderRadius: 10, background: liberado ? 'var(--c-oksoft)' : 'var(--c-errsoft)', border: `1px solid ${liberado ? 'var(--c-ok)' : 'var(--c-err)'}` }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: liberado ? 'var(--c-ok)' : 'var(--c-err)' }} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: liberado ? 'var(--c-okfg)' : 'var(--c-errfg)' }}>
                    {liberado ? 'ACESSO LIBERADO' : 'ACESSO BLOQUEADO'}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--c-ink3)' }}>· {motivo}</span>
                </div>
              );
            })()}
            <div className="r-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
              <Mini label="Mensalidade total" v={brl(plano.mensal)} c="var(--c-softfg)" />
              <Mini label="Terminais alocados" v={String(plano.total_terminais)} />
              <Mini label="Não alocados" v={String(plano.nao_alocados || 0)} c={plano.nao_alocados > 0 ? 'var(--c-warnfg)' : undefined} />
              <Mini label="Implantação" v={brl(plano.valor_implantacao)} />
            </div>

            <Card style={{ padding: 20 }}>
              <div style={{ color: 'var(--c-ink)', fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Plano do assinante</div>
              <div style={{ color: 'var(--c-ink3)', fontSize: 12.5, marginBottom: 14 }}>Os valores seguem a <b>Tabela de preços</b> (global, acima). {plano.total_terminais} terminal(is) → <b>{brl(plano.mensal)}/mês</b>. Próximo terminal custará <b>{brl((plano as { proximo_terminal?: number }).proximo_terminal ?? 0)}</b>.</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>Implantação ({brl(plano.valor_implantacao)}) paga</span>
                <Switch on={plano.implantacao_paga} onClick={() => patchTenant({ implantacao_paga: !plano.implantacao_paga })} />
                <span style={{ fontSize: 12, color: plano.implantacao_paga ? 'var(--c-okfg)' : 'var(--c-warnfg)' }}>{plano.implantacao_paga ? 'paga' : 'pendente'}</span>
              </div>

              {/* ISENÇÃO: conta de teste / parceiro. Roda automação sem pagar —
                  por isso fica destacado, para não passar despercebido numa
                  conta que deveria estar cobrando. */}
              <div style={{ marginTop: 16, padding: '13px 15px', borderRadius: 10, background: (plano as any).isento_pagamento ? 'var(--c-warnsoft)' : 'var(--c-surface2)', border: `1px solid ${(plano as any).isento_pagamento ? 'var(--c-warn)' : 'var(--c-border)'}` }}>
                {(() => {
                  const isento = !!(plano as any).isento_pagamento;
                  const ate = (plano as any).isento_ate as string | null;
                  const venceu = !!ate && ate < new Date().toISOString().slice(0, 10);
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--c-ink2)', fontSize: 13, fontWeight: 600 }}>Isento de pagamento (teste / parceiro)</span>
                        <Switch on={isento} onClick={() => patchTenant({ isento_pagamento: !isento })} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: venceu ? 'var(--c-err)' : isento ? 'var(--c-warnfg)' : 'var(--c-ink3)' }}>
                          {!isento ? 'cobrança normal'
                            : venceu ? 'TESTE VENCIDO — já voltou a cobrar'
                            : ate ? `teste até ${ate.split('-').reverse().join('/')}`
                            : 'ISENTO por tempo indeterminado'}
                        </span>
                      </div>

                      {isento && (
                        // Escolha do prazo: teste tem fim; parceiro não.
                        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                          <span style={{ color: 'var(--c-ink3)', fontSize: 12 }}>Prazo:</span>
                          {[7, 15, 30].map((d) => (
                            <button key={d} onClick={() => patchTenant({ isento_pagamento: true, isento_dias: d })} className="ia-btn-outline" style={{ padding: '0 11px', height: 28, fontSize: 12 }}>{d} dias</button>
                          ))}
                          <button onClick={() => patchTenant({ isento_pagamento: true, isento_dias: 0 })} className="ia-btn-outline" style={{ padding: '0 11px', height: 28, fontSize: 12, borderColor: !ate ? 'var(--c-blue)' : undefined, color: !ate ? 'var(--c-softfg)' : undefined }}>Indeterminado</button>
                        </div>
                      )}

                      <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
                        Ligado, o assinante roda a automação <b>sem nenhuma cobrança</b> — ignora implantação, mensalidade e faturas vencidas.
                        {isento && ate && !venceu && ' Quando o prazo vencer, a cobrança volta sozinha.'}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Concede terminais sem cobrar — para teste/parceiro, já que o
                  caminho normal (cliente contrata e paga) não se aplica a eles. */}
              <div style={{ marginTop: 12, padding: '13px 15px', borderRadius: 10, background: 'var(--c-surface2)', border: '1px solid var(--c-border)' }}>
                <div style={{ color: 'var(--c-ink2)', fontSize: 13, fontWeight: 600 }}>Atrelar terminais sem cobrança</div>
                <div style={{ color: 'var(--c-ink3)', fontSize: 12, margin: '5px 0 10px', lineHeight: 1.5 }}>
                  Concede terminais direto, sem gerar fatura. Hoje: <b>{plano.total_terminais}</b>.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[1, 2, 3].map((n) => (
                    <button key={n} onClick={() => concederTerminais(n)} disabled={busy === 'terminais'} className="ia-btn-outline" style={{ padding: '0 14px', height: 32, fontSize: 13 }}>+{n}</button>
                  ))}
                  <button onClick={() => concederTerminais(-1)} disabled={busy === 'terminais' || plano.total_terminais <= 0} className="ia-btn-outline" style={{ padding: '0 14px', height: 32, fontSize: 13, color: 'var(--c-errfg)' }}>−1</button>
                </div>
              </div>
            </Card>

            <Card style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--c-border)' }}>
                <span style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Faturamento ({faturas.length})</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setLancar(true)} className="ia-btn-outline" style={{ padding: '0 12px', height: 32, fontSize: 13 }}>Lançar pagamento manual</button>
                  <button onClick={gerarMensalidade} disabled={busy === 'gerar'} className="ia-btn-outline" style={{ padding: '0 12px', height: 32, fontSize: 13 }}>{busy === 'gerar' ? 'Gerando…' : 'Gerar mensalidade (Asaas)'}</button>
                </div>
              </div>
              {faturas.length === 0 ? (
                <div style={{ padding: 18, color: 'var(--c-ink3)', fontSize: 13 }}>Nenhuma fatura. Gere a mensalidade do mês para começar.</div>
              ) : faturas.map((f) => {
                const vencida = f.status === 'aberto' && f.vencimento < new Date().toISOString().slice(0, 10);
                const cor = f.status === 'pago' ? 'var(--c-okfg)' : vencida ? 'var(--c-warnfg)' : 'var(--c-ink3)';
                return (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', borderBottom: '1px solid var(--c-border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                        {f.descricao || f.tipo}
                        {f.pago_manual && <span style={{ flex: 'none', fontSize: 10, fontWeight: 700, color: 'var(--c-softfg)', background: 'var(--c-soft)', padding: '1px 7px', borderRadius: 999 }}>MANUAL</span>}
                      </div>
                      <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>ref {f.referencia} · vence {f.vencimento}{f.empresas?.nome ? ` · ${f.empresas.nome}` : ''}</div>
                    </div>
                    <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700, width: 96, textAlign: 'right' }}>{brl(f.valor)}</div>
                    <div style={{ width: 78, textAlign: 'center', fontSize: 12, fontWeight: 700, color: cor }}>{f.status === 'pago' ? 'pago' : vencida ? 'vencida' : 'aberto'}</div>
                    <button onClick={() => baixa(f, f.status !== 'pago')} disabled={busy === f.id} className="ia-btn-outline" style={{ padding: '0 12px', height: 32, fontSize: 13, width: 92 }}>
                      {busy === f.id ? '…' : f.status === 'pago' ? 'Reabrir' : 'Dar baixa'}
                    </button>
                  </div>
                );
              })}
            </Card>

            <Card style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--c-border)', color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Empresas ({plano.empresas.length})</div>
              {plano.empresas.map((e) => (
                <EmpresaLinha key={e.id} e={e} onRevogar={revogarTerminal} busy={busy === e.id} />
              ))}
            </Card>

            {lancar && <LancamentoModal implantacaoLiberada={!!plano.implantacao_paga} onClose={() => setLancar(false)} onLancar={lancarPagamento} onErr={(m) => showToast({ title: 'Falha', msg: m, kind: 'err' })} />}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function EmpresaLinha({ e, onRevogar, busy }: { e: Plano['empresas'][number]; onRevogar: (empresaId: number) => void; busy: boolean }) {
  const configurados = (e as { configurados?: number }).configurados ?? 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--c-border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{e.nome}</div>
        <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{e.cnpj || 'sem CNPJ'}{configurados > 0 ? ` · ${configurados} conectado(s)` : ''}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{e.terminais} terminal(is)</div>
        <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{brl(e.mensal)}/mês</div>
      </div>
      <button
        onClick={() => onRevogar(e.id)}
        disabled={busy || e.terminais <= 0}
        title={e.terminais <= 0 ? 'Sem terminais para revogar' : 'Revogar 1 terminal'}
        className="ia-btn-outline"
        style={{ padding: '0 12px', height: 34, fontSize: 13, flex: 'none', color: e.terminais > 0 ? 'var(--c-errfg)' : 'var(--c-ink3)' }}
      >{busy ? '…' : 'Revogar terminal'}</button>
    </div>
  );
}

function Mini({ label, v, c }: { label: string; v: string; c?: string }) {
  return <Card style={{ padding: 16 }}><div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{label}</div><div style={{ color: c ?? 'var(--c-ink)', fontSize: 22, fontWeight: 800, marginTop: 2 }}>{v}</div></Card>;
}

/**
 * Lançamento manual de pagamento (sem Asaas). Cobre mensalidade paga por fora e
 * implantação parcelada (1ª parcela paga + parcelas a vencer). Toda fatura sai
 * marcada como manual e aparece no Meu Plano do cliente.
 */
function LancamentoModal({ implantacaoLiberada, onClose, onLancar, onErr }: { implantacaoLiberada: boolean; onClose: () => void; onLancar: (d: Record<string, unknown>) => Promise<void>; onErr: (m: string) => void }) {
  const [tipo, setTipo] = useState<'mensalidade' | 'implantacao' | 'avulso'>('implantacao');
  const [valor, setValor] = useState('');
  const [pago, setPago] = useState(true); // pago por fora x parcela a vencer
  const [vencimento, setVencimento] = useState('');
  const [descricao, setDescricao] = useState('');
  const [liberar, setLiberar] = useState(true); // implantação: libera acesso por padrão
  // Implantação parcelada: 2ª parcela (valor + data) registrada no mesmo ato.
  const [parcelaValor, setParcelaValor] = useState('');
  const [parcelaVenc, setParcelaVenc] = useState('');
  // Mensalidade: atrela o terminal que o cliente pagou.
  const [terminais, setTerminais] = useState('0');
  const [busy, setBusy] = useState(false);

  const num = (s: string) => Number(String(s).replace(',', '.'));

  const salvar = async () => {
    const v = num(valor);
    if (!(v > 0)) return onErr('Informe um valor maior que zero.');
    if (!pago && !vencimento) return onErr('Parcela a vencer precisa de uma data de vencimento.');
    const parcelas: { valor: number; vencimento: string }[] = [];
    if (tipo === 'implantacao' && parcelaValor.trim()) {
      const pv = num(parcelaValor);
      if (!(pv > 0)) return onErr('Valor da 2ª parcela inválido.');
      if (!parcelaVenc) return onErr('Informe a data de vencimento da 2ª parcela.');
      parcelas.push({ valor: pv, vencimento: parcelaVenc });
    }
    const nTerm = Math.trunc(num(terminais));
    setBusy(true);
    try {
      await onLancar({
        tipo, valor: v, pago,
        vencimento: pago ? undefined : vencimento,
        descricao: descricao.trim() || undefined,
        liberar_implantacao: tipo === 'implantacao' && liberar,
        parcelas: parcelas.length ? parcelas : undefined,
        atrelar_terminais: nTerm > 0 ? nTerm : undefined,
      });
    } catch (e) { onErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(7,11,22,.7)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 480, maxWidth: '100%', padding: 26, animation: 'ia-slide .22s ease' }}>
        <h3 style={{ color: 'var(--c-ink)', fontSize: 19, fontWeight: 700, margin: 0 }}>Lançar pagamento manual</h3>
        <p style={{ color: 'var(--c-ink3)', fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.5 }}>Fora do Asaas. Registra no plano do cliente e aparece no Meu Plano dele marcado como <b>manual</b>.</p>

        <label className="ia-label" style={{ marginTop: 18 }}>Tipo</label>
        <div style={{ display: 'flex', gap: 6, background: 'var(--c-surface2)', padding: 4, borderRadius: 10 }}>
          {([['mensalidade', 'Mensalidade'], ['implantacao', 'Implantação'], ['avulso', 'Avulso']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTipo(k)} style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: tipo === k ? 'var(--c-surface)' : 'transparent', color: tipo === k ? 'var(--c-ink)' : 'var(--c-ink3)', boxShadow: tipo === k ? 'var(--c-shadow)' : 'none' }}>{lbl}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          <div>
            <label className="ia-label">Valor (R$)</label>
            <input value={valor} onChange={(e) => setValor(e.target.value)} className="ia-input" placeholder="2000,00" inputMode="decimal" />
          </div>
          <div>
            <label className="ia-label">Situação</label>
            <div style={{ display: 'flex', gap: 6, background: 'var(--c-surface2)', padding: 4, borderRadius: 10 }}>
              <button onClick={() => setPago(true)} style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: pago ? 'var(--c-surface)' : 'transparent', color: pago ? 'var(--c-okfg)' : 'var(--c-ink3)' }}>Pago</button>
              <button onClick={() => setPago(false)} style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: !pago ? 'var(--c-surface)' : 'transparent', color: !pago ? 'var(--c-warnfg)' : 'var(--c-ink3)' }}>A vencer</button>
            </div>
          </div>
        </div>

        {!pago && (
          <div style={{ marginTop: 12 }}>
            <label className="ia-label">Vence em</label>
            <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="ia-input" style={{ width: 'auto' }} />
            <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 5 }}>Parcela a vencer: se passar da data sem pagar, o acesso do cliente bloqueia.</div>
          </div>
        )}

        <label className="ia-label" style={{ marginTop: 12 }}>Descrição (opcional)</label>
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="ia-input" placeholder={tipo === 'implantacao' ? 'Ex: Implantação — 1ª parcela (entrada)' : 'Ex: Mensalidade julho (PIX)'} />

        {/* IMPLANTAÇÃO: 2ª parcela agendada + liberar acesso no mesmo ato. */}
        {tipo === 'implantacao' && (
          <>
            <div style={{ marginTop: 14, padding: '13px 15px', borderRadius: 10, background: 'var(--c-surface2)', border: '1px solid var(--c-border)' }}>
              <div style={{ color: 'var(--c-ink2)', fontSize: 13, fontWeight: 600 }}>Parcela restante (a vencer) — opcional</div>
              <div style={{ color: 'var(--c-ink3)', fontSize: 12, margin: '4px 0 10px', lineHeight: 1.5 }}>Registra a 2ª parcela com data. Se vencer sem pagar, o acesso bloqueia.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="ia-label">Valor restante (R$)</label>
                  <input value={parcelaValor} onChange={(e) => setParcelaValor(e.target.value)} className="ia-input" placeholder="10000,00" inputMode="decimal" />
                </div>
                <div>
                  <label className="ia-label">Vence em</label>
                  <input type="date" value={parcelaVenc} onChange={(e) => setParcelaVenc(e.target.value)} className="ia-input" />
                </div>
              </div>
            </div>

            {!implantacaoLiberada && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 12, padding: '11px 13px', borderRadius: 10, background: liberar ? 'var(--c-oksoft)' : 'var(--c-surface2)', border: `1px solid ${liberar ? 'var(--c-ok)' : 'var(--c-border)'}`, cursor: 'pointer' }}>
                <input type="checkbox" checked={liberar} onChange={(e) => setLiberar(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--c-blued)' }} />
                <span style={{ fontSize: 12.5, color: 'var(--c-ink2)', lineHeight: 1.5 }}>
                  <b>Liberar o acesso agora</b><br />
                  <span style={{ color: 'var(--c-ink3)' }}>Mesmo pago em parte, o cliente já usa a automação. As parcelas a vencer seguem cobrando.</span>
                </span>
              </label>
            )}
          </>
        )}

        {/* MENSALIDADE: atrela o terminal que o cliente pagou. */}
        {tipo === 'mensalidade' && (
          <div style={{ marginTop: 14 }}>
            <label className="ia-label">Atrelar terminais (o cliente pagou por eles)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input value={terminais} onChange={(e) => setTerminais(e.target.value.replace(/\D/g, ''))} className="ia-input" style={{ width: 80 }} inputMode="numeric" />
              <span style={{ color: 'var(--c-ink3)', fontSize: 12.5, lineHeight: 1.5 }}>terminal(is) liberado(s) sem gerar outra fatura.</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button onClick={onClose} disabled={busy} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
          <button onClick={salvar} disabled={busy} className="ia-btn" style={{ flex: 1.4, padding: 12 }}>{busy ? 'Lançando…' : 'Lançar'}</button>
        </div>
      </div>
    </div>
  );
}

interface AuditLog { id: number; tenant_id: number | null; tenant_nome: string | null; usuario_id: string | null; categoria: string; acao: string; descricao: string; nivel: 'info' | 'sucesso' | 'alerta' | 'erro'; actor_nome: string | null; actor_email: string | null; actor_role: string | null; meta: Record<string, unknown> | null; criado_em: string }
interface TecLog { id: number; upload_id: number; timestamp: string; level: string; message: string }

const CAT_LOG: { key: string; label: string }[] = [
  { key: 'todas', label: 'Todas as categorias' },
  { key: 'assinante', label: 'Assinantes' },
  { key: 'terminal', label: 'Terminais' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'automacao', label: 'Automação' },
  { key: 'empresa', label: 'Empresas' },
  { key: 'auth', label: 'Acesso' },
  { key: 'sistema', label: 'Sistema' },
];
const nivelCor = (raw: string) => {
  const n = (raw || '').toLowerCase();
  if (n === 'sucesso' || n === 'success') return 'var(--c-okfg)';
  if (n === 'alerta' || n === 'warning' || n === 'warn') return 'var(--c-warnfg)';
  if (n === 'erro' || n === 'error') return 'var(--c-errfg)';
  return 'var(--c-ink3)';
};
const catCor = (c: string) => c === 'financeiro' ? 'var(--c-okfg)' : c === 'terminal' ? 'var(--c-softfg)' : c === 'automacao' ? 'var(--c-warnfg)' : c === 'assinante' ? 'var(--c-softfg)' : 'var(--c-ink3)';
const DIA_HOJE = () => new Date().toISOString().slice(0, 10);
const DIA_ATRAS = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const rotuloDia = (iso: string) => {
  const hoje = DIA_HOJE(); const ontem = DIA_ATRAS(1);
  if (iso === hoje) return 'Hoje'; if (iso === ontem) return 'Ontem';
  const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`;
};
const horaDe = (ts: string) => { const dt = new Date(ts); return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`; };

function Logs({ users, tenants }: { users: U[]; tenants: T[] }) {
  const [modo, setModo] = useState<'simples' | 'tecnico'>('tecnico');
  const [from, setFrom] = useState(DIA_ATRAS(30));
  const [to, setTo] = useState(DIA_HOJE());
  const [usuario, setUsuario] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [categoria, setCategoria] = useState('todas');
  const [nivel, setNivel] = useState('todos');
  const [q, setQ] = useState('');
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [tec, setTec] = useState<TecLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ctrl = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams();
        if (from) p.set('from', from); if (to) p.set('to', to);
        if (tenantId) p.set('tenant_id', tenantId);
        if (q.trim()) p.set('q', q.trim());
        if (modo === 'simples') {
          if (usuario) p.set('usuario', usuario);
          if (categoria !== 'todas') p.set('categoria', categoria);
          if (nivel !== 'todos') p.set('nivel', nivel);
          setAudit(await apiGet<AuditLog[]>(`/admin/audit?${p.toString()}`));
        } else {
          if (nivel !== 'todos') p.set('level', nivel);
          setTec(await apiGet<TecLog[]>(`/admin/logs-tecnicos?${p.toString()}`));
        }
      } catch { /* silencioso */ } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(ctrl);
  }, [modo, from, to, usuario, tenantId, categoria, nivel, q]);

  // Agrupa por dia.
  const grupos = (() => {
    const map = new Map<string, (AuditLog | TecLog)[]>();
    const rows: (AuditLog | TecLog)[] = modo === 'simples' ? audit : tec;
    for (const r of rows) {
      const iso = ('criado_em' in r ? r.criado_em : r.timestamp).slice(0, 10);
      if (!map.has(iso)) map.set(iso, []);
      map.get(iso)!.push(r);
    }
    return [...map.entries()];
  })();
  const total = modo === 'simples' ? audit.length : tec.length;

  const selInput: CSSProperties = { width: 'auto', flex: '0 0 auto', minWidth: 150, maxWidth: 230, height: 38, fontSize: 13, padding: '0 34px 0 12px' };
  const dateInput: CSSProperties = { flex: '0 0 auto', width: 150, height: 38, fontSize: 13, padding: '0 10px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Alternador de modo */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 10, padding: 3 }}>
          {([['tecnico', 'Técnico'], ['simples', 'Simplificado']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setModo(k)} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '7px 16px', borderRadius: 8, background: modo === k ? 'var(--c-surface)' : 'transparent', color: modo === k ? 'var(--c-ink)' : 'var(--c-ink3)', boxShadow: modo === k ? 'var(--c-shadow)' : 'none' }}>{lbl}</button>
          ))}
        </div>
        <span style={{ color: 'var(--c-ink3)', fontSize: 13, marginLeft: 4 }}>
          {modo === 'simples' ? 'Eventos em linguagem natural (quem fez o quê).' : 'Log técnico do motor de automação.'}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--c-ink3)', fontSize: 12 }}>{loading ? 'carregando…' : `${total} evento(s)`}</span>
      </div>

      {/* Filtros */}
      <Card style={{ padding: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <label style={{ color: 'var(--c-ink3)', fontSize: 12 }}>De</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ia-input" style={dateInput} />
          <label style={{ color: 'var(--c-ink3)', fontSize: 12 }}>até</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ia-input" style={dateInput} />

          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="ia-input" style={selInput}>
            <option value="">Todos os assinantes</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          {modo === 'simples' && (
            <>
              <select value={usuario} onChange={(e) => setUsuario(e.target.value)} className="ia-input" style={selInput}>
                <option value="">Todos os usuários</option>
                {users.map((u) => <option key={u.id} value={u.email}>{u.nome} · {u.email}</option>)}
              </select>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="ia-input" style={selInput}>
                {CAT_LOG.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </>
          )}

          <select value={nivel} onChange={(e) => setNivel(e.target.value)} className="ia-input" style={selInput}>
            <option value="todos">Todos os níveis</option>
            {modo === 'simples'
              ? [['info', 'Info'], ['sucesso', 'Sucesso'], ['alerta', 'Alerta'], ['erro', 'Erro']].map(([k, l]) => <option key={k} value={k}>{l}</option>)
              : [['INFO', 'Info'], ['WARN', 'Warning'], ['ERROR', 'Error']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>

          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar no texto…" className="ia-input" style={{ flex: '1 1 160px', minWidth: 140, height: 38, fontSize: 13 }} />
          <button onClick={() => { setFrom(DIA_ATRAS(30)); setTo(DIA_HOJE()); setUsuario(''); setTenantId(''); setCategoria('todas'); setNivel('todos'); setQ(''); }} className="ia-btn-outline" style={{ height: 38, padding: '0 12px', fontSize: 13 }}>Limpar</button>
        </div>
      </Card>

      {/* Lista agrupada por dia */}
      {total === 0 ? (
        <Card style={{ padding: 40, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>{loading ? 'Carregando…' : modo === 'simples' ? 'Nenhum evento de auditoria ainda neste período. Eles aparecem aqui conforme as ações vão acontecendo (liberar assinante, dar baixa, iniciar automação, criar usuário…).' : 'Nenhum evento no período/filtros selecionados.'}</Card>
      ) : grupos.map(([dia, itens]) => (
        <div key={dia}>
          <SectionTitle right={<span style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{itens.length}</span>}>{rotuloDia(dia)}</SectionTitle>
          <Card style={{ overflow: 'hidden', marginTop: 10 }}>
            {(itens as (AuditLog | TecLog)[]).map((r, i) => modo === 'simples' ? (
              (() => { const a = r as AuditLog; return (
                <div key={a.id} style={{ display: 'flex', gap: 14, padding: '12px 18px', borderTop: i ? '1px solid var(--c-border)' : 'none' }}>
                  <span className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 12, width: 42, flex: 'none', paddingTop: 2 }}>{horaDe(a.criado_em)}</span>
                  <span style={{ width: 4, flex: 'none', borderRadius: 2, background: nivelCor(a.nivel), alignSelf: 'stretch' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--c-ink)', fontSize: 14 }}>{a.descricao}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: catCor(a.categoria) }}>{a.categoria}</span>
                      {a.actor_email && <span style={{ color: 'var(--c-ink3)', fontSize: 12 }}>· {a.actor_nome || a.actor_email}</span>}
                      {a.tenant_nome && <span style={{ color: 'var(--c-ink3)', fontSize: 12 }}>· {a.tenant_nome}</span>}
                    </div>
                  </div>
                </div>
              ); })()
            ) : (
              (() => { const t = r as TecLog; return (
                <div key={t.id} style={{ display: 'flex', gap: 12, padding: '9px 18px', borderTop: i ? '1px solid var(--c-border)' : 'none', alignItems: 'baseline' }}>
                  <span className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 12, width: 42, flex: 'none' }}>{horaDe(t.timestamp)}</span>
                  <span className="ia-mono" style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: nivelCor(t.level), width: 58, flex: 'none' }}>{t.level}</span>
                  <span className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 11, width: 54, flex: 'none' }}>#{t.upload_id}</span>
                  <span className="ia-mono" style={{ color: 'var(--c-ink2)', fontSize: 12.5, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{t.message}</span>
                </div>
              ); })()
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}

interface RegraItem { label: string; valor: string; desc: string; origem: string; tone?: 'ok' | 'warn' | 'accent' }
interface RegraGrupo { titulo: string; icone: string; regras: RegraItem[] }
interface RegrasResp {
  modo: { simulada: boolean };
  config?: {
    registration_concurrency: number;
    extraction_concurrency: number;
    max_rondas_retry: number;
    login_timeout_segundos: number;
    cadastro_timeout_segundos: number;
    watchdog_interval_minutos: number;
    automacao_simulada: boolean;
  };
  grupos: RegraGrupo[];
}

const ICONE_GRUPO: Record<string, ReactNode> = {
  cpu: <Cpu size={16} />, target: <ShieldCheck size={16} />, clock: <Loader2 size={16} />,
  file: <ScrollText size={16} />, shield: <Shield size={16} />, lock: <CreditCard size={16} />, power: <Wallet size={16} />,
};

function Regras({ showToast }: { showToast: (t: ToastData) => void }) {
  const [d, setD] = useState<RegrasResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Form states
  const [regConcurrency, setRegConcurrency] = useState(4);
  const [extConcurrency, setExtConcurrency] = useState(2);
  const [maxRetry, setMaxRetry] = useState(3);
  const [loginTimeout, setLoginTimeout] = useState(150);
  const [cadastroTimeout, setCadastroTimeout] = useState(360);
  const [watchdogInterval, setWatchdogInterval] = useState(5);
  const [simulada, setSimulada] = useState(true);

  const carregar = async () => {
    try {
      setLoading(true);
      const res = await apiGet<RegrasResp>('/admin/regras');
      setD(res);
      if (res.config) {
        setRegConcurrency(res.config.registration_concurrency);
        setExtConcurrency(res.config.extraction_concurrency);
        setMaxRetry(res.config.max_rondas_retry);
        setLoginTimeout(res.config.login_timeout_segundos);
        setCadastroTimeout(res.config.cadastro_timeout_segundos);
        setWatchdogInterval(res.config.watchdog_interval_minutos);
        setSimulada(res.config.automacao_simulada);
      }
    } catch {
      setD(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  const salvar = async () => {
    setSalvando(true);
    try {
      await apiPut('/admin/regras', {
        registration_concurrency: regConcurrency,
        extraction_concurrency: extConcurrency,
        max_rondas_retry: maxRetry,
        login_timeout_segundos: loginTimeout,
        cadastro_timeout_segundos: cadastroTimeout,
        watchdog_interval_minutos: watchdogInterval,
        automacao_simulada: simulada,
      });
      showToast({ title: 'Configurações salvas', msg: 'As regras do motor foram atualizadas com sucesso.', kind: 'ok' });
      setEditando(false);
      await carregar();
    } catch (e) {
      showToast({ title: 'Erro ao salvar', msg: (e as Error).message, kind: 'err' });
    } finally {
      setSalvando(false);
    }
  };

  if (loading) return <Card style={{ padding: 30, color: 'var(--c-ink3)', fontSize: 14 }}>Carregando regras…</Card>;
  if (!d) return <Card style={{ padding: 30, color: 'var(--c-ink3)', fontSize: 14 }}>Não foi possível carregar as regras.</Card>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--c-ink3)', fontSize: 13, margin: 0, flex: 1, minWidth: 260 }}>
          Regras operacionais <b>reais</b> que o motor de automação aplica hoje. Valores vindos da configuração do motor (workers) e das regras da API.
        </p>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: d.modo.simulada ? 'var(--c-warnsoft)' : 'var(--c-oksoft)', color: d.modo.simulada ? 'var(--c-warnfg)' : 'var(--c-okfg)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.modo.simulada ? 'var(--c-warn)' : 'var(--c-ok)' }} />
          Motor {d.modo.simulada ? 'em modo SIMULADO' : 'em modo REAL'}
        </span>
        {!editando && (
          <button onClick={() => setEditando(true)} className="ia-btn" style={{ padding: '8px 16px', fontSize: 13 }}>
            <Pencil size={14} /> Editar configurações
          </button>
        )}
      </div>

      {editando ? (
        <Card style={{ padding: 22 }}>
          <h3 style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>Editar Regras do Motor</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-ink2)', marginBottom: 6 }}>Listas Simultâneas</label>
              <input type="number" className="ia-input" min={1} value={regConcurrency} onChange={(e) => setRegConcurrency(Math.max(1, Number(e.target.value)))} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-ink2)', marginBottom: 6 }}>Extrações Simultâneas</label>
              <input type="number" className="ia-input" min={1} value={extConcurrency} onChange={(e) => setExtConcurrency(Math.max(1, Number(e.target.value)))} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-ink2)', marginBottom: 6 }}>Rodadas Extras (Retry)</label>
              <input type="number" className="ia-input" min={0} value={maxRetry} onChange={(e) => setMaxRetry(Math.max(0, Number(e.target.value)))} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-ink2)', marginBottom: 6 }}>Timeout de Login (segundos)</label>
              <input type="number" className="ia-input" min={10} value={loginTimeout} onChange={(e) => setLoginTimeout(Math.max(10, Number(e.target.value)))} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-ink2)', marginBottom: 6 }}>Timeout por Cadastro (segundos)</label>
              <input type="number" className="ia-input" min={10} value={cadastroTimeout} onChange={(e) => setCadastroTimeout(Math.max(10, Number(e.target.value)))} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-ink2)', marginBottom: 6 }}>Watchdog Intervalo (minutos)</label>
              <input type="number" className="ia-input" min={1} value={watchdogInterval} onChange={(e) => setWatchdogInterval(Math.max(1, Number(e.target.value)))} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--c-ink2)', marginBottom: 6 }}>Modo Simulação</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Switch on={simulada} onClick={() => setSimulada(!simulada)} />
                <span style={{ fontSize: 13, color: 'var(--c-ink2)' }}>{simulada ? 'Simulada' : 'Real (Produção)'}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--c-border)', paddingTop: 16 }}>
            <button onClick={() => setEditando(false)} className="ia-btn-outline" style={{ padding: '9px 16px' }}>Cancelar</button>
            <button onClick={salvar} disabled={salvando} className="ia-btn" style={{ padding: '9px 20px' }}>
              {salvando ? 'Salvando…' : 'Salvar Regras'}
            </button>
          </div>
        </Card>
      ) : (
        <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
          {d.grupos.map((g) => (
            <Card key={g.titulo} style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 18px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)' }}>
                <span style={{ color: 'var(--c-softfg)', display: 'grid', placeItems: 'center' }}>{ICONE_GRUPO[g.icone] ?? <SlidersHorizontal size={16} />}</span>
                <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700 }}>{g.titulo}</span>
              </div>
              {g.regras.map((r, i) => {
                const cor = r.tone === 'ok' ? 'var(--c-okfg)' : r.tone === 'warn' ? 'var(--c-warnfg)' : r.tone === 'accent' ? 'var(--c-softfg)' : 'var(--c-ink)';
                return (
                  <div key={i} style={{ padding: '13px 18px', borderTop: i ? '1px solid var(--c-border)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{r.label}</span>
                      <span style={{ color: cor, fontSize: 13.5, fontWeight: 700, textAlign: 'right', flex: 'none' }}>{r.valor}</span>
                    </div>
                    <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{r.desc}</div>
                    <div style={{ color: 'var(--c-ink3)', fontSize: 10.5, marginTop: 4, opacity: 0.7 }} className="ia-mono">{r.origem}</div>
                  </div>
                );
              })}
            </Card>
          ))}
        </div>
      )}

      <p style={{ color: 'var(--c-ink3)', fontSize: 12, margin: 0 }}>
        Estas regras são definidas no motor e salvas na tabela de configurações. Alterações entram em vigor no próximo ciclo de execução.
      </p>
    </div>
  );
}

interface InfraMetrics {
  api: {
    status: string;
    cpuLoad: number;
    memoryUsedGb: number;
    memoryTotalGb: number;
    memoryPct: number;
    apiMemoryMb: number;
    uptime: number;
    networkBps: string;
  };
  db: {
    status: string;
    latencyMs: number;
    connections: number;
    sizeFormatted: string;
  };
  redis: {
    status: string;
    latencyMs: number;
    memoryUsedFormatted: string;
    activeStreams: number;
  };
  saas?: {
    totalTerminais: number;
    totalFaturamento: number;
    precoMedio: number;
  };
}

function Infra() {
  const [metrics, setMetrics] = useState<InfraMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [terminais, setTerminais] = useState(0);
  const [preco, setPreco] = useState(0);

  useEffect(() => {
    const carregarMetricas = () => {
      apiGet<InfraMetrics>('/admin/infra-metrics')
        .then((m) => {
          setMetrics(m);
          setLoading(false);
          setTerminais((prev) => prev === 0 && m.saas ? m.saas.totalTerminais : prev || 25);
          setPreco((prev) => prev === 0 && m.saas ? m.saas.precoMedio : prev || 2000);
        })
        .catch(() => {});
    };
    carregarMetricas();
    const t = setInterval(carregarMetricas, 4000);
    return () => clearInterval(t);
  }, []);

  const dolarTaxa = 5.5;
  const custoFixoUsd = 48; // API Droplet real cost
  const custoFixo = custoFixoUsd * dolarTaxa;
  const custoVpsPorTerminal = 0; // Terminais rodam sob a mesma infraestrutura, custo extra por terminal = R$ 0

  const faturamento = terminais * preco;
  const custoRobos = terminais * custoVpsPorTerminal;
  const custoTotal = faturamento > 0 ? custoFixo + custoRobos : 0;
  const lucro = faturamento - custoTotal;
  const margem = faturamento > 0 ? (lucro / faturamento) * 100 : 0;

  if (loading && !metrics) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'var(--c-ink3)' }}>
        <Loader2 size={32} style={{ animation: 'ia-spin .8s linear infinite', color: 'var(--c-blue)' }} />
        <div style={{ marginTop: 12, fontSize: 14 }}>Carregando dados reais da infraestrutura…</div>
      </div>
    );
  }

  const apiStatus = metrics?.api.status || 'offline';
  const dbStatus = metrics?.db.status || 'disconnected';
  const redisStatus = metrics?.redis.status || 'offline';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Grid de Status da Infra */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-ink)' }}>🖥️ Servidor API (DigitalOcean)</span>
            <span style={{ fontSize: 11, background: apiStatus === 'online' ? 'var(--c-oksoft)' : 'var(--c-errsoft)', color: apiStatus === 'online' ? 'var(--c-okfg)' : 'var(--c-err)', fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
              {apiStatus === 'online' ? 'Online' : 'Offline'}
            </span>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-ink3)', marginBottom: 4 }}>
              <span>Uso de CPU (Sistema)</span>
              <strong>{metrics?.api.cpuLoad ?? 0}%</strong>
            </div>
            <div style={{ height: 6, background: 'var(--c-border)', borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ height: '100%', width: `${metrics?.api.cpuLoad ?? 0}%`, background: '#3B82F6', borderRadius: 999 }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-ink3)', marginBottom: 4 }}>
              <span>Uso de RAM (Sistema)</span>
              <strong>{metrics?.api.memoryPct ?? 0}% ({metrics?.api.memoryUsedGb ?? 0} GB / {metrics?.api.memoryTotalGb ?? 0} GB)</strong>
            </div>
            <div style={{ height: 6, background: 'var(--c-border)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${metrics?.api.memoryPct ?? 0}%`, background: '#10B981', borderRadius: 999 }} />
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 14, paddingTop: 14, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-ink2)' }}>
            <span>Banda de rede: <strong>{metrics?.api.networkBps || '0.00 Mbps'}</strong></span>
            <span>RSS API: <strong>{metrics?.api.apiMemoryMb ?? 0} MB</strong></span>
          </div>
        </Card>

        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-ink)' }}>🗄️ Banco de Dados (Supabase)</span>
            <span style={{ fontSize: 11, background: dbStatus === 'connected' ? 'var(--c-oksoft)' : 'var(--c-errsoft)', color: dbStatus === 'connected' ? 'var(--c-okfg)' : 'var(--c-err)', fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
              {dbStatus === 'connected' ? 'Conectado' : 'Desconectado'}
            </span>
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--c-ink3)' }}>Latência média</span>
              <strong style={{ color: 'var(--c-blue)' }}>{metrics?.db.latencyMs ?? 0} ms</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--c-ink3)' }}>Pool de conexões</span>
              <strong>{metrics?.db.connections ?? 0} ativas</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--c-ink3)' }}>Tamanho do banco</span>
              <strong>{metrics?.db.sizeFormatted ?? '—'}</strong>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 14, paddingTop: 14, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-ink2)' }}>
            <span>Backups diários: <strong style={{ color: 'var(--c-okfg)' }}>Ativos</strong></span>
            <span>SSL/RLS: <strong style={{ color: 'var(--c-okfg)' }}>Forçado</strong></span>
          </div>
        </Card>

        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-ink)' }}>⚡ Cache & Filas (Redis)</span>
            <span style={{ fontSize: 11, background: redisStatus === 'online' ? 'var(--c-oksoft)' : 'var(--c-errsoft)', color: redisStatus === 'online' ? 'var(--c-okfg)' : 'var(--c-err)', fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
              {redisStatus === 'online' ? 'Operacional' : 'Offline'}
            </span>
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--c-ink3)' }}>Latência local</span>
              <strong style={{ color: 'var(--c-okfg)' }}>{metrics?.redis.latencyMs ?? 0} ms</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--c-ink3)' }}>Uso de Memória</span>
              <strong>{metrics?.redis.memoryUsedFormatted ?? '—'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--c-ink3)' }}>Terminais ativos</span>
              <strong style={{ color: 'var(--c-cyan)' }}>{metrics?.redis.activeStreams ?? 0} robôs</strong>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 14, paddingTop: 14, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-ink2)' }}>
            <span>Comunicação: <strong>Microsegundos</strong></span>
            <span>Egress cost: <strong>R$ 0,00 (Local)</strong></span>
          </div>
        </Card>
      </div>

      {/* Grid de Escala e Simulador */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        {/* Guia de Dimensionamento */}
        <Card style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700, margin: 0 }}>📊 Guia de Dimensionamento e Escala</h3>
          <p style={{ color: 'var(--c-ink3)', fontSize: 13, margin: 0 }}>Parâmetros práticos de hardware para saber quando escalar a infraestrutura central:</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            <div style={{ borderLeft: '3px solid #3B82F6', paddingLeft: 12, background: 'var(--c-oksoft)', borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-okfg)' }}>Fase 1: Droplet Atual ($48/mês - 8GB RAM, 4 CPUs)</div>
              <div style={{ fontSize: 12, color: 'var(--c-okfg)', marginTop: 4 }}>
                Suporta até <strong>500 robôs em segundo plano</strong> ou <strong>75 telas ao vivo simultâneas</strong>. (Seu ambiente real atual).
              </div>
            </div>

            <div style={{ borderLeft: '3px solid #10B981', paddingLeft: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-ink)' }}>Fase 2: Droplet Médio ($24/mês - 4GB RAM, 2 CPUs)</div>
              <div style={{ fontSize: 12, color: 'var(--c-ink3)', marginTop: 4 }}>
                Fazer upgrade ao passar de 100 robôs. Suporta até <strong>300 robôs ativos</strong> ou <strong>50 telas ao vivo simultâneas</strong>.
              </div>
            </div>

            <div style={{ borderLeft: '3px solid var(--c-warn)', paddingLeft: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-ink)' }}>Fase 3: Clusterização (Acima de 300 robôs)</div>
              <div style={{ fontSize: 12, color: 'var(--c-ink3)', marginTop: 4 }}>
                Separar o Redis em um Droplet dedicado e hospedar APIs Node sob balanceadores de carga (Load Balancers).
              </div>
            </div>
          </div>
        </Card>

        {/* Simulador SaaS */}
        <Card style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700, margin: 0 }}>💸 Calculadora de Lucro e Custos SaaS</h3>
          
          {metrics?.saas && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, background: 'var(--c-soft)', color: 'var(--c-softfg)', padding: '10px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, alignItems: 'center' }}>
              <span>Métricas reais atuais:</span>
              <span style={{ background: 'var(--c-surface)', padding: '2px 8px', borderRadius: 4, fontSize: 11.5 }}>{metrics.saas.totalTerminais} terminais ativos</span>
              <span style={{ background: 'var(--c-surface)', padding: '2px 8px', borderRadius: 4, fontSize: 11.5 }}>Faturamento: {brl(metrics.saas.totalFaturamento)}/mês</span>
              <span style={{ background: 'var(--c-surface)', padding: '2px 8px', borderRadius: 4, fontSize: 11.5 }}>Preço médio: {brl(metrics.saas.precoMedio)}</span>
            </div>
          )}
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--c-ink2)', marginBottom: 4 }}>
                <span>Terminais contratados:</span>
                <strong>{terminais}</strong>
              </div>
              <input type="range" min="1" max="500" value={terminais} onChange={(e) => setTerminais(Number(e.target.value))} style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--c-ink2)', marginBottom: 4 }}>
                <span>Preço cobrado por terminal (mensal):</span>
                <strong>{brl(preco)}</strong>
              </div>
              <input type="range" min="500" max="5000" step="100" value={preco} onChange={(e) => setPreco(Number(e.target.value))} style={{ width: '100%', cursor: 'pointer' }} />
            </div>
          </div>

          <div style={{ background: 'var(--c-surface2)', borderRadius: 10, padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 6 }}>
            <div>
              <div style={{ color: 'var(--c-ink3)', fontSize: 11 }}>Faturamento bruto</div>
              <div style={{ color: 'var(--c-ink)', fontSize: 18, fontWeight: 700 }}>{brl(faturamento)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--c-ink3)', fontSize: 11 }}>Custo de servidores</div>
              <div style={{ color: 'var(--c-err)', fontSize: 18, fontWeight: 700 }}>{brl(custoTotal)}</div>
            </div>
            <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8, gridColumn: 'span 2' }} />
            <div>
              <div style={{ color: 'var(--c-ink3)', fontSize: 11 }}>Lucro líquido</div>
              <div style={{ color: 'var(--c-okfg)', fontSize: 18, fontWeight: 700 }}>{brl(lucro)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--c-ink3)', fontSize: 11 }}>Margem de lucro</div>
              <div style={{ color: 'var(--c-blue)', fontSize: 18, fontWeight: 700 }}>{margem.toFixed(1).replace('.', ',')}%</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
