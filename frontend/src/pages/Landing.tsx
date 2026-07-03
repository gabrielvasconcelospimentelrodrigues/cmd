import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sun, Moon, ArrowRight, PlayCircle, Check, Grid3x3, ShieldCheck, Clock, LineChart,
  AlertTriangle, Lock, Plus, Minus, X,
} from 'lucide-react';
import { useTheme, LogoMark, useToast, Toast, Field } from '../components/iacmd/ui';
import { AgentSphere } from '../components/iacmd/AgentSphere';

const NAV = [
  { id: 'como', label: 'Como funciona' },
  { id: 'recursos', label: 'Recursos' },
  { id: 'seguranca', label: 'Segurança' },
  { id: 'precos', label: 'Preços' },
];
const CONTAINER: React.CSSProperties = { maxWidth: 1200, margin: '0 auto', padding: '0 24px' };
const eyebrow: React.CSSProperties = { color: 'var(--c-softfg)', fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' };

export default function Landing() {
  const nav = useNavigate();
  const [theme, toggle] = useTheme();
  const [toast, showToast] = useToast();
  const [demo, setDemo] = useState(false);
  const [menu, setMenu] = useState(false);

  const scrollTo = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setMenu(false); };

  return (
    <div className="iacmd" data-theme={theme} style={{ minHeight: '100vh' }}>
      {/* NAV */}
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: 'var(--c-nav)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--c-border)' }}>
        <div style={{ ...CONTAINER, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px' }}>
          <div onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer' }}><LogoMark size={34} /><span style={{ color: 'var(--c-ink)', fontWeight: 700, fontSize: 20, letterSpacing: '.02em' }}>IACMD</span></div>
          <nav style={{ display: 'flex', gap: 26 }} className="lp-nav">
            {NAV.map((n) => <button key={n.id} onClick={() => scrollTo(n.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-ink2)', fontSize: 14, fontWeight: 500, fontFamily: 'inherit' }}>{n.label}</button>)}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={toggle} title="Alternar tema" style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
            <button onClick={() => nav('/login')} className="lp-hide-sm" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-ink2)', fontSize: 14, fontWeight: 500, fontFamily: 'inherit' }}>Entrar</button>
            <button onClick={() => nav('/registro')} className="ia-btn" style={{ padding: '10px 18px', fontSize: 14 }}>Começar agora</button>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section style={{ position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -160, right: -160, width: 680, height: 680, borderRadius: '50%', background: 'radial-gradient(circle,var(--c-glow),transparent 66%)', pointerEvents: 'none' }} />
        <div style={{ ...CONTAINER, display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 40, alignItems: 'center', padding: '60px 24px 48px' }} className="lp-hero">
          <div>
            <span style={{ ...eyebrow, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--c-soft)', border: '1px solid var(--c-softb)', padding: '7px 14px', borderRadius: 999 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--c-cyan)' }} /> IA de cadastro · ativa 24h</span>
            <h1 style={{ color: 'var(--c-ink)', fontSize: 54, lineHeight: 1.05, fontWeight: 700, letterSpacing: '-.025em', margin: '20px 0 0' }} className="lp-h1">
              As fichas dos seus pacientes, cadastradas <span style={{ background: 'linear-gradient(120deg,var(--c-cyan),var(--c-blued))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>sozinhas.</span>
            </h1>
            <p style={{ color: 'var(--c-ink2)', fontSize: 18, lineHeight: 1.6, maxWidth: 480, marginTop: 18 }}>A IA da IACMD preenche e envia cada ficha no sistema do governo — todo atendimento da sua carreta de saúde em dia, em até 24 horas. Sem digitador, sem fila, sem atraso.</p>
            <div style={{ display: 'flex', gap: 12, marginTop: 26, flexWrap: 'wrap' }}>
              <button onClick={() => setDemo(true)} className="ia-btn" style={{ padding: '15px 26px', fontSize: 15 }}>Agendar demonstração <ArrowRight size={18} /></button>
              <button onClick={() => nav('/registro')} className="ia-btn-outline" style={{ padding: '15px 22px', fontSize: 15 }}><PlayCircle size={18} style={{ color: 'var(--c-cyan)' }} /> Ver automação ao vivo</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, color: 'var(--c-ink3)', fontSize: 13 }}><Check size={15} style={{ color: 'var(--c-ok)' }} /> Credenciais criptografadas · Conformidade LGPD · você sempre no controle</div>
          </div>
          <div style={{ display: 'grid', placeItems: 'center', position: 'relative' }} className="lp-mesh">
            <AgentSphere active size={360} />
            <div style={{ position: 'absolute', top: 10, left: 0, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 14, padding: 14, boxShadow: 'var(--c-cardsh)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Check size={16} style={{ color: 'var(--c-ok)' }} /><span style={{ color: 'var(--c-ink)', fontSize: 13, fontWeight: 600 }}>Ficha #2041 · Maria S.</span></div>
              <div className="ia-mono" style={{ color: 'var(--c-ink3)', fontSize: 11, marginTop: 4 }}>enviada · 14:32</div>
            </div>
            <div style={{ position: 'absolute', bottom: 10, right: 0, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 14, padding: 16, boxShadow: 'var(--c-cardsh)' }}>
              <div style={{ ...eyebrow }}>Fichas hoje</div>
              <div style={{ color: 'var(--c-ink)', fontSize: 26, fontWeight: 700 }}>1.284</div>
              <div style={{ color: 'var(--c-okfg)', fontSize: 12, fontWeight: 600 }}>100% em dia · 0 atrasadas</div>
            </div>
          </div>
        </div>
        {/* trust strip */}
        <div style={{ ...CONTAINER, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '20px 24px 40px', borderTop: '1px solid var(--c-border)', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--c-ink3)', fontSize: 13, maxWidth: 220 }}>A serviço de carretas e unidades móveis de saúde no Brasil</span>
          {[['24h', 'ficha no ar'], ['−70%', 'custo de digitação'], ['0', 'fila de atraso'], ['99,8%', 'de acerto']].map(([n, l]) => (
            <div key={l}><div style={{ color: 'var(--c-ink)', fontSize: 26, fontWeight: 700 }}>{n}</div><div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>{l}</div></div>
          ))}
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como" style={{ ...CONTAINER, padding: '80px 24px 20px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <span style={eyebrow}>Como funciona</span>
          <h2 style={{ color: 'var(--c-ink)', fontSize: 36, fontWeight: 700, letterSpacing: '-.02em', margin: '10px 0 0' }}>Três passos. Depois é só atender.</h2>
          <p style={{ color: 'var(--c-ink2)', fontSize: 17, marginTop: 10 }}>Você conecta a conta uma vez. A IA faz o resto, todo dia, sozinha.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20, marginTop: 48 }} className="lp-3">
          {[
            ['Conecte a conta CMD-COLETA', 'Informe e-mail, senha e a chave do 2FA do sistema do governo. Tudo criptografado, usado só pela IA.'],
            ['Envie as fichas do dia', 'Suba a planilha ou deixe a integração puxar os atendimentos da carreta. A IA organiza a fila automaticamente.'],
            ['Acompanhe em tempo real', 'Veja cada ficha entrando no sistema, com log ao vivo e alerta na hora se algo precisar de você.'],
          ].map(([t, d], i) => (
            <div key={i} style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 16, padding: 26 }}>
              <div style={{ width: 54, height: 54, borderRadius: 14, background: 'var(--c-soft)', border: '1px solid var(--c-softb)', color: 'var(--c-softfg)', fontSize: 20, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{i + 1}</div>
              <h3 style={{ color: 'var(--c-ink)', fontSize: 19, fontWeight: 600, margin: '16px 0 0' }}>{t}</h3>
              <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, marginTop: 6 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* RECURSOS (bento) */}
      <section id="recursos" style={{ ...CONTAINER, padding: '80px 24px 20px' }}>
        <div style={{ maxWidth: 640 }}><span style={eyebrow}>Recursos</span><h2 style={{ color: 'var(--c-ink)', fontSize: 36, fontWeight: 700, letterSpacing: '-.02em', margin: '10px 0 0' }}>Tudo que a carreta precisa, no automático.</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18, marginTop: 32 }} className="lp-bento">
          <Bento span2 icon={<Grid3x3 size={22} />} tone="var(--c-blue)" toneBg="var(--c-soft)" title="Cadastro automático no sistema do governo" desc="A IA faz login, resolve o 2FA, preenche cada campo e confirma o envio — exatamente como um digitador faria, só que sem parar e sem errar." />
          <Bento icon={<ShieldCheck size={22} />} tone="var(--c-ok)" toneBg="var(--c-oksoft)" title="Credenciais criptografadas" desc="Senhas e chave 2FA guardadas com criptografia. Só a IA acessa, nunca aparecem na tela." />
          <Bento icon={<Clock size={22} />} tone="var(--c-blue)" toneBg="var(--c-soft)" title="Tudo em até 24h" desc="Atendeu hoje, está no sistema amanhã. Sem acúmulo, sem fila parada." />
          <Bento icon={<LineChart size={22} />} tone="var(--c-blue)" toneBg="var(--c-soft)" title="Relatórios e log completo" desc="Cada ficha tem registro de quando entrou e por quem. Prestação de contas pronta." />
          <Bento icon={<AlertTriangle size={22} />} tone="var(--c-warn)" toneBg="var(--c-warnsoft)" title="Alertas na hora certa" desc="Se uma ficha estiver incompleta ou o sistema cair, você recebe aviso com som — não descobre tarde demais." />
        </div>
      </section>

      {/* SEGURANÇA */}
      <section id="seguranca" style={{ ...CONTAINER, padding: '0 24px' }}>
        <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 22, padding: 44, marginTop: 60, display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 40 }} className="lp-hero">
          <div>
            <span style={eyebrow}>Segurança</span>
            <h2 style={{ color: 'var(--c-ink)', fontSize: 32, fontWeight: 700, margin: '10px 0 0' }}>Seus dados de paciente, tratados com seriedade.</h2>
            <p style={{ color: 'var(--c-ink2)', fontSize: 16, lineHeight: 1.6, maxWidth: 460, marginTop: 12 }}>Lidar com ficha de paciente é lidar com dado sensível. A IACMD foi feita pensando em LGPD do primeiro dia.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
              {['Criptografia das credenciais em repouso e em trânsito', 'Acesso só após autorização do administrador', 'Registro de auditoria de cada ação da IA'].map((t) => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Check size={17} style={{ color: 'var(--c-ok)', flex: 'none' }} /><span style={{ color: 'var(--c-ink)', fontSize: 15 }}>{t}</span></div>
              ))}
            </div>
          </div>
          <div style={{ background: 'var(--c-surface2)', border: '1px solid var(--c-border)', borderRadius: 16, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--c-soft)', color: 'var(--c-blue)', display: 'grid', placeItems: 'center' }}><Lock size={20} /></div><div><div style={{ color: 'var(--c-ink)', fontSize: 15, fontWeight: 700 }}>Cofre de credenciais</div><div style={{ color: 'var(--c-ink3)', fontSize: 12 }}>criptografado · AES-256</div></div></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {[['e-mail CMD-COLETA', 'g••••••00'], ['senha', '•••••••••••'], ['chave 2FA', '••••••••••••']].map(([k, v]) => (
                <div key={k} className="ia-mono" style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--c-input)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}><span style={{ color: 'var(--c-ink3)' }}>{k}</span><span style={{ color: 'var(--c-ink)' }}>{v}</span></div>
              ))}
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 14, background: 'var(--c-oksoft)', color: 'var(--c-okfg)', fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 999 }}><Lock size={12} /> Visível apenas para a IA</span>
          </div>
        </div>
      </section>

      {/* PREÇOS (modelo: implantação + mensalidade por canal) */}
      <section id="precos" style={{ ...CONTAINER, padding: '80px 24px 20px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <span style={eyebrow}>Preços</span>
          <h2 style={{ color: 'var(--c-ink)', fontSize: 36, fontWeight: 700, letterSpacing: '-.02em', margin: '10px 0 0' }}>Cobrança simples e justa.</h2>
          <p style={{ color: 'var(--c-ink2)', fontSize: 17, marginTop: 10 }}><b>Implantação</b> (única) + <b>mensalidade por canal de automação</b>. Cada canal equivale a um funcionário. Cadastre 1 ou mais empresas.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18, marginTop: 40, alignItems: 'start' }} className="lp-3">
          <Plano nome="1 canal" sub="Para uma empresa começando." preco="Sob consulta" onCta={() => setDemo(true)} cta="Falar com vendas" feats={['1 empresa · 1 canal de automação', 'Implantação + 1 mensalidade', 'Painel ao vivo e log completo']} />
          <Plano nome="Multi-canal" sub="Para quem roda várias frentes." preco="Sob consulta" destaque onCta={() => setDemo(true)} cta="Agendar demonstração" feats={['Várias empresas · vários canais', 'Implantação + N mensalidades', 'Alertas por som e WhatsApp', 'Suporte prioritário']} />
          <Plano nome="Rede" sub="Para redes e secretarias." preco="Sob medida" onCta={() => setDemo(true)} cta="Falar com vendas" feats={['Empresas e canais ilimitados', 'Gestão multiusuário e papéis', 'Gerente de conta dedicado']} />
        </div>
      </section>

      {/* FAQ */}
      <Faq />

      {/* CTA FINAL */}
      <section style={{ ...CONTAINER, padding: '0 24px' }}>
        <div style={{ background: '#070B16', borderRadius: 24, padding: '60px 44px', marginTop: 60, textAlign: 'center', border: '1px solid rgba(255,255,255,.08)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 0,var(--c-glow),transparent 60%)', pointerEvents: 'none' }} />
          <h2 style={{ color: '#fff', fontSize: 38, fontWeight: 700, maxWidth: 620, margin: '0 auto', position: 'relative' }}>Pare de digitar ficha. Deixe a IA trabalhar.</h2>
          <p style={{ color: '#B7C2DA', fontSize: 17, maxWidth: 520, margin: '12px auto 0', position: 'relative' }}>Agende uma demonstração e veja sua primeira carreta cadastrando em 24h.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 26, position: 'relative', flexWrap: 'wrap' }}>
            <button onClick={() => setDemo(true)} className="ia-btn" style={{ padding: '15px 26px', fontSize: 15 }}>Agendar demonstração</button>
            <button onClick={() => nav('/registro')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', fontSize: 15, fontWeight: 600, padding: '15px 22px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Criar conta</button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ ...CONTAINER, padding: '56px 24px 40px', borderTop: '1px solid var(--c-border)', marginTop: 60, display: 'flex', justifyContent: 'space-between', gap: 40, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 280 }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><LogoMark size={30} /><span style={{ color: 'var(--c-ink)', fontWeight: 700, fontSize: 18 }}>IACMD</span></div><p style={{ color: 'var(--c-ink3)', fontSize: 13, marginTop: 10 }}>Automação de cadastro de fichas de paciente para carretas e unidades móveis de saúde.</p></div>
        <FooterCol title="Produto" links={[['Como funciona', () => scrollTo('como')], ['Recursos', () => scrollTo('recursos')], ['Preços', () => scrollTo('precos')]]} />
        <FooterCol title="Conta" links={[['Entrar', () => nav('/login')], ['Criar conta', () => nav('/registro')]]} />
      </footer>
      <div style={{ ...CONTAINER, padding: '0 24px 30px', color: 'var(--c-ink3)', fontSize: 12 }}>© {new Date().getFullYear()} IACMD · Todos os direitos reservados.</div>

      {demo && <DemoModal onClose={() => setDemo(false)} onSent={() => { setDemo(false); showToast({ title: 'Pedido enviado', msg: 'Entramos em contato em até 1 dia útil.', kind: 'ok' }); }} />}
      {menu && null}
      <Toast data={toast} />
    </div>
  );
}

