# Plano de Port — Motor de Automação CMD-COLETA (Python → Node/TS)

Mapeamento do `automation_engine/` do sistema antigo (`cmd-coleta`) para a
reescrita em Node + TypeScript + Playwright + BullMQ. Referência da **Fase 2**.

> ## ⚠️ ESCOPO ATUALIZADO (decisão do usuário)
> **NÃO vamos usar extração de PDF/OCR/IA.** O sistema trabalha SOMENTE com
> import de arquivos tabulares: **CSV, Excel (.xlsx) e XML**. Portanto:
> - ❌ Descartados: `ficha_extractor.py` (Tesseract+Claude), `extrator_rapido.py`,
>   rasterização de PDF, Anthropic SDK, sharp, mupdf — nada disso é portado.
> - ✅ **FEITO:** extratores de tabela em `src/extractors/` (CSV/Excel/XML +
>   mapeamento auto/manual), 15 testes passando (`npm run test:extractors`).
> - ✅ A fazer: a automação **Playwright** de cadastro (Blocos 4-6) continua.
>
> Seções de OCR/IA abaixo ficam só como registro histórico — ignorar para o port.

## Arquivos do motor antigo
| Arquivo | Linhas | Responsabilidade |
|---|---|---|
| `web_automation.py` | 1425 | Login gov.br + Playwright, cadastro de contato assistencial, verificação, edição, screencast |
| `ficha_extractor.py` | 763 | OCR híbrido (Tesseract + Claude Vision) de fichas escaneadas |
| `extrator_rapido.py` | 192 | Extração rápida só-OCR de 4 campos, com "labels aprendidos" por tenant |
| `spreadsheet_extractor.py` | 164 | CSV/Excel com mapeamento automático de colunas por aliases |
| `importador_mapeado.py` | 131 | Import CSV/Excel/XML com mapeamento manual |
| `utils.py` | 49 | Logger rotativo + retry (tenacity) |
| `diagnostico.py` | 160 | Base de conhecimento de bugs → diagnóstico de exceções |

**Contrato comum:** todos os extratores produzem o MESMO dict de paciente
(`nome, cns, data_nascimento, data_atendimento, cid10_codigo, medico_nome` +
`extraction_method/campos_incertos/status`), consumido pelo `WebAutomator` de
forma agnóstica. Esse contrato é a fronteira estável do port — definir primeiro.

## Login (web_automation.py 269–429)
- Alvo: `acesso.saude.gov.br/login` (SCPA) → abre app Angular `cmd-coleta.saude.gov.br` em nova aba.
- `#username`/`#password` → `#entrar`; **MFA TOTP** via `pyotp.TOTP(mfa_secret.replace(" ","")).now()` → `#codigo` → `#prosseguir`. Equivalente Node: **otplib** `authenticator.generate(secret)`.
- Loop de 3 tentativas (código MFA expira em ~30s; detecta `#username` reaparecendo = expirou).
- Pós-login: escolhe perfil ("Usuário" + "Esfera Ministério da Saúde"), card CMD-COLETA "ACESSAR" abre nova aba, troca `self.page`. **Sem captcha** (risco: se gov.br adicionar, quebra).

