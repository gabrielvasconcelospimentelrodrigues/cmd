import { useState } from 'react';
import { Sliders, Shield, Pencil, Trash2, Plus, Wallet } from 'lucide-react';
import { apiPatch, apiDelete, apiPost } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import type { ClinicAccount, Tenant } from '../../lib/types';
import { Card, Switch } from './parts';
import { Field, PasswordField } from '../../components/iacmd/ui';
import type { ToastData } from '../../components/iacmd/ui';

const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const DELAYS = [{ label: 'Imediato', v: 0 }, { label: '1 minuto', v: 1 }, { label: '2 minutos', v: 2 }, { label: '1 hora', v: 60 }];

export default function Config({ tenant, contas, empresas = [], onChange, showToast }: { tenant: Tenant | null; contas: ClinicAccount[]; empresas?: any[]; onChange: () => Promise<void>; showToast: (t: ToastData) => void }) {
  const [tab, setTab] = useState<'controles' | 'custos' | 'seguranca'>('controles');
  const [novo, setNovo] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <TabBtn active={tab === 'controles'} onClick={() => setTab('controles')} icon={<Sliders size={15} />}>Controles</TabBtn>
        <TabBtn active={tab === 'custos'} onClick={() => setTab('custos')} icon={<Wallet size={15} />}>Custos de Funcionário</TabBtn>
        <TabBtn active={tab === 'seguranca'} onClick={() => setTab('seguranca')} icon={<Shield size={15} />}>Segurança</TabBtn>
      </div>

      {tab === 'controles' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setNovo(true)} className="ia-btn" style={{ padding: '11px 16px', fontSize: 14 }}><Plus size={16} /> Nova conta</button>
          </div>
          {contas.length === 0 && <Card style={{ padding: 32, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhuma conta conectada.</Card>}
          {contas.map((c) => <AccountCard key={c.id} conta={c} empresas={empresas} onChange={onChange} showToast={showToast} />)}
        </>
      )}

      {tab === 'custos' && <Custos tenant={tenant} onChange={onChange} showToast={showToast} />}

      {tab === 'seguranca' && <Seguranca showToast={showToast} />}

      {novo && <NovaConta empresas={empresas} onClose={() => setNovo(false)} onSaved={async () => { setNovo(false); await onChange(); showToast({ title: 'Conta conectada', msg: 'Nova conta CMD-COLETA criada.', kind: 'ok' }); }} onErr={(m) => showToast({ title: 'Falha', msg: m, kind: 'err' })} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--c-border)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, background: active ? 'var(--c-blued)' : 'var(--c-surface)', color: active ? '#fff' : 'var(--c-ink2)' }}>{icon}{children}</button>;
}

