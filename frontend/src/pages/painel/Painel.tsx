import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, UploadCloud, Clock, Settings as SettingsIcon, Sun, Moon, LogOut,
  FileSpreadsheet, Eye, Trash2, Wallet, Users, CheckCircle2, Radio, X,
  Loader2, AlertTriangle, XCircle, FileText, Bug, ScrollText, Play, Pause, Square,
  Cpu, Building2, Menu,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { useTheme, LogoMark, useToast, Toast } from '../../components/iacmd/ui';
import ProfileSecurity from '../../components/iacmd/ProfileSecurity';
import { AgentSphere } from '../../components/iacmd/AgentSphere';
import { apiGet, apiPost, apiUpload, apiDelete, apiPatch } from '../../lib/api';
import type { Upload, Ficha, ClinicAccount, Me, LogEntry, EconomiaResp } from '../../lib/types';
import { StatusPill, Card, ProgressBar, fmtMilhar, brl, economia, fichaTone, toneLabel } from './parts';
import Pendencias from './Pendencias';
import Config from './Config';
import Planos from './Planos';
import { RoboAoVivo, RoboAoVivoModal } from './RoboAoVivo';
import { Maximize2 } from 'lucide-react';

type Page = 'painel' | 'enviar' | 'pendencias' | 'planos' | 'config';
const NAV: { key: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'painel', label: 'Painel', icon: LayoutDashboard },
  { key: 'enviar', label: 'Fichas', icon: UploadCloud },
  { key: 'pendencias', label: 'Pendências', icon: Clock },
  { key: 'planos', label: 'Meu plano', icon: Wallet },
  { key: 'config', label: 'Configurações', icon: SettingsIcon },
];
const TITLE: Record<Page, string> = { painel: 'Painel', enviar: 'Fichas', pendencias: 'Pendências', planos: 'Meu plano', config: 'Configurações' };
const SUB: Record<Page, string> = { painel: 'Resumo da operação', enviar: 'Importe planilhas e acompanhe os envios', pendencias: 'Fichas que precisam de atenção', planos: 'Empresas, terminais e cobrança', config: 'Contas, automação e segurança' };
const OK = ['registered', 'verified_ok', 'verified_divergent', 'done_manually', 'done'];
type StatsResp = { registrados: number; erros: number; pendentes: number; hoje: number; por_dia: { dia: string; n: number }[]; erros_por_tipo: { motivo: string; n: number }[]; media_cadastros_dia: number; dias_ativos: number; funcionarios_operacao: number; cadastros_dia_por_funcionario: number; funcionarios_equivalentes_real: number };