function Bento({ span2, icon, tone, toneBg, title, desc }: { span2?: boolean; icon: React.ReactNode; tone: string; toneBg: string; title: string; desc: string }) {
  return (
    <div style={{ gridColumn: span2 ? 'span 2' : undefined, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 18, padding: 24, minHeight: span2 ? 230 : 200 }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: toneBg, color: tone, display: 'grid', placeItems: 'center' }}>{icon}</div>
      <h3 style={{ color: 'var(--c-ink)', fontSize: span2 ? 21 : 18, fontWeight: 600, margin: '16px 0 0' }}>{title}</h3>
      <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, marginTop: 6, maxWidth: span2 ? 460 : undefined }}>{desc}</p>
    </div>
  );
}

function Plano({ nome, sub, preco, feats, cta, onCta, destaque }: { nome: string; sub: string; preco: string; feats: string[]; cta: string; onCta: () => void; destaque?: boolean }) {
  return (
    <div style={{ background: 'var(--c-surface)', border: destaque ? '1.5px solid var(--c-blue)' : '1px solid var(--c-border)', borderRadius: 18, padding: 28, position: 'relative', boxShadow: destaque ? '0 16px 40px rgba(37,99,235,.18)' : undefined }}>
      {destaque && <span style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--c-blued)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '4px 14px', borderRadius: 999 }}>Mais escolhido</span>}
      <div style={{ color: 'var(--c-ink)', fontSize: 17, fontWeight: 700 }}>{nome}</div>
      <div style={{ color: 'var(--c-ink3)', fontSize: 13 }}>{sub}</div>
      <div style={{ color: 'var(--c-ink)', fontSize: 30, fontWeight: 700, margin: '16px 0' }}>{preco}</div>
      <button onClick={onCta} className={destaque ? 'ia-btn' : 'ia-btn-outline'} style={{ width: '100%', justifyContent: 'center' }}>{cta}</button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
        {feats.map((f) => <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Check size={16} style={{ color: 'var(--c-ok)', flex: 'none' }} /><span style={{ color: 'var(--c-ink2)', fontSize: 14 }}>{f}</span></div>)}
      </div>
    </div>
  );
}

