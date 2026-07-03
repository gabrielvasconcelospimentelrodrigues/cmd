import { extrairPlanilha } from './spreadsheet';
import { importarComMapa, type CampoImportacao } from './mapped-import';
import type { PatientData } from './types';

/**
 * Decide o caminho de extração pelo arquivo e pela presença de mapeamento:
 *  - com `mapeamento_campos` (tela "Dados importados") → import manual;
 *  - CSV/XLSX sem mapa → extração automática por aliases;
 *  - XML sem mapa não é suportado (precisa de mapeamento manual).
 * Sempre devolve PatientData[] (contrato comum).
 */
export async function extrairPacientes(
  buffer: Buffer,
  filename: string,
  mapeamento: Record<string, string>,
): Promise<PatientData[]> {
  const ehXml = filename.toLowerCase().endsWith('.xml');
  const temMapa = Object.keys(mapeamento).length > 0;

  if (temMapa) {
    const linhas = await importarComMapa(buffer, filename, mapeamento as Partial<Record<CampoImportacao, string>>);
    return linhas.map((l) => {
      // Obrigatórios: cns (aceita CPF ou CNS) + data_atendimento + médico.
      // Nome/CID são preenchidos pelo CMD a partir do CNS, então não bloqueiam.
      const fundamentais = { cns: l.cns, data_atendimento: l.data_atendimento, medico_nome: l.profissional };
      const extraction_method: Record<string, string> = {};
      const campos_incertos: string[] = [];
      for (const [campo, val] of Object.entries(fundamentais)) {
        if (val) extraction_method[campo] = 'importado';
        else campos_incertos.push(campo);
      }
      return {
        nome: l.nome,
        cns: l.cns,
        data_nascimento: l.data_nascimento,
        data_atendimento: l.data_atendimento,
        cid10_codigo: '',
        medico_nome: l.profissional,
        extraction_method,
        campos_incertos,
        status: campos_incertos.length ? 'needs_review' : 'ok',
      };
    });
  }

  if (ehXml) {
    throw new Error('XML exige mapeamento manual de colunas (envie mapeamento_campos).');
  }

  return extrairPlanilha(buffer, filename);
}

export type { PatientData } from './types';
