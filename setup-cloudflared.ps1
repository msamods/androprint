# ================================================================
# ANDROPRINT - 1-CLICK CLOUDFLARE TUNNEL INSTALLER FOR WINDOWS
# Developed By : MSA MODS x WhatYouWantKerala
# ================================================================

Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║          ANDROPRINT • CLOUDFLARE TUNNEL SETUP                 ║" -ForegroundColor Cyan
Write-Host "║          Zero Config • Free Public HTTPS Printing             ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    $version = cloudflared --version
    Write-Host "[✔] cloudflared is ALREADY installed: $version" -ForegroundColor Green
    Write-Host ""
    Write-Host "Starting Cloudflare Tunnel to AndroPrint on port 3000..." -ForegroundColor Yellow
    cloudflared tunnel --url http://127.0.0.1:3000
    exit 0
}

Write-Host "[*] Checking winget package manager..." -ForegroundColor Yellow
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "[*] Installing Cloudflare.cloudflared via winget..." -ForegroundColor Cyan
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
} else {
    Write-Host "[*] Downloading cloudflared.exe directly from GitHub..." -ForegroundColor Cyan
    $dest = "$env:LOCALAPPDATA\Microsoft\WindowsApps\cloudflared.exe"
    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Invoke-WebRequest -Uri $url -OutFile $dest
    Write-Host "[✔] Downloaded to $dest" -ForegroundColor Green
}

if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "✔ CLOUDFLARED SUCCESSFULLY INSTALLED!" -ForegroundColor Green
    Write-Host "You can now launch the tunnel directly from the AndroPrint Web Dashboard." -ForegroundColor Cyan
} else {
    Write-Host "Please restart your PowerShell terminal for PATH changes to take effect." -ForegroundColor Yellow
}
