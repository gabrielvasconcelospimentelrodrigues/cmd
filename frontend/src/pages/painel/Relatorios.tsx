import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CalendarRange, Stethoscope, Layers, Clock3, RotateCcw, AlertTriangle, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { apiGet, type ApiError } from '../../lib/api';
import { Card, brl, fmtMilhar } from './parts';

/* ============================================================================
   RELATÓRIO DAS FICHAS IMPORTADAS

   Duas séries no relatório inteiro — OCI e Cirurgia — sempre nas MESMAS cores
   (azul e ciano, tokens do próprio painel), nesta ordem, em todo gráfico. Cor
   segue a entidade, não a posição: filtrar não repinta o que sobrou.

   O ciano fica abaixo de 3:1 contra o fundo claro, o que obriga apoio além da
   cor — por isso toda barra leva rótulo direto, há legenda e existe a tabela
   por médico com os mesmos números.
   ========================================================================== */

const COR_OCI = 'var(--c-blue)';
const COR_CIR = 'var(--c-cyan)';

type Base = 'atendimento' | 'importacao' | 'registro';
type Modalidade = 'todas' | 'oci' | 'catarata';
type Faixa = 'todas' | '0_8' | '9_mais' | 'sem_idade';
type Situacao = 'todas' | 'registrada' | 'pendente' | 'revisao' | 'erro';

