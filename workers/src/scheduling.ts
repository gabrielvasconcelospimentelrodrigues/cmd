/**
 * Janela de execução por ClinicAccount — porta fiel de
 * intake/scheduling.py:proxima_janela_permitida do sistema antigo.
 *
 * Regras:
 *  - `dias_execucao`: dias da semana permitidos (0=Segunda ... 6=Domingo).
 *  - `horario_inicio/fim_execucao`: janela diária ('HH:MM:SS' ou null).
 *  - `pausa_inicio/fim`: pausa recorrente dentro da janela (ex: almoço).
 *
 * Retorna { permitidoAgora, proximoHorario } — proximoHorario só vem quando
 * NÃO é permitido agora (próximo instante em que a janela libera).
 */

export interface JanelaConfig {
  dias_execucao: number[] | null;
  horario_inicio_execucao: string | null; // 'HH:MM:SS'
  horario_fim_execucao: string | null;
  pausa_inicio: string | null;
  pausa_fim: string | null;
}

/** Converte 'HH:MM:SS' em minutos desde meia-noite (para comparar horários). */
function horaParaMinutos(hhmmss: string): number {
  const [h = '0', m = '0'] = hhmmss.split(':');
  return Number(h) * 60 + Number(m);
}

/** JS getDay(): 0=Domingo..6=Sábado. Convertemos p/ 0=Segunda..6=Domingo. */
function diaSemanaSegunda0(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export interface JanelaResultado {
  permitidoAgora: boolean;
  proximoHorario: Date | null;
}

export function proximaJanelaPermitida(conta: JanelaConfig, agora: Date = new Date()): JanelaResultado {
  const dias = conta.dias_execucao && conta.dias_execucao.length ? conta.dias_execucao : [0, 1, 2, 3, 4, 5, 6];
  const ini = conta.horario_inicio_execucao ? horaParaMinutos(conta.horario_inicio_execucao) : null;
  const fim = conta.horario_fim_execucao ? horaParaMinutos(conta.horario_fim_execucao) : null;
  const pIni = conta.pausa_inicio ? horaParaMinutos(conta.pausa_inicio) : null;
  const pFim = conta.pausa_fim ? horaParaMinutos(conta.pausa_fim) : null;

  const permitidoEm = (momento: Date): boolean => {
    if (!dias.includes(diaSemanaSegunda0(momento))) return false;
    const min = momento.getHours() * 60 + momento.getMinutes();
    if (ini !== null && min < ini) return false;
    if (fim !== null && min > fim) return false;
    if (pIni !== null && pFim !== null && min >= pIni && min <= pFim) return false;
    return true;
  };

  if (permitidoEm(agora)) return { permitidoAgora: true, proximoHorario: null };

  // Avança minuto a minuto até 8 dias à frente (barato e sem duplicar lógica).
  const candidato = new Date(agora);
  candidato.setSeconds(0, 0);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    candidato.setMinutes(candidato.getMinutes() + 1);
    if (permitidoEm(candidato)) return { permitidoAgora: false, proximoHorario: new Date(candidato) };
  }
  return { permitidoAgora: false, proximoHorario: null };
}
