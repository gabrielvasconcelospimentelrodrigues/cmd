import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from 'playwright';
import { connection } from '../lib/redis';
import { generateTotp } from './totp';
import { limparNomeMedico } from '../extractors/aliases';

/**
 * Automação do portal Acesso Saúde / CMD-COLETA (gov.br) — porta de
 * automation_engine/web_automation.py (Playwright sync → async TS).
 *
 * Responsabilidades nesta etapa: subir o browser, logar (usuário + senha +
 * MFA/TOTP) e transmitir o screencast ao vivo (CDP → Redis pub/sub).
 * O cadastro de paciente (incluirContato) será portado em seguida.
 */
const URL_LOGIN = 'https://acesso.saude.gov.br/login';

// ⚠️ REGRA PROVISÓRIA (remover depois): dá até 5 minutos para o trecho
// login → tela "Contatos Assistenciais" (onde costuma travar) se resolver,
// reinsistindo nos redirects/perfil/ACESSAR. Os demais passos seguem os
// timeouts padrão. Para desativar: baixar de volta para ~40_000ms (ou remover
// o loop de reinsistência em login()).  [pendência lembrada ao usuário]
const PROVISORIO_LOGIN_ATE_CONTATOS_MS = 5 * 60_000;

// Códigos de procedimento (SIGTAP) — porta de PROCEDURE_CODES (web_automation.py).
// 1 a 5 (+7) valem a partir de 9 anos; 6 substitui o 1 para 0 a 8 anos.
const PROCEDURE_CODES: Record<number, [string, string]> = {
  1: ['0905010035', 'OCI AVALIAÇÃO INICIAL EM OFTALMOLOGIA - A PARTIR DE 9 ANOS'],
  2: ['0211060020', 'BIOMICROSCOPIA DE FUNDO DE OLHO'],
  3: ['0211060127', 'MAPEAMENTO DE RETINA'],
  4: ['0211060259', 'TONOMETRIA'],
  5: ['0301010072', 'CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA'],
  6: ['0905010019', 'OCI AVALIAÇÃO INICIAL EM OFTALMOLOGIA - 0 A 8 ANOS'],
  7: ['0211060232', 'TESTE ORTÓPTICO'], // 6ª OCI — só para 9+ anos (não-cirurgia)
};

export class ProfessionalNotFoundError extends Error {}

/** Remove acentos, título (Dr./Dra.) e sufixo de CRM para comparar nomes. */
function normalize(text: string): string {
  let t = (text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.trim().toLowerCase();
  t = t.replace(/\s*[-–]?\s*crm[:\s]*\S*.*$/i, '');
  t = t.replace(/^(dr|dra)\.?\s+/i, '');
  return t.trim();
}

/** Razão de similaridade ~ difflib.SequenceMatcher.ratio (Levenshtein normalizado). */
function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const m = a.length, n = b.length;
  const d: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j]!;
      d[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, d[j]!, d[j - 1]!) + 1;
      prev = tmp;
    }
  }
  return 1 - d[n]! / Math.max(m, n);
}

/** Porta de _find_best_match: acha a opção mais parecida com target. */
function findBestMatch(target: string, options: string[], cutoff = 0.6): string | null {
  const targetNorm = normalize(target);
  if (!targetNorm) return null;
  const normMap = new Map<string, string>();
  for (const opt of options) if (opt) normMap.set(opt, normalize(opt));

  for (const [opt, norm] of normMap) {
    if (norm.includes(targetNorm) || targetNorm.includes(norm)) return opt;
  }
  const targetTokens = new Set(targetNorm.split(/\s+/));
  if (!targetTokens.size) return null;
  let bestOpt: string | null = null, bestScore = 0;
  for (const [opt, norm] of normMap) {
    const optTokens = new Set(norm.split(/\s+/));
    if (!optTokens.size) continue;
    let inter = 0;
    for (const t of targetTokens) if (optTokens.has(t)) inter++;
    const overlap = inter / targetTokens.size;
    if (overlap > bestScore) { bestScore = overlap; bestOpt = opt; }
  }
  if (bestScore >= cutoff) return bestOpt;
  // Último recurso: similaridade textual geral (erros de OCR letra a letra).
  let close: string | null = null, closeScore = cutoff + 0.15;
  for (const [opt, norm] of normMap) {
    const r = ratio(targetNorm, norm);
    if (r >= closeScore) { closeScore = r; close = opt; }
  }
  return close;
}

