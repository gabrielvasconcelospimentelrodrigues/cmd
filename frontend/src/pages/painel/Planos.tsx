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
  const [confirmar, setConfirmar] = useState<{ id: number; nome: string } | null>(null); // confirmação de contratação
  const [descontratar, setDescontratar] = useState<{ id: number; nome: string } | null>(null); // confirmação de descontratação
  const [processando, setProcessando] = useState(false);
  const [verDetalhamento, setVerDetalhamento] = useState(false);

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
      setConfirmar(null);
      await carregar();
      if (onChange) await onChange();
      showToast({ title: 'Solicitação enviada', msg: 'Aguarde a liberação do administrador.', kind: 'ok' });
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    } finally {
      setSolicitando(false);
    }
  };

  const confirmarDescontratar = async () => {
    if (!descontratar) return;
    setProcessando(true);
    try {
      await apiPost(`/empresas/${descontratar.id}/descontratar-terminal`, {});
      setDescontratar(null);
      await carregar();
      if (onChange) await onChange();
      showToast({ title: 'Terminal descontratado', msg: 'A cobrança segue até o fim do mês.', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setProcessando(false); }
  };
  const desfazerCancelamento = async (empresaId: number) => {
    setProcessando(true);
    try {
      await apiPost(`/empresas/${empresaId}/desfazer-cancelamento`, {});
      await carregar();
      if (onChange) await onChange();
      showToast({ title: 'Cancelamento desfeito', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setProcessando(false); }
  };
  const fimDoMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('pt-BR'); };

  const hojeISO = new Date().toISOString().slice(0, 10);

  if (loading) return <div style={{ color: 'var(--c-ink3)', fontSize: 14 }}>Carregando plano…</div>;
  if (!plano) return <div style={{ color: 'var(--c-ink3)', fontSize: 14 }}>Plano indisponível.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Resumo */}
      <div className="r-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        <Resumo label="Mensalidade" valor={brl(plano.mensal)} sub={`${plano.total_terminais} terminal(is) · valor escalonado`} destaque onClick={() => setVerDetalhamento(true)} />
        <Resumo label="Terminais não alocados" valor={String(plano.nao_alocados)} sub={plano.nao_alocados > 0 ? 'Ação necessária: vincular nas Configurações' : 'Tudo alocado'} alerta={plano.nao_alocados > 0} />
        <Resumo label="Implantação (única)" valor={brl(plano.valor_implantacao)} sub={plano.implantacao_paga ? 'Paga' : 'Pendente'} pago={plano.implantacao_paga} />
      </div>

      {/* Como funciona o plano */}
      <Card style={{ padding: 18 }}>
        <div style={{ color: 'var(--c-ink2)', fontSize: 13, lineHeight: 1.7 }}>
          Seu plano é por <b>terminal de automação</b> (cada terminal equivale a 3 funcionários). O valor é <b>escalonado</b>: quanto mais terminais, menor o preço de cada um — o 1º custa <b>{brl(plano.valor_terminal)}/mês</b> e os seguintes têm desconto progressivo. Os terminais pertencem às suas <b>empresas</b>. A <b>implantação</b> é um pagamento único de {brl(plano.valor_implantacao)}. Terminais não alocados a nenhuma empresa não são cobrados na mensalidade.
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

              <div style={{ padding: '14px 20px', background: 'var(--c-surface2)', borderTop: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ color: 'var(--c-ink2)', fontSize: 13 }}>
                  Cota de terminais contratada: <b>{e.terminais}</b> terminal(is)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {e.terminais - (e.cancelar_terminais ?? 0) > 0 && (
                    <button onClick={() => setDescontratar({ id: e.id, nome: e.nome })} disabled={processando} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--c-errfg)', textDecoration: 'underline', padding: 0 }}>Descontratar terminal</button>
                  )}
                  <button
                    onClick={() => setConfirmar({ id: e.id, nome: e.nome })}
                    disabled={temPendente || solicitando}
                    className="ia-btn"
                    style={{ padding: '8px 14px', fontSize: 13 }}
                  >
                    {temPendente ? 'Aguardando liberação' : solicitando ? 'Solicitando...' : 'Contratar Novo Terminal'}
                  </button>
                </div>
              </div>

              {(e.cancelar_terminais ?? 0) > 0 && (
                <div style={{ padding: '10px 20px', background: 'var(--c-warnsoft)', borderTop: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--c-warnfg)', fontSize: 12.5, fontWeight: 600 }}>
                    ⏳ {e.cancelar_terminais} terminal(is) descontratado(s) — cobrança até {e.cancelar_em ? new Date(new Date(e.cancelar_em + 'T00:00:00').getTime() - 86400000).toLocaleDateString('pt-BR') : fimDoMes()}, depois sai da conta.
                  </span>
                  <button onClick={() => desfazerCancelamento(e.id)} disabled={processando} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--c-softfg)', textDecoration: 'underline', padding: 0 }}>Desfazer</button>
                </div>
              )}

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

      {confirmar && (
        <div onClick={() => setConfirmar(null)} style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', padding: 26 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--c-soft)', color: 'var(--c-softfg)', display: 'grid', placeItems: 'center' }}><Cpu size={24} /></div>
            <h3 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, margin: '16px 0 0' }}>Contratar novo terminal?</h3>
            <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '10px 0 0' }}>
              Você está contratando <b>+1 terminal</b> para <b>{confirmar.nome}</b>. Ele custará <b>{brl(plano.proximo_terminal ?? plano.valor_terminal)}/mês</b> (valor escalonado) e será somado à sua mensalidade a partir da liberação.
            </p>
            <div style={{ background: 'var(--c-surface2)', borderRadius: 10, padding: '10px 14px', marginTop: 14, fontSize: 13, color: 'var(--c-ink3)' }}>
              Mensalidade atual <b style={{ color: 'var(--c-ink2)' }}>{brl(plano.mensal)}</b> → depois <b style={{ color: 'var(--c-softfg)' }}>{brl(plano.mensal + (plano.proximo_terminal ?? plano.valor_terminal))}</b>
            </div>
            <p style={{ color: 'var(--c-ink3)', fontSize: 12.5, margin: '12px 0 0' }}>A solicitação vai para o administrador aprovar.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setConfirmar(null)} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
              <button onClick={() => solicitarTerminal(confirmar.id)} disabled={solicitando} className="ia-btn" style={{ flex: 1, padding: 12 }}>{solicitando ? 'Enviando…' : 'Confirmar contratação'}</button>
            </div>
          </div>
        </div>
      )}

      {descontratar && (
        <div onClick={() => setDescontratar(null)} style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', padding: 26 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--c-warnsoft)', color: 'var(--c-warnfg)', display: 'grid', placeItems: 'center' }}><X size={24} /></div>
            <h3 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, margin: '16px 0 0' }}>Descontratar terminal?</h3>
            <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '10px 0 0' }}>
              Você está descontratando <b>1 terminal</b> de <b>{descontratar.nome}</b>. Você <b>mantém a cobrança até {fimDoMes()}</b> (fim do período já contratado) e, a partir do próximo mês, ele <b>sai da sua conta e não gera mais cobrança</b>.
            </p>
            <div style={{ background: 'var(--c-surface2)', borderRadius: 10, padding: '10px 14px', marginTop: 14, fontSize: 12.5, color: 'var(--c-ink3)' }}>
              O terminal continua funcionando normalmente até lá. Você pode <b>desfazer</b> o cancelamento a qualquer momento antes dessa data.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setDescontratar(null)} className="ia-btn-outline" style={{ flex: 1 }}>Voltar</button>
              <button onClick={confirmarDescontratar} disabled={processando} className="ia-btn" style={{ flex: 1, padding: 12, background: 'var(--c-warn)' }}>{processando ? 'Processando…' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}
      {verDetalhamento && (
        <div onClick={() => setVerDetalhamento(false)} style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 500, maxWidth: '100%', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', padding: 26 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--c-soft)', color: 'var(--c-softfg)', display: 'grid', placeItems: 'center' }}><Cpu size={22} /></div>
              <h3 style={{ color: 'var(--c-ink)', fontSize: 19, fontWeight: 700, margin: 0, flex: 1 }}>Detalhamento da Mensalidade</h3>
              <button onClick={() => setVerDetalhamento(false)} style={{ border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            
            <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
              Seu plano utiliza a **cobrança escalonada** por terminal contratado. Quanto mais terminais contratados, menor o custo unitário.
            </p>

            <div style={{ border: '1px solid var(--c-border)', borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 120px', padding: '10px 14px', background: 'var(--c-surface2)', fontSize: 11, fontWeight: 600, color: 'var(--c-ink3)', textTransform: 'uppercase', borderBottom: '1px solid var(--c-border)' }}>
                <span>Posição</span>
                <span>Descrição</span>
                <span style={{ textAlign: 'right' }}>Valor Mensal</span>
              </div>
              
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {Array.from({ length: plano.total_terminais }).map((_, idx) => {
                  const pos = idx + 1;
                  const valor = precoTerminalNaPosicao(plano.precos, pos);
                  
                  // Encontra a empresa que está usando esse terminal
                  let empresaNome = "Terminal não alocado";
                  let acumulador = 0;
                  for (const emp of plano.empresas) {
                    if (pos <= acumulador + emp.terminais) {
                      empresaNome = emp.nome;
                      break;
                    }
                    acumulador += emp.terminais;
                  }

                  return (
                    <div key={pos} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 120px', padding: '11px 14px', borderBottom: pos === plano.total_terminais ? 'none' : '1px solid var(--c-border)', fontSize: 13, alignItems: 'center' }}>
                      <span className="ia-mono" style={{ color: 'var(--c-ink3)', fontWeight: 600 }}>#{pos}</span>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: 'var(--c-ink)', fontWeight: 500 }}>Terminal de Automação</span>
                        <span style={{ color: 'var(--c-ink3)', fontSize: 11 }}>{empresaNome}</span>
                      </div>
                      <span style={{ color: 'var(--c-ink)', fontWeight: 600, textAlign: 'right' }}>{brl(valor)}</span>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', padding: '12px 14px', background: 'var(--c-surface2)', borderTop: '1px solid var(--c-border)', fontWeight: 700, fontSize: 14 }}>
                <span style={{ color: 'var(--c-ink)' }}>Total da Mensalidade</span>
                <span style={{ color: 'var(--c-softfg)', textAlign: 'right' }}>{brl(plano.mensal)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--c-surface2)', borderRadius: 10, padding: 12, fontSize: 12, color: 'var(--c-ink3)' }}>
              <div>• **Tabela de Preços Escalonados:**</div>
              {(plano.precos?.terminais ?? precosPadrao.terminais).map((valor, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 8 }}>
                  <span>{i + 1}º Terminal:</span>
                  <span style={{ fontWeight: 600 }}>{brl(valor)}/mês</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 8 }}>
                <span>A partir do {(plano.precos?.terminais ?? precosPadrao.terminais).length + 1}º:</span>
                <span style={{ fontWeight: 600 }}>{brl(plano.precos?.adicional ?? precosPadrao.adicional)}/mês (adicional)</span>
              </div>
            </div>

            <button onClick={() => setVerDetalhamento(false)} className="ia-btn" style={{ width: '100%', marginTop: 18 }}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Resumo({ label, valor, sub, destaque, pago, alerta, onClick }: { label: string; valor: string; sub: string; destaque?: boolean; pago?: boolean; alerta?: boolean; onClick?: () => void }) {
  return (
    <Card onClick={onClick} style={{ padding: 18, cursor: onClick ? 'pointer' : 'default', position: 'relative' }}>
      <div style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ color: destaque ? 'var(--c-softfg)' : alerta ? 'var(--c-warnfg)' : 'var(--c-ink)', fontSize: 26, fontWeight: 800, marginTop: 4 }}>{valor}</div>
      <div style={{ color: pago === true ? 'var(--c-okfg)' : pago === false ? 'var(--c-warnfg)' : alerta ? 'var(--c-warnfg)' : 'var(--c-ink3)', fontSize: 12, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {pago === true && <CheckCircle2 size={12} />}{pago === false && <Clock size={12} />}{sub}
      </div>
      {onClick && (
        <span style={{ position: 'absolute', top: 12, right: 12, color: 'var(--c-softfg)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
          Ver detalhes →
        </span>
      )}
    </Card>
  );
}

const precosPadrao = {
  implantacao: 20000,
  terminais: [2000, 1800, 1600, 1400],
  adicional: 1000
};

function precoTerminalNaPosicao(precos: any, posicao: number): number {
  if (posicao <= 0) return 0;
  const p = precos || precosPadrao;
  return p.terminais[posicao - 1] ?? p.adicional;
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
