import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, X } from 'lucide-react';
import { apiGet, apiDownload, type ApiError } from '../../lib/api';
import { fmtMilhar } from './parts';
import type { FichaListada } from './Relatorios';

/* ============================================================================
   LISTAGEM das fichas do recorte + detalhe em modal + exportação.

   Fica em arquivo próprio para não inchar a tela de relatório, que já carrega
   os gráficos e o quantitativo.

   A listagem é paginada porque o recorte chega a milhares de fichas. Já o CSV
   exporta o conjunto INTEIRO, não a página visível: um arquivo que parece
   completo e não está é pior do que não ter arquivo nenhum.
   ========================================================================== */

const COR_OCI = 'var(--c-blue)';
const COR_CIR = 'var(--c-cyan)';
const POR_PAGINA = 50;

const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—');

function msgErro(e: unknown): string {
  const status = (e as ApiError)?.status;
  if (status === 404) return 'Esta listagem ainda não está disponível nesta versão do servidor.';
  if (status && status >= 500) return 'O servidor não conseguiu montar a listagem agora.';
  return e instanceof Error && e.message ? e.message : 'Não foi possível carregar as fichas.';
}

export default function ListaFichas({
  query,
  estreito,
  onErro,
}: {
  query: string;
  estreito: boolean;
  onErro: (msg: string) => void;
}) {
  const [dados, setDados] = useState<{ fichas: FichaListada[]; total: number } | null>(null);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(false);
  const [aberta, setAberta] = useState<FichaListada | null>(null);
  const [baixando, setBaixando] = useState<'csv' | 'xlsx' | null>(null);

  // Mudou o filtro → volta para a primeira página, senão a tela pediria a
  // "página 7" de um resultado que agora tem duas e viria vazia.
  useEffect(() => { setPagina(1); }, [query]);

  const buscaAtual = useRef(0);
  useEffect(() => {
    const minha = ++buscaAtual.current;
    setCarregando(true);
    apiGet<{ fichas: FichaListada[]; total: number }>(
      `/relatorios/fichas/lista?${query}&pagina=${pagina}&por_pagina=${POR_PAGINA}`,
    )
      .then((r) => { if (minha === buscaAtual.current) setDados(r); })
      .catch((e) => { if (minha === buscaAtual.current) onErro(msgErro(e)); })
      .finally(() => { if (minha === buscaAtual.current) setCarregando(false); });
  }, [query, pagina, onErro]);

  const baixar = async (formato: 'csv' | 'xlsx') => {
    setBaixando(formato);
    try {
      await apiDownload(`/relatorios/fichas/${formato}?${query}`, `fichas.${formato}`);
    } catch (e) {
      onErro(msgErro(e));
    } finally {
      setBaixando(null);
    }
  };

  const total = dados?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ color: 'var(--c-ink3)', fontSize: 12.5 }}>
          {carregando ? 'carregando…' : `${fmtMilhar(total)} ficha(s) no recorte`}
        </span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Excel primeiro: é o formato que a maioria abre sem ajuste. O CSV
              fica para quem vai importar em outro sistema. */}
          <button
            onClick={() => void baixar('xlsx')}
            disabled={!!baixando || total === 0}
            className="ia-btn-outline"
            style={{ padding: '0 14px', height: 34, fontSize: 12.5, opacity: baixando || total === 0 ? 0.6 : 1 }}
          >
            <FileSpreadsheet size={14} /> {baixando === 'xlsx' ? 'Gerando…' : 'Excel'}
          </button>
          <button
            onClick={() => void baixar('csv')}
            disabled={!!baixando || total === 0}
            className="ia-btn-outline"
            style={{ padding: '0 14px', height: 34, fontSize: 12.5, opacity: baixando || total === 0 ? 0.6 : 1 }}
          >
            <Download size={14} /> {baixando === 'csv' ? 'Gerando…' : 'CSV'}
          </button>
        </span>
      </div>

      {total === 0 && !carregando ? (
        <div style={{ padding: '20px 0', color: 'var(--c-ink3)', fontSize: 13.5 }}>Nenhuma ficha neste recorte.</div>
      ) : (
        <div style={{ borderTop: '1px solid var(--c-border)' }}>
          {(dados?.fichas ?? []).map((f) => (
            <button
              key={f.id}
              onClick={() => setAberta(f)}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center',
                justifyContent: 'space-between', padding: '11px 2px', background: 'transparent',
                border: 'none', borderBottom: '1px solid var(--c-border)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', color: 'var(--c-ink)', fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nome}</span>
                <span style={{ display: 'block', color: 'var(--c-ink3)', fontSize: 12, marginTop: 1 }}>
                  {f.cns} · {dataBR(f.data_atendimento)}{estreito ? '' : ` · ${f.medico_nome}`}
                </span>
              </span>
              <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, color: '#fff', background: f.modalidade === 'catarata' ? COR_CIR : COR_OCI }}>
                  {f.modalidade === 'catarata' ? 'CIRURGIA' : 'OCI'}
                </span>
                {!estreito && <span style={{ color: 'var(--c-ink3)', fontSize: 12, width: 130, textAlign: 'right' }}>{f.situacao}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {paginas > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1}
            className="ia-btn-outline" style={{ padding: '0 12px', height: 34, fontSize: 12.5, opacity: pagina <= 1 ? 0.5 : 1 }}>
            Anterior
          </button>
          <span style={{ color: 'var(--c-ink2)', fontSize: 12.5 }}>{pagina} de {fmtMilhar(paginas)}</span>
          <button onClick={() => setPagina((p) => Math.min(paginas, p + 1))} disabled={pagina >= paginas}
            className="ia-btn-outline" style={{ padding: '0 12px', height: 34, fontSize: 12.5, opacity: pagina >= paginas ? 0.5 : 1 }}>
            Próxima
          </button>
        </div>
      )}

      {aberta && <ModalFicha f={aberta} onClose={() => setAberta(null)} />}
    </>
  );
}

