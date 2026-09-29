import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../lib/db';
import { supabaseAdmin } from '../lib/supabase';
import ExcelJS from 'exceljs';
import { PROC_CATARATA, PROC_OCI_0_8, PROC_OCI_9_MAIS, qtdProcedimentos } from '../lib/procedimentos';

/**
 * RELATÓRIO ANALÍTICO DAS FICHAS IMPORTADAS.
 *
 * Uma única rota devolve o relatório inteiro (resumo, recortes e séries) em
 * uma consulta só. O motivo é o mesmo do /fichas/analitico: agregar no banco.
 * Buscar as linhas e contar no frontend daria número errado — são milhares de
 * fichas e a listagem é paginada.
 */

/** Fichas que chegaram ao CMD. Mesmo conjunto usado no /fichas/analitico, para
 * os números das duas telas não se contradizerem. */
const STATUS_OK = "('registered','verified_ok','verified_divergent','done_manually')";

/** Coluna que comanda o filtro de período. Whitelist fechada: o valor vem do
 * querystring e entra direto no SQL, então NUNCA pode ser texto livre. */
const BASE_DATA: Record<string, string> = {
  atendimento: 'pr.data_atendimento',
  importacao: '(u.uploaded_at AT TIME ZONE \'America/Sao_Paulo\')::date',
  registro: '(pr.registered_at AT TIME ZONE \'America/Sao_Paulo\')::date',
};

export type BaseData = keyof typeof BASE_DATA;

/**
 * Terminais que o solicitante pode ver — mesma regra do módulo de economia:
 * membro vê os designados a ele + os livres da empresa dele; dono vê tudo,
 * ou só um terminal se filtrar.
 */
async function resolverCaIds(req: FastifyRequest, tid: number, clinicAccountId?: string): Promise<number[] | null> {
  if (req.member) {
    const empFiltro = req.member.empresa_id == null ? 'empresa_id.is.null' : `empresa_id.eq.${req.member.empresa_id}`;
    const { data: cas } = await supabaseAdmin
      .from('clinic_accounts')
      .select('id')
      .eq('tenant_id', tid)
      .or(`member_user_id.eq.${req.member.user_id},and(member_user_id.is.null,${empFiltro})`);
    return (cas ?? []).map((c) => Number(c.id));
  }
  if (clinicAccountId) {
    const id = Number(clinicAccountId);
    if (Number.isFinite(id)) {
      const { data: ca } = await supabaseAdmin.from('clinic_accounts').select('id').eq('id', id).eq('tenant_id', tid).maybeSingle();
      if (ca) return [id];
    }
  }
  return null;
}

const num = (v: unknown) => Number(v ?? 0);

/** 'YYYY-MM-DD' ou nada. Data inválida vira null em vez de quebrar a consulta. */
function dataOuNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}


/** Situação da ficha em português — usada no CSV e na listagem. */
export function rotuloSituacao(status: string): string {
  if (['registered', 'verified_ok', 'verified_divergent', 'done_manually'].includes(status)) return 'Cadastrada';
  if (status === 'pending_registration') return 'Aguardando cadastro';
  if (status === 'needs_review') return 'Em pendência';
  if (status === 'error') return 'Com erro';
  return status;
}

export interface Recorte {
  base: string; colData: string;
  inicio: string | null; fim: string | null;
  filtros: string; params: unknown[];
}

/**
 * Monta o WHERE do recorte a partir do querystring.
 *
 * Fica fora das rotas porque relatório, listagem e CSV precisam do MESMO
 * filtro — se cada uma montasse o seu, o CSV cedo ou tarde exportaria um
 * conjunto diferente do que a tela mostra, que é o pior tipo de divergência
 * num relatório.
 *
 * Devolve null quando o recorte não alcança terminal nenhum (quem chama
 * responde o vazio no formato da sua própria rota).
 */