## Cadastro (incluir_contato_assistencial 524–721)
App Angular/Ionic → muitos campos exigem `press_sequentially` (não `.fill()`).
Ordem: busca CNS (CADSUS auto-preenche nascimento) → admissão (modalidade "07
Ambulatorial Especializada", procedência "12", caráter "01", motivo "01") →
CID-10 → procedimentos (por idade: ≤8 anos `[6,2,3,4,5]`, ≥9 `[1,2,3,4,5]`;
códigos 1 e 6 mutuamente exclusivos) → Salvar → Finalizar.
- **Overrides por paciente** (`automation_overrides` no banco): `_valor_override` +
  `_autocomplete_com_override` aplicam correções manuais do cliente SÓ àquele
  paciente. ~20 campos suportados.
- **Máscara de data:** digitar só os dígitos (`\D`→""), nunca a string com "/".
- **Profissional:** fuzzy match (`_find_best_match`, difflib) tolerante a OCR;
  `ProfessionalNotFoundError` = erro de dados não-retryável.
- **Sucesso:** "Incluir contato assistencial" reaparece = cadastro efetivado.
- `dry_run`: preenche tudo e para antes de Salvar (validação sem criar cadastro).

## Verificação (723–1149)
Abre "Aguardando envio", compara espelho × ficha por substring no texto da
página. `divergencias` = campos esperados não-encontrados (overrides mudam o
esperado). Paginação confirma mudança de conteúdo (race do Angular).

## Extração (ficha_extractor.py)
- **Tesseract** `lang="por"`, word-level bbox+confidence (`image_to_data`),
  parsing POR POSIÇÃO (rótulo → valor abaixo/acima, coords normalizadas 0-1).
  `CONFIANCA_MINIMA=70`.
- **Fallback Claude Vision:** modelo **`claude-opus-4-8`**, `messages.parse` com
  `thinking={"type":"adaptive"}` + structured output (Pydantic → **Zod** no port).
  Duas passadas: extração + verificação independente. Imagem ≤2000px JPEG q85
  (sharp no Node). Custo registrado em `ApiUsageRecord` ($5/$25 por 1M tokens).
- **PDF:** **PyMuPDF (`fitz`)**, rasteriza 1 página por vez a 250 DPI, apaga o PNG
  na hora (fichas de 1000+ páginas). NÃO usa poppler/pdf2image.
- Paralelismo `MAX_PAGINAS_EM_PARALELO = max(2, cpu-1)` (CPU-bound).
- Obrigatórios p/ cadastro: `cns, data_atendimento, medico_nome`.

## Pool de sessão (browser_pool.py)
Mantém 1 browser logado por conta CMD vivo entre jobs (evita re-login), descarta
após **8 min idle** (sessão gov.br expira cedo). Replicar nos workers BullMQ.

## Dependências Python → Node
| Python | Node | Risco |
|---|---|---|
| playwright (sync) | **playwright** (async) | port vira todo async/await (mecânico, extenso) |
| pyotp | **otplib** | baixo |
| pymupdf (fitz) | **mupdf** ou **pdfjs-dist** | médio (binding menos maduro) |
| pytesseract | **tesseract.js** (WASM) ou node-tesseract-ocr | **ALTO** (bbox+confidence por palavra) |
| pillow | **sharp** | baixo |
| anthropic | **@anthropic-ai/sdk** (`messages.parse` + Zod) | baixo |
| pydantic | **zod** | médio |
| openpyxl | **exceljs**/xlsx | baixo |
| csv/xml | **csv-parse**/**fast-xml-parser** | baixo |
| tenacity | retry do **BullMQ** | baixo |

**Binários de sistema (deploy):** Tesseract + traineddata `por` (`apt install
tesseract-ocr tesseract-ocr-por`); Chromium (Playwright baixa). Evitar poppler
usando mupdf/pdfjs.

## Ordem de port (menor → maior risco)
- **Bloco 0 — Fundação:** tipo do dict de paciente (contrato), `utils` (pino+retry), `diagnostico.ts`. *Offline.*
- **Bloco 1 — Extratores estruturados:** spreadsheet + importador. *Offline, 100% testável.*
- **Bloco 2 — Rasterização + Claude Vision:** sharp + mupdf/pdfjs + Anthropic SDK + prompts/Zod. *Testável com fichas + API key.*
- **Bloco 3 — OCR Tesseract posicional:** ⚠️ maior risco da extração. *Offline com corpus golden vs Python.*
- **Bloco 4 — Login + sessão Playwright:** ⚠️ exige credenciais reais. `headless:false` p/ depurar.
- **Bloco 5 — Cadastro:** ⚠️ credenciais reais. Usar `dry_run` extensivamente.
- **Bloco 6 — Verificação/edição:** ⚠️ credenciais reais.
- **Bloco 7 — Orquestração BullMQ:** substitui `intake/tasks.py` (extrai→cadastra com retry via diagnostico→verifica).

## 3 maiores riscos + mitigação
1. **OCR posicional em Node** — bbox+confidence por palavra difere entre libs.
   Mitigar: camada de adaptação que reproduz EXATAMENTE o formato de "observação"
   do Python; validar com golden-corpus campo-a-campo; `tesseract.js` dá controle
   do output `words`; Claude Vision como rede de segurança.
2. **Estabilidade do Angular/Ionic do CMD-COLETA** — cheio de workarounds para
   races (modais órfãos, aria-disabled +1200ms, máscara de data, aba duplicada).
   Mitigar: portar workarounds LITERALMENTE (não "limpar"); `headless:false` +
   screencast; `dry_run` padrão; preservar `_aguardar_modal_carregamento`.
3. **Sync→async** — fácil introduzir corrida ou esquecer `await`.
   Mitigar: port 1:1 mantendo ordem/timeouts; ESLint `no-floating-promises`;
   testar fluxo completo com conta real em ambiente isolado.

## Testável offline vs precisa credenciais
- **Offline (com fixtures + Anthropic key):** Blocos 0,1,2,3; `diagnostico`,
  `calculate_procedure_codes`, `_find_best_match`. Validar campo-a-campo vs Python.
- **Precisa conta gov.br real:** Blocos 4,5,6 (login/MFA, cadastro, verificação).
  Usar `dry_run` para minimizar cadastros reais; ideal um ambiente de testes do gov.