const initials = (s: string) => (s || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function Painel() {
  const { signOut, session } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const [toast, showToast] = useToast();
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [liveSidebarUpload, setLiveSidebarUpload] = useState<Upload | null>(null);
  const [page, setPageInternal] = useState<Page>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cmd_active_page') as Page;
      if (saved && ['painel', 'enviar', 'pendencias', 'config', 'planos'].includes(saved)) {
        return saved;
      }
    }
    return 'painel';
  });

  const setPage = (newPage: Page) => {
    setPageInternal(newPage);
    if (typeof window !== 'undefined') {
      localStorage.setItem('cmd_active_page', newPage);
    }
  };

  const [tenant, setTenant] = useState<Me['tenant'] | null>(null);
  const [isMember, setIsMember] = useState(false); // membro de equipe (acesso restrito)
  const [filtroMembro, setFiltroMembro] = useState<string>(''); // filtro por membro/operador
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>(''); // filtro por empresa
  const [membros, setMembros] = useState<{ user_id: string; nome: string | null; email: string; empresa_id?: number | null }[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [patients, setPatients] = useState<Ficha[]>([]);
  const [contas, setContas] = useState<ClinicAccount[]>([]);
  const [empresas, setEmpresas] = useState<any[]>([]);

  useEffect(() => {
    window.scrollTo(0, 0);
    const mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.scrollTop = 0;
    }
  }, [page]);

  const carregar = useCallback(async () => {
    const [me, u, p, c, e] = await Promise.all([
      apiGet<Me>('/me'),
      apiGet<Upload[]>('/uploads'),
      apiGet<Ficha[]>('/patients'),
      apiGet<ClinicAccount[]>('/clinic-accounts'),
      apiGet<any[]>('/empresas').catch(() => [])
    ]);
    setTenant(me.tenant); setIsMember(!!me.member); setUploads(u); setPatients(p); setContas(c); setEmpresas(e);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { const t = setInterval(() => void carregar().catch(() => {}), 2000); return () => clearInterval(t); }, [carregar]);
  useEffect(() => { if (isMember && ['planos', 'config'].includes(page)) setPage('painel'); }, [isMember, page]);
  useEffect(() => { if (!isMember) void apiGet<any[]>('/equipe').then(setMembros).catch(() => setMembros([])); }, [isMember, contas.length]);

  // ---- FILTRO por membro/empresa (dono): aplica a fichas, pendências e dashboard ----
  const uploadsView = uploads.filter((u) => {
    if (empresas.length > 1 && filtroEmpresa) {
      if (String(u.empresa_id ?? '') !== filtroEmpresa) return false;
    }
    if (filtroMembro) {
      const ca = contas.find((c) => c.id === u.clinic_account_id);
      const matchesCreator = u.uploaded_by === filtroMembro;
      const matchesTerminal = ca?.member_user_id === filtroMembro;
      if (!matchesCreator && !matchesTerminal) return false;
    }
    return true;
  });

  const patientsView = patients.filter((p) => {
    if (empresas.length > 1 && filtroEmpresa) {
      if (String(p.uploads?.empresa_id ?? '') !== filtroEmpresa) return false;
    }
    if (filtroMembro) {
      const ca = contas.find((c) => c.id === p.clinic_account_id);
      const matchesCreator = p.uploads?.uploaded_by === filtroMembro;
      const matchesTerminal = ca?.member_user_id === filtroMembro;
      if (!matchesCreator && !matchesTerminal) return false;
    }
    return true;
  });

  const pendCount = patientsView.filter((p) => p.status === 'error' || p.status === 'needs_review').length;
  // Reflete o filtro do header: sidebar "Em execução" e status "IA ativa" mostram
  // o terminal selecionado (ou todos, se sem filtro) — ao vivo como se estivesse na conta.
  const runningUploads = uploadsView.filter((u) => ['registering', 'extracting'].includes(u.status));
  // Mostra o ao vivo SEMPRE que houver automação rodando (o filtro só narrow-a a lista).
  const showRealTime = runningUploads.length > 0;
  const running = showRealTime;

  return (
    <div className="iacmd ia-shell" data-theme={theme} data-menu={menuOpen ? 'open' : 'closed'} style={{ display: 'grid', gridTemplateColumns: '244px 1fr', height: '100vh', overflow: 'hidden' }}>
      {menuOpen && <div className="ia-shell-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside style={{ display: 'flex', flexDirection: 'column', background: 'var(--c-side)', borderRight: '1px solid var(--c-side-border)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '18px' }}><LogoMark size={34} /><span style={{ color: 'var(--c-side-ink)', fontWeight: 700, fontSize: 18 }}>IA-CMD</span></div>
        <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.filter((n) => !(isMember && (n.key === 'planos' || n.key === 'config'))).map(({ key, label, icon: Icon }) => {
            const active = page === key;
            return (
              <button key={key} onClick={() => { setPage(key); setMenuOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', fontSize: 14, fontWeight: active ? 600 : 500, color: active ? 'var(--c-side-active-ink)' : 'var(--c-side-ink2)', background: active ? 'var(--c-side-active-bg)' : 'transparent' }}>
                <Icon size={18} /><span style={{ flex: 1 }}>{label}</span>
                {key === 'pendencias' && pendCount > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--c-err)', minWidth: 18, height: 18, borderRadius: 999, display: 'grid', placeItems: 'center', padding: '0 5px' }}>{pendCount}</span>}
              </button>
            );
          })}
        </nav>
        {showRealTime && (
          <div style={{ borderTop: '1px solid var(--c-side-border)', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 16px 6px', flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-cyan)', animation: 'ia-pulse 1.5s infinite' }} />
              <span style={{ color: 'var(--c-side-ink3)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Em execução</span>
            </div>
            <div style={{ maxHeight: runningUploads.length > 3 ? 340 : 'none', overflowY: runningUploads.length > 3 ? 'auto' : 'visible', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {runningUploads.map((u) => (
                 <LiveFeed key={u.id} upload={u} patients={patients.filter((p) => p.upload_id === u.id)} contas={contas} multiple={runningUploads.length > 1} onClick={() => setLiveSidebarUpload(u)} />
              ))}
            </div>
          </div>
        )}
        <div style={{ flexShrink: 0, padding: 14, borderTop: '1px solid var(--c-side-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: 'var(--c-side-ink3)', fontSize: 11, padding: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tenant?.name}</div>
          <button onClick={signOut} style={navFoot}><LogOut size={16} /> Sair</button>
        </div>
      </aside>

      <main style={{ minWidth: 0, overflowY: 'auto' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 30, minHeight: 68, background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
          <button className="ia-hamburger" onClick={() => setMenuOpen(true)} title="Menu" style={{ width: 38, height: 38, flex: 'none', borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer', placeItems: 'center' }}><Menu size={18} /></button>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, letterSpacing: '-.01em', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{TITLE[page]}</h1>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{SUB[page]}</div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {/* Filtro por TERMINAL / MEMBRO (dono) — aplica a fichas, pendências e dashboard */}
            {/* Filtro por Membro (Operador) */}
            {!isMember && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: filtroMembro ? 'var(--c-soft)' : 'var(--c-surface2)', border: `1px solid ${filtroMembro ? 'var(--c-blue)' : 'var(--c-border)'}`, borderRadius: 10, padding: '0 4px 0 10px', height: 40, minWidth: 0, maxWidth: 280, flexShrink: 1 }}>
                <Users size={16} style={{ color: 'var(--c-softfg)', flex: 'none' }} />
                <select value={filtroMembro} onChange={(e) => setFiltroMembro(e.target.value)} title="Filtrar por operador" style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', background: 'transparent', color: 'var(--c-ink)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', outline: 'none', padding: '0 24px 0 0', minWidth: 0, textOverflow: 'ellipsis', backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237A89A6' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right center' }}>
                  <option value="">Todos os operadores</option>
                  {session?.user?.id && (
                    <option value={session.user.id}>
                      {(session.user.user_metadata as any)?.full_name || 'Assinante / Titular'} (Assinante)
                    </option>
                  )}
                  {membros.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.nome || m.email}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Filtro por Empresa (só aparece se houver mais de uma empresa cadastrada) */}
            {!isMember && empresas.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: filtroEmpresa ? 'var(--c-soft)' : 'var(--c-surface2)', border: `1px solid ${filtroEmpresa ? 'var(--c-blue)' : 'var(--c-border)'}`, borderRadius: 10, padding: '0 4px 0 10px', height: 40, minWidth: 0, maxWidth: 280, flexShrink: 1 }}>
                <Building2 size={16} style={{ color: 'var(--c-softfg)', flex: 'none' }} />
                <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} title="Filtrar por empresa" style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', background: 'transparent', color: 'var(--c-ink)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', outline: 'none', padding: '0 24px 0 0', minWidth: 0, textOverflow: 'ellipsis', backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237A89A6' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right center' }}>
                  <option value="">Todas as empresas</option>
                  {empresas.map((emp) => (
                    <option key={emp.id} value={String(emp.id)}>
                      {emp.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 999, fontSize: 13, fontWeight: 600, color: running ? 'var(--c-okfg)' : 'var(--c-ink3)', background: running ? 'var(--c-oksoft)' : 'var(--c-surface2)', border: '1px solid var(--c-border)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: running ? 'var(--c-ok)' : 'var(--c-ink3)' }} />
              {running ? 'IA ativa' : 'IA ociosa'}
            </span>
            <button onClick={toggleTheme} title="Alternar tema" style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
            <button onClick={() => setPerfilAberto(true)} title="Perfil e segurança" style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'linear-gradient(135deg,#2563EB,#38BDF8)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>{initials((session?.user?.user_metadata as { full_name?: string } | undefined)?.full_name || tenant?.name || 'U')}</button>
          </div>
        </div>
        <div className="ia-main-pad" style={{ maxWidth: page === 'painel' && runningUploads.length > 0 ? '100%' : 1180, margin: '0 auto', padding: 28, animation: 'ia-slide .25s ease' }}>
          <div style={{ display: page === 'painel' ? 'block' : 'none' }}>
            <Home
              tenant={tenant}
              uploads={uploadsView}
              patients={patientsView}
              empresas={empresas}
              contas={contas}
              filtroMembro={filtroMembro}
              filtroEmpresa={filtroEmpresa}
              onEnviar={() => setPage('enviar')}
              onChange={carregar}
              showToast={showToast}
            />
          </div>
          <div style={{ display: page === 'enviar' ? 'block' : 'none' }}>
            <Enviar empresas={empresas} uploads={uploadsView} contas={contas} isMember={isMember} onChange={carregar} showToast={showToast} />
          </div>
          <div style={{ display: page === 'pendencias' ? 'block' : 'none' }}>
            <Pendencias patients={patientsView} uploads={uploadsView} onChange={carregar} showToast={showToast} />
          </div>
          <div style={{ display: page === 'planos' ? 'block' : 'none' }}>
            <Planos
              tenant={tenant}
              contas={contas}
              membros={membros}
              ownerId={session?.user?.id}
              ownerName={(session?.user?.user_metadata as any)?.full_name || 'Titular'}
              onChange={carregar}
              showToast={showToast}
            />
          </div>
          <div style={{ display: page === 'config' ? 'block' : 'none' }}>
            <Config tenant={tenant} contas={contas} empresas={empresas} isMember={isMember} filtroMembro={filtroMembro} onChange={carregar} showToast={showToast} />
          </div>
        </div>
      </main>
      {perfilAberto && <ProfileSecurity onClose={() => setPerfilAberto(false)} showToast={showToast} papelLabel="Assinante" />}
      {liveSidebarUpload && <RoboAoVivoModal upload={liveSidebarUpload} onClose={() => setLiveSidebarUpload(null)} />}
      <Toast data={toast} />
    </div>
  );
}
const navFoot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 6px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--c-side-ink2)', fontSize: 14, fontFamily: 'inherit', cursor: 'pointer' };

/* ============ PAINEL (home) ============ */
function Home({ tenant, uploads, patients, empresas = [], contas = [], filtroMembro = '', filtroEmpresa = '', onEnviar, onChange, showToast }: { tenant: Me['tenant'] | null; uploads: Upload[]; patients: Ficha[]; empresas?: { id: number; nome: string; terminais_contratados?: number }[]; contas?: ClinicAccount[]; filtroMembro?: string; filtroEmpresa?: string; onEnviar: () => void; onChange: () => Promise<void>; showToast: (t: { title: string; msg: string; kind: 'ok' | 'err' }) => void }) {
  const [robo, setRobo] = useState(false);
  const [modalUpload, setModalUpload] = useState<Upload | null>(null);
  const [hoverBar, setHoverBar] = useState<number | null>(null);
  // Estatísticas REAIS (agregado no banco, sem o teto de 500 da lista /patients).
  const [stats, setStats] = useState<StatsResp | null>(null);

  const runningUploads = uploads.filter((u) => ['registering', 'extracting'].includes(u.status));
  const custo = Number(tenant?.custo_mensal_funcionario ?? 3000) || 3000;
  const ok = patients.filter((p) => OK.includes(p.status));
  const reg = stats ? stats.registrados : ok.length;
  const err = stats ? stats.erros : patients.filter((p) => p.status === 'error').length;
  const regSemana = stats ? stats.por_dia.reduce((s, d) => s + d.n, 0) : ok.length;

  // Economia REAL (RPC do backend, que usa os custos do funcionário). Atualiza
  // sozinha; cai para a estimativa JS só enquanto carrega.
  const [eco, setEco] = useState<EconomiaResp | null>(null);
  const [ecoSem, setEcoSem] = useState<EconomiaResp | null>(null);
  useEffect(() => {
    const inicio = new Date(Date.now() - 7 * 864e5).toISOString();
    const queryParts: string[] = [];
    if (filtroMembro) queryParts.push(`member_user_id=${filtroMembro}`);
    if (empresas.length > 1 && filtroEmpresa) queryParts.push(`empresa_id=${filtroEmpresa}`);
    const qStr = queryParts.join('&');
 
    const puxar = () => {
      apiGet<EconomiaResp>(`/economia?${qStr}`).then(setEco).catch(() => {});
      apiGet<EconomiaResp>(`/economia?inicio=${encodeURIComponent(inicio)}${qStr ? '&' + qStr : ''}`).then(setEcoSem).catch(() => {});
      apiGet<StatsResp>(`/stats?${qStr}`).then(setStats).catch(() => {});
    };
    puxar();
    const t = setInterval(puxar, 4000);
    return () => clearInterval(t);
  }, [filtroMembro, filtroEmpresa, empresas.length]);
  const custoMin = eco?.custo_minuto ?? custo / (176 * 60);
  const ecoTotal = { valor: eco ? eco.valor_economizado : economia(reg, custo).valor };
  const ecoSemana = { valor: ecoSem ? ecoSem.valor_economizado : economia(regSemana, custo).valor };
  const minPoupados = eco ? eco.minutos_economizados : reg * 14;
  const horasPoupadas = Math.floor(minPoupados / 60);
  const minPoupadosResto = Math.round(minPoupados % 60);
  const taxa = reg + err > 0 ? Math.round((reg / (reg + err)) * 1000) / 10 : 100;

  // Série dos últimos 7 dias — cadastros REAIS por DATA DO CADASTRO (do /stats).
  const dias = useMemo(() => {
    const porDia = new Map((stats?.por_dia ?? []).map((d) => [d.dia, d.n]));
    const arr: { dia: string; n: number; r: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const key = d.toISOString().slice(0, 10);
      const n = porDia.get(key) ?? 0;
      arr.push({ dia: key.slice(8) + '/' + key.slice(5, 7), n, r: n * 14 * custoMin });
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, custoMin]);
  const maxN = Math.max(1, ...dias.map((d) => d.n));
  // Capacidade diária da equipe manual = funcionários × cadastros/dia (real).
  const capManualDia = (stats?.funcionarios_operacao ?? 0) * (stats?.cadastros_dia_por_funcionario ?? 0);

  const showRealTime = runningUploads.length > 0; // ao vivo sempre que houver automação rodando
 
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {showRealTime ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 18 }}>
          {/* Agente */}
          <Card style={{ padding: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'start', minHeight: 400 }}>
            <AgentSphere active={true} size={160} />
            <div style={{ color: 'var(--c-softfg)', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', marginTop: 16 }}>IA-CMD</div>
            <div style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, marginTop: 4 }}>Agente de IA em andamento</div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 13, marginTop: 4 }}>Cadastro automático no CMD-COLETA</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 20 }}>
              <button onClick={() => { setModalUpload(runningUploads[0]); setRobo(true); }} className="ia-btn" style={{ width: '100%' }}><Radio size={16} /> Ver Robô Ao Vivo</button>
              <button onClick={onEnviar} className="ia-btn-outline" style={{ width: '100%', justifyContent: 'center' }}><UploadCloud size={16} /> Enviar Fichas</button>
            </div>
          </Card>

          {/* Screencasts */}
          {runningUploads.map((up) => (
            <div key={up.id} style={{ position: 'relative', minHeight: 400 }}>
              <RoboAoVivo upload={up} />
              <button onClick={() => { setModalUpload(up); setRobo(true); }} title="Tela cheia" style={{ position: 'absolute', top: 56, right: 14, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(15,27,51,.7)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><Maximize2 size={13} /> Tela cheia</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="r-agent-row" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {/* Agente */}
          <Card className="r-agent-card" style={{ width: 340, flex: 'none', padding: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'start' }}>
            <AgentSphere active={false} size={160} />
            <div style={{ color: 'var(--c-softfg)', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', marginTop: 16 }}>IA-CMD</div>
            <div style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, marginTop: 4 }}>Agente de IA inativo</div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 13, marginTop: 4 }}>Cadastro automático no CMD-COLETA</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 20 }}>
              <button onClick={onEnviar} className="ia-btn-outline" style={{ width: '100%', justifyContent: 'center' }}><UploadCloud size={16} /> Enviar Fichas</button>
            </div>
          </Card>

          {/* Cadastros */}
          <Card style={{ flex: 1, minWidth: 320, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div><div style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Total de cadastros</div><div style={{ color: 'var(--c-ink)', fontSize: 48, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{fmtMilhar(reg)}</div><div style={{ color: 'var(--c-ink3)', fontSize: 14 }}>pacientes registrados</div></div>
            </div>
            {/* Legenda / indicadores do gráfico */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, fontSize: 11, color: 'var(--c-ink3)', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'linear-gradient(180deg,#38BDF8,#2563EB)' }} /> Cadastros da IA por dia</span>
              {capManualDia > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, borderTop: '2px dashed var(--c-warn)' }} /> Capacidade da equipe manual ({fmtMilhar(capManualDia)}/dia)</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 130, marginTop: 10, position: 'relative' }}>
              {capManualDia > 0 && capManualDia <= maxN && (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${19 + (capManualDia / maxN) * 90}px`, borderTop: '2px dashed var(--c-warn)', zIndex: 3, pointerEvents: 'none' }} title={`Sua equipe manual fazia ~${fmtMilhar(capManualDia)} cadastros/dia`}>
                  <span style={{ position: 'absolute', right: 0, top: -15, fontSize: 10, fontWeight: 700, color: 'var(--c-warnfg)', background: 'var(--c-surface)', padding: '0 4px', borderRadius: 4 }}>equipe: {fmtMilhar(capManualDia)}/dia</span>
                </div>
              )}
              {dias.map((d, i) => (
                <div key={i} onMouseEnter={() => setHoverBar(i)} onMouseLeave={() => setHoverBar(null)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative', cursor: 'default' }}>
                  {hoverBar === i && (
                    <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translate(-50%,-100%)', background: 'var(--c-ink)', color: 'var(--c-surface)', padding: '5px 9px', borderRadius: 7, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 6, pointerEvents: 'none', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>
                      {d.dia}: {fmtMilhar(d.n)} cadastro{d.n === 1 ? '' : 's'} · {brl(d.r)}
                    </div>
                  )}
                  <div style={{ width: '70%', height: `${(d.n / maxN) * 90}px`, minHeight: 3, background: hoverBar === i ? 'linear-gradient(180deg,#7DD3FC,#3B82F6)' : 'linear-gradient(180deg,#38BDF8,#2563EB)', borderRadius: 5, transition: 'background .15s' }} />
                  <span style={{ color: hoverBar === i ? 'var(--c-ink)' : 'var(--c-ink3)', fontSize: 10, fontWeight: hoverBar === i ? 700 : 400 }}>{d.dia}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--c-border)' }}>
              <Mini label="Esta semana" v={fmtMilhar(regSemana)} /><Mini label="Total" v={fmtMilhar(reg)} /><Mini label="Erros" v={fmtMilhar(err)} />
            </div>
          </Card>
        </div>
      )}

      {/* Economia & Cadastros */}
      <Card style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}><Wallet size={18} style={{ color: 'var(--c-blue)' }} /><span style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700 }}>Economia & Cadastros</span></div>
        <div className="r-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          <Sub icon={<Wallet size={15} />} label="Economizado">
            <Row k="Esta semana" v={brl(ecoSemana.valor)} /><Row k="Total" v={brl(ecoTotal.valor)} accent />
          </Sub>
          <Sub icon={<Users size={15} />} label="Funcionários poupados">
            <div style={{ color: 'var(--c-ink)', fontSize: 30, fontWeight: 700, marginTop: 6 }}>{(stats?.funcionarios_equivalentes_real ?? 0).toFixed(1).replace('.', ',')}</div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>equivalente (produtividade real)</div>
            <Row k="Cadastros" v={fmtMilhar(reg)} accent />
          </Sub>
          <Sub icon={<Clock size={15} />} label="Tempo poupado">
            <div style={{ color: 'var(--c-ink)', fontSize: 30, fontWeight: 700, marginTop: 6 }}>{horasPoupadas}<span style={{ fontSize: 15, color: 'var(--c-ink3)' }}>h</span> {minPoupadosResto}<span style={{ fontSize: 15, color: 'var(--c-ink3)' }}>min</span></div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>de digitação evitada</div>
          </Sub>
          <Sub icon={<CheckCircle2 size={15} />} label="Taxa de acertos">
            <div style={{ color: 'var(--c-ink)', fontSize: 30, fontWeight: 700, marginTop: 6 }}>{String(taxa).replace('.', ',')}<span style={{ fontSize: 16, color: 'var(--c-ink3)' }}>%</span></div>
            <div style={{ marginTop: 6 }}><ProgressBar pct={taxa} /></div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 6 }}>{fmtMilhar(reg)} cadastrados · <b style={{ color: err ? 'var(--c-err)' : 'var(--c-okfg)' }}>{fmtMilhar(err)} erro{err === 1 ? '' : 's'}</b></div>
          </Sub>
        </div>
        {/* Comparativo: operação manual vs automação */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14 }}>
          <CompBox label="Funcionários que você usava" valor={String(stats?.funcionarios_operacao ?? 1)} sub="na operação manual" hint="Quantas pessoas faziam esse cadastro manualmente na sua operação. Você define em Configurações → Custos do funcionário." />
          <CompBox label="Cadastros/dia por funcionário" valor={fmtMilhar(stats?.cadastros_dia_por_funcionario ?? 0)} sub="dado real informado" hint="Quantos cadastros UMA pessoa fazia por dia na mão (valor real que você informa em Configurações), usado de base pra comparação." />
          <CompBox label="Equivalente que a IA substitui" valor={(stats?.funcionarios_equivalentes_real ?? 0).toFixed(1).replace('.', ',')} sub="funcionário(s), pela produtividade real" accent hint="Média de cadastros/dia da IA ÷ cadastros/dia de um funcionário. Ex.: a IA faz 258/dia e cada pessoa fazia 30 → equivale a 8,6 funcionários." />
          <CompBox label="Média de cadastros / dia (IA)" valor={fmtMilhar(stats?.media_cadastros_dia ?? 0)} sub={`em ${stats?.dias_ativos ?? 0} dia(s) de operação`} hint="Total de cadastros reais da automação ÷ dias em que houve cadastro. É a produtividade real da IA por dia." />
        </div>
        {/* área de economia 7 dias */}
        <div style={{ marginTop: 20 }}>
          <div style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>Economia (R$) — últimos 7 dias</div>
          <AreaChart points={dias.map((d) => d.r)} labels={dias.map((d) => d.dia)} />
        </div>
        {/* Erros por tipo — visível pra melhorar o que dá errado */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--c-border)' }}>
          <div style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>Erros por tipo{err ? ` — ${fmtMilhar(err)}` : ''}</div>
          {!stats || stats.erros_por_tipo.length === 0 ? (
            <div style={{ color: 'var(--c-okfg)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={15} /> Nenhum erro nos cadastros reais. 🎉</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {stats.erros_por_tipo.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <span style={{ background: 'var(--c-errsoft)', color: 'var(--c-err)', fontWeight: 700, minWidth: 36, textAlign: 'center', padding: '3px 7px', borderRadius: 6, flex: 'none' }}>{fmtMilhar(e.n)}</span>
                  <span style={{ color: 'var(--c-ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.motivo}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Envios recentes */}
      <EnviosRecentes empresas={empresas} uploads={uploads} contas={contas} onChange={onChange} showToast={showToast} simple />
      {robo && modalUpload && <RoboAoVivoModal upload={modalUpload} onClose={() => { setRobo(false); setModalUpload(null); }} />}
    </div>
  );
}
function Mini({ label, v }: { label: string; v: string }) { return <div><div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{label}</div><div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700 }}>{v}</div></div>; }
function CompBox({ label, valor, sub, accent, hint }: { label: string; valor: string; sub: string; accent?: boolean; hint?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 160, background: 'var(--c-surface2)', border: `1px solid ${accent ? 'var(--c-blue)' : 'var(--c-border)'}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 600 }}>{label}</div>
        {hint && <span title={hint} style={{ cursor: 'help', width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--c-ink3)', color: 'var(--c-ink3)', fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center', flex: 'none' }}>?</span>}
      </div>
      <div style={{ color: accent ? 'var(--c-softfg)' : 'var(--c-ink)', fontSize: 28, fontWeight: 800, marginTop: 4 }}>{valor}</div>
      <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{sub}</div>
    </div>
  );
}
function Sub({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return <div style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--c-ink3)', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 4 }}>{icon}{label}</div>{children}</div>;
}
function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) { return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 6 }}><span style={{ color: 'var(--c-ink3)' }}>{k}</span><span style={{ color: accent ? 'var(--c-softfg)' : 'var(--c-ink)', fontWeight: 600 }}>{v}</span></div>; }

/* ============ GRAFICO DE AREA ============ */
function AreaChart({ points, labels }: { points: number[]; labels: string[] }) {
  const max = Math.max(1, ...points);
  const w = 500;
  const h = 80;
  const step = w / (points.length - 1 || 1);
  const pts = points.map((p, i) => `${i * step},${h - (p / max) * (h - 10)}`);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 90 }}>
        <polyline points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill="rgba(56,189,248,.12)" stroke="none" />
        <polyline points={pts.join(' ')} fill="none" stroke="#3B82F6" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>{labels.map((l, i) => <span key={i} style={{ color: 'var(--c-ink3)', fontSize: 10 }}>{l}</span>)}</div>
    </div>
  );
}

