import type { FastifyInstance } from 'fastify';
import { getPool } from '../lib/db';

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
    const { inicio, fim } = req.query as { inicio?: string; fim?: string };
    const { rows } = await getPool().query('SELECT * FROM economia_cliente($1, $2, $3)', [
      req.tenant!.id,
      inicio ?? null,
      fim ?? null,
    ]);
    return normalizar(rows[0]);
  });

  // Estatísticas REAIS do assinante (agregado direto no banco, SEM limite de
  // linhas) — o painel usava a lista /patients (teto 500) e contava errado.
  app.get('/stats', { preHandler: [app.authenticate] }, async (req) => {
    const tid = req.tenant!.id;
    const OK = "('registered','verified_ok','verified_divergent','done_manually')";
    // Ignora pacientes de uploads EXCLUÍDOS (deleted_at) — senão listas velhas
    // apagadas poluem os números (ex.: erros de teste puxando a taxa pra baixo).
    const { rows: tot } = await getPool().query(
      `SELECT
         count(*) FILTER (WHERE pr.status IN ${OK}) AS registrados,
         count(*) FILTER (WHERE pr.status = 'error') AS erros,
         count(*) FILTER (WHERE pr.status = 'pending_registration') AS pendentes,
         count(*) FILTER (WHERE pr.status IN ${OK} AND pr.registered_at::date = current_date) AS hoje
       FROM patient_records pr
       JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
       JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
       WHERE ca.tenant_id = $1`,
      [tid],
    );
    // Cadastros por dia (últimos 7 dias) pela DATA DO CADASTRO (registered_at).
    const { rows: dias } = await getPool().query(
      `SELECT to_char(pr.registered_at::date, 'YYYY-MM-DD') AS dia, count(*) AS n
       FROM patient_records pr
       JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
       JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
       WHERE ca.tenant_id = $1 AND pr.status IN ${OK}
         AND pr.registered_at >= (current_date - interval '6 days')
       GROUP BY 1 ORDER BY 1`,
      [tid],
    );
    // Erros por TIPO (métrica pra melhorar o que dá errado) — 1ª linha da msg.
    const { rows: errTipos } = await getPool().query(
      `SELECT COALESCE(NULLIF(split_part(pr.error_message, E'\n', 1), ''), 'sem mensagem') AS motivo, count(*) AS n
       FROM patient_records pr
       JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
       JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
       WHERE ca.tenant_id = $1 AND pr.status = 'error'
       GROUP BY 1 ORDER BY n DESC LIMIT 8`,
      [tid],
    );
    // Média de cadastros/dia (total ÷ dias que houve cadastro) + nº de
    // funcionários que o cliente usava na operação manual (comparativo).
    const { rows: med } = await getPool().query(
      `SELECT count(*) AS total, count(DISTINCT pr.registered_at::date) AS dias
       FROM patient_records pr
       JOIN clinic_accounts ca ON ca.id = pr.clinic_account_id
       JOIN uploads u ON u.id = pr.upload_id AND u.deleted_at IS NULL
       WHERE ca.tenant_id = $1 AND pr.status IN ${OK} AND pr.registered_at IS NOT NULL`,
      [tid],
    );
    const { rows: cfg } = await getPool().query('SELECT funcionarios_operacao, cadastros_dia_funcionario FROM tenants WHERE id = $1', [tid]);
    const totalReg = Number(med[0]?.total ?? 0);
    const diasAtivos = Number(med[0]?.dias ?? 0);
    // Quanto UM funcionário fazia por dia — dado REAL informado pelo cliente.
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
      // Equivalente pelo dado REAL: quantos funcionários seriam pra fazer o que a
      // IA faz por dia, na produtividade real deles.
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
