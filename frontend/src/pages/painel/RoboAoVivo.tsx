import { useEffect, useRef, useState } from 'react';
import { Lock, X, Maximize2, Loader2, Cpu } from 'lucide-react';
import type { Upload } from '../../lib/types';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

/**
 * Visualização AO VIVO real do robô operando o gov.br. Consome o screencast
 * do navegador (frames JPEG) que o worker publica no Redis e o backend
 * transmite via SSE (canal público por upload.public_token).
 */
export function RoboAoVivo({ upload, onClose }: { upload: Upload; onClose?: () => void }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [conectando, setConectando] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${API}/live/${upload.public_token}`);
    esRef.current = es;
    es.onmessage = (e) => { setFrame(e.data); setConectando(false); };
    es.onerror = () => { /* reconecta sozinho */ };
    return () => es.close();
  }, [upload.public_token]);

  return (
    <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-surface2)' }}>
        <span style={{ display: 'flex', gap: 6 }}><Dot c="#FF5F57" /><Dot c="#FEBC2E" /><Dot c="#28C840" /></span>
        {upload.terminal_slot != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--c-soft)', color: 'var(--c-softfg)', fontWeight: 700, fontSize: 12, padding: '4px 10px', borderRadius: 999, flex: 'none' }}><Cpu size={13} /> Terminal {upload.terminal_slot}</span>
        )}
        <div className="ia-mono" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '5px 11px', fontSize: 11, color: 'var(--c-ink3)', flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          <Lock size={11} style={{ color: 'var(--c-ok)', flex: 'none' }} /> acesso.saude.gov.br
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--c-oksoft)', color: 'var(--c-okfg)', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, flex: 'none' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--c-ok)' }} /> AO VIVO</span>
        {onClose && <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer', flex: 'none' }}><X size={16} /></button>}
      </div>

      <div style={{ flex: 1, background: '#0b1322', display: 'grid', placeItems: 'center', minHeight: 320, overflow: 'hidden' }}>
        {frame ? (
          <img src={`data:image/jpeg;base64,${frame}`} alt="Robô ao vivo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--c-ink3)' }}>
            <Loader2 size={32} style={{ color: 'var(--c-cyan)', animation: 'ia-spin .9s linear infinite' }} />
            <div style={{ marginTop: 12, fontSize: 14, color: 'var(--c-ink2)' }}>{conectando ? 'Conectando ao navegador…' : 'Aguardando o robô abrir o acesso.saude.gov.br'}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>O vídeo aparece quando a automação está operando o site do governo.</div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: '1px solid var(--c-border)', flex: 'none' }}>
        <span style={{ color: 'var(--c-ink3)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Lista</span>
        <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{upload.name || upload.original_filename}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--c-ink3)', fontSize: 12 }}>{upload.current_step || 'preparando…'}</span>
      </div>
    </div>
  );
}

function Dot({ c }: { c: string }) { return <span style={{ width: 11, height: 11, borderRadius: '50%', background: c }} />; }

export function RoboAoVivoModal({ upload, onClose }: { upload: Upload; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(7,11,22,.7)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(1000px,100%)', height: 'min(640px,90vh)' }}>
        <RoboAoVivo upload={upload} onClose={onClose} />
      </div>
    </div>
  );
}
export { Maximize2 };