function AccountCard({ conta, empresas, onChange, showToast }: { conta: ClinicAccount; empresas: any[]; onChange: () => Promise<void>; showToast: (t: ToastData) => void }) {
  const [dias, setDias] = useState<number[]>(conta.dias_execucao ?? [0, 1, 2, 3, 4, 5, 6]);
  const [ini, setIni] = useState((conta.horario_inicio_execucao ?? '').slice(0, 5));
  const [fim, setFim] = useState((conta.horario_fim_execucao ?? '').slice(0, 5));
  const [pIni, setPIni] = useState((conta.pausa_inicio ?? '').slice(0, 5));
  const [pFim, setPFim] = useState((conta.pausa_fim ?? '').slice(0, 5));
  const [delay, setDelay] = useState(conta.delay_inicio_minutos ?? 0);
  const [cidPadrao, setCidPadrao] = useState(conta.cid_padrao ?? '');
  const [empresaId, setEmpresaId] = useState<number | ''>(conta.empresa_id ?? '');
  const [salvando, setSalvando] = useState(false);
  const [editCred, setEditCred] = useState(false);

  const toggleDia = (d: number) => setDias((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d].sort()));

  const ligar = async () => {
    await apiPatch(`/clinic-accounts/${conta.id}`, { is_enabled: !conta.is_enabled });
    await onChange();
  };
  const excluir = async () => {
    if (!confirm(`Excluir a conta "${conta.label}"?`)) return;
    await apiDelete(`/clinic-accounts/${conta.id}`);
    await onChange();
  };
  const salvar = async () => {
    setSalvando(true);
    try {
      await apiPatch(`/clinic-accounts/${conta.id}`, {
        dias_execucao: dias,
        horario_inicio_execucao: ini || null,
        horario_fim_execucao: fim || null,
        pausa_inicio: pIni || null,
        pausa_fim: pFim || null,
        delay_inicio_minutos: delay,
        cid_padrao: cidPadrao.trim(),
        empresa_id: empresaId || null,
      });
      await onChange();
      showToast({ title: 'Salvo', msg: 'Controles atualizados.', kind: 'ok' });
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Card style={{ padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700 }}>{conta.label}</div>
          <div className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 2 }}>E-mail CMD-COLETA: {conta.cmd_username}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => setEditCred(true)} className="ia-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }}><Pencil size={14} /> Editar credenciais</button>
          <button onClick={excluir} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--c-err)', background: 'none', border: 'none', cursor: 'pointer' }}><Trash2 size={14} /> Excluir</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>Automação ativa</span><Switch on={conta.is_enabled} onClick={ligar} /></div>
        </div>
      </div>

      <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
        <div>
          <label className="ia-label">Empresa vinculada (terminal)</label>
          <select value={empresaId} onChange={(e) => setEmpresaId(Number(e.target.value) || '')} className="ia-input" style={{ width: '100%' }}>
            <option value="">Nenhuma empresa (Não alocado)</option>
            {empresas.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.nome}</option>)}
          </select>
          <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 5 }}>Associe o terminal a uma empresa para faturamento correto.</div>
        </div>
        <div>
          <label className="ia-label">CID-10 padrão</label>
          <input
            value={cidPadrao}
            onChange={(e) => setCidPadrao(e.target.value)}
            placeholder="Ex: H54.9"
            className="ia-input ia-mono"
            style={{ width: '100%', textTransform: 'uppercase' }}
          />
          <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 5 }}>Usado quando a ficha não traz CID.</div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <label className="ia-label">Dias de execução</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {DIAS.map((d, i) => {
            const on = dias.includes(i);
            return <button key={i} onClick={() => toggleDia(i)} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${on ? 'var(--c-blue)' : 'var(--c-border2)'}`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, background: on ? 'var(--c-soft)' : 'transparent', color: on ? 'var(--c-softfg)' : 'var(--c-ink3)' }}>{d}</button>;
          })}
        </div>
      </div>

      <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
        <div>
          <label className="ia-label">Janela de horário</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="time" value={ini} onChange={(e) => setIni(e.target.value)} className="ia-input" style={{ width: 'auto' }} />
            <span style={{ color: 'var(--c-ink3)', fontSize: 13 }}>até</span>
            <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} className="ia-input" style={{ width: 'auto' }} />
          </div>
          <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 5 }}>Em branco = sem restrição.</div>
        </div>
        <div>
          <label className="ia-label">Pausa diária recorrente</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="time" value={pIni} onChange={(e) => setPIni(e.target.value)} className="ia-input" style={{ width: 'auto' }} />
            <span style={{ color: 'var(--c-ink3)', fontSize: 13 }}>até</span>
            <input type="time" value={pFim} onChange={(e) => setPFim(e.target.value)} className="ia-input" style={{ width: 'auto' }} />
          </div>
          <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 5 }}>Ex: almoço. Em branco = sem pausa.</div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <label className="ia-label">Delay antes de iniciar a automação após o envio</label>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {DELAYS.map((d) => (
            <label key={d.v} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, color: 'var(--c-ink2)', cursor: 'pointer' }}>
              <input type="radio" checked={delay === d.v} onChange={() => setDelay(d.v)} style={{ accentColor: 'var(--c-blued)' }} /> {d.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22 }}>
        <button onClick={salvar} disabled={salvando} className="ia-btn" style={{ padding: '11px 22px', fontSize: 14 }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </div>

      {editCred && <EditCred conta={conta} onClose={() => setEditCred(false)} onSaved={async () => { setEditCred(false); await onChange(); showToast({ title: 'Credenciais atualizadas', msg: '', kind: 'ok' }); }} onErr={(m) => showToast({ title: 'Falha', msg: m, kind: 'err' })} />}
    </Card>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 420, maxWidth: '100%', padding: 26, animation: 'ia-slide .22s ease' }}>{children}</div>
    </div>
  );
}

function EditCred({ conta, onClose, onSaved, onErr }: { conta: ClinicAccount; onClose: () => void; onSaved: () => Promise<void>; onErr: (m: string) => void }) {
  const [user, setUser] = useState(conta.cmd_username);
  const [pass, setPass] = useState('');
  const [mfa, setMfa] = useState('');
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    setBusy(true);
    try {
      const patch: Record<string, string> = { cmd_username: user };
      if (pass) patch.cmd_password = pass;
      if (mfa) patch.mfa_secret = mfa;
      await apiPatch(`/clinic-accounts/${conta.id}`, patch);
      await onSaved();
    } catch (e) { onErr((e as Error).message); setBusy(false); }
  };
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ color: 'var(--c-ink)', fontSize: 18, fontWeight: 700, margin: 0 }}>Editar credenciais</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
        <Field label="Usuário CMD-COLETA"><input className="ia-input ia-mono" value={user} onChange={(e) => setUser(e.target.value)} /></Field>
        <Field label="Nova senha (deixe vazio p/ manter)"><PasswordField value={pass} onChange={setPass} placeholder="••••••••" mono /></Field>
        <Field label="Nova chave 2FA (opcional)"><input className="ia-input ia-mono" value={mfa} onChange={(e) => setMfa(e.target.value.toUpperCase())} placeholder="JBSWY3DPEHPK3PXP" /></Field>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={onClose} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
        <button onClick={salvar} disabled={busy} className="ia-btn" style={{ flex: 1, padding: 12 }}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </Overlay>
  );
}

function NovaConta({ empresas, onClose, onSaved, onErr }: { empresas: any[]; onClose: () => void; onSaved: () => Promise<void>; onErr: (m: string) => void }) {
  const [f, setF] = useState({ label: '', cmd_username: '', cmd_password: '', mfa_secret: '', empresa_id: '' as number | '' });
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    if (!f.label || !f.cmd_username || !f.cmd_password) return onErr('Preencha identificação, usuário e senha.');
    setBusy(true);
    try {
      const payload = {
        ...f,
        empresa_id: f.empresa_id || null,
      };
      await apiPost('/clinic-accounts', payload);
      await onSaved();
    } catch (e) { onErr((e as Error).message); setBusy(false); }
  };
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ color: 'var(--c-ink)', fontSize: 18, fontWeight: 700, margin: 0 }}>Nova conta CMD-COLETA</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
        <Field label="Identificação"><input className="ia-input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Ex: Unidade Centro" /></Field>
        <Field label="Empresa vinculada">
          <select className="ia-input" value={f.empresa_id} onChange={(e) => setF({ ...f, empresa_id: Number(e.target.value) || '' })}>
            <option value="">Nenhuma empresa (Não alocado)</option>
            {empresas.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.nome}</option>)}
          </select>
        </Field>
        <Field label="Usuário CMD-COLETA"><input className="ia-input ia-mono" value={f.cmd_username} onChange={(e) => setF({ ...f, cmd_username: e.target.value })} /></Field>
        <Field label="Senha CMD-COLETA"><PasswordField value={f.cmd_password} onChange={(v) => setF({ ...f, cmd_password: v })} mono /></Field>
        <Field label="Chave 2FA (opcional)"><input className="ia-input ia-mono" value={f.mfa_secret} onChange={(e) => setF({ ...f, mfa_secret: e.target.value.toUpperCase() })} placeholder="JBSWY3DPEHPK3PXP" /></Field>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={onClose} className="ia-btn-outline" style={{ flex: 1 }}>Cancelar</button>
        <button onClick={salvar} disabled={busy} className="ia-btn" style={{ flex: 1, padding: 12 }}>{busy ? 'Salvando…' : 'Conectar'}</button>
      </div>
    </Overlay>
  );
}

function Seguranca({ showToast }: { showToast: (t: ToastData) => void }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    if (pass.length < 6) return showToast({ title: 'Senha curta', msg: 'Mínimo 6 caracteres.', kind: 'err' });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pass });
    setBusy(false);
    if (error) return showToast({ title: 'Falha', msg: error.message, kind: 'err' });
    setPass('');
    showToast({ title: 'Senha alterada', msg: 'Sua senha de acesso foi atualizada.', kind: 'ok' });
  };
  return (
    <Card style={{ padding: 24, maxWidth: 480 }}>
      <div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700 }}>Alterar senha de acesso</div>
      <div style={{ marginTop: 16 }}>
        <Field label="Nova senha"><PasswordField value={pass} onChange={setPass} placeholder="Mínimo 6 caracteres" /></Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={salvar} disabled={busy} className="ia-btn" style={{ padding: '11px 22px', fontSize: 14 }}>{busy ? 'Salvando…' : 'Salvar senha'}</button>
      </div>
    </Card>
  );
}

const numOr = (v: unknown, d = 0): number => { const x = Number(v); return Number.isNaN(x) ? d : x; };
const brlFmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function Custos({ tenant, onChange, showToast }: { tenant: Tenant | null; onChange: () => Promise<void>; showToast: (t: ToastData) => void }) {
  const [salario, setSalario] = useState(String(numOr(tenant?.salario_bruto_medio, 3000)));
  const [encargos, setEncargos] = useState(String(numOr(tenant?.porcentagem_encargos, 80)));
  const [beneficios, setBeneficios] = useState(String(numOr(tenant?.beneficios_mensais_total, 0)));
  const [infra, setInfra] = useState(String(numOr(tenant?.custo_infra_estacao_trabalho, 0)));
  const [horas, setHoras] = useState(String(tenant?.horas_uteis_mes ?? 176));
  const [funcOp, setFuncOp] = useState(String(tenant?.funcionarios_operacao ?? 1));
  const [cadFunc, setCadFunc] = useState(String(tenant?.cadastros_dia_funcionario ?? 30));
  const [busy, setBusy] = useState(false);

  const horasNum = numOr(horas, 176);
  const custoTotal = numOr(salario) * (1 + numOr(encargos) / 100) + numOr(beneficios) + numOr(infra);
  const custoMin = horasNum > 0 ? custoTotal / (horasNum * 60) : 0;

  const salvar = async () => {
    if (horasNum <= 0) return showToast({ title: 'Valor inválido', msg: 'Horas úteis/mês deve ser maior que zero.', kind: 'err' });
    for (const [n, v] of [['Salário', salario], ['Encargos', encargos], ['Benefícios', beneficios], ['Infra', infra]] as const) {
      if (Number.isNaN(Number(v)) || Number(v) < 0) return showToast({ title: 'Valor inválido', msg: `${n} deve ser um número ≥ 0.`, kind: 'err' });
    }
    setBusy(true);
    try {
      await apiPatch('/clinic', {
        salario_bruto_medio: numOr(salario),
        porcentagem_encargos: numOr(encargos),
        beneficios_mensais_total: numOr(beneficios),
        custo_infra_estacao_trabalho: numOr(infra),
        horas_uteis_mes: Math.round(horasNum),
        funcionarios_operacao: Math.round(numOr(funcOp, 1)),
        cadastros_dia_funcionario: Math.round(numOr(cadFunc, 30)),
      });
      await onChange();
      showToast({ title: 'Salvo', msg: 'Custos do funcionário atualizados.', kind: 'ok' });
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const numInput = (value: string, set: (v: string) => void, step = '100') => (
    <input type="number" min="0" step={step} className="ia-input" value={value} onChange={(e) => set(e.target.value)} />
  );

  return (
    <Card style={{ padding: 24, maxWidth: 620 }}>
      <div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700 }}>Custos do funcionário</div>
      <div style={{ color: 'var(--c-ink3)', fontSize: 13, marginTop: 4 }}>
        Compõem o <b>custo real</b> de um funcionário, usado pela IA para calcular a economia (tempo, dinheiro e funcionários poupados) com base nos cadastros automáticos.
      </div>

      <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 18 }}>
        <Field label="Salário bruto médio (R$)" hint="Salário bruto mensal médio de um funcionário que faria esse trabalho manualmente (sem encargos/benefícios).">{numInput(salario, setSalario)}</Field>
        <Field label="Encargos (%)" hint="Percentual de encargos sobre o salário (INSS, FGTS, férias, 13º, etc.). Ex.: 80 = 80% a mais sobre o salário bruto.">{numInput(encargos, setEncargos, '1')}</Field>
        <Field label="Benefícios mensais (R$)" hint="Soma mensal de benefícios por funcionário: VT, VR/VA, plano de saúde, etc.">{numInput(beneficios, setBeneficios)}</Field>
        <Field label="Custo infra/estação (R$)" hint="Custo mensal de infraestrutura por posto de trabalho: computador, software, energia, espaço, etc.">{numInput(infra, setInfra)}</Field>
        <Field label="Horas úteis/mês" hint="Horas efetivamente trabalhadas por mês (padrão 176 = 8h × 22 dias). Usado pra calcular o custo por minuto.">{numInput(horas, setHoras, '1')}</Field>
        <Field label="Funcionários na operação (manual)" hint="Quantas pessoas faziam esse cadastro manualmente na sua operação, antes da automação. Usado no comparativo do painel.">{numInput(funcOp, setFuncOp, '1')}</Field>
        <Field label="Cadastros/dia por funcionário (real)" hint="Quantos cadastros UMA pessoa fazia por dia na mão, de verdade, na sua operação. É o número real que você observou — usado no comparativo, não uma estimativa.">{numInput(cadFunc, setCadFunc, '1')}</Field>
      </div>

      <div style={{ display: 'flex', gap: 24, marginTop: 18, padding: '14px 16px', background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 10 }}>
        <div><div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>Custo total mensal</div><div style={{ color: 'var(--c-softfg)', fontSize: 20, fontWeight: 800 }}>{brlFmt(custoTotal)}</div></div>
        <div><div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>Custo por minuto</div><div style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 800 }}>{brlFmt(custoMin)}</div></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={salvar} disabled={busy} className="ia-btn" style={{ padding: '11px 22px', fontSize: 14 }}>
          {busy ? 'Salvando…' : 'Salvar custos'}
        </button>
      </div>
    </Card>
  );
}
