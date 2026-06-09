# Aether Agent installer — Windows (PowerShell).
#
#   irm https://aethersystems.net/install.ps1 | iex
#
# Installs the `aether` CLI globally via npm, then shows next steps.
# Respects NO_COLOR via Write-Host -ForegroundColor.

param()

$ErrorActionPreference = "Stop"

# ── Color support check ──
$noColor = [Environment]::GetEnvironmentVariable("NO_COLOR")
$useColor = (-not $noColor)

# ── Print helpers ──
function Write-Header($text) {
  if ($useColor) { Write-Host $text -ForegroundColor Cyan }
  else { Write-Host $text }
}
function Write-Success($text) {
  if ($useColor) { Write-Host "  ✓ $text" -ForegroundColor Green }
  else { Write-Host "  ✓ $text" }
}
function Write-ErrorMsg($text) {
  if ($useColor) { Write-Host "  ✗ $text" -ForegroundColor Red }
  else { Write-Host "  ✗ $text" }
}
function Write-Info($text) {
  if ($useColor) { Write-Host "  $text" -ForegroundColor DarkGray }
  else { Write-Host "  $text" }
}
function Write-Step($text) {
  if ($useColor) { Write-Host -NoNewline "$text... " -ForegroundColor DarkGray }
  else { Write-Host -NoNewline "$text... " }
}

# ── Cloud glyph (ANSI ice blue, works in Windows Terminal / modern PowerShell) ──
$iceBlue = if ($useColor) { "`e[38;5;117m" } else { "" }
$reset   = if ($useColor) { "`e[0m" } else { "" }
$cyan = if ($useColor) { "`e[38;5;44m" } else { "" }
$bold = if ($useColor) { "`e[1m" } else { "" }
$dim  = if ($useColor) { "`e[90m" } else { "" }
$green2 = if ($useColor) { "`e[32m" } else { "" }
$check = "✓"
$cross = "✗"

Write-Host ""
Write-Host "${iceBlue}                            ▄▄███▄▄   ${reset}"
Write-Host "${iceBlue}                           ▄█████████▄ ${reset}"
Write-Host "${iceBlue}                           ███▄███▄███ ${reset}"
Write-Host "${iceBlue}                           ▀████▄████▀ ${reset}"
Write-Host "${iceBlue}                             ▀ ▀ ▀ ▀   ${reset}"
Write-Host ""

# Box header
Write-Host "${cyan}┌──────────────────────────────────────────────────────────────┐${reset}"
Write-Host "${cyan}│${reset}                                                              ${cyan}│${reset}"
Write-Host "${cyan}│${reset}  ${iceBlue}☁${reset}  ${bold}Aether Agent${reset} — Terminal Coding Agent Installer              ${cyan}│${reset}"
Write-Host "${cyan}│${reset}     ${dim}v0.1.0  ·  aethersystems.net${reset}                              ${cyan}│${reset}"
Write-Host "${cyan}│${reset}                                                              ${cyan}│${reset}"
Write-Host "${cyan}└──────────────────────────────────────────────────────────────┘${reset}"
Write-Host ""

# ── Check Node.js ──
Write-Step "Checking Node.js"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host ""
  Write-ErrorMsg "Node.js not found. Aether Agent needs Node.js >= 20."
  Write-Host ""
  Write-Info "Install it from https://nodejs.org"
  Write-Info "Or with winget: winget install OpenJS.NodeJS.LTS"
  exit 1
}
$nodeVer = (node -v 2>$null) -replace '^v', ''
$nodeMajor = [int]($nodeVer -split '\.')[0]
Write-Success "Node.js v$nodeVer"

if ($nodeMajor -lt 20) {
  Write-ErrorMsg "Node.js >= 20 required (found v$nodeVer). Please upgrade."
  Write-Info "https://nodejs.org/en/download"
  exit 1
}

# ── Check npm ──
Write-Step "Checking npm"
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
  Write-Host ""
  Write-ErrorMsg "npm not found (it ships with Node.js). Reinstall Node from https://nodejs.org."
  exit 1
}
$npmVer = npm -v 2>$null
Write-Success "npm v$npmVer"

# ── Check if already installed ──
$already = $false
$aetherCmd = Get-Command aether -ErrorAction SilentlyContinue
if ($aetherCmd) {
  $already = $true
  try { $aethVer = aether --version 2>$null } catch { $aethVer = "unknown" }
  Write-Info "aether-agent $aethVer already installed — will update to latest."
}

# ── Install ──
Write-Host ""
if ($already) { Write-Step "Updating aether-agent" }
else { Write-Step "Installing aether-agent" }

npm install -g aether-agent 2>&1 | ForEach-Object {
  Write-Host -NoNewline "."  # spinner dots
}
Write-Host ""

if ($LASTEXITCODE -ne 0) {
  Write-ErrorMsg "Install failed. Check your network and npm permissions."
  Write-Host ""
  Write-Info "If you see permission errors, try running PowerShell as Administrator,"
  Write-Info "or install a Node version manager like nvm-windows or fnm."
  exit 1
}

try { $aethFinalVer = aether --version 2>$null } catch { $aethFinalVer = "0.1.0" }
Write-Success "Aether Agent $aethFinalVer installed!"

# ── Verify ──
$aetherCmd2 = Get-Command aether -ErrorAction SilentlyContinue
if (-not $aetherCmd2) {
  Write-ErrorMsg "aether command not found on PATH after install."
  Write-Info "npm global prefix: $(npm config get prefix)"
  Write-Info "Add $(npm config get prefix) to your PATH, or reinstall Node."
  exit 1
}

# ── Next steps box ──
Write-Host ""
Write-Host "${cyan}┌──────────────────────────────────────────────────────────────┐${reset}"
Write-Host "${cyan}│${reset}                                                              ${cyan}│${reset}"
Write-Host "${cyan}│${reset}  ${green2}✓${reset} ${bold}Ready!${reset}  Next: sign in to unlock the full model fleet.       ${cyan}│${reset}"
Write-Host "${cyan}│${reset}                                                              ${cyan}│${reset}"
Write-Host "${cyan}│${reset}    ${bold}${cyan}aether auth login${reset}                                         ${cyan}│${reset}"
Write-Host "${cyan}│${reset}                                                              ${cyan}│${reset}"
Write-Host "${cyan}│${reset}  ${dim}Opens aethersystems.net/platform in your browser.${reset}           ${cyan}│${reset}"
Write-Host "${cyan}│${reset}  ${dim}→ click Approve → you're in.${reset}                                ${cyan}│${reset}"
Write-Host "${cyan}│${reset}                                                              ${cyan}│${reset}"
Write-Host "${cyan}│${reset}  ${dim}Then start coding:${reset}                                           ${cyan}│${reset}"
Write-Host "${cyan}│${reset}    ${dim}aether `"explain src/router.ts`"${reset}                             ${cyan}│${reset}"
Write-Host "${cyan}│${reset}    ${dim}aether agent `"fix the failing tests`"${reset}                        ${cyan}│${reset}"
Write-Host "${cyan}│${reset}    ${dim}aether agent --local `"same, fully offline`"${reset}                   ${cyan}│${reset}"
Write-Host "${cyan}│${reset}                                                              ${cyan}│${reset}"
Write-Host "${cyan}└──────────────────────────────────────────────────────────────┘${reset}"
Write-Host ""
