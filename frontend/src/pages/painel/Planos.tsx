import { useCallback, useEffect, useState } from 'react';
import { Building2, Cpu, Plus, CheckCircle2, Clock, X } from 'lucide-react';
import { apiGet, apiPost } from '../../lib/api';
import type { Plano, Tenant, TerminalRequest, Fatura } from '../../lib/types';
import { Card, brl } from './parts';

type ToastData = { title: string; msg: string; kind: 'ok' | 'err' };

export default function Planos({ onChange, showToast }: { tenant?: Tenant | null; onChange?: () => Promise<void>; showToast: (t: ToastData) => void }) {
  const [plano, setPlano] = useState<Plano | null>(null);
  const [requests, setRequests] = useState<TerminalRequest[]>([]);
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [novaEmpresa, setNovaEmpresa] = useState(false);
  const [solicitando, setSolicitando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [p, reqs, fats] = await Promise.all([
        apiGet<Plano>('/plano'),
        apiGet<TerminalRequest[]>('/terminal-requests').catch(() => []),
        apiGet<Fatura[]>('/minhas-faturas').catch(() => [])
      ]);
      setPlano(p);
      setRequests(reqs);
      setFaturas(fats);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const solicitarTerminal = async (empresaId: number) => {
    setSolicitando(true);
    try {
      await apiPost('/terminal-requests', { empresa_id: empresaId });
      await carregar();
      if (onChange) await onChange();
      showToast({ title: 'Solicitação enviada', msg: 'Aguarde a liberação do administrador.', kind: 'ok' });
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    } finally {
      setSolicitando(false);
    }
  };

  const hojeISO = new Date().toISOString().slice(0, 10);

  if (loading) return <div style={{ color: 'var(--c-ink3)', fontSize: 14 }}>Carregando plano…</div>;
  if (!plano) return <div style={{ color: 'var(--c-ink3)', fontSize: 14 }}>Plano indisponível.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Resumo */}
      <div className="r-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        <Resumo label="Mensalidade" valor={brl(plano.mensal)} sub={`${plano.total_terminais} terminal(is) × ${brl(plano.valor_terminal)}`} destaque />
        <Resumo label="Terminais não alocados" valor={String(plano.nao_alocados)} sub={plano.nao_alocados > 0 ? 'Ação necessária: vincular nas Configurações' : 'Tudo alocado'} alerta={plano.nao_alocados > 0} />
        <Resumo label="Implantação (única)" valor={brl(plano.valor_implantacao)} sub={plano.implantacao_paga ? 'Paga' : 'Pendente'} pago={plano.implantacao_paga} />
      </div>

      {/* Como funciona o plano */}
      <Card style={{ padding: 18 }}>
        <div style={{ color: 'var(--c-ink2)', fontSize: 13, lineHeight: 1.7 }}>
          Seu plano é por <b>terminal de automação</b> — cada terminal equivale a 3 funcionários e custa <b>{brl(plano.valor_terminal)}/mês</b>. Os terminais pertencem às suas <b>empresas</b>. A <b>implantação</b> é um pagamento único de {brl(plano.valor_implantacao)}. Terminais não alocados a nenhuma empresa não são cobrados na mensalidade.
        </div>
      </Card>

      {/* Empresas */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Empresas e terminais</span>
          <button onClick={() => setNovaEmpresa(true)} className="ia-btn" style={{ padding: '8px 14px', fontSize: 13 }}><Plus size={15} /> Cadastrar empresa</button>
        </div>

        {plano.empresas.length === 0 ? (
          <Card style={{ padding: 30, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhuma empresa ainda.</Card>
        ) : plano.empresas.map((e) => {
          const empresaRequests = requests.filter(r => r.empresa_id === e.id);
          const temPendente = empresaRequests.some(r => r.status === 'pending');

          return (
            <Card key={e.id} style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 20px' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--c-soft)', color: 'var(--c-softfg)', display: 'grid', placeItems: 'center', flex: 'none' }}><Building2 size={20} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700 }}>{e.nome}</div>
                  <div className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{e.cnpj || 'sem CNPJ'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--c-ink2)', fontSize: 13, flex: 'none' }}>
                  <Cpu size={15} style={{ color: 'var(--c-softfg)' }} /> {e.terminais} terminal(is)
                </div>
                <div style={{ textAlign: 'right', flex: 'none', minWidth: 120 }}>
                  <div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700 }}>{brl(e.mensal)}<span style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 400 }}>/mês</span></div>
                </div>
              </div>

              <div style={{ padding: '14px 20px', background: 'var(--c-surface2)', borderTop: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
                <div style={{ color: 'var(--c-ink2)', fontSize: 13 }}>
                  Cota de terminais contratada: <b>{e.terminais}</b> terminal(is)
                </div>
                <button
                  onClick={() => solicitarTerminal(e.id)}
                  disabled={temPendente || solicitando}
                  className="ia-btn"
                  style={{ padding: '8px 14px', fontSize: 13 }}
                >
                  {temPendente ? 'Aguardando liberação' : solicitando ? 'Solicitando...' : 'Contratar Novo Terminal'}
                </button>
              </div>

              {empresaRequests.length > 0 && (
                <div style={{ padding: '12px 20px', background: 'var(--c-surface2)', borderTop: '1px solid var(--c-border)' }}>
                  <div style={{ color: 'var(--c-ink3)', fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Solicitações de contratação para esta empresa</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {empresaRequests.map((r) => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '8px 12px', background: 'var(--c-surface)', borderRadius: 8, border: '1px solid var(--c-border)' }}>
                        <span style={{ color: 'var(--c-ink2)' }}>Solicitado em {new Date(r.created_at).toLocaleDateString('pt-BR')} às {new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span style={{
                          fontWeight: 600,
                          color: r.status === 'approved' ? 'var(--c-okfg)' : r.status === 'rejected' ? 'var(--c-err)' : 'var(--c-warnfg)',
                          fontSize: 12
                        }}>
                          {r.status === 'approved' ? 'Aprovada (Liberada)' : r.status === 'rejected' ? 'Recusada' : 'Pendente de liberação'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Histórico de Faturamento */}
      <Card className="r-scroll-x" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--c-border)', color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          Histórico de Faturamento e Pagamentos
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px 140px 120px', padding: '10px 20px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)', fontSize: 11, fontWeight: 600, color: 'var(--c-ink3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <span>Fatura</span><span>Referência</span><span>Vencimento</span><span>Valor</span><span>Status</span>
        </div>
        {faturas.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhuma fatura emitida ainda.</div>
        ) : (
          faturas.map((f) => {
            const vencida = f.status === 'aberto' && f.vencimento < hojeISO;
            const rotulo = f.status === 'pago' ? 'Pago' : vencida ? 'Vencida' : 'Aberto';
            const cor = f.status === 'pago' ? 'var(--c-okfg)' : vencida ? 'var(--c-warnfg)' : 'var(--c-ink2)';
            return (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px 140px 120px', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--c-border)' }}>
                <span style={{ color: 'var(--c-ink)', fontSize: 13, fontWeight: 600 }}>{f.descricao || f.tipo}</span>
                <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>{f.referencia}</span>
                <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>{f.vencimento.split('-').reverse().join('/')}</span>
                <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700 }}>{brl(f.valor)}</span>
                <span style={{ fontWeight: 600, color: cor, fontSize: 12 }}>{rotulo}</span>
              </div>
            );
          })
        )}
      </Card>

      {novaEmpresa && <NovaEmpresaModal onClose={() => setNovaEmpresa(false)} onSaved={async () => { setNovaEmpresa(false); await carregar(); showToast({ title: 'Empresa cadastrada', msg: 'A taxa será definida pelo administrador.', kind: 'ok' }); }} onErr={(m) => showToast({ title: 'Falha', msg: m, kind: 'err' })} />}
    </div>
  );
}

