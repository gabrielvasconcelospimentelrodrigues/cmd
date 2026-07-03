import { useState } from 'react';
import { AlertOctagon, RefreshCw, Check, CheckSquare } from 'lucide-react';
import { apiPost } from '../../lib/api';
import type { Ficha } from '../../lib/types';
import { Card } from './parts';
import type { ToastData } from '../../components/iacmd/ui';

export default function Pendencias({ patients, onChange, showToast }: { patients: Ficha[]; onChange: () => Promise<void>; showToast: (t: ToastData) => void }) {
  const pend = patients.filter((p) => p.status === 'error' || p.status === 'needs_review');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todos = () => setSel((s) => (s.size === pend.length ? new Set() : new Set(pend.map((p) => p.id))));

  const acao = async (tipo: 'retry' | 'manual', ids: number[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      for (const id of ids) await apiPost(`/patients/${id}/${tipo}`, {});
      setSel(new Set());
      await onChange();
      showToast({ title: tipo === 'retry' ? 'Reenviado para a IA' : 'Marcado como feito', msg: `${ids.length} paciente(s) atualizado(s).`, kind: 'ok' });
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const selIds = [...sel];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: 0, maxWidth: 760 }}>
        Pacientes que não foram cadastrados com sucesso no CMD-COLETA. Selecione os que deseja reenviar e clique em <b>Iniciar automação</b>. Assim que um paciente for cadastrado, ele sai desta lista.
      </p>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start', background: pend.length ? 'var(--c-errsoft)' : 'var(--c-oksoft)', color: pend.length ? 'var(--c-err)' : 'var(--c-okfg)', fontSize: 13, fontWeight: 700, padding: '6px 13px', borderRadius: 999 }}>
        <AlertOctagon size={15} /> {pend.length} pendência{pend.length === 1 ? '' : 's'}
      </span>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={todos} className="ia-btn-outline" disabled={!pend.length}><CheckSquare size={16} /> Marcar todos</button>
        <button onClick={() => acao('retry', selIds)} className="ia-btn" disabled={busy || !sel.size} style={{ padding: '12px 18px', fontSize: 14 }}><RefreshCw size={16} /> Iniciar automação</button>
        <button onClick={() => acao('manual', selIds)} className="ia-btn-outline" disabled={busy || !sel.size}><Check size={16} /> Feito manualmente</button>
      </div>

      <Card className="r-scroll-x" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '40px 1.6fr 1fr 110px 150px 1.4fr 100px', padding: '12px 18px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)', fontSize: 12, fontWeight: 600, color: 'var(--c-ink3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <span /><span>Nome</span><span>CNS</span><span>Atend.</span><span>Envio</span><span>Motivo</span><span />
        </div>
        {pend.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhuma pendência. 🎉</div>
        ) : pend.map((p) => (
          <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '40px 1.6fr 1fr 110px 150px 1.4fr 100px', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--c-border)' }}>
            <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} style={{ width: 16, height: 16, accentColor: 'var(--c-blued)' }} />
            <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 500 }}>{p.nome || '—'}</span>
            <span className="ia-mono" style={{ color: 'var(--c-ink2)', fontSize: 12 }}>{p.cns || '—'}</span>
            <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>{p.data_atendimento ?? '—'}</span>
            <span className="ia-mono" style={{ color: 'var(--c-softfg)', fontSize: 12 }}>Envio #{p.upload_id}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {(p.error_message || '').toLowerCase().includes('duplicad') && (
                <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: 'var(--c-warnfg)', background: 'var(--c-warnsoft)', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>DUPLICADO</span>
              )}
              <span style={{ color: 'var(--c-ink3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.error_message || (p.status === 'needs_review' ? 'Dados incompletos — revisar.' : 'Falha no cadastro.')}</span>
            </span>
            <button onClick={() => acao('retry', [p.id])} disabled={busy} className="ia-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', justifySelf: 'end' }}><RefreshCw size={14} /> Reenviar</button>
          </div>
        ))}
      </Card>
    </div>
  );
}