/* ============ MAPEAMENTO DE COLUNAS ============ */
const CAMPOS_MAP: { key: string; label: string }[] = [
  { key: 'cns', label: 'CNS / CPF do paciente' },
  { key: 'data_atendimento', label: 'Data de atendimento' },
  { key: 'profissional', label: 'Médico / Profissional' },
  { key: 'nome', label: 'Nome do paciente' },
  { key: 'data_nascimento', label: 'Data de nascimento' },
];

function MapeamentoModal({ colunas, obrigatorios, mapa, setMapa, busy, onCancel, onConfirm }: { colunas: string[]; obrigatorios: string[]; mapa: Record<string, string>; setMapa: (m: Record<string, string>) => void; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const set = (campo: string, col: string) => setMapa({ ...mapa, [campo]: col });
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 560, maxWidth: '100%', padding: 26, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--c-soft)', color: 'var(--c-softfg)', display: 'grid', placeItems: 'center' }}><FileSpreadsheet size={22} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ color: 'var(--c-ink)', fontSize: 19, fontWeight: 700, margin: 0 }}>Mapear colunas da planilha</h3>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12.5 }}>Confira qual coluna corresponde a cada campo. Campos com <span style={{ color: 'var(--c-err)' }}>*</span> são obrigatórios.</div>
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {CAMPOS_MAP.map((c) => {
            const obrig = obrigatorios.includes(c.key);
            const vazioObrig = obrig && !mapa[c.key];
            return (
              <div key={c.key}>
                <label className="ia-label">{c.label} {obrig && <span style={{ color: 'var(--c-err)' }}>*</span>}</label>
                <select value={mapa[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} className={`ia-input ${vazioObrig ? 'err' : ''}`} style={{ width: '100%' }}>
                  <option value="">{obrig ? '— Selecione a coluna —' : '— Não mapear —'}</option>
                  {colunas.map((col) => <option key={col} value={col}>{col}</option>)}
                </select>
              </div>
            );
          })}
        </div>

        <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 14, background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '10px 12px' }}>
          Detectamos {colunas.length} coluna(s) no arquivo e já sugerimos o mapeamento automático. Ajuste se algo estiver errado — nada é importado com campo trocado.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onCancel} disabled={busy} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
          <button onClick={onConfirm} disabled={busy} className="ia-btn" style={{ flex: 1, padding: 12 }}>{busy ? 'Importando…' : 'Confirmar e importar'}</button>
        </div>
      </div>
    </div>
  );
}