async function montarRecorte(req: FastifyRequest): Promise<Recorte | null> {
  const tid = req.tenant!.id;
  const q = req.query as Record<string, string | undefined>;

    const base: string = BASE_DATA[q.base ?? 'atendimento'] ? (q.base ?? 'atendimento') : 'atendimento';
    const colData = BASE_DATA[base]!;
    const inicio = dataOuNull(q.inicio);
    const fim = dataOuNull(q.fim);

    // $1 tenant, $2 inicio, $3 fim — sempre nessa ordem.
    const params: unknown[] = [tid, inicio, fim];
    let filtros = '';

    if (q.modalidade === 'oci') filtros += ` AND pr.modalidade IS DISTINCT FROM 'catarata'`;
    else if (q.modalidade === 'catarata') filtros += ` AND pr.modalidade = 'catarata'`;

    if (q.faixa === '0_8') filtros += ' AND pr.idade_no_atendimento <= 8';
    else if (q.faixa === '9_mais') filtros += ' AND pr.idade_no_atendimento >= 9';
    else if (q.faixa === 'sem_idade') filtros += ' AND pr.idade_no_atendimento IS NULL';

    if (q.situacao === 'registrada') filtros += ` AND pr.status IN ${STATUS_OK}`;
    else if (q.situacao === 'pendente') filtros += ` AND pr.status = 'pending_registration'`;
    else if (q.situacao === 'revisao') filtros += ` AND pr.status = 'needs_review'`;
    else if (q.situacao === 'erro') filtros += ` AND pr.status = 'error'`;

    if (q.medico) {
      filtros += ` AND pr.medico_nome = $${params.length + 1}`;
      params.push(q.medico);
    }

    // Cidade fica no UPLOAD (a lista é de um mutirão/município). 'sem' isola as
    // listas antigas, importadas antes de o campo existir.
    if (q.cidade === 'sem') {
      filtros += ' AND u.cidade IS NULL';
    } else if (q.cidade) {
      filtros += ` AND u.cidade = $${params.length + 1}`;
      params.push(q.cidade);
    }

    if (q.upload_id) {
      const uid = Number(q.upload_id);
      if (Number.isFinite(uid)) {
        filtros += ` AND u.id = $${params.length + 1}`;
        params.push(uid);
      }
    }

    // Escopo: membro só enxerga o que é dele; dono pode recortar por empresa
    // ou por terminal. Mesma semântica das outras telas.
    const activeMemberId = req.member ? req.member.user_id : (q.member_user_id || null);
    const activeEmpresaId = req.member ? req.member.empresa_id : (q.empresa_id ? Number(q.empresa_id) : null);

    if (activeEmpresaId) {
      filtros += ` AND (ca.empresa_id = $${params.length + 1} OR u.empresa_id = $${params.length + 1})`;
      params.push(activeEmpresaId);
    }
    if (activeMemberId) {
      filtros += ` AND (ca.member_user_id = $${params.length + 1}::uuid OR u.uploaded_by = $${params.length + 1}::uuid)`;
      params.push(activeMemberId);
    } else if (!req.member && q.clinic_account_id) {
      const caIds = await resolverCaIds(req, tid, q.clinic_account_id);
      if (caIds) {
        if (caIds.length === 0) return null;
        filtros += ` AND pr.clinic_account_id = ANY($${params.length + 1}::bigint[])`;
        params.push(caIds);
      }
    }


  return { base, colData, inicio, fim, filtros, params };
}

export interface FichaListada {
  id: number;
  nome: string;
  cns: string;
  data_nascimento: string | null;
  data_atendimento: string | null;
  idade: number | null;
  modalidade: string;
  cid10_codigo: string;
  medico_nome: string;
  status: string;
  situacao: string;
  error_message: string | null;
  registered_at: string | null;
  lista: string;
  cidade: string | null;
  upload_id: number;
}

/**
 * Busca as fichas do recorte.
 *
 * `tudo` = true traz o conjunto inteiro (usado pelo CSV: exportar só a página
 * visível seria uma armadilha — o arquivo pareceria completo e não estaria).
 * O padrão é paginado, para a listagem da tela não carregar milhares de linhas.
 */