function Faq() {
  const data = [
    ['Como a IA acessa o sistema do governo?', 'Você cadastra uma vez o e-mail, a senha e a chave do 2FA do CMD-COLETA. A IACMD guarda tudo criptografado e a IA usa essas credenciais para fazer login e enviar as fichas — exatamente como você faria manualmente.'],
    ['Meus dados de paciente ficam seguros?', 'Sim. As credenciais ficam criptografadas e nunca aparecem na tela. Cada ação da IA gera registro de auditoria, e o acesso à conta só é liberado após autorização do administrador.'],
    ['Preciso instalar alguma coisa?', 'Não. A IACMD roda na nuvem. Você acompanha tudo pelo navegador, no computador ou no celular.'],
    ['E se uma ficha estiver incompleta?', 'A IA separa a ficha, te avisa na hora com alerta sonoro e segue com as demais. Nada trava a fila por causa de um cadastro com pendência.'],
    ['Consigo cancelar quando quiser?', 'Sim, sem fidelidade e sem multa. A cobrança é mensal por canal de automação ativo.'],
  ];
  const [open, setOpen] = useState(-1);
  return (
    <section style={{ maxWidth: 760, margin: '0 auto', padding: '80px 24px 20px' }}>
      <h2 style={{ color: 'var(--c-ink)', fontSize: 32, fontWeight: 700, textAlign: 'center' }}>Perguntas frequentes</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
        {data.map(([q, a], i) => (
          <div key={i} onClick={() => setOpen(open === i ? -1 : i)} style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '20px 22px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><span style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 600 }}>{q}</span>{open === i ? <Minus size={20} style={{ color: 'var(--c-softfg)', flex: 'none' }} /> : <Plus size={20} style={{ color: 'var(--c-softfg)', flex: 'none' }} />}</div>
            {open === i && <p style={{ color: 'var(--c-ink2)', fontSize: 14, lineHeight: 1.6, margin: '12px 0 0' }}>{a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, () => void][] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</div>
      {links.map(([l, fn]) => <button key={l} onClick={fn} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-ink2)', fontSize: 14, textAlign: 'left', fontFamily: 'inherit', padding: 0 }}>{l}</button>)}
    </div>
  );
}

function DemoModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [f, setF] = useState({ nome: '', email: '', whats: '', canais: '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const erros = { nome: !f.nome.trim(), email: !/.+@.+\..+/.test(f.email), whats: !f.whats.trim() };
  const enviar = () => {
    setTouched(true);
    if (Object.values(erros).some(Boolean)) return;
    setBusy(true);
    setTimeout(() => onSent(), 800); // lead sem CRM ainda
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,11,22,.62)', backdropFilter: 'blur(3px)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="ia-card" style={{ width: 480, maxWidth: '100%', padding: 26, animation: 'ia-slide .22s ease' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div><h3 style={{ color: 'var(--c-ink)', fontSize: 20, fontWeight: 700, margin: 0 }}>Agendar demonstração</h3><p style={{ color: 'var(--c-ink3)', fontSize: 13, margin: '4px 0 0' }}>Conte um pouco da sua operação. Sem compromisso.</p></div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--c-ink3)', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
          <Field label="Seu nome" error={touched && erros.nome ? 'Falta seu nome.' : undefined}><input className="ia-input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex: João Pereira" /></Field>
          <Field label="E-mail" error={touched && erros.email ? 'Confira o e-mail.' : undefined}><input className="ia-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="voce@clinica.com.br" /></Field>
          <Field label="WhatsApp" error={touched && erros.whats ? 'Falta o WhatsApp.' : undefined}><input className="ia-input" value={f.whats} onChange={(e) => setF({ ...f, whats: e.target.value })} placeholder="(11) 99876-5432" /></Field>
          <div><label className="ia-label">Quantas carretas / canais?</label><div style={{ display: 'flex', gap: 8 }}>{['1', '2 a 5', '6+'].map((c) => <button key={c} onClick={() => setF({ ...f, canais: c })} style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${f.canais === c ? 'var(--c-blue)' : 'var(--c-border2)'}`, background: f.canais === c ? 'var(--c-soft)' : 'transparent', color: f.canais === c ? 'var(--c-softfg)' : 'var(--c-ink2)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 14 }}>{c}</button>)}</div></div>
        </div>
        <button onClick={enviar} disabled={busy} className="ia-btn" style={{ width: '100%', marginTop: 20 }}>{busy ? 'Enviando…' : 'Enviar pedido'}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, color: 'var(--c-ink3)', fontSize: 12 }}><Lock size={13} /> Seus dados não são compartilhados.</div>
      </div>
    </div>
  );
}
