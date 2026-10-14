/**
 * Entrada da chave 2FA (TOTP) — leitura do print do QR code, com digitação
 * manual como alternativa.
 *
 * Vive aqui, e não dentro de uma tela, porque o cadastro e a edição de
 * credenciais precisam se comportar igual. Quando só o cadastro sabia ler o QR
 * e validar o que foi digitado, a tela de edição aceitou o código de 6 dígitos
 * do aplicativo no lugar da chave permanente e sobrescreveu a chave boa de um
 * cliente — a automação dele parou no 2FA sem nenhum aviso.
 */
import { useState } from 'react';
import jsQR from 'jsqr';
import { Upload, X } from 'lucide-react';
import { Field } from './ui';
import type { ToastData } from './ui';
import { extractSecretFromQr } from '../../lib/otpauth';

/** Piso de uma chave TOTP real (80 bits em base32). A do Acesso Saúde tem 32. */
const MIN_CHAVE = 16;

/** Tira espaços e hífens de quem copia a chave em blocos. */
export function normalizaChave2FA(bruto: string): string {
  return bruto.replace(/[\s-]+/g, '').toUpperCase();
}

/**
 * Devolve o motivo da recusa, ou null quando a chave serve. As mensagens
 * explicam a diferença entre a chave e o código, porque na tela do celular os
 * dois são sequências parecidas e a confusão é fácil de cometer.
 */
export function validaChave2FA(bruto: string): string | null {
  const v = normalizaChave2FA(bruto);
  if (!v) return 'Informe a chave 2FA.';
  if (/^\d{6,8}$/.test(v)) {
    return 'Esse é o código que o aplicativo mostra e troca a cada 30 segundos, não a chave. A chave aparece junto do QR code, tem 32 letras e números, e não muda.';
  }
  if (!/^[A-Z2-7]+=*$/.test(v)) {
    return 'A chave só tem letras de A a Z e números de 2 a 7. Confira se não entrou outro caractere.';
  }
  if (v.replace(/=+$/, '').length < MIN_CHAVE) {
    return `A chave ficou com ${v.length} caractere(s) — a do Acesso Saúde tem 32. Confira se copiou ela inteira.`;
  }
  return null;
}

/**
 * `chave` é o texto atual (extraído do print ou digitado) e sobe cru pelo
 * `onChave`: quem usa decide quando validar, com `validaChave2FA`.
 */
export function Entrada2FA({ chave, onChave, erro, showToast }: {
  chave: string;
  onChave: (v: string) => void;
  erro?: string;
  showToast?: (t: ToastData) => void;
}) {
  const [modo, setModo] = useState<'qr' | 'manual'>('qr');
  const [doQr, setDoQr] = useState(false); // a chave atual veio de um print
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [previa, setPrevia] = useState('');

  const limpar = () => {
    if (previa) URL.revokeObjectURL(previa);
    setDoQr(false);
    setNomeArquivo('');
    setPrevia('');
    onChave('');
  };

  const aoEscolherArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(data.data, data.width, data.height);
      const secret = code ? extractSecretFromQr(code.data) : null;
      if (secret) {
        setNomeArquivo(f.name);
        setPrevia(url);
        setDoQr(true);
        onChave(secret);
        showToast?.({ title: 'Chave extraída', msg: 'Lemos a chave 2FA do seu print.', kind: 'ok' });
      } else {
        URL.revokeObjectURL(url);
        showToast?.({ title: 'Não consegui ler o QR', msg: 'Tente outro print ou insira a chave manualmente.', kind: 'err' });
        setModo('manual');
      }
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  if (modo === 'manual') {
    return (
      <>
        <Field label="Chave TOTP" error={erro}>
          <input
            className={`ia-input ia-mono ${erro ? 'err' : ''}`}
            value={chave}
            onChange={(e) => onChave(e.target.value.toUpperCase())}
            placeholder="JBSWY3DPEHPK3PXP"
            style={{ letterSpacing: '.06em' }}
          />
        </Field>
        <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 6 }}>
          Cole a chave que aparece junto do QR code — não o código de 6 dígitos do aplicativo.
        </div>
        <div onClick={() => setModo('qr')} className="ia-link" style={{ marginTop: 14, textAlign: 'center', fontSize: 13 }}>
          Voltar a enviar o print do QR code
        </div>
      </>
    );
  }

  return (
    <>
      {!doQr ? (
        <label style={{ display: 'block', border: `1.5px dashed ${erro ? 'var(--c-warn)' : 'var(--c-border2)'}`, borderRadius: 14, background: 'var(--c-input)', padding: '30px 20px', textAlign: 'center', cursor: 'pointer' }}>
          <input type="file" accept="image/*" onChange={aoEscolherArquivo} style={{ display: 'none' }} />
          <div style={{ width: 50, height: 50, borderRadius: 13, background: 'var(--c-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
            <Upload size={24} style={{ color: 'var(--c-blue)' }} />
          </div>
          <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600, marginTop: 14 }}>Clique para enviar o print do QR code</div>
          <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 4 }}>JPG, PNG ou qualquer imagem do celular</div>
          {erro && <div style={{ color: 'var(--c-warn)', fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>{erro}</div>}
        </label>
      ) : (
        <div style={{ border: '1.5px solid var(--c-ok)', borderRadius: 14, background: 'var(--c-oksoft)', padding: 18, animation: 'ia-slide .2s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {previa && <img src={previa} alt="print" style={{ width: 54, height: 54, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--c-border)' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--c-ink)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeArquivo}</div>
              <div style={{ color: 'var(--c-okfg)', fontSize: 12, fontWeight: 600, marginTop: 2 }}>Chave extraída automaticamente</div>
            </div>
            <button onClick={limpar} style={{ width: 30, height: 30, flex: 'none', border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer' }}><X size={17} /></button>
          </div>
          <div className="ia-mono" style={{ marginTop: 12, letterSpacing: '.04em', color: 'var(--c-ink)', background: 'var(--c-input)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '10px 12px', wordBreak: 'break-all' }}>{chave}</div>
        </div>
      )}
      <div onClick={() => setModo('manual')} className="ia-link" style={{ marginTop: 14, textAlign: 'center', fontSize: 13 }}>
        Prefiro inserir a chave manualmente
      </div>
    </>
  );
}

/** Passos para gerar o QR code no Google Authenticator. */
export const PASSOS_2FA = [
  'Abra o Google Authenticator no seu celular.',
  'Toque nos três pontos (menu) e em "Transferir contas".',
  'Toque em "Exportar contas" para gerar um QR code.',
  'Selecione a conta do Acesso Saúde / SCPA e toque em "Avançar".',
  'Aparece um QR code na tela — tire um print (screenshot).',
  'Envie o print abaixo — extraímos a chave automaticamente.',
];
