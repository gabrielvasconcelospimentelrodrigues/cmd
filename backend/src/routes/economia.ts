import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getPool } from '../lib/db';
import { supabaseAdmin } from '../lib/supabase';

/**
 * Resolve o conjunto de terminais (clinic_account ids) a considerar:
 *  - MEMBRO: seus terminais (designados a ele + livres da empresa dele);
 *  - DONO com ?clinic_account_id=: só aquele terminal (filtro do dashboard);
 *  - DONO sem filtro: null → agrega TODOS os terminais do tenant.
 */
async function resolverCaIds(req: FastifyRequest, tid: number, clinicAccountId?: string): Promise<number[] | null> {
  if (req.member) {
    // Membro: terminais DESIGNADOS a ele + os LIVRES da empresa dele (mesmo
    // escopo da lista /clinic-accounts), para as estatísticas baterem.
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

/** Converte os numerics (string do driver) num objeto de números. */
function normalizar(r: Record<string, unknown> | undefined) {
  return {
    custo_total_mensal: Number(r?.custo_total_mensal ?? 0),
    volume_execucoes: Number(r?.volume_execucoes ?? 0),
    minutos_economizados: Number(r?.minutos_economizados ?? 0),
    horas_economizadas: Number(r?.horas_economizadas ?? 0),
    custo_minuto: Number(r?.custo_minuto ?? 0),
    valor_economizado: Number(r?.valor_economizado ?? 0),
    funcionarios_equivalentes: Number(r?.funcionarios_equivalentes ?? 0),
  };
}

/**
 * Módulo de ECONOMIA — tempo, dinheiro e funcionários poupados pelas
 * automações. Usa a função nativa do Postgres economia_cliente() (período
 * opcional) e a view vw_economia_cliente (visão geral do super admin).
 */
export async function economiaRoutes(app: FastifyInstance): Promise<void> {
  // Economia do assinante logado. ?inicio=ISO&fim=ISO (período opcional).
  app.get('/economia', { preHandler: [app.authenticate] }, async (req) => {
    const { inicio, fim, clinic_account_id, member_user_id, empresa_id } = req.query as {
      inicio?: string;
      fim?: string;
      clinic_account_id?: string;
      member_user_id?: string;
      empresa_id?: string;
    };
    const tid = req.tenant!.id;

    let sql = `
      SELECT
        t.salario_medio_funcionario,
        t.horas_trabalhadas_mes,
        count(e.id) AS volume_execucoes,
        COALESCE(sum(ta.tempo_manual_estimado_minutos), 0) AS minutos_economizados,
        ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0, 2) AS horas_economizadas,
        ROUND(t.salario_medio_funcionario / NULLIF(t.horas_trabalhadas_mes*60, 0), 4) AS custo_minuto,
        ROUND(COALESCE(sum(ta.tempo_manual_estimado_minutos),0)
              * (t.salario_medio_funcionario / NULLIF(t.horas_trabalhadas_mes*60, 0)), 2) AS valor_economizado,
        ROUND((COALESCE(sum(ta.tempo_manual_estimado_minutos),0)/60.0)
              / NULLIF(t.horas_trabalhadas_mes, 0), 2) AS funcionarios_equivalentes
      FROM tenants t
      LEFT JOIN execucoes_automacao e ON e.tenant_id = t.id AND e.sucesso
        AND ($2::timestamptz IS NULL OR e.executed_at >= $2)
        AND ($3::timestamptz IS NULL OR e.executed_at <= $3)
    `;

    const params: any[] = [tid, inicio ?? null, fim ?? null];

    const activeMemberId = req.member ? req.member.user_id : (member_user_id || null);
    const activeEmpresaId = req.member ? req.member.empresa_id : (empresa_id ? Number(empresa_id) : null);

    if (activeEmpresaId) {
      sql += ` AND (e.clinic_account_id IN (
        SELECT id FROM clinic_accounts WHERE empresa_id = $${params.length + 1}
      ) OR e.paciente_record_id IN (
        SELECT pr.id FROM patient_records pr
        JOIN uploads u ON u.id = pr.upload_id
        WHERE u.empresa_id = $${params.length + 1}
      )) `;
      params.push(activeEmpresaId);
    }

    if (activeMemberId) {
      sql += ` AND (e.clinic_account_id IN (
        SELECT id FROM clinic_accounts WHERE member_user_id = $${params.length + 1}::uuid
      ) OR e.paciente_record_id IN (
        SELECT pr.id FROM patient_records pr
        JOIN uploads u ON u.id = pr.upload_id
        WHERE u.uploaded_by = $${params.length + 1}::uuid
      )) `;
      params.push(activeMemberId);
    } else if (!req.member && clinic_account_id) {
      const caIds = await resolverCaIds(req, tid, clinic_account_id);
      if (caIds) {
        sql += ` AND e.clinic_account_id = ANY($${params.length + 1}::bigint[]) `;
        params.push(caIds);
      }
    }

    sql += `
      LEFT JOIN tipos_automacao ta ON ta.id = e.tipo_automacao_id
      WHERE t.id = $1
      GROUP BY t.id, t.salario_medio_funcionario, t.horas_trabalhadas_mes
    `;

    const { rows } = await getPool().query(sql, params);
    return normalizar(rows[0]);
  });

  // Estatísticas REAIS do assinante (agregado direto no banco, SEM limite de
  // linhas) — o painel usava a lista /patients (teto 500) e contava errado.
  app.get('/stats', { preHandler: [app.authenticate] }, async (req) => {
    const tid = req.tenant!.id;
    const OK = "('registered','verified_ok','verified_divergent','done_manually')";
    const { clinic_account_id, member_user_id, empresa_id } = req.query as { clinic_account_id?: string; member_user_id?: string; empresa_id?: string };

    let sqlFilter = 'AND ca.tenant_id = $1';
    const params: any[] = [tid];

    const activeMemberId = req.member ? req.member.user_id : (member_user_id || null);
    const activeEmpresaId = req.member ? req.member.empresa_id : (empresa_id ? Number(empresa_id) : null);

    if (activeEmpresaId) {
      sqlFilter += ` AND (ca.empresa_id = $${params.length + 1} OR u.empresa_id = $${params.length + 1})`;
      params.push(activeEmpresaId);
    }

    if (activeMemberId) {
      sqlFilter += ` AND (ca.member_user_id = $${params.length + 1}::uuid OR u.uploaded_by = $${params.length + 1}::uuid)`;
      params.push(activeMemberId);
    } else if (!req.member && clinic_account_id) {
      const caIds = await resolverCaIds(req, tid, clinic_account_id);
      if (caIds) {
        sqlFilter += ` AND ca.id = ANY($${params.length + 1}::bigint[])`;
        params.push(caIds);
      }
    }

    // 1) Totais
    const { rows: tot } = await getPool().query(
      `SELECT
         count(*) FILTER (WHERE pr.status IN ${OK}) AS registrados,
         count(*) FILTER (WHERE pr.status = 'error') AS erros,
         count(*) FILTER (WHERE pr.status = 'pending_registration') AS pendentes,
         count(*) FILTER (WHERE pr.status IN ${OK} AND pr.registered_at::date = current_date) AS hoje
       FROM patient_records pr
       JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
       JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
       WHERE 1=1 ${sqlFilter}`,
      params,
    );

    // 2) Por dia (últimos 7 dias) pela DATA DO CADASTRO (registered_at).
    const { rows: dias } = await getPool().query(
      `SELECT to_char(pr.registered_at::date, 'YYYY-MM-DD') AS dia, count(*) AS n
       FROM patient_records pr
       JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
       JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
       WHERE pr.status IN ${OK}
         AND pr.registered_at >= (current_date - interval '6 days')
         ${sqlFilter}
       GROUP BY 1 ORDER BY 1`,
      params,
    );

    // 3) Erros por TIPO (métrica pra melhorar o que dá errado) — 1ª linha da msg.
    const { rows: errTipos } = await getPool().query(
      `SELECT COALESCE(NULLIF(split_part(pr.error_message, E'\n', 1), ''), 'sem mensagem') AS motivo, count(*) AS n
       FROM patient_records pr
       JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
       JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
       WHERE pr.status = 'error'
         ${sqlFilter}
       GROUP BY 1 ORDER BY n DESC LIMIT 8`,
      params,
    );

    // 4) Média de cadastros/dia (total ÷ dias que houve cadastro) + nº de
    // funcionários que o cliente usava na operação manual (comparativo).
    const { rows: med } = await getPool().query(
      `SELECT count(*) AS total, count(DISTINCT pr.registered_at::date) AS dias
       FROM patient_records pr
       JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
       JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
       WHERE pr.status IN ${OK} AND pr.registered_at IS NOT NULL
         ${sqlFilter}`,
      params,
    );

    const { rows: cfg } = await getPool().query('SELECT funcionarios_operacao, cadastros_dia_funcionario FROM tenants WHERE id = $1', [tid]);
    const totalReg = Number(med[0]?.total ?? 0);
    const diasAtivos = Number(med[0]?.dias ?? 0);
    const cadDiaPorFunc = Number(cfg[0]?.cadastros_dia_funcionario ?? 30);
    const funcOp = Number(cfg[0]?.funcionarios_operacao ?? 1);

    const r = tot[0] ?? {};
    return {
      registrados: Number(r.registrados ?? 0),
      erros: Number(r.erros ?? 0),
      pendentes: Number(r.pendentes ?? 0),
      hoje: Number(r.hoje ?? 0),
      por_dia: dias.map((d) => ({ dia: d.dia as string, n: Number(d.n) })),
      erros_por_tipo: errTipos.map((e) => ({ motivo: (e.motivo as string).slice(0, 80), n: Number(e.n) })),
      media_cadastros_dia: diasAtivos > 0 ? Math.round(totalReg / diasAtivos) : 0,
      dias_ativos: diasAtivos,
      funcionarios_operacao: funcOp,
      cadastros_dia_por_funcionario: cadDiaPorFunc, // REAL (informado pelo cliente)
      funcionarios_equivalentes_real:
        cadDiaPorFunc > 0 && diasAtivos > 0
          ? Math.round((totalReg / diasAtivos / cadDiaPorFunc) * 10) / 10
          : 0,
    };
  });

  // Visão geral do super admin: economia de todos os clientes (a partir da view).
  app.get('/admin/economia', { preHandler: [app.authenticateSuperAdmin] }, async () => {
    const { rows } = await getPool().query(
      'SELECT tenant_id, tenant_nome, salario_medio_funcionario, horas_trabalhadas_mes, volume_execucoes, horas_economizadas, valor_economizado, funcionarios_equivalentes FROM vw_economia_cliente ORDER BY valor_economizado DESC',
    );
    return rows.map((r) => ({
      tenant_id: Number(r.tenant_id),
      tenant_nome: r.tenant_nome as string,
      salario_medio_funcionario: Number(r.salario_medio_funcionario),
      horas_trabalhadas_mes: Number(r.horas_trabalhadas_mes),
      volume_execucoes: Number(r.volume_execucoes),
      horas_economizadas: Number(r.horas_economizadas),
      valor_economizado: Number(r.valor_economizado),
      funcionarios_equivalentes: Number(r.funcionarios_equivalentes),
    }));
  });
}