interface Relatorio {
  periodo: { inicio: string | null; fim: string | null; base: string };
  resumo: {
    total: number; oci: number; cirurgia: number;
    faixa_0_8: number; faixa_9_mais: number; sem_idade: number;
    registradas: number; pendentes: number; revisao: number; erros: number;
    medicos: number; listas: number;
    primeira: string | null; ultima: string | null; sem_data: number;
  };
  economia: { execucoes: number; minutos: number; horas: number; custo_minuto: number; valor: number; funcionarios_equivalentes: number };
  por_medico: { medico: string; total: number; oci: number; cirurgia: number; faixa_0_8: number; faixa_9_mais: number; registradas: number }[];
  por_mes: { mes: string; total: number; oci: number; cirurgia: number; faixa_0_8: number; faixa_9_mais: number }[];
  por_lista: { upload_id: number; lista: string; enviado_em: string | null; total: number; registradas: number; cirurgia: number }[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Atalhos de período. Fechado em opções de propósito: digitar duas datas para
 * ver "este mês" é atrito puro. */
function atalho(qual: 'mes' | 'mes_passado' | 'noventa' | 'ano'): { inicio: string; fim: string } {
  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = hoje.getMonth();
  if (qual === 'mes') return { inicio: iso(new Date(y, m, 1)), fim: iso(new Date(y, m + 1, 0)) };
  if (qual === 'mes_passado') return { inicio: iso(new Date(y, m - 1, 1)), fim: iso(new Date(y, m, 0)) };
  if (qual === 'ano') return { inicio: iso(new Date(y, 0, 1)), fim: iso(new Date(y, 11, 31)) };
  const de = new Date(hoje); de.setDate(de.getDate() - 89);
  return { inicio: iso(de), fim: iso(hoje) };
}

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function rotuloMes(mes: string): string {
  const [a, m] = mes.split('-');
  return `${MES_CURTO[Number(m) - 1] ?? m}/${(a ?? '').slice(2)}`;
}
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');

/**
 * Traduz a falha da API para algo que o usuário do painel entenda.
 *
 * O 404 é o caso concreto que já aconteceu: o frontend foi publicado antes do
 * backend, então a tela existia mas a rota não. Mostrar "Not Found" cru fazia
 * parecer defeito da conta do cliente — a causa era o servidor estar numa
 * versão anterior.
 */
function mensagemDeErro(e: unknown): string {
  const status = (e as ApiError)?.status;
  if (status === 404) {
    return 'O relatório ainda não está disponível nesta versão do servidor. A tela já foi publicada, mas a atualização da API está pendente — avise o suporte se isto continuar após algumas horas.';
  }
  if (status === 403) return 'Seu usuário não tem permissão para ver este relatório.';
  if (status && status >= 500) return 'O servidor não conseguiu montar o relatório agora. Tente de novo em alguns instantes.';
  if (e instanceof Error && e.message) return e.message;
  return 'Não foi possível carregar o relatório.';
}

const inp: CSSProperties = {
  boxSizing: 'border-box', width: '100%', height: 42, background: 'var(--c-input)',
  border: '1.5px solid var(--c-border2)', borderRadius: 9, padding: '0 10px',
  color: 'var(--c-ink)', fontFamily: 'inherit', fontSize: 15,
};

/**
 * Tela estreita (celular).
 *
 * Aqui não basta CSS: no celular a tabela vira lista de cartões e o painel de
 * filtros deixa de existir até ser aberto — são árvores diferentes, não a
 * mesma coisa reposicionada. Por isso a decisão precisa chegar ao JSX.
 */
function useEstreito(limite = 640): boolean {
  const consulta = `(max-width: ${limite}px)`;
  const [estreito, setEstreito] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(consulta).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const aoMudar = (e: MediaQueryListEvent) => setEstreito(e.matches);
    setEstreito(mq.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, [consulta]);
  return estreito;
}

export default function Relatorios({
  contas = [],
  empresas = [],
  isMember = false,
  filtroMembro,
  filtroEmpresa,
  ativo,
}: {
  contas?: { id: number; label: string }[];
  empresas?: { id: number; nome: string }[];
  isMember?: boolean;
  filtroMembro?: string | null;
  filtroEmpresa?: string | null;
  ativo: boolean;
}) {
  const inicial = atalho('noventa');
  const [inicio, setInicio] = useState(inicial.inicio);
  const [fim, setFim] = useState(inicial.fim);
  const [base, setBase] = useState<Base>('atendimento');
  const [modalidade, setModalidade] = useState<Modalidade>('todas');
  const [faixa, setFaixa] = useState<Faixa>('todas');
  const [situacao, setSituacao] = useState<Situacao>('todas');
  const [medico, setMedico] = useState('');
  const [conta, setConta] = useState('');
  const [empresa, setEmpresa] = useState('');

  const [dados, setDados] = useState<Relatorio | null>(null);
  const [medicos, setMedicos] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const estreito = useEstreito();
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  // No celular os campos ficam guardados: nove selects empurravam o relatório
  // inteiro para baixo da dobra, e quem abre a tela quer ver o número primeiro.
  const mostrarCampos = !estreito || filtrosAbertos;

  // Quantos filtros fogem do padrão — vira o contador do botão, para o usuário
  // saber que há recorte ativo sem precisar abrir o painel.
  const ativos = [
    modalidade !== 'todas', faixa !== 'todas', situacao !== 'todas',
    !!medico, !!conta, !!empresa, base !== 'atendimento',
  ].filter(Boolean).length;

  const query = useMemo(() => {
    const q: string[] = [`base=${base}`];
    if (inicio) q.push(`inicio=${inicio}`);
    if (fim) q.push(`fim=${fim}`);
    if (modalidade !== 'todas') q.push(`modalidade=${modalidade}`);
    if (faixa !== 'todas') q.push(`faixa=${faixa}`);
    if (situacao !== 'todas') q.push(`situacao=${situacao}`);
    if (medico) q.push(`medico=${encodeURIComponent(medico)}`);
    if (!isMember && conta) q.push(`clinic_account_id=${conta}`);
    if (filtroMembro) q.push(`member_user_id=${filtroMembro}`);
    // Uma empresa só na querystring: o filtro global do painel manda, e o
    // select local vale quando não há filtro global. Mandar empresa_id duas
    // vezes faria o backend usar a primeira e ignorar a escolha da tela.
    const empresaAtiva = filtroEmpresa || (isMember ? '' : empresa);
    if (empresaAtiva) q.push(`empresa_id=${empresaAtiva}`);
    return q.join('&');
  }, [base, inicio, fim, modalidade, faixa, situacao, medico, conta, empresa, isMember, filtroMembro, filtroEmpresa]);

  /**
   * Numera as buscas para descartar resposta atrasada.
   *
   * O relatório leva de 150ms a 600ms conforme o recorte, então trocar de
   * filtro rápido deixa duas consultas no ar — e a antiga pode voltar DEPOIS
   * da nova. Sem esta guarda, a resposta velha sobrescrevia a tela e o filtro
   * parecia não ter pegado.
   */
  const buscaAtual = useRef(0);

  const carregar = useCallback(async () => {
    const minha = ++buscaAtual.current;
    setCarregando(true);
    setErro(null);
    try {
      const resp = await apiGet<Relatorio>(`/relatorios/fichas?${query}`);
      if (minha !== buscaAtual.current) return; // já existe busca mais nova
      setDados(resp);
    } catch (e) {
      if (minha !== buscaAtual.current) return;
      setErro(mensagemDeErro(e));
      setDados(null);
    } finally {
      if (minha === buscaAtual.current) setCarregando(false);
    }
  }, [query]);

  // Só busca com a aba aberta: as páginas ficam montadas com display:none e
  // recarregar em segundo plano seria consulta jogada fora. O atraso curto
  // agrupa mudanças em sequência (mexer nas duas datas dispara uma busca, não
  // duas) sem que a tela pareça travada.
  useEffect(() => {
    if (!ativo) return;
    const t = setTimeout(() => { void carregar(); }, 250);
    return () => clearTimeout(t);
  }, [ativo, carregar]);
  useEffect(() => {
    if (!ativo || medicos.length) return;
    apiGet<string[]>('/relatorios/medicos').then(setMedicos).catch(() => setMedicos([]));
  }, [ativo, medicos.length]);

  const limpar = () => {
    const p = atalho('noventa');
    setInicio(p.inicio); setFim(p.fim); setBase('atendimento');
    setModalidade('todas'); setFaixa('todas'); setSituacao('todas');
    setMedico(''); setConta(''); setEmpresa('');
  };

  const r = dados?.resumo;
  const ec = dados?.economia;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* ---- FILTROS ---- */}
      <Card style={{ padding: estreito ? 12 : 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          {/* No celular o cabeçalho vira o próprio botão: um toque abre e
              fecha o painel, e o contador mostra que há recorte ativo. */}
          <button
            onClick={() => estreito && setFiltrosAbertos((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
              background: 'transparent', border: 'none', padding: 0,
              color: 'var(--c-ink)', fontSize: 15, fontWeight: 700,
              fontFamily: 'inherit', cursor: estreito ? 'pointer' : 'default',
            }}
          >
            <SlidersHorizontal size={17} style={{ color: 'var(--c-ink3)', flex: 'none' }} />
            Filtros
            {ativos > 0 && (
              <span style={{ flex: 'none', fontSize: 11, fontWeight: 800, color: '#fff', background: 'var(--c-blued)', borderRadius: 999, padding: '2px 7px' }}>{ativos}</span>
            )}
            {estreito && (mostrarCampos ? <ChevronUp size={16} style={{ color: 'var(--c-ink3)' }} /> : <ChevronDown size={16} style={{ color: 'var(--c-ink3)' }} />)}
            {carregando && (
              <span style={{ color: 'var(--c-ink3)', fontSize: 12, fontWeight: 600, animation: 'ia-pulse 1.2s ease-in-out infinite' }}>
                atualizando…
              </span>
            )}
          </button>
          {!estreito && (
            <button onClick={limpar} title="Voltar aos filtros padrão" className="ia-btn-outline" style={{ padding: '0 10px', height: 32, fontSize: 12 }}><RotateCcw size={13} /></button>
          )}
        </div>

        {/* Período por atalho fica SEMPRE visível, mesmo com o painel fechado:
            é o filtro que mais se troca, e escondê-lo custaria dois toques. */}
        <div className="r-wrap" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {([['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['noventa', '90 dias'], ['ano', 'Este ano'], ['tudo', 'Tudo']] as const).map(([k, rot]) => {
            const p = k === 'tudo' ? { inicio: '', fim: '' } : atalho(k);
            const ativo = inicio === p.inicio && fim === p.fim;
            return (
              <button
                key={k}
                onClick={() => { setInicio(p.inicio); setFim(p.fim); }}
                style={{
                  flex: estreito ? '1 1 auto' : 'none',
                  padding: '0 12px', height: estreito ? 36 : 30, borderRadius: 8,
                  border: `1px solid ${ativo ? 'var(--c-blued)' : 'var(--c-border2)'}`,
                  background: ativo ? 'var(--c-blued)' : 'transparent',
                  color: ativo ? '#fff' : 'var(--c-ink2)',
                  fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                {rot}
              </button>
            );
          })}
        </div>

        {!mostrarCampos && (
          <div style={{ marginTop: 10, color: 'var(--c-ink3)', fontSize: 12.5 }}>
            {inicio || fim ? `${dataBR(inicio || null)} a ${dataBR(fim || null)}` : 'Todo o período'} · toque em Filtros para refinar
          </div>
        )}

        {mostrarCampos && (
        <div style={{ display: 'grid', gridTemplateColumns: estreito ? '1fr' : 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
          <div>
            <label className="ia-label">De</label>
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} style={inp} />
          </div>
          <div>
            <label className="ia-label">Até</label>
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} style={inp} />
          </div>
          <div>
            <label className="ia-label">Data considerada</label>
            <select value={base} onChange={(e) => setBase(e.target.value as Base)} style={inp}>
              <option value="atendimento">Data do atendimento</option>
              <option value="importacao">Data da importação</option>
              <option value="registro">Data do cadastro no CMD</option>
            </select>
          </div>
          <div>
            <label className="ia-label">Modalidade</label>
            <select value={modalidade} onChange={(e) => setModalidade(e.target.value as Modalidade)} style={inp}>
              <option value="todas">OCI e Cirurgia</option>
              <option value="oci">Somente OCI</option>
              <option value="catarata">Somente Cirurgia</option>
            </select>
          </div>
          <div>
            <label className="ia-label">Faixa etária</label>
            <select value={faixa} onChange={(e) => setFaixa(e.target.value as Faixa)} style={inp}>
              <option value="todas">Todas as idades</option>
              <option value="0_8">0 a 8 anos</option>
              <option value="9_mais">9 anos ou mais</option>
              <option value="sem_idade">Sem idade informada</option>
            </select>
          </div>
          <div>
            <label className="ia-label">Profissional</label>
            <select value={medico} onChange={(e) => setMedico(e.target.value)} style={inp}>
              <option value="">Todos</option>
              {medicos.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="ia-label">Situação</label>
            <select value={situacao} onChange={(e) => setSituacao(e.target.value as Situacao)} style={inp}>
              <option value="todas">Todas</option>
              <option value="registrada">Cadastradas no CMD</option>
              <option value="pendente">Aguardando cadastro</option>
              <option value="revisao">Em pendência</option>
              <option value="erro">Com erro</option>
            </select>
          </div>
          {!isMember && contas.length > 0 && (
            <div>
              <label className="ia-label">Terminal</label>
              <select value={conta} onChange={(e) => setConta(e.target.value)} style={inp}>
                <option value="">Todos</option>
                {contas.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          )}
          {!isMember && empresas.length > 1 && (
            <div>
              <label className="ia-label">Empresa</label>
              <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} style={inp}>
                <option value="">Todas</option>
                {empresas.map((e2) => <option key={e2.id} value={e2.id}>{e2.nome}</option>)}
              </select>
            </div>
          )}
        </div>
        )}

        {mostrarCampos && estreito && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={limpar} className="ia-btn-outline" style={{ flex: 1, height: 40, fontSize: 13 }}>
              <RotateCcw size={14} /> Limpar
            </button>
            <button onClick={() => setFiltrosAbertos(false)} className="ia-btn" style={{ flex: 1, height: 40, fontSize: 13 }}>
              Ver resultado
            </button>
          </div>
        )}
      </Card>

      {erro && (
        <Card style={{ padding: 22, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 9, background: 'var(--c-errsoft)', color: 'var(--c-errfg)', display: 'grid', placeItems: 'center' }}>
            <AlertTriangle size={17} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--c-ink)', fontSize: 14.5, fontWeight: 700, marginBottom: 3 }}>Relatório indisponível</div>
            <div style={{ color: 'var(--c-ink2)', fontSize: 13, lineHeight: 1.5 }}>{erro}</div>
            <button onClick={() => void carregar()} className="ia-btn-outline" style={{ marginTop: 12, padding: '0 14px', height: 32, fontSize: 12.5 }}>
              Tentar de novo
            </button>
          </div>
        </Card>
      )}

      {carregando && !dados && (
        <Card style={{ padding: 30, textAlign: 'center', color: 'var(--c-ink3)', fontSize: 14 }}>Montando o relatório…</Card>
      )}

      {dados && r && ec && (
        <>
          {/* ---- NÚMEROS DO RECORTE ---- */}
          <div style={{ display: 'grid', gridTemplateColumns: estreito ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(148px, 1fr))', gap: estreito ? 10 : 12 }}>
            <Tile rotulo="Fichas no período" valor={fmtMilhar(r.total)} nota={`${fmtMilhar(r.listas)} lista(s) · ${fmtMilhar(r.medicos)} profissional(is)`} largo={estreito} />
            <Tile rotulo="OCI" valor={fmtMilhar(r.oci)} nota={pct(r.oci, r.total)} cor={COR_OCI} />
            <Tile rotulo="Cirurgia" valor={fmtMilhar(r.cirurgia)} nota={pct(r.cirurgia, r.total)} cor={COR_CIR} />
            <Tile rotulo="0 a 8 anos" valor={fmtMilhar(r.faixa_0_8)} nota={pct(r.faixa_0_8, r.total)} />
            <Tile rotulo="9 anos ou mais" valor={fmtMilhar(r.faixa_9_mais)} nota={pct(r.faixa_9_mais, r.total)} />
            <Tile rotulo="Economia no período" valor={brl(ec.valor)} nota={`${fmtMilhar(Math.round(ec.horas))} h poupadas`} largo={estreito} />
          </div>

          {/* ---- COMPOSIÇÃO ---- */}
          <Card style={{ padding: 18 }}>
            <Titulo icone={<Layers size={16} />} texto="Composição do período" />
            <Legenda />
            <BarraEmpilhada oci={r.oci} cirurgia={r.cirurgia} />
            <div style={{ display: 'grid', gridTemplateColumns: estreito ? '1fr' : 'repeat(auto-fit, minmax(140px, 1fr))', gap: estreito ? 10 : 12, marginTop: 16 }}>
              <Linha rotulo="Cadastradas no CMD" valor={r.registradas} total={r.total} />
              <Linha rotulo="Aguardando cadastro" valor={r.pendentes} total={r.total} />
              <Linha rotulo="Em pendência" valor={r.revisao} total={r.total} />
              <Linha rotulo="Com erro" valor={r.erros} total={r.total} />
            </div>
            {r.sem_idade > 0 && (
              <p style={{ margin: '14px 0 0', color: 'var(--c-ink3)', fontSize: 12 }}>
                {fmtMilhar(r.sem_idade)} ficha(s) sem idade informada — não entram em nenhuma das duas faixas etárias.
                A idade vem do CADSUS durante a automação, então fichas antigas não a têm.
              </p>
            )}
            {r.total > 0 && (
              <p style={{ margin: '6px 0 0', color: 'var(--c-ink3)', fontSize: 12 }}>
                Período com dados: {dataBR(r.primeira)} a {dataBR(r.ultima)}.
              </p>
            )}
          </Card>

          {/* ---- SÉRIE MENSAL ---- */}
          {dados.por_mes.length > 0 && (
            <Card style={{ padding: 18 }}>
              <Titulo icone={<CalendarRange size={16} />} texto="Fichas por mês" />
              <Legenda />
              <SerieMensal dados={dados.por_mes} />
            </Card>
          )}

          {/* ---- POR PROFISSIONAL ---- */}
          <Card style={{ padding: 18 }}>
            <Titulo icone={<Stethoscope size={16} />} texto="Por profissional" />
            {dados.por_medico.length === 0 ? (
              <Vazio />
            ) : (
              <>
                <Legenda />
                <PorMedico dados={dados.por_medico} />
                {estreito ? <ListaMedicos dados={dados.por_medico} /> : <TabelaMedicos dados={dados.por_medico} />}
              </>
            )}
          </Card>

          {/* ---- POR LISTA IMPORTADA ---- */}
          <Card style={{ padding: 18 }}>
            <Titulo icone={<Clock3 size={16} />} texto="Por lista importada" />
            {dados.por_lista.length === 0 ? <Vazio /> : estreito ? <ListaListas dados={dados.por_lista} /> : <TabelaListas dados={dados.por_lista} />}
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------ peças ------------------------------------ */

const pct = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}% do total` : '—');

function Titulo({ icone, texto }: { icone: ReactNode; texto: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--c-ink)', fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
      <span style={{ color: 'var(--c-ink3)', display: 'grid', placeItems: 'center' }}>{icone}</span>{texto}
    </div>
  );
}

function Vazio() {
  return <div style={{ padding: '20px 0', color: 'var(--c-ink3)', fontSize: 13.5 }}>Nenhuma ficha neste recorte.</div>;
}

/** Legenda sempre presente: são duas séries, então identidade nunca pode
 * depender só da cor. */
function Legenda() {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
      {([['OCI', COR_OCI], ['Cirurgia', COR_CIR]] as const).map(([rot, cor]) => (
        <span key={rot} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--c-ink2)', fontSize: 12, fontWeight: 600 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: cor, flex: 'none' }} />{rot}
        </span>
      ))}
    </div>
  );
}

function Tile({ rotulo, valor, nota, cor, largo }: { rotulo: string; valor: string; nota: string; cor?: string; largo?: boolean }) {
  return (
    // minWidth 0 no cartão e no rótulo: sem isso o item do grid adota a largura
    // do conteúdo e o valor ("R$ 8.415,91") empurra a coluna para fora da tela
    // no celular, em vez de reduzir junto com ela.
    <Card style={{ padding: 14, minWidth: 0, gridColumn: largo ? '1 / -1' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, color: 'var(--c-ink3)', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {cor && <span style={{ width: 8, height: 8, borderRadius: 2, background: cor, flex: 'none' }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rotulo}</span>
      </div>
      {/* clamp: encolhe a fonte em tela estreita sem precisar de media query */}
      <div style={{ color: 'var(--c-ink)', fontSize: 'clamp(19px, 5.2vw, 26px)', fontWeight: 800, marginTop: 6, lineHeight: 1.15, overflowWrap: 'anywhere' }}>{valor}</div>
      <div style={{ color: 'var(--c-ink3)', fontSize: 12, marginTop: 3, overflowWrap: 'anywhere' }}>{nota}</div>
    </Card>
  );
}

/** Uma barra empilhada com folga de 2px entre os trechos, para os blocos não
 * se colarem, e rótulo direto em cada um. */
function BarraEmpilhada({ oci, cirurgia }: { oci: number; cirurgia: number }) {
  const total = oci + cirurgia;
  if (total === 0) return <Vazio />;
  const pOci = (oci / total) * 100;
  return (
    <>
      <div style={{ display: 'flex', gap: 2, height: 30, borderRadius: 6, overflow: 'hidden' }}>
        <div title={`OCI: ${fmtMilhar(oci)} ficha(s)`} style={{ width: `${pOci}%`, background: COR_OCI, borderRadius: '6px 0 0 6px' }} />
        <div title={`Cirurgia: ${fmtMilhar(cirurgia)} ficha(s)`} style={{ width: `${100 - pOci}%`, background: COR_CIR, borderRadius: '0 6px 6px 0' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, color: 'var(--c-ink2)', fontSize: 12.5, fontWeight: 600 }}>
        <span>OCI · {fmtMilhar(oci)} ({Math.round(pOci)}%)</span>
        <span>Cirurgia · {fmtMilhar(cirurgia)} ({Math.round(100 - pOci)}%)</span>
      </div>
    </>
  );
}

function Linha({ rotulo, valor, total }: { rotulo: string; valor: number; total: number }) {
  const p = total > 0 ? (valor / total) * 100 : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--c-ink2)', fontSize: 12.5, marginBottom: 4 }}>
        <span>{rotulo}</span><b style={{ color: 'var(--c-ink)' }}>{fmtMilhar(valor)}</b>
      </div>
      <div style={{ height: 6, background: 'var(--c-surface2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: 'var(--c-ink3)', borderRadius: 4 }} />
      </div>
    </div>
  );
}

/** Colunas por mês. Escala única para todos os meses — comparar alturas entre
 * meses é justamente o ponto do gráfico. */
function SerieMensal({ dados }: { dados: Relatorio['por_mes'] }) {
  const max = Math.max(...dados.map((d) => d.total), 1);
  return (
    /* Sem a classe r-scroll-x de propósito: ela impõe 640px de largura mínima,
       o que faria o gráfico rolar de lado mesmo quando os meses cabem na tela.
       Aqui a largura mínima vem da quantidade de meses, então só rola quando
       realmente não cabe. */
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', minHeight: 160, paddingTop: 6, minWidth: Math.min(dados.length * 54, 640) }}>
        {dados.map((d) => {
          const h = Math.max(4, (d.total / max) * 120);
          const hOci = d.total > 0 ? (d.oci / d.total) * h : 0;
          return (
            <div key={d.mes} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 44, flex: '1 0 44px' }}>
              <span style={{ color: 'var(--c-ink)', fontSize: 11.5, fontWeight: 700 }}>{fmtMilhar(d.total)}</span>
              <div
                title={`${rotuloMes(d.mes)} — total ${fmtMilhar(d.total)} · OCI ${fmtMilhar(d.oci)} · Cirurgia ${fmtMilhar(d.cirurgia)}`}
                style={{ width: '100%', maxWidth: 40, height: h, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2 }}
              >
                {d.cirurgia > 0 && <div style={{ height: Math.max(2, h - hOci), background: COR_CIR, borderRadius: '4px 4px 0 0' }} />}
                {d.oci > 0 && <div style={{ height: Math.max(2, hOci), background: COR_OCI, borderRadius: d.cirurgia > 0 ? 0 : '4px 4px 0 0' }} />}
              </div>
              <span style={{ color: 'var(--c-ink3)', fontSize: 11 }}>{rotuloMes(d.mes)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Barras horizontais por profissional — comparação de magnitude entre nomes,
 * que é exatamente onde a barra horizontal ganha da coluna (nome longo cabe). */
function PorMedico({ dados }: { dados: Relatorio['por_medico'] }) {
  const max = Math.max(...dados.map((d) => d.total), 1);
  return (
    <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
      {dados.slice(0, 12).map((m) => {
        const largura = (m.total / max) * 100;
        const pOci = m.total > 0 ? (m.oci / m.total) * 100 : 0;
        return (
          <div key={m.medico}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
              <span style={{ color: 'var(--c-ink2)', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.medico}</span>
              <span style={{ color: 'var(--c-ink)', fontSize: 12.5, fontWeight: 700, flex: 'none' }}>{fmtMilhar(m.total)}</span>
            </div>
            <div style={{ height: 14, background: 'var(--c-surface2)', borderRadius: 4 }}>
              <div
                title={`${m.medico} — OCI ${fmtMilhar(m.oci)} · Cirurgia ${fmtMilhar(m.cirurgia)} · 0-8 ${fmtMilhar(m.faixa_0_8)} · 9+ ${fmtMilhar(m.faixa_9_mais)}`}
                style={{ width: `${largura}%`, height: '100%', display: 'flex', gap: 2, borderRadius: 4, overflow: 'hidden' }}
              >
                {m.oci > 0 && <div style={{ width: `${pOci}%`, background: COR_OCI }} />}
                {m.cirurgia > 0 && <div style={{ width: `${100 - pOci}%`, background: COR_CIR }} />}
              </div>
            </div>
          </div>
        );
      })}
      {dados.length > 12 && (
        <p style={{ margin: 0, color: 'var(--c-ink3)', fontSize: 12 }}>
          Mostrando os 12 maiores. Os {dados.length - 12} restantes estão na tabela abaixo.
        </p>
      )}
    </div>
  );
}

const th: CSSProperties = { textAlign: 'right', padding: '8px 10px', color: 'var(--c-ink3)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' };
const td: CSSProperties = { textAlign: 'right', padding: '9px 10px', color: 'var(--c-ink)', fontSize: 13, whiteSpace: 'nowrap' };

/** Par rótulo/valor das listas de celular. */
function Dado({ rot, v }: { rot: string; v: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline', fontSize: 12.5 }}>
      <span style={{ color: 'var(--c-ink3)' }}>{rot}</span>
      <b style={{ color: 'var(--c-ink)' }}>{fmtMilhar(v)}</b>
    </span>
  );
}

/**
 * No celular a tabela vira lista: sete colunas não cabem em 360px, e rolar a
 * tabela de lado esconde justamente as colunas da direita — que aqui são as
 * faixas etárias, o motivo de o relatório existir.
 */
function ListaMedicos({ dados }: { dados: Relatorio['por_medico'] }) {
  return (
    <div style={{ borderTop: '1px solid var(--c-border)' }}>
      {dados.map((m) => (
        <div key={m.medico} style={{ padding: '12px 0', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.medico}</span>
            <b style={{ color: 'var(--c-ink)', fontSize: 15, flex: 'none' }}>{fmtMilhar(m.total)}</b>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 6 }}>
            <Dado rot="OCI" v={m.oci} />
            <Dado rot="Cirurgia" v={m.cirurgia} />
            <Dado rot="0 a 8" v={m.faixa_0_8} />
            <Dado rot="9+" v={m.faixa_9_mais} />
            <Dado rot="Cadastradas" v={m.registradas} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListaListas({ dados }: { dados: Relatorio['por_lista'] }) {
  return (
    <div style={{ borderTop: '1px solid var(--c-border)' }}>
      {dados.map((l) => (
        <div key={l.upload_id} style={{ padding: '12px 0', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <span style={{ color: 'var(--c-ink)', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.lista}</span>
            <b style={{ color: 'var(--c-ink)', fontSize: 15, flex: 'none' }}>{fmtMilhar(l.total)}</b>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 6 }}>
            <Dado rot="Cirurgia" v={l.cirurgia} />
            <Dado rot="Cadastradas" v={l.registradas} />
            <span style={{ color: 'var(--c-ink3)', fontSize: 12.5 }}>
              {l.enviado_em ? new Date(l.enviado_em).toLocaleDateString('pt-BR') : '—'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Os mesmos números da barra, em texto. É o que garante que o relatório seja
 * legível sem depender de enxergar cor. */
function TabelaMedicos({ dados }: { dados: Relatorio['por_medico'] }) {
  return (
    <div className="r-scroll-x" style={{ overflowX: 'auto', borderTop: '1px solid var(--c-border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Profissional</th>
            <th style={th}>Total</th><th style={th}>OCI</th><th style={th}>Cirurgia</th>
            <th style={th}>0 a 8</th><th style={th}>9+</th><th style={th}>Cadastradas</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((m) => (
            <tr key={m.medico} style={{ borderTop: '1px solid var(--c-border)' }}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{m.medico}</td>
              <td style={{ ...td, fontWeight: 700 }}>{fmtMilhar(m.total)}</td>
              <td style={td}>{fmtMilhar(m.oci)}</td>
              <td style={td}>{fmtMilhar(m.cirurgia)}</td>
              <td style={td}>{fmtMilhar(m.faixa_0_8)}</td>
              <td style={td}>{fmtMilhar(m.faixa_9_mais)}</td>
              <td style={td}>{fmtMilhar(m.registradas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaListas({ dados }: { dados: Relatorio['por_lista'] }) {
  return (
    <div className="r-scroll-x" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Lista</th>
            <th style={{ ...th, textAlign: 'left' }}>Enviada em</th>
            <th style={th}>Fichas</th><th style={th}>Cirurgia</th><th style={th}>Cadastradas</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((l) => (
            <tr key={l.upload_id} style={{ borderTop: '1px solid var(--c-border)' }}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.lista}</td>
              <td style={{ ...td, textAlign: 'left', color: 'var(--c-ink2)' }}>
                {l.enviado_em ? new Date(l.enviado_em).toLocaleDateString('pt-BR') : '—'}
              </td>
              <td style={{ ...td, fontWeight: 700 }}>{fmtMilhar(l.total)}</td>
              <td style={td}>{fmtMilhar(l.cirurgia)}</td>
              <td style={td}>{fmtMilhar(l.registradas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
