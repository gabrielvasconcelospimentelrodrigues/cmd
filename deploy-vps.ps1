# Script de Deploy Automatizado para a VPS (DigitalOcean)
# Execute no terminal do seu computador (PowerShell) com: .\deploy-vps.ps1

$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   Iniciando Deploy de Atualização para a VPS     " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Criar o arquivo compactado localmente
Write-Host "--> Compactando arquivos do projeto (excluindo pastas pesadas)..." -ForegroundColor Yellow
if (Test-Path cmd-saas-update.tar) { Remove-Item cmd-saas-update.tar }
# IMPORTANTE: excluir .env — o servidor tem o SEU próprio .env (com senha do
# Redis etc.). Se o tar incluir os .env locais (de dev, sem senha), o deploy
# SOBRESCREVE os do servidor e quebra a conexão (NOAUTH no Redis → 504).
tar --exclude="node_modules" --exclude=".git" --exclude="dist" --exclude="frontend/dist" --exclude="backend/dist" --exclude=".env" --exclude="backend/.env" --exclude="workers/.env" --exclude="frontend/.env" -cf cmd-saas-update.tar backend workers frontend docker-compose.yml ecosystem.config.cjs

# 2. Upload para a VPS
Write-Host "--> Enviando arquivo para a VPS (IP: 174.138.62.216)..." -ForegroundColor Yellow
scp -o StrictHostKeyChecking=no -i "$env:USERPROFILE\.ssh\id_rsa" cmd-saas-update.tar root@174.138.62.216:/tmp/cmd-saas-update.tar

# 3. Executar extração, compilação e restart dos serviços via SSH
Write-Host "--> Executando compilação e reiniciando serviços na VPS..." -ForegroundColor Yellow
$sshCmd = "tar -xf /tmp/cmd-saas-update.tar -C /var/www/cmd-saas && " +
          "rm /tmp/cmd-saas-update.tar && " +
          "cd /var/www/cmd-saas/backend && npm install && npm run build && " +
          "cd /var/www/cmd-saas/workers && npm install && npm run build && " +
          "pm2 restart all"

ssh -o StrictHostKeyChecking=no -i "$env:USERPROFILE\.ssh\id_rsa" root@174.138.62.216 $sshCmd

# 4. Limpar arquivo local
Remove-Item cmd-saas-update.tar

Write-Host "==================================================" -ForegroundColor Green
Write-Host "    Atualização publicada com sucesso na VPS! 🎉  " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