async function consultarFichas(
  req: FastifyRequest,
  reply: FastifyReply,
  tudo = false,
): Promise<{ fichas: FichaListada[]; total: number; pagina: number; por_pagina: number } | null> {
  const recorte = await montarRecorte(req);
  if (!recorte) {
    if (tudo) { await reply.code(200).send('﻿'); return null; }
    await reply.code(200).send({ fichas: [], total: 0, pagina: 1, por_pagina: 0 });
    return null;
  }
  const { colData, filtros, params } = recorte;
  const q = req.query as Record<string, string | undefined>;

  const porPagina = Math.min(Math.max(Number(q.por_pagina) || 50, 1), 200);
  const pagina = Math.max(Number(q.pagina) || 1, 1);

  const DE = `
    FROM patient_records pr
    JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
    LEFT JOIN clinic_accounts uca ON uca.id = u.clinic_account_id
    LEFT JOIN empresas ue ON ue.id = u.empresa_id
    LEFT JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
    WHERE COALESCE(uca.tenant_id, ue.tenant_id) = $1
      AND ($2::date IS NULL OR ${colData} >= $2::date)
      AND ($3::date IS NULL OR ${colData} <= $3::date)
      ${filtros}`;

  const { rows: cont } = await getPool().query(`SELECT count(*)::int AS n ${DE}`, params);
  const total = num(cont[0]?.n);

  // Teto de segurança no CSV: acima disso o arquivo deixa de ser útil e a
  // consulta passa a pesar no banco de produção.
  const limite = tudo ? Math.min(total, 50_000) : porPagina;
  const salto = tudo ? 0 : (pagina - 1) * porPagina;

  const { rows } = await getPool().query(
    `SELECT pr.id, pr.nome, pr.cns, pr.data_nascimento::text AS data_nascimento,
            pr.data_atendimento::text AS data_atendimento, pr.idade_no_atendimento AS idade,
            pr.modalidade, pr.cid10_codigo, pr.medico_nome, pr.status::text AS status,
            NULLIF(pr.error_message, '') AS error_message,
            to_char(pr.registered_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS registered_at,
            COALESCE(NULLIF(btrim(u.name), ''), u.original_filename) AS lista,
            u.cidade, u.id AS upload_id
     ${DE}
     ORDER BY ${colData} DESC NULLS LAST, pr.id DESC
     LIMIT ${limite} OFFSET ${salto}`,
    params,
  );

  const fichas: FichaListada[] = rows.map((f) => ({
    id: num(f.id),
    nome: String(f.nome ?? ''),
    cns: String(f.cns ?? ''),
    data_nascimento: f.data_nascimento ?? null,
    data_atendimento: f.data_atendimento ?? null,
    idade: f.idade == null ? null : num(f.idade),
    modalidade: String(f.modalidade ?? 'oci'),
    cid10_codigo: String(f.cid10_codigo ?? ''),
    medico_nome: String(f.medico_nome ?? ''),
    status: String(f.status),
    situacao: rotuloSituacao(String(f.status)),
    error_message: f.error_message ?? null,
    registered_at: f.registered_at ?? null,
    lista: String(f.lista ?? ''),
    cidade: f.cidade ?? null,
    upload_id: num(f.upload_id),
  }));

  return { fichas, total, pagina, por_pagina: porPagina };
}

