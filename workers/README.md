# CMD SaaS — Workers (BullMQ)

Motor de automação em segundo plano. Consome jobs do Redis (BullMQ) e executa
o pipeline herdado do `cmd-coleta` (Django/Celery):

```
upload ─▶ [extraction] ─▶ [registration] ─▶ [verification]
                 │                │
           cria patient_records   loga no CMD-COLETA e cadastra (Playwright)
```

## Filas isoladas
| Fila            | O que faz                                   | Origem (Django)                    |
|-----------------|---------------------------------------------|------------------------------------|
| `extraction`    | extrai pacientes do arquivo                 | `processar_upload`                 |
| `registration`  | cadastra no CMD-COLETA (browser)            | `registrar_pacientes_do_upload`    |
| `verification`  | confere os cadastros                        | `verificar_pacientes_do_upload`    |
| watchdog (5min) | recupera uploads travados                   | `watchdog_uploads_travados`        |

## Regras de negócio preservadas
- **1 sessão por conta CMD** — `withClinicLock` serializa registros da mesma
  clínica (clínicas diferentes rodam em paralelo). Era `concurrency=1` no Celery.
- **Janela de execução** — `scheduling.ts` (porta de `intake/scheduling.py`):
  dias da semana + horário + pausa diária. Fora da janela, reagenda.
- **Delay antes do registro** — `delay_inicio_minutos` vira `delay` do job.
- **Recuperação de travados** — watchdog no boot e a cada 5 min.

## Setup
```bash
# 1. Suba o Redis (na raiz do projeto):
docker compose up -d

# 2. Workers:
cd workers
npm install
cp .env.example .env   # já existe um .env pronto (mesma FIELD_ENCRYPTION_KEY do backend)
npm run dev
```

## ⚠️ O que ainda falta portar (esqueletos marcados com TODO(port))
A orquestração (status, filas, lock, janela, logs) está completa. Falta a
lógica "braçal", que será portada de `automation_engine/` do repo antigo:
- `ficha_extractor.py` (OCR/Tesseract + IA Claude) → `extraction.worker.ts`
- `web_automation.py` (Playwright: login + cadastro) → `registration.worker.ts`
- conferência → `verification.worker.ts`

> A `FIELD_ENCRYPTION_KEY` é a MESMA do backend — necessária para decifrar
> senha/MFA da clínica (Fernet, compatível com o ciphertext do banco antigo).
