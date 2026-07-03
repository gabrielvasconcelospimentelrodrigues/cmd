/* Self-test de lógica pura (sem Redis): cripto Fernet + janela de execução. */
import { encrypt, decrypt } from '../lib/crypto';
import { proximaJanelaPermitida } from '../scheduling';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) falhas++;
};

// 1. Round-trip Fernet (cifra -> decifra volta ao original)
const segredo = 'Senha#CMD-123!';
const cipher = encrypt(segredo);
ok(cipher !== segredo && cipher.length > 20, `Fernet cifra (${cipher.length} chars)`);
ok(decrypt(cipher) === segredo, 'Fernet decifra de volta ao original');

// 2. Janela: segunda-feira 10h, janela 08:00-18:00 -> permitido
const seg10 = new Date(2026, 5, 29, 10, 0); // 2026-06-29 é segunda
const r1 = proximaJanelaPermitida(
  { dias_execucao: [0, 1, 2, 3, 4], horario_inicio_execucao: '08:00:00', horario_fim_execucao: '18:00:00', pausa_inicio: null, pausa_fim: null },
  seg10,
);
ok(r1.permitidoAgora, 'Janela: seg 10h dentro de 08-18 -> permitido');

// 3. Janela: segunda 20h (fora) -> reagenda para próximo dia útil 08:00
const seg20 = new Date(2026, 5, 29, 20, 0);
const r2 = proximaJanelaPermitida(
  { dias_execucao: [0, 1, 2, 3, 4], horario_inicio_execucao: '08:00:00', horario_fim_execucao: '18:00:00', pausa_inicio: null, pausa_fim: null },
  seg20,
);
ok(!r2.permitidoAgora && r2.proximoHorario?.getHours() === 8, `Janela: seg 20h fora -> proximo ${r2.proximoHorario?.toLocaleString('pt-BR')}`);

// 4. Pausa de almoço 12:00-13:00 bloqueia 12:30
const seg1230 = new Date(2026, 5, 29, 12, 30);
const r3 = proximaJanelaPermitida(
  { dias_execucao: [0, 1, 2, 3, 4], horario_inicio_execucao: '08:00:00', horario_fim_execucao: '18:00:00', pausa_inicio: '12:00:00', pausa_fim: '13:00:00' },
  seg1230,
);
ok(!r3.permitidoAgora && r3.proximoHorario?.getHours() === 13, 'Janela: pausa 12-13 bloqueia 12:30 -> volta 13:01');

console.log(falhas === 0 ? '\n✅ Todos os testes passaram.' : `\n❌ ${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
