import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getPool } from '../lib/db';
import { supabaseAdmin } from '../lib/supabase';

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

export async function relatoriosRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Relatório das fichas importadas.
   *
   * Filtros: período (com a data-base escolhida), modalidade (OCI x cirurgia),
   * faixa etária (0-8 x 9+), médico, situação, empresa e terminal.
   */
  app.get('/relatorios/fichas', { preHandler: [app.authenticate] }, async (req, reply) => {
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
        if (caIds.length === 0) return reply.code(200).send(vazio(base, inicio, fim));
        filtros += ` AND pr.clinic_account_id = ANY($${params.length + 1}::bigint[])`;
        params.push(caIds);
      }
    }

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
            count(DISTINCT medico) AS medicos,
            count(DISTINCT upload_id) AS listas,
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
        medicos: num(resumo.medicos),
        listas: num(resumo.listas),
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
      registradas: 0, pendentes: 0, revisao: 0, erros: 0, medicos: 0, listas: 0,
      primeira: null, ultima: null, sem_data: 0,
    },
    economia: { execucoes: 0, minutos: 0, horas: 0, custo_minuto: 0, valor: 0, funcionarios_equivalentes: 0 },
    por_medico: [], por_mes: [], por_lista: [],
  };
}