/** Converte dd/mm/aaaa (ou aaaa-mm-dd) → Date local. */
function parseDate(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const s = String(valor).trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

/** Formata Date → dd/mm/aaaa (equivale a strftime("%d/%m/%Y")). */
function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export interface PatientData {
  cns: string;
  nome: string;
  dataNascimento: Date | null;
  dataAtendimento: Date | null;
  cid10Codigo: string;
  medicoNome: string;
  overrides?: Record<string, string>;
  /** Modalidade do cadastro: 'oci' (padrão — pacote de consultas por idade) ou
   * 'catarata' (FACOEMULSIFICAÇÃO: sem checkbox OCI e procedimento único). */
  modalidade?: 'oci' | 'catarata';
}

/** Código SIGTAP da FACOEMULSIFICAÇÃO com implante de lente intra-ocular dobrável. */
const CODIGO_CATARATA_FACO = '0405050372';

export interface AutomatorOpts {
  username: string;
  password: string;
  mfaSecret: string;
  uploadId: number;
  headless?: boolean;
  onStep?: (descricao: string) => void;
  // Controles clínicos: CID escolhido pela idade (calculada da data de nascimento).
  cidOci0a8?: string; // paciente de OCI de 0 a 8 anos
  cid9Mais?: string; // paciente acima de 9 anos
  // Corta o login no meio se o usuário parou/pausou/excluiu o envio — assim o
  // laço de até 5 min não segue rodando "fantasma" com o navegador aberto.
  abortou?: () => Promise<boolean>;
}

/** Login interrompido porque o usuário parou/excluiu o envio (não é erro real). */
export class LoginAbortadoError extends Error {}

export class WebAutomator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  page: Page | null = null;
  private cdp: CDPSession | null = null;

  constructor(private opts: AutomatorOpts) {}

  private passo(d: string) {
    this.opts.onStep?.(d);
  }

  async start(): Promise<void> {
    // Tenta Chrome instalado; cai para o Chromium do Playwright.
    try {
      this.browser = await chromium.launch({ headless: this.opts.headless ?? true, channel: 'chrome' });
    } catch {
      this.browser = await chromium.launch({ headless: this.opts.headless ?? true });
    }
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(45_000);
    await this.startScreencast();
  }

  async close(): Promise<void> {
    await this.stopScreencast();
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  // ---- Screencast (CDP → Redis pub/sub canal live:{uploadId}) --------------
  private async startScreencast(): Promise<void> {
    if (!this.page || !this.context) return;
    try {
      this.cdp = await this.context.newCDPSession(this.page);
      this.cdp.on('Page.screencastFrame', async (frame: { data: string; sessionId: number }) => {
        connection.publish(`live:${this.opts.uploadId}`, frame.data).catch(() => {});
        try {
          await this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
        } catch {
          /* sessão pode ter trocado */
        }
      });
      await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, everyNthFrame: 1 });
    } catch {
      this.cdp = null;
    }
  }
  private async stopScreencast(): Promise<void> {
    try {
      await this.cdp?.send('Page.stopScreencast');
    } catch {
      /* ignore */
    }
    this.cdp = null;
  }

  private gerarMfa(): string {
    return generateTotp(this.opts.mfaSecret);
  }

  /**
   * Espera a URL parar de mudar (SSO do gov.br encadeia redirects). Considera
   * estável quando fica igual por 2 checagens seguidas, ou estoura o timeout.
   */
  private async esperarUrlEstavel(page: Page, timeoutMs: number): Promise<void> {
    const fim = Date.now() + timeoutMs;
    let anterior = '';
    let estaveis = 0;
    while (Date.now() < fim) {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      const atual = page.url();
      if (atual === anterior && atual) {
        if (++estaveis >= 2) break;
      } else {
        estaveis = 0;
        anterior = atual;
      }
      await page.waitForTimeout(1500);
    }
    // Assenta requisições pendentes (XHR do app) antes de tocar no DOM.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  }

  /**
   * Tela de escolha de perfil do SCPA (gov.br). O campo é um combo do Design
   * System gov.br rotulado "Usuário"/"Perfil": clica pra abrir e escolhe a
   * esfera "Ministério da Saúde". Estratégia em camadas, tolerante a variação:
   *   1) se a esfera já estiver clicável, clica direto;
   *   2) senão abre o combo (label, input, setinha ou o próprio texto "Usuário");
   *   3) escolhe a opção que contém "Ministério da Saúde".
   * Se a tela nem existir (login já trouxe direto ao app), sai sem erro.
   */
  private async selecionarPerfilMinisterio(page: Page): Promise<void> {
    const alvo = /minist[ée]rio da sa[úu]de/i;

    for (let tentativa = 0; tentativa < 5; tentativa++) {
      // (1) A esfera já está visível e clicável?
      const esfera = page.getByText(alvo).first();
      if (await esfera.isVisible({ timeout: 1500 }).catch(() => false)) {
        this.passo('Selecionando perfil "Ministério da Saúde"...');
        await esfera.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2500);
        // Confirma que saiu da tela de perfil.
        if (!(await this.pareceTelaPerfil(page))) return;
      }

      // Não é (mais) a tela de perfil? Então segue o fluxo.
      if (!(await this.pareceTelaPerfil(page))) return;

      // (2) Abre o combo. Tenta vários gatilhos, na ordem de robustez.
      this.passo('Abrindo seletor de perfil...');
      const abridores = [
        page.getByRole('combobox').first(),
        page.locator('label:has-text("Usuário"), label:has-text("Perfil")').first(),
        page.locator('.br-select, .br-input, input[readonly], .selectized, .dropdown-toggle').first(),
        page.locator('i.fa-angle-down, i.fas.fa-angle-down, .br-select .icon, [class*="chevron"]').first(),
        page.getByText('Usuário', { exact: true }).first(),
      ];
      for (const ab of abridores) {
        if (await ab.count().then((c) => c > 0).catch(() => false)) {
          await ab.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(1000);
          const op = page.getByText(alvo).first();
          if (await op.isVisible({ timeout: 1500 }).catch(() => false)) break;
        }
      }
      await page.waitForTimeout(800);
    }

    // Se chegou aqui e ainda parece a tela de perfil, registra e segue mesmo
    // assim (o dashboard-check adiante decide se deu certo).
    if (await this.pareceTelaPerfil(page)) {
      this.passo('Não consegui confirmar a seleção de perfil — seguindo mesmo assim.');
    }
  }

  /** Heurística: ainda estamos na tela de escolha de perfil? */
  private async pareceTelaPerfil(page: Page): Promise<boolean> {
    const temUsuarioOuPerfil =
      (await page.getByText('Selecione', { exact: false }).count().catch(() => 0)) > 0 ||
      (await page.getByText('perfil', { exact: false }).count().catch(() => 0)) > 0;
    const temDashboard =
      (await page.getByRole('button', { name: 'Incluir contato assistencial' }).count().catch(() => 0)) > 0 ||
      (await page.getByText('ACESSAR', { exact: true }).count().catch(() => 0)) > 0;
    return temUsuarioOuPerfil && !temDashboard;
  }

  // ---- Login (porta fiel de web_automation.py:login) ----------------------
  async login(): Promise<void> {
    if (!this.page) await this.start();
    const page = this.page!;
    this.passo('Abrindo o portal Acesso Saúde...');
    await page.goto(URL_LOGIN);

    // Tela inicial do app pode ter um botão "Entrar" antes do formulário.
    await page.getByRole('button', { name: 'Entrar', exact: true }).click({ timeout: 5000 }).catch(() => {});

    // Sessão já autenticada pode pular o formulário.
    let telaLogin = true;
    try {
      await page.waitForSelector('#username', { timeout: 15_000 });
    } catch {
      telaLogin = false;
    }

    if (telaLogin) {
      await page.waitForSelector('#password');
      this.passo('Preenchendo usuário e senha...');
      // Código MFA expira em ~30s — até 3 tentativas com código novo.
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        await page.fill('#username', this.opts.username);
        await page.fill('#password', this.opts.password);
        await page.click('#entrar');

        // Tela de MFA?
        try {
          await page.waitForSelector('#codigo', { timeout: 8000 });
          this.passo('Validando autenticação em duas etapas (MFA)...');
          if (!this.opts.mfaSecret) throw new Error('Conta exige MFA mas mfa_secret não foi configurado.');
          await page.fill('#codigo', this.gerarMfa());
          await page.click('#prosseguir');
        } catch (e) {
          if (e instanceof Error && e.message.includes('mfa_secret')) throw e;
          // sem tela de MFA — login direto
        }

        // Se o formulário reaparecer, credencial/código rejeitado → tenta de novo.
        await page.waitForTimeout(3000);
        const userVisible = (await page.locator('#username').count()) > 0 && (await page.locator('#username').isVisible().catch(() => false));
        if (userVisible) continue;
        break;
      }
    }

    this.passo('Login aceito, aguardando redirecionamentos do gov.br...');

    // O SSO do gov.br encadeia vários redirects (login → scpa → sso → app).
    // Espera a URL PARAR de mudar antes de tocar na página — assim evitamos o
    // "Execution context was destroyed" que acontecia ao mexer no meio do redirect.
    await this.esperarUrlEstavel(page, 25_000);

    // [DEBUG] Salva screenshot + HTML em DISCO (uma vez) pra inspeção real da
    // tela de perfil. Escrever em disco é mais robusto que console.log (não
    // trunca nem corre com a navegação). Desligado por padrão em produção.
    if (process.env.DEBUG_PERFIL === '1') {
      const dir = process.env.DEBUG_PERFIL_DIR || '.';
      try {
        await page.screenshot({ path: `${dir}/perfil.png`, fullPage: true }).catch(() => {});
        const html = await page.content().catch(() => '');
        await import('node:fs/promises').then((fs) => fs.writeFile(`${dir}/perfil.html`, html, 'utf8')).catch(() => {});
        console.log(`[DEBUG perfil] salvo em ${dir}/perfil.{png,html} | url=${page.url()}`);
      } catch (e) {
        console.log(`[DEBUG perfil] falha ao salvar: ${(e as Error).message.slice(0, 100)}`);
      }
    }

    await this.selecionarPerfilMinisterio(page);

    // ⚠️ REGRA PROVISÓRIA (5 min): reinsiste no trecho perfil → ACESSAR →
    // CMD-COLETA até a tela "Contatos Assistenciais" (botão "Incluir contato
    // assistencial") aparecer, ou estourar PROVISORIO_LOGIN_ATE_CONTATOS_MS.
    // Cada tentativa refaz: seleção de perfil, abrir a nova aba pelo "ACESSAR"
    // e, se cair no login do app, "Entrar"/goto home.
    const prazo = Date.now() + PROVISORIO_LOGIN_ATE_CONTATOS_MS;
    let dashboardOk = false;
    let tentativa = 0;
    while (Date.now() < prazo && !dashboardOk) {
      // Parou/excluiu no meio do login? Aborta JÁ (não deixa fantasma rodando).
      if (this.opts.abortou && await this.opts.abortou().catch(() => false)) {
        throw new LoginAbortadoError('Login interrompido — envio parado/excluído pelo usuário.');
      }
      tentativa++;
      const restanteMin = Math.max(0, Math.ceil((prazo - Date.now()) / 60_000));
      this.passo(`Abrindo CMD-COLETA (tentativa ${tentativa}, até ${restanteMin} min)...`);

      // Reforça a seleção de perfil caso ainda esteja na tela do SCPA.
      await this.selecionarPerfilMinisterio(this.page!).catch(() => {});

      // Portal "Meus Sistemas" → "ACESSAR" abre o CMD-COLETA em nova aba.
      // A conta pode ter VÁRIOS sistemas (ex.: SISCAN + CMD-COLETA). Clica o
      // ACESSAR do CARD do CMD-COLETA — clicar o 1º ACESSAR abriria o sistema
      // errado (SISCAN) e o login nunca chegava no CMD.
      let acessar = page
        .locator('xpath=//*[contains(text(),"CMD-COLETA")]/ancestor::*[.//*[contains(normalize-space(.),"ACESSAR")]][1]')
        .getByText('ACESSAR', { exact: true }).first();
      if (!(await acessar.count().catch(() => 0))) {
        // Só um sistema (CMD-COLETA) → qualquer ACESSAR serve.
        acessar = page.getByText('ACESSAR', { exact: true }).first();
      }
      try {
        const [novaAba] = await Promise.all([
          this.context!.waitForEvent('page', { timeout: 8000 }),
          acessar.click({ timeout: 5000 }),
        ]);
        await novaAba.waitForLoadState();
        this.page = novaAba;
        this.page.setDefaultTimeout(45_000);
        await this.stopScreencast();
        await this.startScreencast();
        await this.page.waitForTimeout(2000);
      } catch {
        /* já no app ou ainda sem o botão ACESSAR — segue */
      }

      // Tela do CMD ("Utilize suas credenciais de operador"): clica UMA vez no
      // botão "Entrar" e ESPERA carregar — NÃO fica reclicando (o laço externo,
      // se precisar, é quem tenta de novo). O botão aparece mesmo sem 'login' na
      // URL, então não dá pra gatear pela URL (bug anterior: nunca clicava aqui).
      const btnEntrar = this.page!.getByRole('button', { name: 'Entrar', exact: true }).first();
      if (await btnEntrar.isVisible({ timeout: 4000 }).catch(() => false)) {
        this.passo('Entrando no CMD-COLETA (clicando em "Entrar")...');
        await btnEntrar.click({ timeout: 8000 }).catch(() => {});
        await this.page!.waitForTimeout(3000);
      } else if (this.page!.url().includes('login')) {
        // Fallback: caiu na tela de login do app → vai direto pra home.
        await this.page!.goto('https://cmd-coleta.saude.gov.br/#/home').catch(() => {});
        await this.page!.waitForTimeout(4000);
      }

      // Espera o dashboard aparecer (espera generosa; o laço externo dá os 5 min).
      dashboardOk = await this.page!.getByRole('button', { name: 'Incluir contato assistencial' })
        .first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);

      if (!dashboardOk) await this.page!.waitForTimeout(2000);
    }

    if (!dashboardOk) {
      // Estourou os 5 min sem chegar na tela de contatos → falha explícita para
      // o retry/relogin de nível superior tratar (em vez de seguir cego).
      throw new Error('Não foi possível chegar à tela "Contatos Assistenciais" em 5 min (regra provisória).');
    }

    await this.dispensarModalSair();
    this.passo('Login concluído — CMD-COLETA aberto.');
  }

  private async dispensarModalSair(): Promise<void> {
    try {
      await this.page?.getByRole('button', { name: 'Não', exact: true }).click({ timeout: 3000 });
    } catch {
      /* sem modal */
    }
  }

  /** Volta para a lista 'Contatos Assistenciais' (estado conhecido) depois de
   * um erro — sem isso, o cadastro do PRÓXIMO paciente também falha, porque ele
   * assume que a página já está na lista antes de clicar em 'Incluir contato'.
   * Porta de recuperar_para_contatos_assistenciais. */
  async recuperarParaContatos(): Promise<void> {
    const page = this.page;
    if (!page) return;
    const listoNaLista = () =>
      page.getByRole('button', { name: 'Incluir contato assistencial' }).first()
        .isVisible({ timeout: 2500 }).catch(() => false);

    // Já está na lista? nada a fazer.
    if (await listoNaLista()) return;

    // 1) Fecha overlays/dropdowns/modais que interceptam cliques (dropdown de
    //    autocomplete aberto, alerta "alterar procedimento", modal "deseja sair").
    await this.confirmarAlterarProcedimento().catch(() => {});
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(200); }
    await this.fecharOverlayAutocomplete().catch(() => {});
    await this.dispensarModalSair();

    // 2) Tenta o caminho normal: clicar no menu "Contatos Assistenciais".
    try {
      await page.getByText('Contatos Assistenciais', { exact: true }).first().click({ timeout: 8000 });
      await page.waitForTimeout(1200);
      await this.dispensarModalSair();
    } catch { /* segue para o fallback */ }
    if (await listoNaLista()) return;

    // 3) Fallback FORTE: navega direto para a home do CMD (reseta qualquer
    //    formulário meio-aberto) — sem depender de menu clicável. Isso evita a
    //    cascata em que um cadastro travado derruba todos os próximos.
    try {
      await page.goto('https://cmd-coleta.saude.gov.br/#/home', { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await this.dispensarModalSair();
      await page.getByText('Contatos Assistenciais', { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
    } catch {
      /* melhor esforço — o retry/relogin externo cobre se ainda não recuperar */
    }
  }

  /** Conta quantos contatos já existem no CMD para este CNS (pesquisando na
   * lista "Contatos Assistenciais"). É a verificação de duplicidade NA FONTE (o
   * próprio CMD), que pega o que o nosso banco não sabe: retry que salvou, lista
   * excluída, cadastro manual. Retorna -1 se não conseguiu pesquisar (aí o
   * chamador NÃO bloqueia, para não travar cadastro legítimo). */
  async contarContatosNoCmd(cns: string): Promise<number> {
    const page = this.page;
    const cnsLimpo = String(cns ?? '').replace(/\D/g, '');
    if (!page || !cnsLimpo) return -1;
    try {
      await this.recuperarParaContatos();
      const busca = page.locator('input[placeholder*="Busque"], input[placeholder*="CPF"], input[placeholder*="CNS"], input[placeholder*="UUID"]').first();
      if (!(await busca.isVisible({ timeout: 6000 }).catch(() => false))) return -1;
      await busca.click({ timeout: 4000 }).catch(() => {});
      await busca.fill('').catch(() => {});
      // ion-searchbar tem debounce e SÓ filtra com eventos reais de teclado —
      // fill() não dispara. Digita char a char e dá Enter (dispara o ionChange).
      await busca.pressSequentially(cnsLimpo, { delay: 60 }).catch(() => {});
      await page.waitForTimeout(700); // debounce 500ms
      await busca.press('Enter').catch(() => {});
      const btn = page.getByRole('button', { name: 'Buscar', exact: true }).first();
      if (await btn.count().catch(() => 0)) await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3500);
      // DEBUG: fotografa + salva HTML da tela de busca para achar o seletor certo.
      if (process.env.DEBUG_BUSCA === '1') {
        const dir = process.env.DEBUG_CADASTRO_DIR || '/tmp/cmddebug';
        await page.screenshot({ path: `${dir}/busca_${cnsLimpo}.png`, fullPage: true }).catch(() => {});
        const html = await page.content().catch(() => '');
        await import('node:fs/promises').then((fs) => fs.writeFile(`${dir}/busca_${cnsLimpo}.html`, html, 'utf8')).catch(() => {});
      }
      // Resultados vêm como CARDS (ion-card). Após filtrar pelo CNS, cada card é
      // um contato do paciente. Conta os cards que contêm o CNS.
      const cards = await page.locator(`ion-card:has-text("${cnsLimpo}"), .card:has-text("${cnsLimpo}")`).count().catch(() => 0);
      const contendo = await page.getByText(cnsLimpo, { exact: false }).count().catch(() => 0);
      const totalCards = await page.locator('ion-card').count().catch(() => 0);
      // DEBUG: amostra do que apareceu na tela após a busca.
      const amostra = (await page.locator('ion-content, body').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 260);
      console.log(`[DEDUP CMD] CNS ${cnsLimpo} cards=${cards} contendo=${contendo} totalCards=${totalCards} | tela: ${amostra}`);
      // Se o filtro funcionou (poucos cards), usa a contagem por CNS; se veio a
      // lista inteira (muitos cards, filtro falhou), NÃO arrisca bloquear (-1).
      if (totalCards > 20 && cards === 0) return -1;
      return Math.max(cards, contendo);
    } catch (e) {
      console.log(`[DEDUP CMD] falha ao pesquisar CNS ${cnsLimpo}: ${(e as Error).message.slice(0, 60)}`);
      return -1;
    }
  }

  /** Clica em 'Sair com segurança' no menu lateral. Porta de logout. */
  async logout(): Promise<void> {
    try {
      await this.page?.getByText('Sair com segurança', { exact: true }).first().click({ timeout: 10_000 });
      await this.page?.waitForTimeout(2000);
    } catch {
      /* já deslogado / sem menu */
    }
  }

  /** Desloga e loga de novo do zero — último recurso quando um erro persiste
   * mesmo após voltar para 'Contatos Assistenciais' (sessão gov.br degradada).
   * Porta de relogar. */
  async relogar(): Promise<void> {
    this.passo('Sessão com problema — saindo e entrando de novo...');
    await this.logout();
    await this.login();
  }

  /** DEBUG: salva screenshot + HTML da tela atual (para diagnosticar qual campo
   * do formulário está travando). Ligado só com DEBUG_CADASTRO=1 no ambiente. */
  async capturarDebug(tag: string): Promise<void> {
    if (process.env.DEBUG_CADASTRO !== '1') return;
    const page = this.page;
    if (!page) return;
    try {
      const dir = process.env.DEBUG_CADASTRO_DIR || '/tmp';
      const safe = tag.replace(/[^\w]/g, '_').slice(0, 30);
      await page.screenshot({ path: `${dir}/cadastro_${safe}.png`, fullPage: true }).catch(() => {});
      const html = await page.content().catch(() => '');
      await import('node:fs/promises').then((fs) => fs.writeFile(`${dir}/cadastro_${safe}.html`, html, 'utf8')).catch(() => {});
      console.log(`[DEBUG cadastro] ${tag} | url=${page.url()} | salvo em ${dir}/cadastro_${safe}.{png,html}`);
    } catch { /* melhor esforço */ }
  }

  // ---- Helpers do formulário (porta fiel de web_automation.py) -------------

  private valorOverride(overrides: Record<string, string> | undefined, campo: string): string | null {
    const v = (overrides || {})[campo];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  /** Espera o modal "Carregando..." aparecer e depois sumir (alguns botões só
   * completam de verdade após esse loop). */
  private async aguardarModalCarregamento(timeoutAparecer = 4000, timeoutDesaparecer = 60_000): Promise<void> {
    const page = this.page!;
    const carregando = page.getByText('Carregando', { exact: false }).first();
    try {
      await carregando.waitFor({ state: 'visible', timeout: timeoutAparecer });
      await carregando.waitFor({ state: 'hidden', timeout: timeoutDesaparecer });
    } catch {
      /* nenhum modal (ou já concluiu rápido) */
    }
    await page.waitForTimeout(500);
  }

  /** Confirma o alerta "Ao alterar o procedimento, os demais campos entre eles
   * os profissionais serão apagados. Deseja continuar?" clicando em "Sim". Ele
   * aparece ao (re)selecionar procedimento/terminologia e, se não for confirmado,
   * fica aberto bloqueando TODO o resto do cadastro (era a causa de 0 cadastros).
   * O profissional apagado é re-preenchido logo em seguida pelo próprio fluxo.
   * Retorna true se tratou um alerta. */
  private async confirmarAlterarProcedimento(): Promise<boolean> {
    const page = this.page!;
    let tratou = false;
    // Pode reaparecer — confirma em laço até sumir (máx 4x).
    for (let i = 0; i < 4; i++) {
      const alerta = page.locator('ion-alert:has-text("alterar o procedimento")').first();
      if (!(await alerta.isVisible({ timeout: 600 }).catch(() => false))) break;
      const sim = alerta.locator('button.alert-button-role-confirm');
      if (await sim.count().catch(() => 0)) await sim.first().click({ timeout: 3000 }).catch(() => {});
      else await alerta.getByRole('button', { name: 'Sim', exact: true }).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      tratou = true;
      console.log(`[TRACE proc] alerta "alterar procedimento" CONFIRMADA (Sim) #${i + 1}`);
    }
    return tratou;
  }

  /** Preenche um campo ng-autocomplete (Angular): digita e clica na sugestão. */
  private async selecionarNgAutocomplete(formcontrolname: string, searchText: string, optionTextContains: string, within?: string): Promise<void> {
    const page = this.page!;
    const scope = within ? page.locator(within) : page;
    const container = scope
      .locator(`ng-autocomplete[formcontrolname="${formcontrolname}"]`)
      .filter({ hasNot: page.locator('input[disabled]') });
    const inputBox = container.locator('input');
    // Um alerta "alterar o procedimento" pendente intercepta o clique — confirma antes.
    await this.confirmarAlterarProcedimento();
    await inputBox.click({ timeout: 20_000 });
    // O próprio clique pode disparar o alerta — confirma e reclica no campo.
    if (await this.confirmarAlterarProcedimento()) {
      await inputBox.click({ timeout: 10_000 }).catch(() => {});
    }
    // Digita e seleciona a sugestão. O servidor do gov às vezes DEMORA a
    // retornar as opções (ex.: "Procedimento Realizado") — se esperar pouco, o
    // campo fica VAZIO (vermelho) e trava o cadastro. Então: espera até ~12s
    // pela sugestão, REDIGITA se não vier, e confirma que o campo foi preenchido.
    const sugestao = container.getByText(optionTextContains, { exact: false }).first();
    let selecionado = false;
    for (let tent = 0; tent < 3 && !selecionado; tent++) {
      // A alerta "alterar o procedimento" pode reaparecer e bloquear a digitação
      // (a busca vai pro vazio e a sugestão nunca vem). Confirma antes de digitar.
      await this.confirmarAlterarProcedimento();
      if (tent > 0) {
        // limpa e redigita
        await inputBox.click({ timeout: 8000 }).catch(() => {});
        await inputBox.press('Control+a').catch(() => {});
        await inputBox.press('Delete').catch(() => {});
        await page.waitForTimeout(300);
      }
      await inputBox.pressSequentially(searchText, { delay: 100 });
      // espera a sugestão aparecer (servidor lento) — até ~12s. Se uma alerta
      // aparecer no meio, confirma e segue esperando.
      let apareceu = false;
      for (let i = 0; i < 120; i++) {
        if ((await sugestao.count().catch(() => 0)) > 0) { apareceu = true; break; }
        if (i % 15 === 14) await this.confirmarAlterarProcedimento();
        await page.waitForTimeout(100);
      }
      if (!apareceu) { await this.confirmarAlterarProcedimento(); continue; } // não veio: trata alerta e redigita
      await sugestao.click({ timeout: 5000 }).catch(() => {});
      // confirma que o campo ficou preenchido de fato
      for (let i = 0; i < 20; i++) {
        if (await inputBox.inputValue().catch(() => '')) { selecionado = true; break; }
        await page.waitForTimeout(100);
      }
    }
    if (!selecionado) {
      throw new Error(`Não foi possível selecionar "${optionTextContains}" em ${formcontrolname} — sugestão não apareceu (servidor do gov lento).`);
    }
    await this.fecharOverlayAutocomplete();
    await page.waitForTimeout(200);
  }

  /** Fecha o dropdown/overlay de sugestões do ng-autocomplete de forma robusta.
   * Esse overlay tem um backdrop invisível de tela cheia que intercepta cliques
   * (ex.: trava o clique no checkbox de OCI) se não for fechado. Fecha por
   * clique FORA (não por Escape); tentamos várias estratégias e confirmamos. */
  private async fecharOverlayAutocomplete(): Promise<void> {
    const page = this.page!;
    const seletores = ['.autocomplete-overlay', '.cdk-overlay-backdrop', 'ion-backdrop'];
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      let algumAberto = false;
      for (const sel of seletores) {
        const ov = page.locator(sel);
        if ((await ov.count()) > 0 && (await ov.first().isVisible().catch(() => false))) {
          algumAberto = true;
          await ov.first().click({ timeout: 1500, force: true }).catch(() => {});
        }
      }
      // Clica num ponto neutro do topo (fora de qualquer campo) e Escape.
      await page.mouse.click(5, 5).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);
      if (!algumAberto) break;
    }
  }

  private async autocompleteComOverride(overrides: Record<string, string> | undefined, campo: string, formcontrolname: string, buscaPadrao: string, matchPadrao: string, within?: string): Promise<void> {
    const valor = this.valorOverride(overrides, campo);
    if (valor) await this.selecionarNgAutocomplete(formcontrolname, valor, valor, within);
    else await this.selecionarNgAutocomplete(formcontrolname, buscaPadrao, matchPadrao, within);
  }

  /** Lê a data de nascimento auto-preenchida pelo CADSUS após a busca por CNS. */
  private async lerDataNascimentoAutoPreenchida(): Promise<Date | null> {
    try {
      const campo = this.page!.locator('ion-input[formcontrolname="dataNascimento"] input');
      if ((await campo.count()) > 0) {
        const valor = await campo.first().inputValue();
        const data = parseDate(valor);
        if (data) return data;
      }
    } catch {
      /* segue sem a data do CADSUS */
    }
    return null;
  }

  /** Idade (anos completos) na data do atendimento, ou null se não há nascimento. */
  private idadeNaData(dataNascimento: Date | null, dataAtendimento: Date): number | null {
    if (!dataNascimento) return null;
    let idade = dataAtendimento.getFullYear() - dataNascimento.getFullYear();
    const antesDoAniversario =
      dataAtendimento.getMonth() < dataNascimento.getMonth() ||
      (dataAtendimento.getMonth() === dataNascimento.getMonth() && dataAtendimento.getDate() < dataNascimento.getDate());
    if (antesDoAniversario) idade--;
    return idade;
  }

  /** Códigos de procedimento conforme a idade na data do atendimento. */
  private calculateProcedureCodes(dataNascimento: Date | null, dataAtendimento: Date): number[] {
    const idade = this.idadeNaData(dataNascimento, dataAtendimento);
    if (idade === null) throw new Error('Data de nascimento ausente — não é possível calcular o procedimento correto.');
    // 0–8 anos: 5 OCIs (inalterado). 9+ anos: 6 OCIs (acrescido o 7 - TESTE ORTÓPTICO).
    return idade <= 8 ? [6, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 7];
  }

  /**
   * CID-10 escolhido pela idade na data do atendimento (regra dos controles):
   * até 8 anos → CID de OCI 0–8; a partir de 9 → CID acima de 9 anos.
   * Sem data de nascimento, assume 9+ (maioria) — o passo de procedimentos, que
   * exige a idade, é quem barra o cadastro se ela realmente faltar.
   * Fallback para 'H53' se os controles não estiverem configurados.
   */
  private cidPorIdade(dataNascimento: Date | null, dataAtendimento: Date): string {
    const idade = this.idadeNaData(dataNascimento, dataAtendimento);
    const cid0a8 = (this.opts.cidOci0a8 || '').trim().toUpperCase() || 'H53';
    const cid9 = (this.opts.cid9Mais || '').trim().toUpperCase() || 'H53';
    return idade !== null && idade <= 8 ? cid0a8 : cid9;
  }

  /** Busca o médico no select 'profissional' e seleciona a opção mais próxima. */
  private async selecionarProfissional(medicoNome: string): Promise<void> {
    // Limpa o registro do conselho ("- CRM AM 10408") — o CMD busca só pelo nome.
    const nome = limparNomeMedico(medicoNome);
    if (!nome) throw new ProfessionalNotFoundError('Nome do médico não foi extraído da ficha (carimbo ilegível ou ausente).');
    const page = this.page!;
    const container = page.locator('app-procedimento').locator('ng-autocomplete[formcontrolname="profissional"]');
    const inputBox = container.locator('input');
    await inputBox.click();
    // Digita da ESQUERDA para a direita (primeiros nomes), não o último sobrenome.
    // Usa os 2 primeiros nomes para filtrar; a escolha final é pelo nome COMPLETO.
    const partes = nome.split(/\s+/).filter(Boolean);
    const termoBusca = partes.slice(0, 2).join(' ') || nome;
    await inputBox.pressSequentially(termoBusca, { delay: 100 });
    await page.waitForTimeout(2000);
    const opcoes = await container.locator('.suggestions-container.is-visible li').allInnerTexts();
    const match = findBestMatch(nome, opcoes);
    if (!match) throw new ProfessionalNotFoundError(`Profissional '${nome}' não foi encontrado na lista do portal. Opções vistas: ${opcoes.join(' | ')}`);
    await container.getByText(match, { exact: false }).first().click();
    await page.waitForTimeout(500);
  }

  /** Preenche e registra um procedimento na aba 'Procedimento realizado'. */
  private async registrarProcedimento(codigoIdx: number | null, patient: PatientData, overrides: Record<string, string>, codigoOverride?: string): Promise<void> {
    const page = this.page!;
    let codigo: string, descricao: string;
    if (codigoOverride) { codigo = codigoOverride; descricao = codigoOverride; }
    else { [codigo, descricao] = PROCEDURE_CODES[codigoIdx!]!; }
    const dataAtendimentoStr = this.valorOverride(overrides, 'data_realizacao') || (patient.dataAtendimento ? fmtDate(patient.dataAtendimento) : '');

    // Limpa qualquer alerta "alterar o procedimento" pendente da iteração anterior.
    await this.confirmarAlterarProcedimento();

    const dataField = page.locator('ion-input[formcontrolname="dataRealizacao"]');
    const dataInput = dataField.locator('input');
    const lupaIcon = dataField.locator('xpath=..').locator('ion-icon');

    // Espera o campo ficar vazio e habilitado (Angular reseta entre procedimentos).
    await dataInput.waitFor({ state: 'visible' });
    for (let i = 0; i < 15; i++) {
      if ((await dataInput.inputValue()) === '' && (await dataInput.isEnabled())) break;
      await page.waitForTimeout(200);
    }
    // Máscara automática insere as "/" sozinha — digita só os dígitos.
    const digitosData = dataAtendimentoStr.replace(/\D/g, '');
    // ion-input exige um ciclo blur→focus antes de aceitar digitação.
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    let ok = false;
    let tentativa = 0;
    for (; tentativa < 4; tentativa++) {
      await dataInput.click();
      await page.waitForTimeout(200);
      if (tentativa > 0) {
        await dataInput.press('Control+a');
        await page.keyboard.press('Delete');
        await page.waitForTimeout(150);
      }
      await dataInput.pressSequentially(digitosData, { delay: 150 });
      await page.waitForTimeout(500);
      const valorDigitado = await dataInput.inputValue();
      if (valorDigitado.replace(/\D/g, '') !== digitosData) {
        await page.locator('body').click({ position: { x: 10, y: 10 } });
        await page.waitForTimeout(400);
        continue;
      }
      await page.waitForTimeout(600);
      if ((await page.getByText('inválida', { exact: false }).count()) > 0) {
        await page.getByRole('button', { name: /^OK$/i }).click();
        await page.waitForTimeout(500);
        continue;
      }
      await lupaIcon.click();
      ok = true;
      break;
    }
    if (!ok) throw new Error(`Não foi possível preencher a Data de Realização corretamente após ${tentativa + 1} tentativas (esperado: ${digitosData}).`);

    // Remove elementos órfãos de carregamento que podem bloquear cliques.
    const loading = page.locator('#validateDataRealizacaoLoad');
    let sumiu = false;
    for (let i = 0; i < 20; i++) {
      if ((await loading.count()) === 0) { sumiu = true; break; }
      await page.waitForTimeout(300);
    }
    if (!sumiu) await page.evaluate("document.querySelectorAll('#validateDataRealizacaoLoad').forEach(el => el.remove())");
    await page.waitForTimeout(300);
    await this.aguardarModalCarregamento(1500);

    const T = (m: string) => console.log(`[TRACE proc ${codigo}] ${m}`);
    T('data ok → financiamento');
    await this.autocompleteComOverride(overrides, 'financiamento', 'financiamento', '01', 'Sistema', 'app-procedimento');
    T('financiamento ok → terminologia');
    await this.autocompleteComOverride(overrides, 'terminologia_procedimento', 'terminologia', 'Tabela SUS', 'Tabela SUS', 'app-procedimento');
    T('terminologia ok → PROCEDIMENTO');
    await this.selecionarNgAutocomplete('procedimentoRealizado', codigo, descricao, 'app-procedimento');
    T('PROCEDIMENTO ok → quantidade');
    const quantidade = this.valorOverride(overrides, 'quantidade') || '1';
    await page.locator('input[formcontrolname="quantidade"]').fill(quantidade);

    const codAutorizacao = this.valorOverride(overrides, 'codigo_autorizacao');
    if (codAutorizacao) await page.locator('input[formcontrolname="codigoAutorizacao"]').fill(codAutorizacao);

    T('quantidade ok → estabelecimento/cbo');
    await this.autocompleteComOverride(overrides, 'estabelecimento_terceiro', 'isEstabelecimentoTerceiro', 'Não', 'Não', 'app-procedimento');
    await this.autocompleteComOverride(overrides, 'cbo', 'cbo', '225265', 'oftalmologista', 'app-procedimento');

    T('cbo ok → profissional');
    const profissional = this.valorOverride(overrides, 'profissional') || patient.medicoNome;
    await this.selecionarProfissional(profissional);
    T('profissional ok → Registrar procedimento');

    const equipe = this.valorOverride(overrides, 'equipe_saude');
    if (equipe) await this.selecionarNgAutocomplete('equipeSaude', equipe, equipe, 'app-procedimento');

    // DIAGNÓSTICO: confere se os campos do procedimento estão realmente
    // preenchidos ANTES de registrar (o usuário viu campos vazios ao vivo).
    const vProc = await page.locator('app-procedimento ng-autocomplete[formcontrolname="procedimentoRealizado"] input').first().inputValue().catch(() => '');
    const vProf = await page.locator('app-procedimento ng-autocomplete[formcontrolname="profissional"] input').first().inputValue().catch(() => '');
    const vQtd = await page.locator('input[formcontrolname="quantidade"]').first().inputValue().catch(() => '');
    T(`CAMPOS antes de registrar → procedimento='${vProc}' profissional='${vProf}' qtd='${vQtd}'`);
    if (!vProc || !vProf) {
      await this.capturarDebug(`proc_vazio_${codigo}`).catch(() => {});
      T('!! CAMPO VAZIO no procedimento — screenshot salvo');
    }
    await page.getByRole('button', { name: 'Registrar procedimento' }).click();
    T('Registrar procedimento CLICADO');
    // O clique pode disparar o alerta "alterar o procedimento" — confirma.
    await this.confirmarAlterarProcedimento();
  }

  // ---- Cadastro de paciente (porta fiel de incluir_contato_assistencial) ---
  async incluirContato(patient: PatientData, dryRun = false): Promise<void> {
    const page = this.page!;
    // CPF/CNS: só números — remove pontos, traços e espaços (ex.: "123.456.789-00"
    // ou CNS com espaços) para não dar erro no campo de busca do CADSUS.
    const cns = String(patient.cns ?? '').replace(/\D/g, '');
    const nome = patient.nome || '';
    const overrides = patient.overrides || {};

    if (!patient.dataAtendimento) {
      throw new Error(`data_atendimento ausente para ${nome || cns} — verifique se a coluna de data foi mapeada no arquivo importado.`);
    }
    // O CID-10 é definido pela idade do paciente (controles: OCI 0–8 vs 9+),
    // não pela coluna de CID da ficha — por isso não bloqueia aqui.
    const dataAtendimentoStr = fmtDate(patient.dataAtendimento);
    const modLabel = patient.modalidade === 'catarata' ? 'CIRURGIA (Catarata)' : 'OCI';
    const T = (m: string) => console.log(`[TRACE cad ${cns}] ${m} | url=${page.url().slice(0, 60)}`);
    this.passo(`Iniciando cadastro [${modLabel}] de ${nome || 'paciente'} (CNS ${cns})...`);

    // Limpa alerta "alterar o procedimento" que possa ter vazado do paciente
    // anterior (fica aberto bloqueando o formulário deste).
    await this.confirmarAlterarProcedimento();
    T('vai clicar "Incluir contato assistencial"');
    // A página tem cópia duplicada do botão (layout mobile/desktop) — .first().
    await page.getByRole('button', { name: 'Incluir contato assistencial' }).first().click();
    T('clicou Incluir → vai marcar radio documentação "Sim"');
    // Confirma que o indivíduo possui documentação.
    await page.getByRole('radio', { name: 'Sim', exact: true }).first().click();
    T('radio Sim ok → busca CNS');

    this.passo(`Buscando paciente pelo CNS ${cns}...`);
    const cnsField = page.locator('ion-input[formcontrolname="cpfCns"] input');
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      await cnsField.fill(cns);
      await page.locator('#cpfSearch').click();
      const naoEncontrado = page.getByText('não encontrado', { exact: false });
      const dataNascCampo = page.locator('ion-input[formcontrolname="dataNascimento"] input');
      // Aguarda até 40s pelo retorno do CADSUS (data de nascimento) ou "não
      // encontrado". O CADSUS às vezes demora; esperar pouco (era 2s) fazia o
      // robô seguir ANTES do paciente carregar → o form de admissão não abria.
      for (let i = 0; i < 400; i++) {
        if ((await naoEncontrado.count()) > 0) break;
        if ((await dataNascCampo.count()) > 0 && (await dataNascCampo.inputValue())) break;
        await page.waitForTimeout(100);
      }
      if ((await page.getByText('não encontrado', { exact: false }).count()) > 0) {
        await page.getByRole('button', { name: /^OK$/i }).click();
        await page.waitForTimeout(1000);
        continue;
      }
      break;
    }

    T('CNS buscado → lê data nasc CADSUS');
    // Usa a data de nascimento do CADSUS (mais confiável que a da ficha).
    const dataNascCadsus = await this.lerDataNascimentoAutoPreenchida();
    if (dataNascCadsus) patient.dataNascimento = dataNascCadsus;

    T('vai clicar Próximo (após CNS)');
    await page.getByRole('button', { name: 'Próximo' }).click();
    T('Próximo clicado → vai clicar Sim (confirmação CNS)');
    await page.getByRole('button', { name: 'Sim' }).last().click({ timeout: 10_000 });
    T('Sim clicado → aguarda form admissão');
    await page.waitForTimeout(2000);

    this.passo('Preenchendo dados de admissão...');
    const dataAdmissaoStr = this.valorOverride(overrides, 'data_admissao') || dataAtendimentoStr;
    T('vai PREENCHER dataAdmissao');
    const admInput = page.locator('ion-input[formcontrolname="dataAdmissao"] input');
    // Espera o campo aparecer. Se NÃO aparecer, fotografa a tela (diagnóstico) e
    // tenta reconfirmar o "Sim" da etapa anterior (a admissão pode não ter aberto).
    let admOk = await admInput.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
    if (!admOk) {
      await this.capturarDebug(`sem_admissao_${cns}`).catch(() => {});
      T('dataAdmissao NÃO apareceu — reconfirma Próximo/Sim');
      await page.getByRole('button', { name: 'Sim' }).last().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      admOk = await admInput.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
    }
    if (!admOk) throw new Error('Formulário de admissão não abriu (campo Data de Admissão não apareceu) — CNS pode não ter carregado.');
    await admInput.fill(dataAdmissaoStr);
    T('dataAdmissao PREENCHIDA ok');
    await page.waitForTimeout(2000);
    await this.aguardarModalCarregamento(1500);

    await this.autocompleteComOverride(overrides, 'modalidade_assistencial', 'modalidadeAssistencial', '07', 'Ambulatorial Especializada');

    // Oferta de Cuidado Integrado (OCI): SÓ marca para a modalidade OCI. Na
    // modalidade CATARATA (FACO), o checkbox NÃO é marcado — resto do fluxo igual.
    if (patient.modalidade !== 'catarata') {
      // Garante que nenhum dropdown aberto (ex.: da Modalidade) esteja
      // interceptando o clique antes de marcar.
      await this.fecharOverlayAutocomplete();
      const ociChk = page.locator('ion-checkbox[formcontrolname="oci"]').first();
      try {
        await ociChk.click({ timeout: 8000 });
      } catch {
        await ociChk.click({ timeout: 5000, force: true });
      }
      try {
        await page.getByRole('button', { name: 'SIM', exact: true }).click({ timeout: 4000 });
        await page.waitForTimeout(1000);
      } catch {
        /* sem modal de confirmação de OCI */
      }
    } else {
      this.passo('Modalidade CATARATA (FACO) — sem OCI.');
      await this.fecharOverlayAutocomplete();
    }

    await this.autocompleteComOverride(overrides, 'procedencia', 'procedencia', '12', 'Demanda Referenciada');
    await this.autocompleteComOverride(overrides, 'carater_atendimento', 'caraterAtendimento', '01', 'Eletivo');
    await this.autocompleteComOverride(overrides, 'motivo_desfecho', 'motivoDesfecho', '01', 'Alta Cl');

    const dataDesfechoStr = this.valorOverride(overrides, 'data_desfecho') || dataAtendimentoStr;
    await page.locator('ion-input[formcontrolname="dataDesfecho"] input').fill(dataDesfechoStr);
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Próximo' }).click();
    await page.getByRole('button', { name: 'Ciente' }).last().click();
    await page.waitForTimeout(1500);

    // Segundo modal não bloqueante: endereço não localizado no CADSUS.
    if ((await page.getByText('Endereço de residência não localizado', { exact: false }).count()) > 0) {
      await page.getByRole('button', { name: 'Ciente' }).last().click();
      await page.waitForTimeout(1500);
    }

    // CID-10 pela idade (controles): usa a data de nascimento do CADSUS (lida
    // acima) para escolher entre "OCI 0–8 anos" e "acima de 9 anos".
    const cid10Valor = this.cidPorIdade(patient.dataNascimento, patient.dataAtendimento);
    const idadePaciente = this.idadeNaData(patient.dataNascimento, patient.dataAtendimento);
    this.passo(`Registrando diagnóstico CID-10 (${cid10Valor}${idadePaciente !== null ? `, ${idadePaciente} anos` : ''})...`);
    await this.autocompleteComOverride(overrides, 'terminologia_diagnostico', 'terminologia', 'CID-10', 'CID-10');
    await this.autocompleteComOverride(overrides, 'classificacao_diagnostico', 'categoria', 'Principal', 'Principal');
    await this.selecionarNgAutocomplete('problemaDiagnostico', cid10Valor, cid10Valor);
    await this.autocompleteComOverride(overrides, 'presenca_admissao', 'presencaAdmissao', 'Sim', 'Sim');
    await page.getByRole('button', { name: 'Registrar' }).click();

    await page.getByRole('button', { name: 'Próximo' }).click();

    this.passo('Registrando procedimentos...');
    const procedimentoOverride = this.valorOverride(overrides, 'procedimento_realizado');
    if (procedimentoOverride) {
      await this.registrarProcedimento(null, patient, overrides, procedimentoOverride);
    } else if (patient.modalidade === 'catarata') {
      // CATARATA: um único procedimento — a FACOEMULSIFICAÇÃO (0405050372).
      await this.registrarProcedimento(null, patient, overrides, CODIGO_CATARATA_FACO);
    } else {
      // OCI (padrão): pacote de procedimentos por idade.
      const codigos = this.calculateProcedureCodes(patient.dataNascimento, patient.dataAtendimento);
      for (const idx of codigos) await this.registrarProcedimento(idx, patient, overrides);
    }

    if (dryRun) {
      this.passo('[DRY RUN] Parando antes de Salvar/Finalizar para revisão.');
      return;
    }

    this.passo(`Salvando e finalizando cadastro de ${nome || 'paciente'}...`);
    T('FINALIZAÇÃO: fotografa form completo e vai clicar Salvar');
    await this.capturarDebug(`antes_salvar_${cns}`).catch(() => {});
    await page.getByRole('button', { name: 'Salvar' }).click({ timeout: 15_000 }).catch(() => {});
    T('Salvar CLICADO → aguarda modal carregando');
    await this.aguardarModalCarregamento();
    // Após Salvar pode aparecer um modal de VALIDAÇÃO (campos faltando) — fotografa.
    await this.capturarDebug(`apos_salvar_${cns}`).catch(() => {});
    const btnFinalizar = page.getByRole('button', { name: 'Finalizar' }).first();
    T('vai clicar Finalizar');
    await btnFinalizar.click({ timeout: 15_000 }).catch(() => {});
    T('Finalizar CLICADO → aguarda modal');
    await this.aguardarModalCarregamento();
    await this.capturarDebug(`apos_finalizar_${cns}`).catch(() => {});
    T('finalização concluída → confirma volta à lista');

    // Confirma que voltou à lista (botão "Incluir contato assistencial" visível).
    // 90s: em horário comercial o gov demora a processar o Salvar/Finalizar —
    // 30s dava "falso-negativo" (marcava erro num cadastro que ia salvar).
    try {
      await page.getByRole('button', { name: 'Incluir contato assistencial' }).first().waitFor({ state: 'visible', timeout: 90_000 });
      T('VOLTOU À LISTA — cadastro OK');
    } catch (e) {
      await this.capturarDebug(`finalizar_falhou_${cns}`).catch(() => {});
      if (await page.getByRole('button', { name: 'Finalizar' }).isVisible({ timeout: 2000 }).catch(() => false)) {
        T('!! Finalizar ainda visível — NÃO registrou');
        throw e; // formulário ainda aberto → não registrado → retry seguro
      }
      // Lista lenta para recarregar, mas o cadastro provavelmente foi enviado.
      T('lista não recarregou mas cadastro provavelmente enviado');
    }
  }
}
