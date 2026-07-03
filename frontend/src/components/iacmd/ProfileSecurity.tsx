import { useCallback, useEffect, useState } from 'react';
import { X, ShieldCheck, KeyRound, User, Check, Copy, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PasswordField, type ToastData } from './ui';

const iniciais = (s: string) => (s || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

interface Factor { id: string; friendly_name?: string | null; status: string }

/** Modal de Perfil & Segurança (dados, senha e 2FA/TOTP). Serve para qualquer
 * papel — é a conta do próprio usuário logado (via Supabase Auth). */
export default function ProfileSecurity({ onClose, showToast, papelLabel }: { onClose: () => void; showToast: (t: ToastData) => void; papelLabel?: string }) {
  const [aba, setAba] = useState<'perfil' | 'seguranca'>('perfil');
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [nomeOrig, setNomeOrig] = useState('');
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [savingNome, setSavingNome] = useState(false);
  const [savingSenha, setSavingSenha] = useState(false);

  // 2FA
  const [factors, setFactors] = useState<Factor[]>([]);
  const [carregando2fa, setCarregando2fa] = useState(true);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      setEmail(u?.email ?? '');
      const n = (u?.user_metadata as { full_name?: string } | undefined)?.full_name ?? (u?.email?.split('@')[0] ?? '');
      setNome(n); setNomeOrig(n);
    })();
  }, []);

  const carregarFatores = useCallback(async () => {
    setCarregando2fa(true);
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
    setCarregando2fa(false);
  }, []);
  useEffect(() => { void carregarFatores(); }, [carregarFatores]);

  const ativo2fa = factors.some((f) => f.status === 'verified');

  const salvarNome = async () => {
    setSavingNome(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: nome.trim() } });
    setSavingNome(false);
    if (error) return showToast({ title: 'Falha', msg: error.message, kind: 'err' });
    setNomeOrig(nome.trim());
    showToast({ title: 'Nome atualizado', msg: '', kind: 'ok' });
  };

  const salvarSenha = async () => {
    if (senha.length < 6) return showToast({ title: 'Senha curta', msg: 'Use ao menos 6 caracteres.', kind: 'err' });
    if (senha !== senha2) return showToast({ title: 'Senhas diferentes', msg: 'A confirmação não confere.', kind: 'err' });
    setSavingSenha(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSavingSenha(false);
    if (error) return showToast({ title: 'Falha', msg: error.message, kind: 'err' });
    setSenha(''); setSenha2('');
    showToast({ title: 'Senha alterada', msg: '', kind: 'ok' });
  };

  const iniciarEnroll = async () => {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `IACMD ${Date.now()}` });
    if (error || !data) return showToast({ title: 'Falha ao iniciar 2FA', msg: error?.message ?? '', kind: 'err' });
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCodigo('');
  };

  const confirmarEnroll = async () => {
    if (!enroll) return;
    setVerificando(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: codigo.trim() });
    setVerificando(false);
    if (error) return showToast({ title: 'Código inválido', msg: error.message, kind: 'err' });
    setEnroll(null); setCodigo('');
    await carregarFatores();
    showToast({ title: '2FA ativado', msg: 'Sua conta está protegida.', kind: 'ok' });
  };

  const desativar = async () => {
    if (!window.confirm('Desativar a verificação em duas etapas desta conta?')) return;
    for (const f of factors) await supabase.auth.mfa.unenroll({ factorId: f.id });
    await carregarFatores();
    showToast({ title: '2FA desativado', msg: '', kind: 'ok' });
  };

  const copiar = (t: string) => { navigator.clipboard?.writeText(t).then(() => showToast({ title: 'Copiado', msg: '', kind: 'ok' })).catch(() => {}); };

  const tab = (k: 'perfil' | 'seguranca', label: string, icon: React.ReactNode) => (
    <button onClick={() => setAba(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', borderBottom: aba === k ? '2px solid var(--c-blue)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: aba === k ? 700 : 500, padding: '9px 14px', background: 'transparent', color: aba === k ? 'var(--c-ink)' : 'var(--c-ink3)' }}>{icon}{label}</button>
  );
  const lbl: React.CSSProperties = { display: 'block', color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, marginBottom: 6 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, boxShadow: 'var(--c-shadow)', overflow: 'hidden' }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 22px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'linear-gradient(135deg,#2563EB,#38BDF8)', color: '#fff', fontWeight: 700, fontSize: 15, display: 'grid', placeItems: 'center', flex: 'none' }}>{iniciais(nome || email)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--c-ink)', fontSize: 17, fontWeight: 700 }}>{nome || '—'}</div>
            <div className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{email}{papelLabel ? ` · ${papelLabel}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer', display: 'grid', placeItems: 'center', flex: 'none' }}><X size={18} /></button>
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 18px 0', borderBottom: '1px solid var(--c-border)' }}>
          {tab('perfil', 'Perfil', <User size={16} />)}
          {tab('seguranca', 'Segurança', <ShieldCheck size={16} />)}
          {ativo2fa && <span style={{ marginLeft: 'auto', alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--c-okfg)', fontSize: 12, fontWeight: 700 }}><ShieldCheck size={14} /> 2FA ativo</span>}
        </div>

        <div style={{ padding: 22, overflowY: 'auto' }}>
          {aba === 'perfil' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={lbl}>Nome</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} className="ia-input" />
                  <button onClick={salvarNome} disabled={savingNome || nome.trim() === nomeOrig || !nome.trim()} className="ia-btn-outline" style={{ padding: '0 16px', flex: 'none' }}>{savingNome ? '…' : 'Salvar'}</button>
                </div>
              </div>
              <div>
                <label style={lbl}>E-mail</label>
                <input value={email} disabled className="ia-input ia-mono" style={{ opacity: 0.65 }} />
              </div>
              <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 18 }}>
                <div style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Trocar senha</div>
                <label style={lbl}>Nova senha</label>
                <PasswordField value={senha} onChange={setSenha} placeholder="mínimo 6 caracteres" />
                <div style={{ height: 10 }} />
                <label style={lbl}>Confirmar nova senha</label>
                <PasswordField value={senha2} onChange={setSenha2} placeholder="repita a senha" />
                <button onClick={salvarSenha} disabled={savingSenha || !senha} className="ia-btn" style={{ marginTop: 14, padding: '10px 18px' }}>{savingSenha ? 'Salvando…' : 'Alterar senha'}</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 11, flex: 'none', background: ativo2fa ? 'var(--c-oksoft)' : 'var(--c-warnsoft)', color: ativo2fa ? 'var(--c-okfg)' : 'var(--c-warnfg)', display: 'grid', placeItems: 'center' }}><ShieldCheck size={22} /></div>
                <div>
                  <div style={{ color: 'var(--c-ink)', fontSize: 15, fontWeight: 700 }}>Verificação em duas etapas (2FA)</div>
                  <div style={{ color: 'var(--c-ink3)', fontSize: 13, marginTop: 2, lineHeight: 1.5 }}>Protege o acesso com um código de 6 dígitos do seu app autenticador (Google Authenticator, Authy, 1Password…). Evita invasão mesmo se a senha vazar.</div>
                </div>
              </div>

              {carregando2fa ? (
                <div style={{ color: 'var(--c-ink3)', fontSize: 14, padding: 12 }}>Carregando…</div>
              ) : ativo2fa && !enroll ? (
                <div style={{ background: 'var(--c-oksoft)', border: '1px solid var(--c-ok)', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Check size={20} style={{ color: 'var(--c-okfg)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'var(--c-okfg)', fontSize: 14, fontWeight: 700 }}>2FA está ativado</div>
                    <div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>No próximo login o código será solicitado.</div>
                  </div>
                  <button onClick={desativar} className="ia-btn-outline" style={{ padding: '0 12px', height: 34, fontSize: 13, color: 'var(--c-errfg)' }}>Desativar</button>
                </div>
              ) : enroll ? (
                <div style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16 }}>
                  <div style={{ color: 'var(--c-ink2)', fontSize: 13, marginBottom: 12 }}>1. Escaneie o QR code no seu app autenticador:</div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ background: '#fff', padding: 8, borderRadius: 10, flex: 'none' }} dangerouslySetInnerHTML={{ __html: enroll.qr }} />
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginBottom: 4 }}>ou digite a chave manualmente:</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input readOnly value={enroll.secret} className="ia-input ia-mono" style={{ fontSize: 12 }} onFocus={(e) => e.target.select()} />
                        <button onClick={() => copiar(enroll.secret)} className="ia-btn-outline" style={{ padding: '0 10px', flex: 'none' }}><Copy size={14} /></button>
                      </div>
                    </div>
                  </div>
                  <div style={{ color: 'var(--c-ink2)', fontSize: 13, margin: '16px 0 8px' }}>2. Digite o código de 6 dígitos gerado:</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="ia-input ia-mono" style={{ fontSize: 18, letterSpacing: '.3em', textAlign: 'center' }} />
                    <button onClick={confirmarEnroll} disabled={verificando || codigo.length !== 6} className="ia-btn" style={{ padding: '0 18px', flex: 'none' }}>{verificando ? <Loader2 size={16} style={{ animation: 'ia-spin .8s linear infinite' }} /> : 'Ativar'}</button>
                  </div>
                  <button onClick={() => setEnroll(null)} className="ia-link" style={{ marginTop: 12, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Cancelar</button>
                </div>
              ) : (
                <button onClick={iniciarEnroll} className="ia-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px' }}><KeyRound size={16} /> Ativar 2FA</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
