# Script de Deploy Automatizado para a VPS (DigitalOcean)
# Execute no terminal do seu computador (PowerShell) com: .\deploy-vps.ps1

$ErrorActionPreference = "Stop"

# ATENÇÃO: $ErrorActionPreference NÃO interrompe executável externo (scp.exe,
# ssh.exe, tar). Sem checar $LASTEXITCODE à mão, o script seguia até o fim e
# imprimia "publicado com sucesso" mesmo com 'Permission denied (publickey)' —
# ou seja, anunciava deploy que nunca aconteceu. Daí a função abaixo.
function Assert-Ok($passo) {
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "==================================================" -ForegroundColor Red
        Write-Host "   DEPLOY ABORTADO — falhou em: $passo" -ForegroundColor Red
        Write-Host "   (codigo de saida $LASTEXITCODE) NADA foi publicado." -ForegroundColor Red
        Write-Host "==================================================" -ForegroundColor Red
        if (Test-Path cmd-saas-update.tar) { Remove-Item cmd-saas-update.tar }
        exit 1
    }
}

$REPO = Split-Path -Parent $MyInvocation.MyCommand.Path
# Aceita ed25519 (preferida) ou a rsa antiga — assim o deploy funciona tanto
# nesta maquina quanto na que ja tinha a chave original.
$CHAVE = @("$env:USERPROFILE\.ssh\id_ed25519", "$env:USERPROFILE\.ssh\id_rsa") |
         Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $CHAVE) { $CHAVE = "$env:USERPROFILE\.ssh\id_ed25519" }

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   Iniciando Deploy de Atualização para a VPS     " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 0. Pré-requisitos, ANTES de compactar qualquer coisa.
if (-not (Test-Path $CHAVE)) {
    Write-Host "--> Chave SSH nao encontrada em: $CHAVE" -ForegroundColor Red
    Write-Host "    Sem ela o servidor recusa a conexao (Permission denied (publickey))." -ForegroundColor Red
    Write-Host "    Rode o deploy na maquina que tem a chave, ou gere um par novo e" -ForegroundColor Red
    Write-Host "    autorize a chave publica no authorized_keys do root da VPS." -ForegroundColor Red
    exit 1
}

# O tar empacota os ARQUIVOS DO DISCO, nao o que esta no GitHub: sem atualizar
# o repositorio antes, o deploy publica a versao antiga sem reclamar de nada.
# O -c safe.directory cobre repositorio em disco externo (NTFS sem dono).
git -c safe.directory="$REPO" fetch origin --quiet 2>$null
if ($LASTEXITCODE -eq 0) {
    # Entre aspas: solto, o '..' viraria o operador de intervalo do PowerShell.
    $intervalo = 'HEAD..@{u}'
    $atras = git -c safe.directory="$REPO" rev-list --count $intervalo 2>$null
    $sujo = git -c safe.directory="$REPO" status --porcelain 2>$null
    if ($atras -and [int]$atras -gt 0) {
        Write-Host "--> ATENCAO: este diretorio esta $atras commit(s) ATRAS do remoto." -ForegroundColor Yellow
        Write-Host "    Publicar agora enviaria codigo antigo. Rode 'git pull' primeiro." -ForegroundColor Yellow
        $r = Read-Host "    Continuar mesmo assim? (digite SIM para prosseguir)"
        if ($r -ne "SIM") { Write-Host "Deploy cancelado." -ForegroundColor Yellow; exit 1 }
    }
    if ($sujo) {
        Write-Host "--> Aviso: ha alteracoes locais nao commitadas; elas VAO junto no deploy." -ForegroundColor Yellow
    }
}

# 1. Criar o arquivo compactado localmente
Write-Host "--> Compactando arquivos do projeto (excluindo pastas pesadas)..." -ForegroundColor Yellow
if (Test-Path cmd-saas-update.tar) { Remove-Item cmd-saas-update.tar }
# IMPORTANTE: excluir .env — o servidor tem o SEU próprio .env (com senha do
# Redis etc.). Se o tar incluir os .env locais (de dev, sem senha), o deploy
# SOBRESCREVE os do servidor e quebra a conexão (NOAUTH no Redis → 504).
tar --exclude="node_modules" --exclude=".git" --exclude="dist" --exclude="frontend/dist" --exclude="backend/dist" --exclude=".env" --exclude="backend/.env" --exclude="workers/.env" --exclude="frontend/.env" -cf cmd-saas-update.tar backend workers frontend docker-compose.yml ecosystem.config.cjs
Assert-Ok "compactacao (tar)"

# 2. Upload para a VPS
Write-Host "--> Enviando arquivo para a VPS (IP: 174.138.62.216)..." -ForegroundColor Yellow
scp -o StrictHostKeyChecking=no -i "$CHAVE" cmd-saas-update.tar root@174.138.62.216:/tmp/cmd-saas-update.tar
Assert-Ok "envio do pacote (scp)"

# 3. Executar extração, compilação e restart dos serviços via SSH
Write-Host "--> Executando compilação e reiniciando serviços na VPS..." -ForegroundColor Yellow
$sshCmd = "tar -xf /tmp/cmd-saas-update.tar -C /var/www/cmd-saas && " +
          "rm /tmp/cmd-saas-update.tar && " +
          "cd /var/www/cmd-saas/backend && npm install && npm run build && " +
          "cd /var/www/cmd-saas/workers && npm install && npm run build && " +
          "pm2 restart all"

ssh -o StrictHostKeyChecking=no -i "$CHAVE" root@174.138.62.216 $sshCmd
Assert-Ok "build e restart na VPS (ssh)"

# 4. Limpar arquivo local
Remove-Item cmd-saas-update.tar

Write-Host "==================================================" -ForegroundColor Green
Write-Host "    Atualização publicada com sucesso na VPS! 🎉  " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