const COMUNS: [string, string][] = [
  ['0211060020', 'BIOMICROSCOPIA DE FUNDO DE OLHO'],
  ['0211060127', 'MAPEAMENTO DE RETINA'],
  ['0211060259', 'TONOMETRIA'],
  ['0301010072', 'CONSULTA MÉDICA EM ATENÇÃO ESPECIALIZADA'],
];

/** Mesma regra do robô: modalidade + idade definem o pacote de procedimentos. */
function procedimentosDa(f: FichaListada): [string, string][] {
  if (f.modalidade === 'catarata') return [['0405050372', 'FACOEMULSIFICAÇÃO (cirurgia de catarata)']];
  if (f.idade !== null && f.idade <= 8) {
    return [['0905010019', 'OCI AVALIAÇÃO INICIAL — 0 A 8 ANOS'], ...COMUNS];
  }
  return [['0905010035', 'OCI AVALIAÇÃO INICIAL — A PARTIR DE 9 ANOS'], ...COMUNS, ['0211060232', 'TESTE ORTÓPTICO']];
}

/** Todos os dados da ficha, inclusive os procedimentos que ela gera. */
function ModalFicha({ f, onClose }: { f: FichaListada; onClose: () => void }) {
  const procs = procedimentosDa(f);
  const linhas: [string, string][] = [
    ['CNS / CPF', f.cns || '—'],
    ['Nascimento', dataBR(f.data_nascimento)],
    ['Idade no atendimento', f.idade == null ? 'não informada' : `${f.idade} anos`],
    ['Data do atendimento', dataBR(f.data_atendimento)],
    ['Modalidade', f.modalidade === 'catarata' ? 'Cirurgia (catarata)' : 'OCI'],
    ['CID-10', f.cid10_codigo || '—'],
    ['Profissional', f.medico_nome || '—'],
    ['Situação', f.situacao],
    ['Cadastrada no CMD em', f.registered_at ?? '—'],
    ['Lista', f.lista],
    ['Cidade', f.cidade ?? 'não informada'],
  ];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 90, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--c-surface)', borderRadius: 14, width: 'min(560px, 100%)', maxHeight: '86vh', overflowY: 'auto', boxShadow: 'var(--c-shadow)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '18px 20px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--c-ink)', fontSize: 16, fontWeight: 700, overflowWrap: 'anywhere' }}>{f.nome}</div>
            <div style={{ color: 'var(--c-ink3)', fontSize: 12.5, marginTop: 2 }}>Ficha #{f.id} · lista #{f.upload_id}</div>
          </div>
          <button onClick={onClose} title="Fechar"
            style={{ flex: 'none', width: 32, height: 32, borderRadius: 8, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-ink2)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '14px 20px 20px' }}>
          {linhas.map(([rot, val]) => (
            <div key={rot} style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--c-border)' }}>
              <span style={{ color: 'var(--c-ink3)', fontSize: 12.5, width: 158, flex: 'none' }}>{rot}</span>
              <span style={{ color: 'var(--c-ink)', fontSize: 13, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{val}</span>
            </div>
          ))}

          {f.error_message && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 9, background: 'var(--c-errsoft)', color: 'var(--c-errfg)', fontSize: 12.5, lineHeight: 1.45 }}>
              {f.error_message}
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <div style={{ color: 'var(--c-ink3)', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              Procedimentos desta ficha ({procs.length})
            </div>
            {procs.map(([cod, desc]) => (
              <div key={cod} style={{ display: 'flex', gap: 10, padding: '6px 0', alignItems: 'baseline' }}>
                <b className="ia-mono" style={{ color: 'var(--c-ink2)', fontSize: 12, flex: 'none' }}>{cod}</b>
                <span style={{ color: 'var(--c-ink2)', fontSize: 12.5 }}>{desc}</span>
              </div>
            ))}
            <p style={{ margin: '8px 0 0', color: 'var(--c-ink3)', fontSize: 11.5, lineHeight: 1.45 }}>
              Definidos pela modalidade e pela idade — é o pacote que o robô lança no CMD.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
