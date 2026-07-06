import { useState } from 'react';
import jsQR from 'jsqr';
import { Check, ArrowRight, Lock, Upload, X, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { apiPost } from '../lib/api';
import { Shell, Field, PasswordField, useTheme, useToast, Toast } from '../components/iacmd/ui';
import { extractSecretFromQr } from '../lib/otpauth';

const STEP_DATA = [
  { title: 'Conta CMD-COLETA', sub: 'E-mail e senha do governo' },
  { title: 'Autenticação 2FA', sub: 'Chave do app autenticador' },
  { title: 'Dados da clínica', sub: 'Identificação da operação' },
  { title: 'Regras clínicas', sub: 'Alta e CID por tipo de paciente' },
  { title: 'Autorização', sub: 'Liberação do super admin' },
];
const TOTAL_STEPS = 4; // etapas de preenchimento (a 5ª, Autorização, é pós-envio)
const MFA_STEPS = [
  'Abra o Google Authenticator no seu celular.',
  'Toque nos três pontos (menu) e em "Transferir contas".',
  'Toque em "Exportar contas" para gerar um QR code.',
  'Selecione a conta do Acesso Saúde / SCPA e toque em "Avançar".',
  'Aparece um QR code na tela — tire um print (screenshot).',
  'Envie o print abaixo — extraímos a chave automaticamente.',
];

export default function Onboarding({ onDone }: { onDone: () => Promise<void> }) {
  const { session, signOut } = useAuth();
  const meta = (session?.user.user_metadata ?? {}) as { clinic_name?: string; full_name?: string };
  const [theme, toggle] = useTheme();
  const [toast, showToast] = useToast();

  const [step, setStep] = useState(1);
  const [touched, setTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [cmdLabel, setCmdLabel] = useState('');
  const [cmdEmail, setCmdEmail] = useState('');
  const [cmdPass, setCmdPass] = useState('');

  const [mfaMode, setMfaMode] = useState<'qr' | 'manual'>('qr');
  const [fileName, setFileName] = useState('');
  const [filePreview, setFilePreview] = useState('');
  const [extractedKey, setExtractedKey] = useState('');
  const [manualKey, setManualKey] = useState('');

  const [clinicName, setClinicName] = useState(meta.clinic_name ?? '');
  const [clinicCnpj, setClinicCnpj] = useState('');
  const [clinicResp, setClinicResp] = useState(meta.full_name ?? '');
  const [clinicPhone, setClinicPhone] = useState('');
  const [clinicCity, setClinicCity] = useState('');

  // Regras clínicas (última etapa) — salvas nos controles da conta CMD.
  const [cidOci08, setCidOci08] = useState('');
  const [cid9Mais, setCid9Mais] = useState('');

  const mfaBad = mfaMode === 'qr' ? !extractedKey : manualKey.trim().length < 12;
  const regrasBad = !cidOci08.trim() || !cid9Mais.trim();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        setFileName(f.name);
        setFilePreview(url);
        setExtractedKey(secret);
        showToast({ title: 'Chave extraída', msg: 'Lemos a chave 2FA do seu print.', kind: 'ok' });
      } else {
        showToast({ title: 'Não consegui ler o QR', msg: 'Tente outro print ou insira a chave manualmente.', kind: 'err' });
        setMfaMode('manual');
      }
    };
    img.src = url;
  };

  const proximo = () => {
    setTouched(true);
    if (step === 1) {
      if (!cmdLabel.trim() || !cmdEmail.trim() || !cmdPass.trim()) return;
    } else if (step === 2) {
      if (mfaBad) return;
    } else if (step === 3) {
      if (!clinicName.trim()) return;
    } else if (step === 4) {
      if (regrasBad) return;
      setConfirmOpen(true);
      return;
    }
    window.scrollTo({ top: 0 });
    setStep((s) => s + 1);
    setTouched(false);
  };

  const voltar = () => {
    if (step === 1) return void signOut();
    setStep((s) => s - 1);
    setTouched(false);
  };

  const confirmFinish = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiPost('/onboarding', {
        name: clinicName.trim(),
        cnpj: clinicCnpj,
        responsavel: clinicResp,
        telefone: clinicPhone,
        cidade: clinicCity,
      });
      await apiPost('/clinic-accounts', {
        label: cmdLabel,
        cmd_username: cmdEmail,
        cmd_password: cmdPass,
        mfa_secret: mfaMode === 'qr' ? extractedKey : manualKey.trim().toUpperCase(),
        // Regras clínicas → controles da conta.
        cid_oci_0_8: cidOci08.trim().toUpperCase(),
        cid_9_mais: cid9Mais.trim().toUpperCase(),
      });
      await onDone(); // parent → tela de "aguardando autorização"
    } catch (e) {
      setSubmitting(false);
      setConfirmOpen(false);
      showToast({ title: 'Falha ao enviar', msg: (e as Error).message, kind: 'err' });
    }
  };

  const cur = step;
  const nextLabel = step === TOTAL_STEPS ? 'Concluir configuração' : 'Continuar';

  return (
    <Shell theme={theme} onToggleTheme={toggle}>
      <div style={{ position: 'relative', zIndex: 2, maxWidth: 1080, margin: '0 auto', padding: '16px 20px 60px' }}>
        <div className="ia-card" style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 0, overflow: 'hidden' }} data-split>
          {/* Aside / stepper */}
          <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--c-surface2)', borderRight: '1px solid var(--c-border)', padding: '34px 28px' }}>
            <div style={{ color: 'var(--c-softfg)', fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>Configuração inicial</div>
            <h2 style={{ color: 'var(--c-ink)', fontSize: 21, fontWeight: 700, margin: '10px 0 0' }}>Vamos preparar sua IA</h2>
            <p style={{ color: 'var(--c-ink3)', fontSize: 13, lineHeight: 1.6, margin: '8px 0 0' }}>Quatro passos rápidos. Depois é só o super admin liberar.</p>

            <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column' }}>
              {STEP_DATA.map((d, i) => {
                const idx = i + 1;
                const done = idx < cur;
                const active = idx === cur;
                return (
                  <div key={idx} style={{ display: 'flex', gap: 14 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700,
                        background: done ? 'var(--c-soft)' : active ? 'var(--c-blue)' : 'transparent',
                        border: `1.5px solid ${done || active ? 'var(--c-blue)' : 'var(--c-border2)'}`,
                        color: done ? 'var(--c-blue)' : active ? '#fff' : 'var(--c-ink3)',
                        transition: 'all .2s ease',
                      }}>
                        {done ? <Check size={16} strokeWidth={2.6} /> : idx}
                      </div>
                      {idx < STEP_DATA.length && <div style={{ width: 2, height: 34, background: idx < cur ? 'var(--c-blue)' : 'var(--c-border2)', margin: '4px 0' }} />}
                    </div>
                    <div style={{ paddingTop: 6 }}>
                      <div style={{ color: done || active ? 'var(--c-ink)' : 'var(--c-ink3)', fontSize: 14, fontWeight: 600 }}>{d.title}</div>
                      <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 2 }}>{d.sub}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 28, display: 'flex', alignItems: 'center', gap: 9, color: 'var(--c-ink3)', fontSize: 12 }}>
              <Lock size={15} style={{ color: 'var(--c-ok)' }} /> Tudo criptografado e usado só pela IA.
            </div>
          </div>

          {/* Formulário do passo */}
          <div style={{ padding: '36px 38px', minHeight: 540, display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: 'var(--c-softfg)', fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Passo {step} de {TOTAL_STEPS}</div>

            {step === 1 && (
              <div style={{ animation: 'ia-slide .25s ease' }}>
                <h2 style={{ color: 'var(--c-ink)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', margin: '14px 0 0' }}>Conectar conta CMD-COLETA</h2>
                <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>Estas credenciais ficam criptografadas e são usadas apenas pela IA.</p>
                <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 460 }}>
                  <Field label="Identificação da conta" error={touched && !cmdLabel.trim() ? 'Dê um apelido para identificar esta conta.' : undefined}>
                    <input className={`ia-input ${touched && !cmdLabel.trim() ? 'err' : ''}`} value={cmdLabel} onChange={(e) => setCmdLabel(e.target.value)} placeholder={'Ex: "Unidade Centro" ou "Conta Principal"'} />
                  </Field>
                  <Field label="E-mail / usuário CMD-COLETA" error={touched && !cmdEmail.trim() ? 'Informe o usuário do CMD-COLETA.' : undefined}>
                    <input className={`ia-input ia-mono ${touched && !cmdEmail.trim() ? 'err' : ''}`} value={cmdEmail} onChange={(e) => setCmdEmail(e.target.value)} placeholder="gabriel9300" />
                  </Field>
                  <Field label="Senha CMD-COLETA" error={touched && !cmdPass.trim() ? 'Informe a senha do CMD-COLETA.' : undefined}>
                    <PasswordField value={cmdPass} onChange={setCmdPass} placeholder="•••••••••••" mono />
                  </Field>
                </div>
              </div>
            )}

            {step === 2 && (
              <div style={{ animation: 'ia-slide .25s ease' }}>
                <h2 style={{ color: 'var(--c-ink)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', margin: '14px 0 0' }}>Autenticação de dois fatores (MFA)</h2>
                <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>A IA também precisa do código 2FA para logar no sistema do governo. Siga os passos para nos enviar a chave.</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 22 }} data-mfa>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                    {MFA_STEPS.map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                        <span style={{ width: 22, height: 22, flex: 'none', borderRadius: '50%', background: 'var(--c-soft)', color: 'var(--c-softfg)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                        <span style={{ color: 'var(--c-ink2)', fontSize: 13, lineHeight: 1.5 }}>{t}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    {mfaMode === 'qr' ? (
                      <>
                        {!extractedKey ? (
                          <label style={{ display: 'block', border: `1.5px dashed ${touched && mfaBad ? 'var(--c-warn)' : 'var(--c-border2)'}`, borderRadius: 14, background: 'var(--c-input)', padding: '30px 20px', textAlign: 'center', cursor: 'pointer' }}>
                            <input type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
                            <div style={{ width: 50, height: 50, borderRadius: 13, background: 'var(--c-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                              <Upload size={24} style={{ color: 'var(--c-blue)' }} />
                            </div>
                            <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 600, marginTop: 14 }}>Clique para enviar o print do QR code</div>
                            <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 4 }}>JPG, PNG ou qualquer imagem do celular</div>
                          </label>
                        ) : (
                          <div style={{ border: '1.5px solid var(--c-ok)', borderRadius: 14, background: 'var(--c-oksoft)', padding: 18, animation: 'ia-slide .2s ease' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              {filePreview && <img src={filePreview} alt="print" style={{ width: 54, height: 54, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--c-border)' }} />}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: 'var(--c-ink)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
                                <div style={{ color: 'var(--c-okfg)', fontSize: 12, fontWeight: 600, marginTop: 2 }}>Chave extraída automaticamente</div>
                              </div>
                              <button onClick={() => { setExtractedKey(''); setFileName(''); setFilePreview(''); }} style={{ width: 30, height: 30, flex: 'none', border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer' }}><X size={17} /></button>
                            </div>
                            <div className="ia-mono" style={{ marginTop: 12, letterSpacing: '.04em', color: 'var(--c-ink)', background: 'var(--c-input)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '10px 12px' }}>{extractedKey}</div>
                          </div>
                        )}
                        <div onClick={() => setMfaMode('manual')} className="ia-link" style={{ marginTop: 14, textAlign: 'center', fontSize: 13 }}>Prefiro inserir a chave manualmente</div>
                      </>
                    ) : (
                      <>
                        <Field label="Chave TOTP" error={touched && mfaBad ? 'A chave parece curta — confira antes de continuar.' : undefined}>
                          <input className={`ia-input ia-mono ${touched && mfaBad ? 'err' : ''}`} value={manualKey} onChange={(e) => setManualKey(e.target.value.toUpperCase())} placeholder="JBSWY3DPEHPK3PXP" style={{ letterSpacing: '.06em' }} />
                        </Field>
                        <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 6 }}>Cole aqui a chave no formato JBSWY3DPEHPK3PXP.</div>
                        <div onClick={() => setMfaMode('qr')} className="ia-link" style={{ marginTop: 14, textAlign: 'center', fontSize: 13 }}>Voltar a enviar o print do QR code</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ animation: 'ia-slide .25s ease' }}>
                <h2 style={{ color: 'var(--c-ink)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', margin: '14px 0 0' }}>Configuração inicial da sua clínica</h2>
                <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>Esses dados aparecem nos relatórios e na tela pública de acompanhamento.</p>
                <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 520 }} data-clinic>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Nome da clínica / operação" error={touched && !clinicName.trim() ? 'Informe o nome da operação.' : undefined}>
                      <input className={`ia-input ${touched && !clinicName.trim() ? 'err' : ''}`} value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="Ex: Saúde Itinerante LTDA" />
                    </Field>
                  </div>
                  <Field label="CNPJ"><input className="ia-input ia-mono" value={clinicCnpj} onChange={(e) => setClinicCnpj(e.target.value)} placeholder="00.000.000/0001-00" /></Field>
                  <Field label="Responsável"><input className="ia-input" value={clinicResp} onChange={(e) => setClinicResp(e.target.value)} placeholder="Ex: João Pereira" /></Field>
                  <Field label="Telefone / WhatsApp"><input className="ia-input" value={clinicPhone} onChange={(e) => setClinicPhone(e.target.value)} placeholder="(11) 99876-5432" /></Field>
                  <Field label="Cidade / UF base"><input className="ia-input" value={clinicCity} onChange={(e) => setClinicCity(e.target.value)} placeholder="Ex: Teresina / PI" /></Field>
                </div>
              </div>
            )}

            {step === 4 && (
              <div style={{ animation: 'ia-slide .25s ease' }}>
                <h2 style={{ color: 'var(--c-ink)', fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', margin: '14px 0 0' }}>Regras clínicas dos cadastros</h2>
                <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>A IA usa essas regras para preencher a alta e o CID de cada paciente. Você pode alterá-las depois em <b>Controles</b>.</p>

                <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 560 }}>
                  {/* Terminologia + categorias de CID */}
                  <div>
                    <label className="ia-label">Terminologia do problema</label>
                    <div className="ia-input" style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 320, background: 'var(--c-surface2)', color: 'var(--c-ink2)', cursor: 'default' }}>
                      <ShieldCheck size={15} style={{ color: 'var(--c-ok)' }} /> CID-10 (padrão)
                    </div>
                    <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 5 }}>Informe a <b>categoria do CID</b> usada em cada tipo de paciente.</div>

                    <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
                      <Field label="CID p/ pacientes de OCI de 0 a 8 anos" error={touched && !cidOci08.trim() ? 'Informe a categoria do CID.' : undefined}>
                        <input className={`ia-input ia-mono ${touched && !cidOci08.trim() ? 'err' : ''}`} value={cidOci08} onChange={(e) => setCidOci08(e.target.value.toUpperCase())} placeholder="Ex: H53" style={{ textTransform: 'uppercase' }} />
                      </Field>
                      <Field label="CID p/ pacientes acima de 9 anos" error={touched && !cid9Mais.trim() ? 'Informe a categoria do CID.' : undefined}>
                        <input className={`ia-input ia-mono ${touched && !cid9Mais.trim() ? 'err' : ''}`} value={cid9Mais} onChange={(e) => setCid9Mais(e.target.value.toUpperCase())} placeholder="Ex: H53" style={{ textTransform: 'uppercase' }} />
                      </Field>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 22, borderTop: '1px solid var(--c-border)' }}>
              <button onClick={voltar} className="ia-btn-outline">{step === 1 ? 'Sair' : 'Voltar'}</button>
              <button onClick={proximo} className="ia-btn" style={{ padding: '12px 24px', fontSize: 14 }}>
                {nextLabel} <ArrowRight size={16} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de confirmação */}
      {confirmOpen && (
        <div onClick={() => !submitting && setConfirmOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 420, maxWidth: '100%', padding: 28, animation: 'ia-slide .22s ease' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--c-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={24} style={{ color: 'var(--c-blue)' }} />
            </div>
            <h3 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, margin: '16px 0 0' }}>Enviar para autorização?</h3>
            <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>Sua conta CMD-COLETA, a chave 2FA e os dados da clínica serão enviados ao super admin para liberação. Você pode editar tudo depois.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={() => setConfirmOpen(false)} disabled={submitting} className="ia-btn-outline" style={{ flex: 1 }}>Revisar</button>
              <button onClick={confirmFinish} disabled={submitting} className="ia-btn" style={{ flex: 1, padding: 12 }}>
                {submitting ? <><span style={{ width: 15, height: 15, border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'ia-spin .7s linear infinite' }} />Enviando…</> : 'Confirmar e enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast data={toast} />
    </Shell>
  );
}
