# Aether Agent installer — Windows (PowerShell).
#
#   irm https://aethersystems.net/install.ps1 | iex
#
# Installs the `aether` CLI globally via npm, then shows next steps.
# Requires Node.js >= 24 and npm on the PATH.

param(
  [switch]$SkipNodeCheck = $false
)

$ErrorActionPreference = "Stop"

# ── Color helpers ──
$cyan  = 11  # BrightCyan  (ANSI 44 ≈ #1aa6b7)
$ice   = 12  # BrightBlue  (ANSI 117 ≈ #87d7ff)
$green = 10  # BrightGreen
$red   = 12  # Red (error — redefined below)
$dim   = 8   # DarkGray

$red_error  = 12
$green_ok   = 10

function Write-Header($msg) { Write-Host $msg -ForegroundColor $cyan }
function Write-Success($msg) { Write-Host "  ✓ " -NoNewline -ForegroundColor $green_ok; Write-Host $msg -ForegroundColor $dim }
function Write-ErrorMsg($msg) { Write-Host "  ✗ " -NoNewline -ForegroundColor $red_error; Write-Host $msg }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor $dim }
function Write-Step($msg) { Write-Host "$msg... " -NoNewline -ForegroundColor $dim }

# ── Cloud glyph ──
function Write-Cloud {
  Write-Host "                            ▄▄███▄▄   " -ForegroundColor $ice
  Write-Host "                           ▄█████████▄ " -ForegroundColor $ice
  Write-Host "                           ███▄███▄███ " -ForegroundColor $ice
  Write-Host "                           ▀████▄████▀ " -ForegroundColor $ice
  Write-Host "                             ▀ ▀ ▀ ▀   " -ForegroundColor $ice
}

# ── Box drawing helper (PowerShell terminal supports Unicode box-drawing) ──
function Write-BoxTop($width = 62) {
  $h  = "─" * ($width - 2)
  Write-Host "┌${h}┐" -ForegroundColor $cyan
}
function Write-BoxBottom($width = 62) {
  $h = "─" * ($width - 2)
  Write-Host "└${h}┘" -ForegroundColor $cyan
}
function Write-BoxLine($text, $width = 62) {
  $inner = $width - 6
  $pad = [Math]::Max(0, $inner - $text.Length)
  Write-Host "│" -NoNewline -ForegroundColor $cyan
  Write-Host "  ${text}" -NoNewline
  Write-Host (" " * $pad + "  ") -NoNewline
  Write-Host "│" -ForegroundColor $cyan
}
function Write-BoxEmpty($width = 62) {
  Write-BoxLine "" $width
}

# ── Banner ──
Write-Host ""
Write-Cloud
Write-Host ""
Write-BoxTop
Write-BoxEmpty
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "  ☁  Aether Agent — Terminal Coding Agent Installer              " -NoNewline
Write-Host "│" -ForegroundColor $cyan
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "     v0.1.0  ·  aethersystems.net                              " -NoNewline -ForegroundColor $dim
Write-Host "│" -ForegroundColor $cyan
Write-BoxEmpty
Write-BoxBottom
Write-Host ""

# ── Check Node.js ──
if (-not $SkipNodeCheck) {
  Write-Step "Checking Node.js"
  $nodePath = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodePath) {
    Write-Host ""
    Write-ErrorMsg "Node.js not found. Aether Agent needs Node.js >= 24."
    Write-Host ""
    Write-Info "Install it from https://nodejs.org"
    Write-Info "  winget install OpenJS.NodeJS.LTS"
    Write-Info "  or download from https://nodejs.org/en/download"
    exit 1
  }
  $nodeVersion = (node -v) -replace '^v', ''
  $nodeMajor = [int]($nodeVersion.Split('.')[0])
  Write-Success "Node.js v${nodeVersion}"

  if ($nodeMajor -lt 24) {
    Write-ErrorMsg "Node.js >= 24 required (found v${nodeVersion}). Please upgrade."
    Write-Info "https://nodejs.org/en/download"
    exit 1
  }
}

