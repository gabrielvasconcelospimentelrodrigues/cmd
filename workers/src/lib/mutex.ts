/**
 * Mutex por chave (em memória, dentro do processo do worker). Serializa
 * execuções que compartilham a mesma chave — usamos para o LOGIN por conta
 * gov: com concorrência > 1, vários cadastros da MESMA conta tentavam logar ao
 * mesmo tempo (mesmo código TOTP da janela de 30s), o que o gov.br rejeita/atrasa.
 * Serializando só o login, os cadastros seguem em paralelo depois.
 */
const cadeias = new Map<string, Promise<unknown>>();

export function comMutex<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const anterior = cadeias.get(chave) ?? Promise.resolve();
  // Roda fn só depois da anterior terminar (mesmo se ela falhou).
  const proximo = anterior.then(fn, fn);
  // Guarda uma versão que engole erros, para não travar a fila da chave.
  cadeias.set(chave, proximo.then(() => undefined, () => undefined));
  return proximo;
}