/* ============ ENVIAR FICHA ============ */
function Enviar({ empresas, uploads, contas = [], isMember, onChange, showToast }: { empresas: any[]; uploads: Upload[]; contas?: ClinicAccount[]; isMember: boolean; onChange: () => Promise<void>; showToast: (t: { title: string; msg: string; kind: 'ok' | 'err' }) => void }) {
  const [empresaId, setEmpresaId] = useState<number | ''>('');
  const [nomeLista, setNomeLista] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selectTerminalForUpload, setSelectTerminalForUpload] = useState<Upload | null>(null);
  // Mapeamento de colunas (previne planilhas com cabeçalhos errados).
  const [mapPreview, setMapPreview] = useState<{ colunas: string[]; obrigatorios: string[] } | null>(null);
  const [mapa, setMapa] = useState<Record<string, string>>({});

  // 1º passo: lê os cabeçalhos do arquivo e abre a tela de mapeamento.
  const abrirMapeamento = async () => {
    if (!empresaId || !file) return showToast({ title: 'Faltam dados', msg: 'Escolha a empresa e o arquivo.', kind: 'err' });
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await apiUpload<{ colunas: string[]; sugestao: Record<string, string>; obrigatorios: string[] }>('/uploads/colunas', form);
      setMapa(r.sugestao ?? {});
      setMapPreview({ colunas: r.colunas, obrigatorios: r.obrigatorios });
    } catch (e) { showToast({ title: 'Falha ao ler o arquivo', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(false); }
  };

  // 2º passo: confirma o mapa e envia o arquivo com mapeamento_campos.
  const confirmarImport = async () => {
    const faltando = (mapPreview?.obrigatorios ?? []).filter((c) => !mapa[c]);
    if (faltando.length) return showToast({ title: 'Mapeamento incompleto', msg: 'Vincule todos os campos obrigatórios (marcados com *).', kind: 'err' });
    setBusy(true);
    try {
      const form = new FormData();
      form.append('empresa_id', String(empresaId));
      form.append('name', nomeLista.trim());
      form.append('file', file!);
      form.append('mapeamento_campos', JSON.stringify(mapa));
      const upload = await apiUpload<Upload>('/uploads', form);
      setMapPreview(null); setMapa({}); setFile(null); setFileKey((k) => k + 1); setNomeLista('');
      await onChange();
      if (isMember) setSelectTerminalForUpload(upload);
      else showToast({ title: 'Enviado para a IA', msg: 'As fichas entraram na fila de extração.', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha no envio', msg: (e as Error).message, kind: 'err' }); } finally { setBusy(false); }
  };

  const confirmarInicio = async (u: Upload, slot: number) => {
    setSelectTerminalForUpload(null);
    try {
      await apiPost(`/uploads/${u.id}/iniciar`, { terminal_slot: slot });
      await onChange();
      showToast({ title: 'Terminal selecionado', msg: `A automação usará o Terminal ${slot}.`, kind: 'ok' });
    } catch (e) {
      showToast({ title: 'Falha ao iniciar', msg: (e as Error).message, kind: 'err' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Card style={{ padding: 24 }}>
        <div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700 }}>Importar planilha (CSV / Excel / XML)</div>
        <div style={{ color: 'var(--c-ink3)', fontSize: 13, marginTop: 4 }}>Envie a planilha e <b>confira o mapeamento das colunas</b> antes de importar — evita erro por cabeçalho fora do padrão.</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 18 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="ia-label">Nome da lista</label>
            <input type="text" value={nomeLista} onChange={(e) => setNomeLista(e.target.value)} className="ia-input" placeholder="Ex: Fichas Oftalmo Junho" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="ia-label">Empresa vinculada</label>
            <select value={empresaId} onChange={(e) => setEmpresaId(Number(e.target.value) || '')} className="ia-input">
              <option value="">Selecione…</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="ia-label">Arquivo (CSV, Excel ou XML)</label>
            <input key={fileKey} type="file" accept=".csv,.xlsx,.xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: 'block', color: 'var(--c-ink2)', fontSize: 13, border: '1px solid var(--c-border)', borderRadius: 8, padding: '7px 10px', background: 'var(--c-surface2)' }} />
          </div>
          <button onClick={abrirMapeamento} disabled={busy} className="ia-btn" style={{ height: 42, padding: '0 22px', fontSize: 14 }}><FileSpreadsheet size={16} /> {busy ? 'Lendo…' : 'Mapear e importar'}</button>
        </div>
      </Card>

      {mapPreview && (
        <MapeamentoModal
          colunas={mapPreview.colunas}
          obrigatorios={mapPreview.obrigatorios}
          mapa={mapa}
          setMapa={setMapa}
          busy={busy}
          onCancel={() => setMapPreview(null)}
          onConfirm={confirmarImport}
        />
      )}
      <EnviosRecentes empresas={empresas} uploads={uploads} contas={contas} onChange={onChange} showToast={showToast} />

      {selectTerminalForUpload && (() => {
        const u = selectTerminalForUpload;
        const emp = empresas.find((e) => e.id === u.empresa_id);
        const n = Math.max(1, Number(emp?.terminais_contratados ?? 1));
        const ca = contas.find((c) => c.empresa_id === u.empresa_id);
        const ocupados = new Set(ca?.busy_slots ?? []);
        const livres = Array.from({ length: n }, (_, i) => i + 1).filter((k) => !ocupados.has(k));
        return (
          <div onClick={() => setSelectTerminalForUpload(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 440, maxWidth: '100%', padding: 26 }}>
              <h3 style={{ color: 'var(--c-ink)', fontSize: 18, fontWeight: 700, margin: 0 }}>Em qual terminal rodar?</h3>
              <p style={{ color: 'var(--c-ink3)', fontSize: 13, margin: '6px 0 4px' }}>Empresa</p>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--c-soft)', color: 'var(--c-softfg)', padding: '6px 12px', borderRadius: 8, fontWeight: 700, fontSize: 14 }}><Building2 size={15} /> {emp?.nome ?? 'Empresa'}</div>
              <p style={{ color: 'var(--c-ink3)', fontSize: 12, margin: '14px 0 8px' }}>Terminais livres ({livres.length} de {n}) — rodam em paralelo:</p>
              {livres.length === 0 ? (
                <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--c-warnfg)', fontSize: 13, background: 'var(--c-warnsoft)', borderRadius: 10 }}>Todos os {n} terminais estão ocupados agora. Aguarde um liberar.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10 }}>
                  {livres.map((k) => (
                    <button key={k} onClick={() => confirmarInicio(u, k)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '14px 8px', borderRadius: 12, border: '1px solid var(--c-blue)', background: 'var(--c-soft)', color: 'var(--c-softfg)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 14 }}>
                      <Cpu size={18} /> Terminal {k}
                      <span style={{ fontSize: 10, fontWeight: 500 }}>livre</span>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setSelectTerminalForUpload(null)} className="ia-btn-outline" style={{ width: '100%', marginTop: 18 }}>Cancelar</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ============ ENVIOS RECENTES ============ */
function EnviosRecentes({ empresas = [], uploads, contas = [], onChange, showToast, simple, onIniciar }: { empresas?: { id: number; nome: string; terminais_contratados?: number }[]; uploads: Upload[]; contas?: ClinicAccount[]; onChange: () => Promise<void>; showToast: (t: { title: string; msg: string; kind: 'ok' | 'err' }) => void; simple?: boolean; onIniciar?: (u: Upload) => void }) {
  const [ver, setVer] = useState<Upload | null>(null);
  const [live, setLive] = useState<Upload | null>(null);
  const [pararAlvo, setPararAlvo] = useState<Upload | null>(null);
  const [selectTerminalForUpload, setSelectTerminalForUpload] = useState<Upload | null>(null);
  const [editarFichas, setEditarFichas] = useState<Upload | null>(null);

  const excluir = async (u: Upload) => {
    if (!confirm(`Excluir o envio "${u.name || u.original_filename}"?`)) return;
    try { await apiDelete(`/uploads/${u.id}`); await onChange(); showToast({ title: 'Envio excluído', msg: '', kind: 'ok' }); } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); }
  };
  const mostrarAoVivo = (u: Upload) => { if (onIniciar) onIniciar(u); else setLive(u); };
  
  const cliqueIniciar = (u: Upload) => setSelectTerminalForUpload(u);

  // Inicia a lista no TERMINAL (slot) escolhido. Todos os terminais da empresa
  // usam o mesmo login CMD (resolvido no backend) — CMD aceita várias sessões.
  const confirmarInicio = async (u: Upload, slot: number) => {
    setSelectTerminalForUpload(u);
    if (onIniciar) onIniciar(u); else setLive(u);
    setSelectTerminalForUpload(null);
    try {
      await apiPost(`/uploads/${u.id}/iniciar`, { terminal_slot: slot });
      await onChange();
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    }
  };

  const controle = async (u: Upload, acao: 'iniciar' | 'retomar' | 'pausar' | 'parar') => {
    if (acao === 'iniciar') {
      cliqueIniciar(u);
      return;
    }
    try {
      await apiPost(`/uploads/${u.id}/${acao}`, {});
      await onChange();
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); }
  };

  const isRunning = (u: Upload) => ['registering', 'extracting', 'extracted'].includes(u.status);
  const temPendentes = (u: Upload) => u.patients_found > 0 && u.patients_registered + u.patients_errored < u.patients_found;
  const cols = simple ? '1fr 190px 160px 110px 140px' : '1fr 190px 80px 92px 62px 92px 100px 128px';
  return (
    <Card style={{ overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--c-border)', color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Envios recentes</div>
      <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 14, padding: '10px 20px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)', fontSize: 11, fontWeight: 600, color: 'var(--c-ink3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        <span>Arquivo</span><span>Status</span>{simple ? <span>Resultado</span> : <><span>Pacientes</span><span>Registrados</span><span>Erros</span><span>Pendências</span></>}<span>Tempo</span><span style={{ textAlign: 'right' }}>Ações</span>
      </div>
      {uploads.length === 0 ? <div style={{ padding: 36, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhum envio ainda.</div> : uploads.map((u) => {
        const p = uploadPill(u);
        return (
        <div key={u.id} style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 14, alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--c-border)' }}>
          <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{u.name || u.original_filename}</span>
          <span style={{ minWidth: 0, display: 'flex' }}><StatusPill tone={p.tone} label={p.label} /></span>
          {simple ? (
            <span style={{ fontSize: 13, display: 'flex', gap: 10, flexWrap: 'wrap' }}><span style={{ color: 'var(--c-okfg)' }}>✓ {u.patients_registered}</span><span style={{ color: u.patients_errored ? 'var(--c-err)' : 'var(--c-ink3)' }}>✗ {u.patients_errored}</span><span style={{ color: 'var(--c-warn)' }}>⏳ {Math.max(0, u.patients_found - u.patients_registered - u.patients_errored)}</span></span>
          ) : (
            <><span style={{ color: 'var(--c-ink2)', fontSize: 14 }}>{u.patients_found}</span><span style={{ color: 'var(--c-softfg)', fontSize: 14 }}>{u.patients_registered}</span><span style={{ color: u.patients_errored ? 'var(--c-err)' : 'var(--c-ink3)', fontSize: 14 }}>{u.patients_errored}</span><span style={{ color: (u.patients_found - u.patients_registered - u.patients_errored) > 0 ? 'var(--c-warn)' : 'var(--c-ink3)', fontSize: 14, fontWeight: 600 }} title="Fichas em Pendências (duplicadas ou sem dados)">{Math.max(0, u.patients_found - u.patients_registered - u.patients_errored)}</span></>
          )}
          <span style={{ color: 'var(--c-ink2)', fontSize: 12 }} title={`Enviado ${new Date(u.uploaded_at).toLocaleString('pt-BR')}`}>{tempoInfo(u)}</span>
          <span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', color: 'var(--c-ink3)' }}>
            {isRunning(u) ? (
              <>
                <button onClick={() => mostrarAoVivo(u)} title="Ver robô ao vivo" style={{ ...actBtn, color: 'var(--c-cyan)' }}><Radio size={15} /></button>
                <button onClick={() => controle(u, 'pausar')} title="Pausar" style={{ ...actBtn, color: 'var(--c-warn)' }}><Pause size={15} /></button>
                <button onClick={() => setPararAlvo(u)} title="Parar" style={{ ...actBtn, color: 'var(--c-err)' }}><Square size={14} /></button>
              </>
            ) : u.status === 'paused' ? (
              <>
                <button onClick={() => controle(u, 'retomar')} title="Retomar automação" style={{ ...actBtn, color: 'var(--c-ok)' }}><Play size={15} /></button>
                <button onClick={() => setPararAlvo(u)} title="Parar" style={{ ...actBtn, color: 'var(--c-err)' }}><Square size={14} /></button>
              </>
            ) : temPendentes(u) ? (
              <button onClick={() => cliqueIniciar(u)} title="Iniciar automação" style={{ ...actBtn, color: 'var(--c-ok)' }}><Play size={15} /></button>
            ) : null}
            <button onClick={() => setEditarFichas(u)} title="Ver / editar fichas" style={actBtn}><FileText size={16} /></button>
            <button onClick={() => setVer(u)} title="Ver detalhes" style={actBtn}><Eye size={16} /></button>
            <button onClick={() => excluir(u)} title="Excluir" style={{ ...actBtn, color: 'var(--c-err)' }}><Trash2 size={16} /></button>
          </span>
        </div>
        );
      })}
      {ver && <VerEnvio upload={ver} onClose={() => setVer(null)} />}
      {editarFichas && <FichasModal upload={editarFichas} onClose={() => setEditarFichas(null)} onChange={onChange} showToast={showToast} />}
      {live && <RoboAoVivoModal upload={live} onClose={() => setLive(null)} />}
      {pararAlvo && (
        <div onClick={() => setPararAlvo(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 420, maxWidth: '100%', padding: 26 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--c-errsoft)', color: 'var(--c-err)', display: 'grid', placeItems: 'center' }}><Square size={22} /></div>
            <h3 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, margin: '16px 0 0' }}>Parar a automação?</h3>
            <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>As fichas que ainda não foram cadastradas deste envio param de ser enviadas. Você pode retomar depois clicando em iniciar.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={() => setPararAlvo(null)} className="ia-btn-outline" style={{ flex: 1 }}>Continuar rodando</button>
              <button onClick={() => { const u = pararAlvo; setPararAlvo(null); void controle(u, 'parar'); }} className="ia-btn" style={{ flex: 1, padding: 12, background: 'var(--c-err)' }}>Parar agora</button>
            </div>
          </div>
        </div>
      )}
      {selectTerminalForUpload && (() => {
        const u = selectTerminalForUpload;
        const emp = empresas.find((e) => e.id === u.empresa_id);
        const n = Math.max(1, Number(emp?.terminais_contratados ?? 1));
        const ca = contas.find((c) => c.empresa_id === u.empresa_id);
        const ocupados = new Set(ca?.busy_slots ?? []);
        const livres = Array.from({ length: n }, (_, i) => i + 1).filter((k) => !ocupados.has(k));
        return (
        <div onClick={() => setSelectTerminalForUpload(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 440, maxWidth: '100%', padding: 26 }}>
            <h3 style={{ color: 'var(--c-ink)', fontSize: 18, fontWeight: 700, margin: 0 }}>Em qual terminal rodar?</h3>
            <p style={{ color: 'var(--c-ink3)', fontSize: 13, margin: '6px 0 4px' }}>Empresa</p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--c-soft)', color: 'var(--c-softfg)', padding: '6px 12px', borderRadius: 8, fontWeight: 700, fontSize: 14 }}><Building2 size={15} /> {emp?.nome ?? 'Empresa'}</div>
            <p style={{ color: 'var(--c-ink3)', fontSize: 12, margin: '14px 0 8px' }}>Terminais livres ({livres.length} de {n}) — rodam em paralelo:</p>
            {livres.length === 0 ? (
              <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--c-warnfg)', fontSize: 13, background: 'var(--c-warnsoft)', borderRadius: 10 }}>Todos os {n} terminais estão ocupados agora. Aguarde um liberar ou contrate mais.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10 }}>
                {livres.map((k) => (
                  <button key={k} onClick={() => confirmarInicio(u, k)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '14px 8px', borderRadius: 12, border: '1px solid var(--c-blue)', background: 'var(--c-soft)', color: 'var(--c-softfg)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 14 }}>
                    <Cpu size={18} /> Terminal {k}
                    <span style={{ fontSize: 10, fontWeight: 500 }}>livre</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setSelectTerminalForUpload(null)} className="ia-btn-outline" style={{ width: '100%', marginTop: 18 }}>Cancelar</button>
          </div>
        </div>
        );
      })()}
    </Card>
  );
}
const actBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: '1px solid var(--c-border)', background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'grid', placeItems: 'center' };

/** Tempo ATIVO de processamento (ms) — acumulado + sessão atual se rodando.
 * Não conta o tempo pausado/parado (senão o relatório contaria ociosidade). */
function tempoMs(u: Upload): number | null {
  const base = (u.tempo_ativo_segundos ?? 0) * 1000;
  const live = u.sessao_iniciada_em ? Math.max(0, Date.now() - new Date(u.sessao_iniciada_em).getTime()) : 0;
  const ms = base + live;
  if (ms <= 0 && !u.registro_iniciado_em) return null;
  return ms;
}

/** Tempo total ativo + média por cadastro (para a listagem). */
function tempoInfo(u: Upload): string {
  const ms = tempoMs(u);
  if (ms === null) return '—';
  const dur = fmtDur(ms);
  const n = u.patients_registered + u.patients_errored;
  if (!n) return u.sessao_iniciada_em ? `${dur} · rodando` : dur;
  const med = ms / n / 1000;
  const medStr = med >= 1 ? `${med.toFixed(1).replace('.', ',')}s` : `${Math.round(med * 1000)}ms`;
  return `${dur} · ${medStr}/cad`;
}
function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
/** Tempo total formatado (ou '—'). */
function tempoTotalStr(u: Upload): string {
  const ms = tempoMs(u);
  return ms === null ? '—' : fmtDur(ms);
}
/** Tempo médio por paciente cadastrado (ou '—'). */
function tempoMedioStr(u: Upload): string {
  const ms = tempoMs(u);
  const n = u.patients_registered + u.patients_errored;
  if (ms === null || !n) return '—';
  const med = ms / n / 1000;
  return med >= 1 ? `${med.toFixed(1).replace('.', ',')}s` : `${Math.round(med * 1000)}ms`;
}

/** Deduz a FASE real do envio a partir do current_step (texto do worker). */
function faseDoStep(cs: string): string | null {
  const s = (cs || '').toLowerCase();
  if (!s) return null;
  if (/duplic/.test(s)) return 'Verificando duplicidades';
  if (/refazendo|revis/.test(s)) return 'Revisando';
  if (/cadastrando|salvando|finalizando|diagn|procedimento|contato assistencial/.test(s)) return 'Cadastrando';
  if (/travou|retomando|reconect/.test(s)) return 'Reconectando';
  if (/login|portal|perfil|acessar|autentic|mfa|usu[aá]rio e senha/.test(s)) return 'Conectando';
  if (/verificando dados|dados obrigat|dados faltan/.test(s)) return 'Verificando dados';
  if (/mape/.test(s)) return 'Mapeando';
  if (/analis|extra|lendo|planilha/.test(s)) return 'Analisando';
  if (/aguardando/.test(s)) return 'Aguardando cadastro';
  return null;
}

/** Status real do envio no listing — condizente com a fase que está acontecendo. */
function uploadPill(u: Upload): { tone: 'ok' | 'proc' | 'warn'; label: string } {
  if (u.status === 'paused') return { tone: 'warn', label: 'Pausado' };
  if (u.status === 'parado') return { tone: 'warn', label: 'Parado' };
  if (u.status === 'extraction_failed' || u.status === 'registration_failed') return { tone: 'warn', label: 'Falhou' };
  const fase = faseDoStep(u.current_step);
  if (u.status === 'extracting') return { tone: 'proc', label: fase ?? 'Analisando' };
  if (u.status === 'extracted') return { tone: 'proc', label: fase ?? 'Aguardando cadastro' };
  if (u.status === 'registering') return { tone: 'proc', label: fase ?? 'Cadastrando' };
  // Concluído: mostra o RESULTADO real (cadastrados x pendências) — antes ficava
  // eternamente "A registrar" quando tudo ia para pendências (duplicados/sem dados).
  if (u.status === 'done') {
    const reg = u.patients_registered;
    const pend = Math.max(0, u.patients_found - u.patients_registered - u.patients_errored);
    if (reg === 0 && (pend > 0 || u.patients_errored > 0)) return { tone: 'warn', label: 'Concluído — 0 novos' };
    if (u.patients_errored > 0 || pend > 0) return { tone: 'warn', label: 'Concluído c/ pendências' };
    return { tone: 'ok', label: 'Concluído' };
  }
  const proc = u.patients_registered + u.patients_errored;
  if (u.patients_found > 0 && proc >= u.patients_found) {
    return u.patients_errored > 0 ? { tone: 'warn', label: 'Concluído c/ erros' } : { tone: 'ok', label: 'Concluído' };
  }
  if (u.patients_found > 0) return { tone: 'proc', label: 'A registrar' };
  return { tone: 'proc', label: 'Aguardando' };
}

/* ---- Modal de envio com abas (Relatório · Logs · Bugs e Soluções) ---- */
function solucao(status: string, motivo: string): string {
  const m = (motivo || '').toLowerCase();
  if (status === 'needs_review') return 'Faltam dados obrigatórios (CNS, data de atendimento ou profissional). Edite a ficha e reenvie pela aba Pendências.';
  if (/demorou|timeout|tempo|responder|lenta?o?/.test(m)) return 'O site do CMD-COLETA estava lento. Reenvie — costuma funcionar na 2ª tentativa.';
  if (/profissional|médico|medico|não encontrad/.test(m)) return 'Profissional não localizado no CMD-COLETA. Confira o nome do médico na ficha.';
  if (/login|2fa|sessão|sessao|autentic/.test(m)) return 'Falha de login/2FA. Verifique as credenciais e a chave 2FA em Configurações.';
  return 'Reenvie pela aba Pendências. Se o erro persistir, fale com o suporte.';
}

/* ============ MODAL: VER / EDITAR FICHAS DE UM ENVIO ============ */
type FichaEdit = Ficha & { data_nascimento?: string | null };
const CAMPOS_FICHA: { k: keyof FichaEdit; label: string; type?: string }[] = [
  { k: 'nome', label: 'Nome' },
  { k: 'cns', label: 'CNS' },
  { k: 'data_atendimento', label: 'Data atendimento', type: 'date' },
  { k: 'data_nascimento', label: 'Nascimento', type: 'date' },
  { k: 'cid10_codigo', label: 'CID-10' },
  { k: 'medico_nome', label: 'Médico' },
];

function FichasModal({ upload, onClose, onChange, showToast }: { upload: Upload; onClose: () => void; onChange: () => Promise<void>; showToast: (t: { title: string; msg: string; kind: 'ok' | 'err' }) => void }) {
  const [fichas, setFichas] = useState<FichaEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<FichaEdit>>({});
  const [salvando, setSalvando] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [bulkForm, setBulkForm] = useState<Partial<FichaEdit>>({});

  const carregar = useCallback(async () => {
    setLoading(true);
    try { setFichas(await apiGet<FichaEdit[]>(`/uploads/${upload.id}/patients`)); }
    catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); }
    finally { setLoading(false); }
    // showToast é estável o suficiente; não entra nas deps para não recriar
    // o carregar a cada render do painel (o que causava o modal piscando).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.id]);
  // Carrega uma vez quando o modal abre para este envio.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, [upload.id]);

  const abrirEdicao = (f: FichaEdit) => {
    setEditId(f.id);
    setForm({ nome: f.nome, cns: f.cns, data_atendimento: f.data_atendimento, data_nascimento: f.data_nascimento ?? null, cid10_codigo: f.cid10_codigo, medico_nome: f.medico_nome });
  };
  const salvarUma = async () => {
    if (editId == null) return;
    setSalvando(true);
    try {
      await apiPatch(`/patients/${editId}`, form);
      await carregar(); await onChange();
      setEditId(null);
      showToast({ title: 'Ficha atualizada', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setSalvando(false); }
  };
  const aplicarTodas = async () => {
    const campos = Object.fromEntries(Object.entries(bulkForm).filter(([, v]) => v !== undefined && v !== ''));
    if (Object.keys(campos).length === 0) return showToast({ title: 'Nada preenchido', msg: 'Preencha ao menos um campo para aplicar a todas.', kind: 'err' });
    if (!window.confirm(`Aplicar esses campos a TODAS as ${fichas.length} fichas deste envio?`)) return;
    setSalvando(true);
    try {
      const r = await apiPatch<{ atualizadas: number }>(`/uploads/${upload.id}/patients`, campos);
      await carregar(); await onChange();
      setBulk(false); setBulkForm({});
      showToast({ title: `${r.atualizadas} ficha(s) atualizada(s)`, msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setSalvando(false); }
  };

  const filtradas = fichas.filter((f) => !busca.trim() || `${f.nome} ${f.cns} ${f.cid10_codigo} ${f.medico_nome}`.toLowerCase().includes(busca.trim().toLowerCase()));
  const inp: React.CSSProperties = { boxSizing: 'border-box', width: '100%', height: 36, background: 'var(--c-input)', border: '1.5px solid var(--c-border2)', borderRadius: 8, padding: '0 10px', color: 'var(--c-ink)', fontFamily: 'inherit', fontSize: 13, outline: 'none' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 860, maxWidth: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', overflow: 'hidden' }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 22px', borderBottom: '1px solid var(--c-border)' }}>
          <FileText size={20} style={{ color: 'var(--c-softfg)', flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{upload.name || upload.original_filename}</div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{fichas.length} ficha(s)</div>
          </div>
          <button onClick={() => { setBulk((b) => !b); setEditId(null); }} className="ia-btn-outline" style={{ height: 36, padding: '0 12px', fontSize: 13, color: bulk ? 'var(--c-softfg)' : undefined }}>{bulk ? 'Cancelar' : 'Editar todas'}</button>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer', display: 'grid', placeItems: 'center', flex: 'none' }}><X size={18} /></button>
        </div>

        {/* Barra de edição em massa */}
        {bulk && (
          <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)' }}>
            <div style={{ color: 'var(--c-ink2)', fontSize: 13, marginBottom: 10 }}>Preencha só os campos que quer aplicar a <b>todas</b> as fichas (os vazios são ignorados):</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {CAMPOS_FICHA.map((c) => (
                <div key={String(c.k)}>
                  <label style={{ color: 'var(--c-ink3)', fontSize: 11, display: 'block', marginBottom: 3 }}>{c.label}</label>
                  <input type={c.type ?? 'text'} value={(bulkForm[c.k] as string) ?? ''} onChange={(e) => setBulkForm({ ...bulkForm, [c.k]: e.target.value })} style={inp} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={aplicarTodas} disabled={salvando} className="ia-btn" style={{ padding: '9px 16px' }}>{salvando ? 'Aplicando…' : `Aplicar a todas (${fichas.length})`}</button>
            </div>
          </div>
        )}

        {/* Busca */}
        <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--c-border)' }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CNS, CID, médico…" style={{ ...inp, height: 38 }} />
        </div>

        {/* Lista */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-ink3)', flex: 'none' }}>Carregando fichas…</div>
          : filtradas.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-ink3)', flex: 'none' }}>Nenhuma ficha.</div>
          : filtradas.map((f) => {
            const aberto = editId === f.id;
            const t = fichaTone(f.status); const tc = t === 'ok' ? 'var(--c-okfg)' : t === 'proc' ? 'var(--c-softfg)' : 'var(--c-warnfg)'; const tbg = t === 'ok' ? 'var(--c-oksoft)' : t === 'proc' ? 'var(--c-soft)' : 'var(--c-warnsoft)';
            return (
            <div key={f.id} style={{ flex: 'none', border: `1px solid ${aberto ? 'var(--c-blue)' : 'var(--c-border)'}`, borderRadius: 12, overflow: 'hidden', background: aberto ? 'var(--c-surface2)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--c-ink)', fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nome || '—'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 6 }}>
                    <Meta label="CNS" v={f.cns} mono />
                    <Meta label="CID" v={f.cid10_codigo} />
                    <Meta label="Atend." v={f.data_atendimento ? f.data_atendimento.slice(0, 10).split('-').reverse().join('/') : ''} />
                    <Meta label="Médico" v={f.medico_nome} />
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: tc, background: tbg, padding: '4px 10px', borderRadius: 999, flex: 'none', whiteSpace: 'nowrap' }}>{toneLabel(t)}</span>
                <button onClick={() => (aberto ? setEditId(null) : abrirEdicao(f))} className="ia-btn-outline" style={{ height: 34, padding: '0 14px', fontSize: 13, flex: 'none' }}>{aberto ? 'Fechar' : 'Editar'}</button>
              </div>
              {aberto && (
                <div style={{ padding: '6px 16px 18px', borderTop: '1px solid var(--c-border)' }}>
                  <div style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', margin: '14px 0 10px' }}>Editar ficha</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                    {CAMPOS_FICHA.map((c) => (
                      <div key={String(c.k)}>
                        <label style={{ color: 'var(--c-ink3)', fontSize: 11, display: 'block', marginBottom: 4 }}>{c.label}</label>
                        <input type={c.type ?? 'text'} value={(form[c.k] as string) ?? ''} onChange={(e) => setForm({ ...form, [c.k]: e.target.value })} style={inp} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                    <button onClick={() => setEditId(null)} className="ia-btn-outline" style={{ padding: '8px 14px', fontSize: 13 }}>Cancelar</button>
                    <button onClick={salvarUma} disabled={salvando} className="ia-btn" style={{ padding: '8px 16px' }}>{salvando ? 'Salvando…' : 'Salvar ficha'}</button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, v, mono }: { label: string; v?: string | null; mono?: boolean }) {
  return (
    <span style={{ fontSize: 12.5, color: 'var(--c-ink3)', minWidth: 0 }}>
      {label}: <span className={mono ? 'ia-mono' : undefined} style={{ color: 'var(--c-ink2)', fontWeight: 500 }}>{v || '—'}</span>
    </span>
  );
}

function VerEnvio({ upload, onClose }: { upload: Upload; onClose: () => void }) {
  const [tab, setTab] = useState<'relatorio' | 'logs' | 'bugs'>('relatorio');
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([apiGet<Ficha[]>(`/uploads/${upload.id}/patients`), apiGet<LogEntry[]>(`/uploads/${upload.id}/logs`)])
      .then(([p, l]) => { setFichas(p); setLogs(l); })
      .finally(() => setLoading(false));
  }, [upload.id]);
  const bugs = fichas.filter((f) => f.status === 'error' || f.status === 'needs_review');
  const TABS = [
    { k: 'relatorio' as const, label: 'Relatório', icon: FileText },
    { k: 'logs' as const, label: 'Logs', icon: ScrollText },
    { k: 'bugs' as const, label: `Bugs e Soluções${bugs.length ? ` (${bugs.length})` : ''}`, icon: Bug },
  ];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: '100%', height: '100%', background: 'var(--c-surface)', borderLeft: '1px solid var(--c-border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}><h3 style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{upload.name || upload.original_filename}</h3><div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{upload.patients_found} pacientes · {upload.patients_registered} registrados · {upload.patients_errored} erros</div></div>
          <StatusPill tone={fichaTone(upload.status)} />
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '12px 24px 0' }}>
          {TABS.map(({ k, label, icon: Icon }) => (
            <button key={k} onClick={() => setTab(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', border: 'none', borderBottom: `2px solid ${tab === k ? 'var(--c-blue)' : 'transparent'}`, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: tab === k ? 'var(--c-ink)' : 'var(--c-ink3)' }}><Icon size={15} />{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading ? <div style={{ color: 'var(--c-ink3)', fontSize: 14 }}>Carregando…</div> : tab === 'relatorio' ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="r-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
                <Stat3 label="Pacientes" v={upload.patients_found} /><Stat3 label="Registrados" v={upload.patients_registered} c="var(--c-okfg)" /><Stat3 label="Erros" v={upload.patients_errored} c={upload.patients_errored ? 'var(--c-err)' : undefined} />
              </div>
              {upload.registro_iniciado_em && (
                <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 16 }}>
                  <StatTxt label="Tempo total" v={tempoTotalStr(upload)} />
                  <StatTxt label="Tempo médio / paciente" v={tempoMedioStr(upload)} c="var(--c-softfg)" />
                </div>
              )}
              {fichas.map((f) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--c-border)' }}>
                  <div style={{ flex: 1 }}><div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 500 }}>{f.nome || '—'}</div><div className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{f.cns || '—'} · {f.data_atendimento ?? '—'}</div></div>
                  <StatusPill tone={fichaTone(f.status)} />
                </div>
              ))}
            </div>
          ) : tab === 'logs' ? (
            <div className="ia-mono" style={{ fontSize: 12, lineHeight: 2 }}>
              {logs.length === 0 ? <span style={{ color: 'var(--c-ink3)' }}>Sem logs ainda.</span> : logs.map((l, i) => (
                <div key={i} style={{ color: l.level === 'WARN' ? 'var(--c-warnfg)' : l.level === 'ERROR' ? 'var(--c-err)' : 'var(--c-ink2)' }}>
                  <span style={{ color: 'var(--c-ink3)' }}>{new Date(l.timestamp).toLocaleTimeString('pt-BR')}</span> {l.message}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {bugs.length === 0 ? <div style={{ color: 'var(--c-okfg)', fontSize: 14 }}>Nenhum problema neste envio. 🎉</div> : bugs.map((b) => (
                <div key={b.id} style={{ border: '1px solid var(--c-border)', borderRadius: 12, padding: 14, background: 'var(--c-surface2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={15} style={{ color: 'var(--c-warn)' }} /><span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{b.nome || '—'}</span></div>
                  <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 6 }}><b>Motivo:</b> {b.error_message || (b.status === 'needs_review' ? 'Dados incompletos.' : 'Falha no cadastro.')}</div>
                  <div style={{ color: 'var(--c-softfg)', fontSize: 13, marginTop: 8, display: 'flex', gap: 6 }}><CheckCircle2 size={15} style={{ flex: 'none', marginTop: 1 }} /> {solucao(b.status, b.error_message)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function Stat3({ label, v, c }: { label: string; v: number; c?: string }) { return <div style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 10, padding: 12 }}><div style={{ color: 'var(--c-ink3)', fontSize: 11 }}>{label}</div><div style={{ color: c ?? 'var(--c-ink)', fontSize: 22, fontWeight: 700 }}>{v}</div></div>; }
function StatTxt({ label, v, c }: { label: string; v: string; c?: string }) { return <div style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 10, padding: 12 }}><div style={{ color: 'var(--c-ink3)', fontSize: 11 }}>{label}</div><div style={{ color: c ?? 'var(--c-ink)', fontSize: 18, fontWeight: 700 }}>{v}</div></div>; }

/* ---- Feed ao vivo da sidebar ---- */
function feedStatus(s: string): { label: string; color: string; kind: 'spin' | 'ok' | 'err' | 'warn' } {
  if (['registering', 'pending_registration', 'extracting', 'extracted'].includes(s)) return { label: 'Cadastrando', color: 'var(--c-cyan)', kind: 'spin' };
  if (['registered', 'verified_ok', 'verified_divergent', 'done', 'done_manually'].includes(s)) return { label: 'Cadastrado', color: 'var(--c-ok)', kind: 'ok' };
  if (s === 'error') return { label: 'Erro', color: 'var(--c-err)', kind: 'err' };
  return { label: 'Dados pendentes', color: 'var(--c-warn)', kind: 'warn' };
}
function feedRow(key: string, nome: string, kind: 'spin' | 'ok' | 'err' | 'warn', label: string, color: string) {
  return (
    <div key={key} style={{ animation: 'ia-slide .35s ease', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 10, border: '1px solid var(--c-side-border)' }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: color }} />
      <span style={{ flex: 1, minWidth: 0, color: 'var(--c-side-ink)', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome || '—'}</span>
      <span style={{ color, fontSize: 10, fontWeight: 600, flex: 'none' }}>{label}</span>
      {kind === 'spin' ? <Loader2 size={13} style={{ color, animation: 'ia-spin .8s linear infinite', flex: 'none' }} /> : kind === 'ok' ? <CheckCircle2 size={13} style={{ color, flex: 'none' }} /> : kind === 'err' ? <XCircle size={13} style={{ color, flex: 'none' }} /> : <AlertTriangle size={13} style={{ color, flex: 'none' }} />}
    </div>
  );
}

function LiveFeed({ upload, patients, contas = [], multiple, onClick }: { upload: Upload; patients: Ficha[]; contas?: ClinicAccount[]; multiple?: boolean; onClick?: () => void }) {
  const reg = upload.patients_registered;
  const total = upload.patients_found;
  const pct = total ? Math.round((reg / total) * 100) : 0;
  const atual = upload.current_step.replace(/^Cadastrando\s+/i, '').replace(/\.+$/, '').trim();

  // Limit to 2 listings if multiple terminals are running
  const limitFeitos = multiple ? (atual ? 1 : 2) : (atual ? 2 : 3);
  const feitos = patients
    .filter((p) => ['registered', 'error'].includes(p.status))
    .sort((a, b) => b.id - a.id)
    .slice(0, limitFeitos);

  const conta = contas.find((c) => c.id === upload.terminal_slot);
  const terminalLabel = conta ? conta.label : upload.terminal_slot ? `Terminal #${upload.terminal_slot}` : 'Automação';

  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = 'var(--c-side-active-bg)'; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.background = 'transparent'; }}
      style={{ padding: '8px 12px 6px', borderTop: multiple ? '1px solid var(--c-side-border)' : 'none', display: 'flex', flexDirection: 'column', gap: 5, cursor: onClick ? 'pointer' : 'default', transition: 'background 0.2s', borderRadius: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 2px' }}>
        <span style={{ color: 'var(--c-side-ink)', fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🖥️ {terminalLabel}</span>
        <span style={{ color: 'var(--c-side-ink3)', fontSize: 10, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={upload.name || upload.original_filename}>{upload.name || upload.original_filename}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {atual && feedRow('atual', atual, 'spin', 'Cadastrando', 'var(--c-cyan)')}
        {feitos.map((p) => {
          const f = feedStatus(p.status);
          return feedRow(String(p.id), p.nome, f.kind, f.label, f.color);
        })}
      </div>
      <div style={{ marginTop: 4, padding: '0 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--c-side-ink2)', marginBottom: 3 }}><span>{fmtMilhar(reg)} enviados</span><span>de {fmtMilhar(total)}</span></div>
        <div style={{ height: 4, borderRadius: 999, background: 'var(--c-side-border)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#2563EB,#38BDF8)', borderRadius: 999, transition: 'width .5s ease' }} /></div>
      </div>
    </div>
  );
}