# ── Check npm ──
Write-Step "Checking npm"
$npmPath = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmPath) {
  Write-Host ""
  Write-ErrorMsg "npm not found (it ships with Node.js). Reinstall Node from https://nodejs.org."
  exit 1
}
$npmVersion = npm -v 2>$null
Write-Success "npm v${npmVersion}"

# ── Check if already installed ──
$alreadyInstalled = $false
$aetherPath = Get-Command aether -ErrorAction SilentlyContinue
if ($aetherPath) {
  $alreadyInstalled = $true
  Write-Info "aether-agent already installed — will update to latest."
}

# ── Install ──
Write-Host ""
if ($alreadyInstalled) {
  Write-Step "Updating aether-agent"
} else {
  Write-Step "Installing aether-agent"
}

npm install -g aether-agents 2>&1 | ForEach-Object {
  Write-Host "." -NoNewline
}
Write-Host ""

if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
  Write-ErrorMsg "Install failed. Check your network and npm permissions."
  Write-Host ""
  Write-Info "If you see EACCES or permission errors:"
  Write-Info "  1. Run PowerShell as Administrator"
  Write-Info "  2. Or configure npm prefix: npm config set prefix $env:APPDATA\`npm"
  exit 1
}

$aetherPath = Get-Command aether -ErrorAction SilentlyContinue
$aetherVersion = "0.1.0"
if ($aetherPath) {
  try { $aetherVersion = (aether --version 2>$null) } catch {}
}
Write-Success "Aether Agent ${aetherVersion} installed!"

# ── Verify ──
if (-not (Get-Command aether -ErrorAction SilentlyContinue)) {
  Write-ErrorMsg "aether command not found on PATH after install."
  Write-Info "npm global prefix: $(npm config get prefix)"
  Write-Info "Add $(npm config get prefix) to your PATH, or reinstall Node."
  exit 1
}

# ── Next steps box ──
Write-Host ""
Write-BoxTop
Write-BoxEmpty
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "  ✓ " -NoNewline -ForegroundColor $green_ok
Write-Host "Ready!  Next: sign in to unlock the full model fleet.       " -NoNewline
Write-Host "│" -ForegroundColor $cyan
Write-BoxEmpty
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "    " -NoNewline
Write-Host "aether auth login" -NoNewline -ForegroundColor $cyan
Write-Host (" " * 42) -NoNewline
Write-Host "│" -ForegroundColor $cyan
Write-BoxEmpty
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "  Opens aethersystems.net/platform in your browser.           " -NoNewline -ForegroundColor $dim
Write-Host "│" -ForegroundColor $cyan
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "  → click Approve → you're in.                                " -NoNewline -ForegroundColor $dim
Write-Host "│" -ForegroundColor $cyan
Write-BoxEmpty
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "  Then start coding:                                           " -NoNewline -ForegroundColor $dim
Write-Host "│" -ForegroundColor $cyan
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "    " -NoNewline
Write-Host "aether `"explain src/router.ts`"" -NoNewline -ForegroundColor $dim
Write-Host (" " * 28) -NoNewline
Write-Host "│" -ForegroundColor $cyan
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "    " -NoNewline
Write-Host "aether agent `"fix the failing tests`"" -NoNewline -ForegroundColor $dim
Write-Host (" " * 23) -NoNewline
Write-Host "│" -ForegroundColor $cyan
Write-Host "│" -NoNewline -ForegroundColor $cyan
Write-Host "    " -NoNewline
Write-Host "aether agent --local `"same, fully offline`"" -NoNewline -ForegroundColor $dim
Write-Host (" " * 19) -NoNewline
Write-Host "│" -ForegroundColor $cyan
Write-BoxEmpty
Write-BoxBottom
Write-Host ""
