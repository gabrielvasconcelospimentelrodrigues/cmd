import { useState } from 'react';
import { AlertOctagon, RefreshCw, Check, CheckSquare, X, Zap } from 'lucide-react';
import { apiPost } from '../../lib/api';
import type { Ficha, Upload } from '../../lib/types';
import { Card } from './parts';
import type { ToastData } from '../../components/iacmd/ui';

export default function Pendencias({ patients, uploads = [], onChange, showToast }: { patients: Ficha[]; uploads?: Upload[]; onChange: () => Promise<void>; showToast: (t: ToastData) => void }) {
  const pend = patients.filter((p) => p.status === 'error' || p.status === 'needs_review');
  // Mapa id do envio -> nome da lista, para mostrar de qual lista é cada pendência.
  const nomeDaLista = (uploadId: number): string => {
    const u = uploads.find((x) => x.id === uploadId);
    return u?.name || u?.original_filename || `Envio #${uploadId}`;
  };
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  // Alvo do modal "Iniciar automação": guarda os ids a reenviar até o operador
  // escolher entre respeitar a duplicidade ou forçar.
  const [confirmar, setConfirmar] = useState<number[] | null>(null);

  const ehDup = (p: Ficha) => (p.error_message || '').toLowerCase().includes('duplicad');

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todos = () => setSel((s) => (s.size === pend.length ? new Set() : new Set(pend.map((p) => p.id))));

  const acao = async (tipo: 'retry' | 'manual', ids: number[], forcar = false) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      for (const id of ids) await apiPost(`/patients/${id}/${tipo}`, forcar ? { forcar: true } : {});
      setSel(new Set());
      setConfirmar(null);
      await onChange();
      showToast({
        title: tipo === 'manual' ? 'Marcado como feito' : forcar ? 'Cadastro forçado' : 'Reenviado para a IA',
        msg: `${ids.length} paciente(s) atualizado(s).`,
        kind: 'ok',
      });
    } catch (e) {
      showToast({ title: 'Falha', msg: (e as Error).message, kind: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const selIds = [...sel];
  // Quantos, entre os alvos do modal, estão marcados como duplicados.
  const dupsNoAlvo = confirmar ? pend.filter((p) => confirmar.includes(p.id) && ehDup(p)).length : 0;

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
        <button onClick={() => setConfirmar(selIds)} className="ia-btn" disabled={busy || !sel.size} style={{ padding: '12px 18px', fontSize: 14 }}><RefreshCw size={16} /> Iniciar automação</button>
        <button onClick={() => acao('manual', selIds)} className="ia-btn-outline" disabled={busy || !sel.size}><Check size={16} /> Feito manualmente</button>
      </div>

      <Card className="r-scroll-x" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '40px 1.6fr 1fr 110px 150px 1.4fr 100px', padding: '12px 18px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)', fontSize: 12, fontWeight: 600, color: 'var(--c-ink3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <span /><span>Nome</span><span>CNS</span><span>Atend.</span><span>Lista</span><span>Motivo</span><span />
        </div>
        {pend.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Nenhuma pendência. 🎉</div>
        ) : pend.map((p) => (
          <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '40px 1.6fr 1fr 110px 150px 1.4fr 100px', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--c-border)' }}>
            <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} style={{ width: 16, height: 16, accentColor: 'var(--c-blued)' }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome || '—'}</span>
              <span title={p.modalidade === 'catarata' ? 'Cirurgia de Catarata (FACO)' : 'OCI'} style={{ flex: 'none', fontSize: 10, fontWeight: 800, color: p.modalidade === 'catarata' ? '#7c3aed' : '#0891b2', background: p.modalidade === 'catarata' ? 'rgba(124,58,237,.14)' : 'rgba(8,145,178,.14)', padding: '2px 7px', borderRadius: 999 }}>{p.modalidade === 'catarata' ? 'Cirurgia' : 'OCI'}</span>
            </span>
            <span className="ia-mono" style={{ color: 'var(--c-ink2)', fontSize: 12 }}>{p.cns || '—'}</span>
            <span style={{ color: 'var(--c-ink2)', fontSize: 13 }}>{p.data_atendimento ?? '—'}</span>
            <span style={{ color: 'var(--c-ink2)', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nomeDaLista(p.upload_id)}>{nomeDaLista(p.upload_id)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {(p.error_message || '').toLowerCase().includes('duplicad') && (
                <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: 'var(--c-warnfg)', background: 'var(--c-warnsoft)', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>DUPLICADO</span>
              )}
              <span style={{ color: 'var(--c-ink3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.error_message || (p.status === 'needs_review' ? 'Dados incompletos — revisar.' : 'Falha no cadastro.')}</span>
            </span>
            <button onClick={() => setConfirmar([p.id])} disabled={busy} className="ia-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', justifySelf: 'end' }}><RefreshCw size={14} /> Reenviar</button>
          </div>
        ))}
      </Card>

      {confirmar && (
        <div onClick={() => !busy && setConfirmar(null)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(7,11,22,.68)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 460, maxWidth: '100%', padding: 26, animation: 'ia-slide .22s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ color: 'var(--c-ink)', fontSize: 19, fontWeight: 700, margin: 0 }}>Iniciar automação</h3>
              <button onClick={() => setConfirmar(null)} disabled={busy} style={{ background: 'none', border: 'none', color: 'var(--c-ink3)', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
            </div>
            <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '10px 0 0' }}>
              Reenviar <b>{confirmar.length} ficha(s)</b> para a automação cadastrar no CMD-COLETA.
            </p>

            {dupsNoAlvo > 0 && (
              <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, background: 'var(--c-warnsoft)', border: '1px solid var(--c-warn)', color: 'var(--c-warnfg)', fontSize: 13, lineHeight: 1.5 }}>
                <b>{dupsNoAlvo}</b> dessa(s) ficha(s) está(ão) marcada(s) como <b>duplicada(s)</b>. No reenvio normal, elas continuam bloqueadas. Use <b>Forçar cadastro</b> para cadastrar mesmo assim.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
              <button onClick={() => acao('retry', confirmar, false)} disabled={busy} className="ia-btn" style={{ padding: 12, fontSize: 14, justifyContent: 'center' }}>
                <RefreshCw size={16} /> {busy ? 'Enviando…' : 'Reenviar (respeita duplicidade)'}
              </button>
              <button onClick={() => acao('retry', confirmar, true)} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', borderRadius: 10, cursor: busy ? 'default' : 'pointer', border: '1px solid var(--c-warn)', background: 'transparent', color: 'var(--c-warnfg)' }}>
                <Zap size={16} /> Forçar cadastro (ignorar duplicidade)
              </button>
            </div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
              <b>Atenção:</b> forçar cadastra mesmo que o paciente já esteja no CMD. Use quando tiver certeza (ex.: os dois olhos da catarata no mesmo dia). Cadastro repetido de verdade pode gerar cobrança indevida ao SUS.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