function Resumo({ label, valor, sub, destaque, pago, alerta }: { label: string; valor: string; sub: string; destaque?: boolean; pago?: boolean; alerta?: boolean }) {
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ color: destaque ? 'var(--c-softfg)' : alerta ? 'var(--c-warnfg)' : 'var(--c-ink)', fontSize: 26, fontWeight: 800, marginTop: 4 }}>{valor}</div>
      <div style={{ color: pago === true ? 'var(--c-okfg)' : pago === false ? 'var(--c-warnfg)' : alerta ? 'var(--c-warnfg)' : 'var(--c-ink3)', fontSize: 12, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {pago === true && <CheckCircle2 size={12} />}{pago === false && <Clock size={12} />}{sub}
      </div>
    </Card>
  );
}

function NovaEmpresaModal({ onClose, onSaved, onErr }: { onClose: () => void; onSaved: () => Promise<void>; onErr: (m: string) => void }) {
  const [nome, setNome] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    if (!nome.trim()) return onErr('Informe o nome da empresa.');
    setBusy(true);
    try { await apiPost('/empresas', { nome: nome.trim(), cnpj: cnpj.trim() }); await onSaved(); } catch (e) { onErr((e as Error).message); setBusy(false); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 440, maxWidth: '100%', padding: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--c-soft)', color: 'var(--c-softfg)', display: 'grid', placeItems: 'center' }}><Building2 size={22} /></div>
          <h3 style={{ color: 'var(--c-ink)', fontSize: 19, fontWeight: 700, margin: 0, flex: 1 }}>Nova empresa</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <p style={{ color: 'var(--c-ink3)', fontSize: 13, margin: '10px 0 18px' }}>As empresas organizam seus terminais e automações. Novos terminais contratados são associados a uma empresa.</p>
        <label className="ia-label">Nome da empresa</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} className="ia-input" placeholder="Ex: Clínica Visão Norte" autoFocus />
        <label className="ia-label" style={{ marginTop: 14 }}>CNPJ (opcional)</label>
        <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} className="ia-input ia-mono" placeholder="00.000.000/0001-00" />
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button onClick={onClose} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
          <button onClick={salvar} disabled={busy} className="ia-btn" style={{ flex: 1, justifyContent: 'center' }}>{busy ? 'Salvando…' : 'Cadastrar'}</button>
        </div>
      </div>
    </div>
  );
}