export async function relatoriosRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Relatório das fichas importadas.
   *
   * Filtros: período (com a data-base escolhida), modalidade (OCI x cirurgia),
   * faixa etária (0-8 x 9+), médico, situação, empresa e terminal.
   */
  app.get('/relatorios/fichas', { preHandler: [app.authenticate] }, async (req, reply) => {
    const recorte = await montarRecorte(req);
    if (!recorte) return reply.code(200).send(vazio('atendimento', null, null));
    const { base, colData, inicio, fim, filtros, params } = recorte;

    /**
     * O tenant da ficha vem do upload (clinic_account OU empresa), não de
     * pr.clinic_account_id: ficha ainda não distribuída a um terminal tem esse
     * campo nulo e sumiria de um INNER JOIN, subnotificando as pendentes.
     */
    const sql = `
      WITH base AS (
        SELECT
          pr.id,
          NULLIF(btrim(pr.medico_nome), '') AS medico,
          pr.modalidade,
          pr.idade_no_atendimento AS idade,
          pr.status::text AS status,
          ${colData} AS data_ref,
          u.id AS upload_id,
          COALESCE(NULLIF(btrim(u.name), ''), u.original_filename) AS lista,
          u.cidade,
          u.uploaded_at
        FROM patient_records pr
        JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
        LEFT JOIN clinic_accounts uca ON uca.id = u.clinic_account_id
        LEFT JOIN empresas ue ON ue.id = u.empresa_id
        LEFT JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
        WHERE COALESCE(uca.tenant_id, ue.tenant_id) = $1
          AND ($2::date IS NULL OR ${colData} >= $2::date)
          AND ($3::date IS NULL OR ${colData} <= $3::date)
          ${filtros}
      ),
      -- Economia do MESMO recorte: cada ficha cadastrada pelo robô é uma
      -- execução, e cada execução vale o tempo manual do tipo de automação.
      econ AS (
        SELECT
          COALESCE(sum(ta.tempo_manual_estimado_minutos), 0) AS minutos,
          count(e.id) AS execucoes
        FROM base b
        JOIN execucoes_automacao e ON e.patient_record_id = b.id AND e.sucesso
        LEFT JOIN tipos_automacao ta ON ta.id = e.tipo_automacao_id
      ),
      custo AS (
        SELECT
          t.salario_medio_funcionario,
          t.horas_trabalhadas_mes,
          t.salario_medio_funcionario / NULLIF(t.horas_trabalhadas_mes * 60, 0) AS custo_minuto
        FROM tenants t WHERE t.id = $1
      )
      SELECT
        (SELECT row_to_json(r) FROM (
          SELECT
            count(*) AS total,
            count(*) FILTER (WHERE modalidade IS DISTINCT FROM 'catarata') AS oci,
            count(*) FILTER (WHERE modalidade = 'catarata') AS cirurgia,
            count(*) FILTER (WHERE idade <= 8) AS faixa_0_8,
            count(*) FILTER (WHERE idade >= 9) AS faixa_9_mais,
            count(*) FILTER (WHERE idade IS NULL) AS sem_idade,
            count(*) FILTER (WHERE status IN ${STATUS_OK}) AS registradas,
            count(*) FILTER (WHERE status = 'pending_registration') AS pendentes,
            count(*) FILTER (WHERE status = 'needs_review') AS revisao,
            count(*) FILTER (WHERE status = 'error') AS erros,
            count(*) FILTER (WHERE modalidade IS DISTINCT FROM 'catarata' AND idade <= 8) AS oci_0_8,
            count(*) FILTER (WHERE modalidade IS DISTINCT FROM 'catarata' AND (idade >= 9 OR idade IS NULL)) AS oci_9_mais,
            count(DISTINCT medico) AS medicos,
            count(DISTINCT upload_id) AS listas,
            count(DISTINCT cidade) AS cidades,
            min(data_ref)::text AS primeira,
            max(data_ref)::text AS ultima,
            count(*) FILTER (WHERE data_ref IS NULL) AS sem_data
          FROM base
        ) r) AS resumo,

        (SELECT COALESCE(json_agg(r), '[]'::json) FROM (
          SELECT
            COALESCE(medico, 'Sem profissional informado') AS medico,
            count(*) AS total,
            count(*) FILTER (WHERE modalidade IS DISTINCT FROM 'catarata') AS oci,
            count(*) FILTER (WHERE modalidade = 'catarata') AS cirurgia,
            count(*) FILTER (WHERE idade <= 8) AS faixa_0_8,
            count(*) FILTER (WHERE idade >= 9) AS faixa_9_mais,
            count(*) FILTER (WHERE status IN ${STATUS_OK}) AS registradas
          FROM base GROUP BY 1 ORDER BY 2 DESC
        ) r) AS por_medico,

        (SELECT COALESCE(json_agg(r), '[]'::json) FROM (
          SELECT
            to_char(data_ref, 'YYYY-MM') AS mes,
            count(*) AS total,
            count(*) FILTER (WHERE modalidade IS DISTINCT FROM 'catarata') AS oci,
            count(*) FILTER (WHERE modalidade = 'catarata') AS cirurgia,
            count(*) FILTER (WHERE idade <= 8) AS faixa_0_8,
            count(*) FILTER (WHERE idade >= 9) AS faixa_9_mais
          FROM base WHERE data_ref IS NOT NULL GROUP BY 1 ORDER BY 1
        ) r) AS por_mes,

        (SELECT COALESCE(json_agg(r), '[]'::json) FROM (
          SELECT
            COALESCE(cidade, 'Sem cidade informada') AS cidade,
            count(*) AS total,
            count(*) FILTER (WHERE modalidade IS DISTINCT FROM 'catarata') AS oci,
            count(*) FILTER (WHERE modalidade = 'catarata') AS cirurgia,
            count(*) FILTER (WHERE status IN ${STATUS_OK}) AS registradas
          FROM base GROUP BY 1 ORDER BY 2 DESC
        ) r) AS por_cidade,

        (SELECT COALESCE(json_agg(r), '[]'::json) FROM (
          SELECT
            upload_id, lista,
            min(uploaded_at)::text AS enviado_em,
            count(*) AS total,
            count(*) FILTER (WHERE status IN ${STATUS_OK}) AS registradas,
            count(*) FILTER (WHERE modalidade = 'catarata') AS cirurgia
          FROM base GROUP BY upload_id, lista ORDER BY min(uploaded_at) DESC NULLS LAST
        ) r) AS por_lista,

        (SELECT row_to_json(r) FROM (
          SELECT
            econ.execucoes,
            econ.minutos,
            ROUND(econ.minutos / 60.0, 2) AS horas,
            ROUND(COALESCE(custo.custo_minuto, 0), 4) AS custo_minuto,
            ROUND(econ.minutos * COALESCE(custo.custo_minuto, 0), 2) AS valor,
            ROUND((econ.minutos / 60.0) / NULLIF(custo.horas_trabalhadas_mes, 0), 2) AS funcionarios_equivalentes
          FROM econ, custo
        ) r) AS economia
    `;

    const { rows } = await getPool().query(sql, params);
    const r = rows[0] ?? {};
    const resumo = r.resumo ?? {};
    const ec = r.economia ?? {};

    return {
      periodo: { inicio, fim, base },
      resumo: {
        total: num(resumo.total),
        oci: num(resumo.oci),
        cirurgia: num(resumo.cirurgia),
        faixa_0_8: num(resumo.faixa_0_8),
        faixa_9_mais: num(resumo.faixa_9_mais),
        sem_idade: num(resumo.sem_idade),
        registradas: num(resumo.registradas),
        pendentes: num(resumo.pendentes),
        revisao: num(resumo.revisao),
        erros: num(resumo.erros),
        oci_0_8: num(resumo.oci_0_8),
        oci_9_mais: num(resumo.oci_9_mais),
        medicos: num(resumo.medicos),
        listas: num(resumo.listas),
        cidades: num(resumo.cidades),
        primeira: resumo.primeira ?? null,
        ultima: resumo.ultima ?? null,
        sem_data: num(resumo.sem_data),
      },
      economia: {
        execucoes: num(ec.execucoes),
        minutos: num(ec.minutos),
        horas: num(ec.horas),
        custo_minuto: num(ec.custo_minuto),
        valor: num(ec.valor),
        funcionarios_equivalentes: num(ec.funcionarios_equivalentes),
      },
      por_medico: ((r.por_medico ?? []) as Record<string, unknown>[]).map((m) => ({
        medico: String(m.medico),
        total: num(m.total),
        oci: num(m.oci),
        cirurgia: num(m.cirurgia),
        faixa_0_8: num(m.faixa_0_8),
        faixa_9_mais: num(m.faixa_9_mais),
        registradas: num(m.registradas),
      })),
      por_mes: ((r.por_mes ?? []) as Record<string, unknown>[]).map((m) => ({
        mes: String(m.mes),
        total: num(m.total),
        oci: num(m.oci),
        cirurgia: num(m.cirurgia),
        faixa_0_8: num(m.faixa_0_8),
        faixa_9_mais: num(m.faixa_9_mais),
      })),
      // ETAPAS: o sistema não grava um registro por procedimento — ele os
      // deriva da modalidade e da idade ao cadastrar. Como a regra é
      // determinística, reproduzi-la aqui chega ao mesmo total sem tabela nova.
      procedimentos: (() => {
        const oci08 = num(resumo.oci_0_8);
        const oci9 = num(resumo.oci_9_mais);
        const cat = num(resumo.cirurgia);
        const soma = new Map<string, { codigo: string; descricao: string; oci: number; cirurgia: number }>();
        const juntar = (procs: { codigo: string; descricao: string }[], qtd: number, ehCirurgia = false) => {
          for (const proc of procs) {
            const at = soma.get(proc.codigo) ?? { codigo: proc.codigo, descricao: proc.descricao, oci: 0, cirurgia: 0 };
            if (ehCirurgia) at.cirurgia += qtd; else at.oci += qtd;
            soma.set(proc.codigo, at);
          }
        };
        juntar(PROC_OCI_0_8, oci08);
        juntar(PROC_OCI_9_MAIS, oci9);
        juntar([PROC_CATARATA], cat, true);
        const linhas = [...soma.values()]
          .map((x) => ({ ...x, total: x.oci + x.cirurgia }))
          .filter((x) => x.total > 0)
          .sort((a, b) => b.total - a.total);
        return {
          linhas,
          total: linhas.reduce((acc, x) => acc + x.total, 0),
          // Quantos procedimentos cada grupo gera, para conferência na tela.
          por_grupo: [
            { grupo: 'OCI 0 a 8 anos', fichas: oci08, por_ficha: PROC_OCI_0_8.length, total: oci08 * PROC_OCI_0_8.length },
            { grupo: 'OCI 9 anos ou mais', fichas: oci9, por_ficha: PROC_OCI_9_MAIS.length, total: oci9 * PROC_OCI_9_MAIS.length },
            { grupo: 'Cirurgia (catarata)', fichas: cat, por_ficha: 1, total: cat },
          ].filter((g) => g.fichas > 0),
        };
      })(),
      por_cidade: ((r.por_cidade ?? []) as Record<string, unknown>[]).map((x) => ({
        cidade: String(x.cidade),
        total: num(x.total),
        oci: num(x.oci),
        cirurgia: num(x.cirurgia),
        registradas: num(x.registradas),
      })),
      por_lista: ((r.por_lista ?? []) as Record<string, unknown>[]).map((l) => ({
        upload_id: num(l.upload_id),
        lista: String(l.lista ?? ''),
        enviado_em: (l.enviado_em as string) ?? null,
        total: num(l.total),
        registradas: num(l.registradas),
        cirurgia: num(l.cirurgia),
      })),
    };
  });

  /**
   * LISTAGEM das fichas do recorte, paginada.
   *
   * Separada do relatório de propósito: o relatório agrega milhares de linhas
   * e cabe numa resposta; a listagem devolve as fichas em si e precisa de
   * página, senão um recorte grande derruba a tela.
   */
  app.get('/relatorios/fichas/lista', { preHandler: [app.authenticate] }, async (req, reply) => {
    const r = await consultarFichas(req, reply);
    if (!r) return; // a própria consultarFichas já respondeu
    return r;
  });

  /** As mesmas fichas do recorte, em CSV — o arquivo traz TUDO, não só a página. */
  /**
   * As mesmas fichas em XLSX (Excel).
   *
   * O CSV resolve a maioria dos casos, mas abre torto no Excel brasileiro: ele
   * espera ponto e vírgula como separador e vira uma coluna só. O .xlsx já sai
   * com tipo por coluna (data é data, idade é número), cabeçalho congelado e
   * filtro pronto — é o que a contabilidade e a auditoria realmente usam.
   *
   * Usa o exceljs que o projeto já tem para LER planilhas na importação;
   * nenhuma dependência nova entra por causa disto.
   */
  app.get('/relatorios/fichas/xlsx', { preHandler: [app.authenticate] }, async (req, reply) => {
    const r = await consultarFichas(req, reply, true);
    if (!r) return;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'IA-CMD';
    wb.created = new Date();
    const ws = wb.addWorksheet('Fichas', {
      views: [{ state: 'frozen', ySplit: 1 }], // cabeçalho fixo ao rolar
    });

    ws.columns = [
      { header: 'Nome', key: 'nome', width: 36 },
      { header: 'CNS / CPF', key: 'cns', width: 16 },
      { header: 'Nascimento', key: 'nasc', width: 13 },
      { header: 'Atendimento', key: 'atend', width: 13 },
      { header: 'Idade', key: 'idade', width: 8 },
      { header: 'Modalidade', key: 'modalidade', width: 12 },
      { header: 'CID-10', key: 'cid', width: 10 },
      { header: 'Profissional', key: 'medico', width: 32 },
      { header: 'Situação', key: 'situacao', width: 20 },
      { header: 'Procedimentos', key: 'procs', width: 14 },
      { header: 'Lista', key: 'lista', width: 30 },
      { header: 'Cidade', key: 'cidade', width: 16 },
      { header: 'Cadastrada em', key: 'registrada', width: 18 },
      { header: 'Observação', key: 'obs', width: 46 },
    ];

    const cab = ws.getRow(1);
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cab.alignment = { vertical: 'middle' };
    cab.height = 20;

    // Data como DATA de verdade (e não texto): permite ordenar e filtrar por
    // período dentro do próprio Excel, que é metade do motivo de pedir xlsx.
    const comoData = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`) : null);

    for (const f of r.fichas) {
      ws.addRow({
        nome: f.nome,
        cns: f.cns,
        nasc: comoData(f.data_nascimento),
        atend: comoData(f.data_atendimento),
        idade: f.idade,
        modalidade: f.modalidade === 'catarata' ? 'CIRURGIA' : 'OCI',
        cid: f.cid10_codigo,
        medico: f.medico_nome,
        situacao: f.situacao,
        procs: qtdProcedimentos(f.modalidade, f.idade),
        lista: f.lista,
        cidade: f.cidade ?? '',
        registrada: f.registered_at ?? '',
        obs: f.error_message ?? '',
      });
    }

    ws.getColumn('nasc').numFmt = 'dd/mm/yyyy';
    ws.getColumn('atend').numFmt = 'dd/mm/yyyy';
    ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columnCount } };

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const hoje = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="fichas-${hoje}.xlsx"`)
      .send(buf);
  });

  app.get('/relatorios/fichas/csv', { preHandler: [app.authenticate] }, async (req, reply) => {
    const r = await consultarFichas(req, reply, true);
    if (!r) return;

    const cab = ['Nome', 'CNS', 'Nascimento', 'Atendimento', 'Idade', 'Modalidade', 'CID', 'Profissional', 'Situação', 'Lista', 'Cidade', 'Cadastrada em', 'Observação'];
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const linhas = r.fichas.map((f) => [
      f.nome, f.cns, f.data_nascimento ?? '', f.data_atendimento ?? '', f.idade ?? '',
      f.modalidade === 'catarata' ? 'CIRURGIA' : 'OCI', f.cid10_codigo, f.medico_nome,
      rotuloSituacao(f.status), f.lista, f.cidade ?? '', f.registered_at ?? '', f.error_message ?? '',
    ].map(esc).join(','));

    // BOM: sem ele o Excel abre os acentos errados (é o leitor mais usado aqui).
    const csv = '﻿' + [cab.join(','), ...linhas].join('\r\n') + '\r\n';
    const hoje = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="fichas-${hoje}.csv"`)
      .send(csv);
  });

  /** Cidades que aparecem nas listas do assinante — alimenta o filtro. */
  app.get('/relatorios/cidades', { preHandler: [app.authenticate] }, async (req) => {
    const { rows } = await getPool().query(
      `SELECT DISTINCT u.cidade
         FROM uploads u
         LEFT JOIN clinic_accounts uca ON uca.id = u.clinic_account_id
         LEFT JOIN empresas ue ON ue.id = u.empresa_id
        WHERE COALESCE(uca.tenant_id, ue.tenant_id) = $1
          AND u.deleted_at IS NULL AND NULLIF(btrim(u.cidade), '') IS NOT NULL
        ORDER BY 1`,
      [req.tenant!.id],
    );
    return rows.map((r) => r.cidade as string);
  });

  /** Médicos que aparecem nas fichas do assinante — alimenta o filtro. */
  app.get('/relatorios/medicos', { preHandler: [app.authenticate] }, async (req) => {
    const tid = req.tenant!.id;
    const { rows } = await getPool().query(
      `SELECT DISTINCT NULLIF(btrim(pr.medico_nome), '') AS medico
         FROM patient_records pr
         JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
         LEFT JOIN clinic_accounts uca ON uca.id = u.clinic_account_id
         LEFT JOIN empresas ue ON ue.id = u.empresa_id
        WHERE COALESCE(uca.tenant_id, ue.tenant_id) = $1
          AND NULLIF(btrim(pr.medico_nome), '') IS NOT NULL
        ORDER BY 1`,
      [tid],
    );
    return rows.map((r) => r.medico as string);
  });
}

/** Resposta vazia com o mesmo formato — usada quando o recorte não alcança
 * nenhum terminal, para o frontend não precisar tratar dois formatos. */
function vazio(base: string, inicio: string | null, fim: string | null) {
  return {
    periodo: { inicio, fim, base },
    resumo: {
      total: 0, oci: 0, cirurgia: 0, faixa_0_8: 0, faixa_9_mais: 0, sem_idade: 0,
      registradas: 0, pendentes: 0, revisao: 0, erros: 0, oci_0_8: 0, oci_9_mais: 0,
      medicos: 0, listas: 0, cidades: 0,
      primeira: null, ultima: null, sem_data: 0,
    },
    economia: { execucoes: 0, minutos: 0, horas: 0, custo_minuto: 0, valor: 0, funcionarios_equivalentes: 0 },
    procedimentos: { linhas: [], total: 0, por_grupo: [] },
    por_medico: [], por_mes: [], por_lista: [], por_cidade: [],
  };
}
