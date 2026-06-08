# Aether Code installer — Windows (PowerShell).
#
#   irm https://aethersystems.net/install.ps1 | iex
#
# Installs the `aether` CLI globally via npm, then tells you how to sign in.
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Aether Code needs Node.js >= 20."
  Write-Host "Install it from https://nodejs.org, then re-run."
  exit 1
}

$major = 0
try { $major = [int](node -p "process.versions.node.split('.')[0]") } catch {}
if ($major -lt 20) {
  Write-Host "Aether Code needs Node.js >= 20 (found $(node -v)). Please upgrade."
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "npm not found (it ships with Node.js). Reinstall Node from https://nodejs.org."
  exit 1
}

Write-Host "Installing aether-agent..."
npm install -g aether-agent

Write-Host ""
Write-Host "Aether Code installed."
Write-Host ""
Write-Host "Next:"
Write-Host "  aether auth login     # authorize via aethersystems.net/platform"
Write-Host "  aether                # start coding"
