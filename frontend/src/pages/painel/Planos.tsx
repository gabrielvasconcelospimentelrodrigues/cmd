import { useCallback, useEffect, useState } from 'react';
import { Building2, Cpu, Plus, CheckCircle2, Clock, X, Users, Trash2, UserPlus, AlertTriangle } from 'lucide-react';
import { apiGet, apiPost, apiDelete, apiPatch } from '../../lib/api';
import type { Plano, Tenant, TerminalRequest, Fatura, TenantMember, ClinicAccount } from '../../lib/types';
import { Card, brl } from './parts';
import { mascaraCpfCnpj, validaCpfCnpj } from '../../lib/documento';

type ToastData = { title: string; msg: string; kind: 'ok' | 'err' };

export default function Planos({ contas = [], membros = [], ownerId, ownerName = 'Titular', onChange, showToast }: { tenant?: Tenant | null; contas?: ClinicAccount[]; membros?: { user_id: string; nome: string | null; email: string; empresa_id?: number | null }[]; ownerId?: string; ownerName?: string; onChange?: () => Promise<void>; showToast: (t: ToastData) => void }) {
  const [plano, setPlano] = useState<Plano | null>(null);
  const [requests, setRequests] = useState<TerminalRequest[]>([]);
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [novaEmpresa, setNovaEmpresa] = useState(false);
  const [solicitando, setSolicitando] = useState(false);
  const [confirmar, setConfirmar] = useState<{ id: number; nome: string } | null>(null); // confirmação de contratação
  const [descontratar, setDescontratar] = useState<{ id: number; nome: string } | null>(null); // confirmação de descontratação
  const [excluirEmpresa, setExcluirEmpresa] = useState<{ id: number; nome: string; terminais: number } | null>(null); // confirmação de exclusão de empresa
  const [processando, setProcessando] = useState(false);
  const [verDetalhamento, setVerDetalhamento] = useState(false);
  const [equipeDe, setEquipeDe] = useState<{ id: number; nome: string } | null>(null); // modal de equipe da empresa

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
      // O contrato já nasce com a cobrança: leva o cliente direto ao pagamento.
      // O terminal é liberado sozinho quando o Asaas confirma (webhook).
      const r = await apiPost<{ link_pagamento: string | null; valor: number; erro_cobranca: string | null }>(
        '/terminal-requests', { empresa_id: empresaId },
      );
      setConfirmar(null);
      await carregar();
      if (onChange) await onChange();

      if (r.link_pagamento) {
        // Nova aba: abrir na mesma perderia o painel. Se o navegador bloquear o
        // popup, o botão "Pagar" na lista de faturas continua disponível.
        window.open(r.link_pagamento, '_blank', 'noopener,noreferrer');
        showToast({ title: 'Terminal contratado', msg: 'Conclua o pagamento na aba aberta — o terminal libera automaticamente.', kind: 'ok' });
      } else {
        // Sem link não há como pagar: avisa de verdade em vez de fingir sucesso.
        showToast({
          title: 'Contratado, mas sem cobrança',
          msg: r.erro_cobranca || 'Não foi possível emitir a cobrança. Fale com o suporte.',
          kind: 'err',
        });
      }
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
  const confirmarExcluirEmpresa = async () => {
    if (!excluirEmpresa) return;
    setProcessando(true);
    try {
      await apiDelete(`/empresas/${excluirEmpresa.id}`);
      setExcluirEmpresa(null);
      await carregar();
      if (onChange) await onChange();
      showToast({ title: 'Empresa excluída', msg: 'A empresa foi removida do seu plano.', kind: 'ok' });
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    } finally {
      setProcessando(false);
    }
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
                  <button onClick={() => setExcluirEmpresa({ id: e.id, nome: e.nome, terminais: e.terminais })} disabled={processando} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid var(--c-border2)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--c-errfg)', padding: '7px 12px' }}><Trash2 size={15} /> Excluir</button>
                  <button onClick={() => setEquipeDe({ id: e.id, nome: e.nome })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid var(--c-border2)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--c-ink2)', padding: '7px 12px' }}><Users size={15} /> Equipe</button>
                  {e.terminais - (e.cancelar_terminais ?? 0) > 0 && (
                    <button onClick={() => setDescontratar({ id: e.id, nome: e.nome })} disabled={processando} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--c-errfg)', textDecoration: 'underline', padding: 0 }}>Descontratar terminal</button>
                  )}
                  <button
                    onClick={() => setConfirmar({ id: e.id, nome: e.nome })}
                    disabled={temPendente || solicitando}
                    className="ia-btn"
                    style={{ padding: '8px 14px', fontSize: 13 }}
                  >
                    {temPendente ? 'Aguardando pagamento' : solicitando ? 'Gerando cobrança...' : 'Contratar Novo Terminal'}
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
                          {r.status === 'approved' ? 'Liberado' : r.status === 'rejected' ? 'Recusada' : 'Aguardando pagamento'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Terminais Contratados */}
              {(() => {
                const contasDaEmpresa = contas.filter(c => c.empresa_id === e.id).sort((a, b) => a.id - b.id);
                const n = Math.max(0, e.terminais); // total contracted terminals
                const slots = Array.from({ length: n }, (_, i) => i + 1);

                return (
                  <div style={{ padding: '16px 20px', borderTop: '1px solid var(--c-border)', background: 'var(--c-surface)' }}>
                    <div style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 12 }}>Terminais Contratados ({n} terminal(is) contratado(s))</div>
                    {slots.length === 0 ? (
                      <div style={{ color: 'var(--c-ink3)', fontSize: 13, padding: '4px 0' }}>Nenhum terminal contratado para esta empresa. Contrate novos terminais acima.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {slots.map((slotIndex) => {
                          const c = contasDaEmpresa[slotIndex - 1]; // connected account (or placeholder) for this slot
                          const isPlaceholder = c ? c.cmd_username === 'aguardando.conexao@empresa.com' : true;
                          const membrosDaEmpresa = membros.filter((m) => m.empresa_id === e.id);

                          const designar = async (userId: string) => {
                            try {
                              if (c) {
                                if (isPlaceholder && !userId) {
                                  // Clean up and delete the placeholder if set back to Livre
                                  await apiDelete(`/clinic-accounts/${c.id}`);
                                  if (onChange) await onChange();
                                  showToast({ title: 'Terminal atualizado', msg: 'Designação removida.', kind: 'ok' });
                                } else {
                                  // Update existing record
                                  await apiPatch(`/clinic-accounts/${c.id}`, { member_user_id: userId || null });
                                  if (onChange) await onChange();
                                  showToast({ title: 'Terminal atualizado', msg: userId ? 'Designado ao operador.' : 'Terminal deixado livre (compartilhado).', kind: 'ok' });
                                }
                              } else if (userId) {
                                // Create new placeholder record for this slot
                                await apiPost('/clinic-accounts', {
                                  empresa_id: e.id,
                                  member_user_id: userId,
                                  label: `Terminal ${slotIndex}`,
                                  cmd_username: 'aguardando.conexao@empresa.com',
                                  cmd_password: 'placeholder'
                                });
                                if (onChange) await onChange();
                                showToast({ title: 'Terminal designado', msg: 'Designado ao operador.', kind: 'ok' });
                              }
                            } catch (err) {
                              showToast({ title: 'Falha', msg: (err as Error).message, kind: 'err' });
                            }
                          };

                          const isSharedLabel = !c || isPlaceholder;

                          return (
                            <div key={c?.id || `unconnected-${slotIndex}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 16px', border: isSharedLabel ? '1px dashed var(--c-border)' : '1px solid var(--c-border)', borderRadius: 12, background: 'var(--c-surface2)', opacity: isSharedLabel ? 0.85 : 1, flexWrap: 'wrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 220 }}>
                                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--c-surface)', color: 'var(--c-softfg)', display: 'grid', placeItems: 'center', flex: 'none', border: '1px solid var(--c-border)' }}>
                                  <Cpu size={16} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ color: 'var(--c-ink)', fontSize: 14.5, fontWeight: 700 }}>Terminal {slotIndex}</div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
                                <span style={{ color: 'var(--c-ink3)', fontSize: 12.5, fontWeight: 500 }}>Designação:</span>
                                <select
                                  value={c?.member_user_id ?? ''}
                                  onChange={(ev) => void designar(ev.target.value)}
                                  style={{
                                    appearance: 'none',
                                    WebkitAppearance: 'none',
                                    border: '1px solid var(--c-border)',
                                    background: 'var(--c-surface)',
                                    color: 'var(--c-ink)',
                                    fontFamily: 'inherit',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    outline: 'none',
                                    padding: '0 32px 0 12px',
                                    height: 36,
                                    minWidth: 260,
                                    borderRadius: 8,
                                    backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237A89A6' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
                                    backgroundRepeat: 'no-repeat',
                                    backgroundPosition: 'right 12px center'
                                  }}
                                >
                                  <option value="">Livre — qualquer membro da empresa</option>
                                  {ownerId && (
                                    <option value={ownerId}>{ownerName} (Assinante / Titular)</option>
                                  )}
                                  {membrosDaEmpresa.map((m) => (
                                    <option key={m.user_id} value={m.user_id}>
                                      {m.nome || m.email}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </Card>
          );
        })}
      </div>


      {/* Histórico de Faturamento */}
      <Card className="r-scroll-x" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--c-border)', color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          Histórico de Faturamento e Pagamentos
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 130px 110px 120px', padding: '10px 20px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)', fontSize: 11, fontWeight: 600, color: 'var(--c-ink3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <span>Fatura</span><span>Referência</span><span>Vencimento</span><span>Valor</span><span>Status</span><span style={{ textAlign: 'right' }}>Pagamento</span>
        </div>
        {faturas.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhuma fatura emitida ainda.</div>
        ) : (
          faturas.map((f) => {
            const vencida = f.status === 'aberto' && f.vencimento < hojeISO;
            const rotulo = f.status === 'pago' ? 'Pago' : vencida ? 'Vencida' : 'Aberto';
            const cor = f.status === 'pago' ? 'var(--c-okfg)' : vencida ? 'var(--c-warnfg)' : 'var(--c-ink2)';
            const podePagar = f.status !== 'pago' && !!f.link_pagamento;
            return (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 130px 110px 120px', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--c-border)' }}>
                <span style={{ color: 'var(--c-ink)', fontSize: 13, fontWeight: 600 }}>{f.descricao || f.tipo}</span>
                <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>{f.referencia}</span>
                <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>{f.vencimento.split('-').reverse().join('/')}</span>
                <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700 }}>{brl(f.valor)}</span>
                <span style={{ fontWeight: 600, color: cor, fontSize: 12 }}>{rotulo}</span>
                <span style={{ textAlign: 'right' }}>
                  {podePagar ? (
                    // Abre a página do Asaas (PIX / boleto / cartão). A baixa
                    // chega sozinha por webhook — o cliente não precisa avisar.
                    <a href={f.link_pagamento!} target="_blank" rel="noopener noreferrer"
                       style={{ display: 'inline-block', padding: '7px 14px', borderRadius: 8, background: vencida ? 'var(--c-warn)' : 'var(--c-blued)', color: '#fff', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>
                      Pagar
                    </a>
                  ) : (
                    <span style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{f.status === 'pago' ? '—' : 'em emissão'}</span>
                  )}
                </span>
              </div>
            );
          })
        )}
      </Card>

      {novaEmpresa && <NovaEmpresaModal onClose={() => setNovaEmpresa(false)} onSaved={async () => { setNovaEmpresa(false); await carregar(); showToast({ title: 'Empresa cadastrada', msg: 'A taxa será definida pelo administrador.', kind: 'ok' }); }} onErr={(m) => showToast({ title: 'Falha', msg: m, kind: 'err' })} />}

      {equipeDe && <EquipeModal empresa={equipeDe} onClose={() => setEquipeDe(null)} onChange={carregar} showToast={showToast} />}

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
            <p style={{ color: 'var(--c-ink3)', fontSize: 12.5, margin: '12px 0 0', lineHeight: 1.55 }}>
              Ao confirmar, abrimos o <b>pagamento do valor proporcional</b> (só os dias que faltam neste mês).
              Assim que o pagamento for aprovado, o terminal é <b>liberado automaticamente</b>.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setConfirmar(null)} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
              <button onClick={() => solicitarTerminal(confirmar.id)} disabled={solicitando} className="ia-btn" style={{ flex: 1, padding: 12 }}>{solicitando ? 'Gerando cobrança…' : 'Contratar e pagar'}</button>
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

      {excluirEmpresa && (
        <div onClick={() => setExcluirEmpresa(null)} style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', padding: 26 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--c-warnsoft)', color: 'var(--c-warnfg)', display: 'grid', placeItems: 'center' }}><Trash2 size={24} /></div>
            <h3 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, margin: '16px 0 0' }}>Excluir empresa?</h3>
            <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '10px 0 0' }}>
              Você tem certeza que deseja excluir a empresa <b>{excluirEmpresa.nome}</b>?
            </p>
            {excluirEmpresa.terminais > 0 && (
              <div style={{ background: 'var(--c-warnsoft)', borderRadius: 10, padding: '10px 14px', marginTop: 14, fontSize: 13, color: 'var(--c-warnfg)', fontWeight: 500 }}>
                ⚠️ Esta empresa possui <b>{excluirEmpresa.terminais} terminal(is) contratado(s)</b>. Ao excluí-la, estes terminais serão removidos da sua cota e o valor proporcional sairá da sua próxima fatura.
              </div>
            )}
            <p style={{ color: 'var(--c-ink3)', fontSize: 12.5, margin: '12px 0 0' }}>Qualquer membro de equipe ou histórico vinculado a esta empresa será desassociado.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => setExcluirEmpresa(null)} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
              <button onClick={confirmarExcluirEmpresa} disabled={processando} className="ia-btn" style={{ flex: 1, padding: 12, background: 'var(--c-errfg)', color: '#fff' }}>{processando ? 'Excluindo…' : 'Excluir Empresa'}</button>
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

function EquipeModal({ empresa, onClose, onChange, showToast }: { empresa: { id: number; nome: string }; onClose: () => void; onChange: () => Promise<void>; showToast: (t: ToastData) => void }) {
  const [membros, setMembros] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState<number | null>(null);
  const [membroExcluir, setMembroExcluir] = useState<TenantMember | null>(null);

  const carregar = useCallback(async () => {
    try {
      setMembros(await apiGet<TenantMember[]>(`/empresas/${empresa.id}/membros`));
    } finally { setLoading(false); }
  }, [empresa.id]);
  useEffect(() => { void carregar(); }, [carregar]);

  const adicionar = async () => {
    if (!email.trim() || senha.length < 6) return showToast({ title: 'Dados incompletos', msg: 'Informe e-mail e uma senha de ao menos 6 caracteres.', kind: 'err' });
    setSalvando(true);
    try {
      await apiPost(`/empresas/${empresa.id}/membros`, { nome: nome.trim(), email: email.trim(), senha });
      setNome(''); setEmail(''); setSenha('');
      await carregar();
      await onChange();
      showToast({ title: 'Membro adicionado', msg: 'O login já pode ser usado. Passe as credenciais ao membro.', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setSalvando(false); }
  };

  const confirmarRemoverMembro = async (m: TenantMember) => {
    setRemovendo(m.id);
    try {
      await apiDelete(`/membros/${m.id}`);
      setMembroExcluir(null);
      await carregar();
      await onChange();
      showToast({ title: 'Membro removido', msg: '', kind: 'ok' });
    } catch (e) { showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' }); } finally { setRemovendo(null); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(ev) => ev.stopPropagation()} className="ia-card" style={{ width: 560, maxWidth: '100%', padding: 26, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--c-soft)', color: 'var(--c-softfg)', display: 'grid', placeItems: 'center' }}><Users size={22} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ color: 'var(--c-ink)', fontSize: 19, fontWeight: 700, margin: 0 }}>Equipe de {empresa.nome}</h3>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12.5 }}>Cada membro tem login próprio. Usa os terminais livres da empresa; você pode designar terminais a ele em Configurações.</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {/* Lista de membros */}
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ color: 'var(--c-ink3)', fontSize: 14 }}>Carregando…</div>
          ) : membros.length === 0 ? (
            <div style={{ color: 'var(--c-ink3)', fontSize: 14, padding: '10px 0' }}>Nenhum membro ainda. Adicione abaixo.</div>
          ) : membros.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', border: '1px solid var(--c-border)', borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600 }}>{m.nome || m.email}</div>
                <div className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{m.email}</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: m.cmd_conectado ? 'var(--c-okfg)' : 'var(--c-ink3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {m.cmd_conectado ? <><CheckCircle2 size={13} /> CMD conectado</> : 'CMD pendente'}
              </span>
              <button onClick={() => setMembroExcluir(m)} disabled={removendo === m.id} title="Remover" style={{ border: 'none', background: 'transparent', color: 'var(--c-err)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>

        {/* Adicionar membro */}
        <div style={{ marginTop: 18, padding: 16, background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 12 }}>
          <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}><UserPlus size={16} /> Adicionar membro</div>
          <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="ia-label">Nome</label>
              <input value={nome} onChange={(ev) => setNome(ev.target.value)} className="ia-input" placeholder="Nome do membro" style={{ width: '100%' }} />
            </div>
            <div>
              <label className="ia-label">E-mail (login)</label>
              <input value={email} onChange={(ev) => setEmail(ev.target.value)} className="ia-input ia-mono" placeholder="membro@clinica.com" style={{ width: '100%' }} />
            </div>
            <div>
              <label className="ia-label">Senha</label>
              <input value={senha} onChange={(ev) => setSenha(ev.target.value)} className="ia-input" placeholder="Mínimo 6 caracteres" type="text" style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 8 }}>
            O membro entra com esse e-mail e senha. Ele já pode usar os <b>terminais livres</b> desta empresa; você designa terminais específicos a ele em <b>Configurações → Controles</b>. Adicionar membro <b>não</b> contrata terminal.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={adicionar} disabled={salvando} className="ia-btn" style={{ padding: '10px 18px', fontSize: 14 }}>{salvando ? 'Adicionando…' : 'Adicionar membro'}</button>
          </div>
        </div>

        {membroExcluir && (
          <div onClick={() => setMembroExcluir(null)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: '100%', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', padding: 26 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--c-warnsoft)', color: 'var(--c-warnfg)', display: 'grid', placeItems: 'center' }}><AlertTriangle size={24} /></div>
              <h3 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, margin: '16px 0 0' }}>Remover membro?</h3>
              <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '10px 0 0' }}>
                Você tem certeza que deseja remover <b>{membroExcluir.nome || membroExcluir.email}</b> da equipe?
              </p>
              <p style={{ color: 'var(--c-ink3)', fontSize: 12.5, margin: '12px 0 0', background: 'var(--c-surface2)', padding: 10, borderRadius: 8 }}>
                ⚠️ O login e a conta do terminal CMD correspondentes a este membro serão apagados permanentemente.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                <button onClick={() => setMembroExcluir(null)} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
                <button onClick={() => confirmarRemoverMembro(membroExcluir)} disabled={removendo === membroExcluir.id} className="ia-btn" style={{ flex: 1, padding: 12, background: 'var(--c-err)' }}>{removendo === membroExcluir.id ? 'Removendo…' : 'Remover Membro'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NovaEmpresaModal({ onClose, onSaved, onErr }: { onClose: () => void; onSaved: () => Promise<void>; onErr: (m: string) => void }) {
  const [nome, setNome] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    if (!nome.trim()) return onErr('Informe o nome da empresa.');
    if (!validaCpfCnpj(cnpj)) return onErr('Informe um CPF ou CNPJ válido.');
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
        <label className="ia-label" style={{ marginTop: 14 }}>CPF / CNPJ</label>
        <input value={cnpj} onChange={(e) => setCnpj(mascaraCpfCnpj(e.target.value))} className="ia-input ia-mono" placeholder="CPF ou CNPJ" inputMode="numeric" />
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button onClick={onClose} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
          <button onClick={salvar} disabled={busy} className="ia-btn" style={{ flex: 1, justifyContent: 'center' }}>{busy ? 'Salvando…' : 'Cadastrar'}</button>
        </div>
      </div>
    </div>
  );
}
