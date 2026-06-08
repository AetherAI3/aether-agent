#!/bin/sh
# Aether Code installer — macOS / Linux / WSL.
#
#   curl -fsSL https://aethersystems.net/install.sh | sh
#
# Installs the `aether` CLI globally via npm, then tells you how to sign in.
set -e

if ! command -v node >/dev/null 2>&1; then
  echo "Aether Code needs Node.js >= 20."
  echo "Install it from https://nodejs.org (or your package manager), then re-run."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Aether Code needs Node.js >= 20 (found $(node -v)). Please upgrade."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found (it ships with Node.js). Reinstall Node from https://nodejs.org."
  exit 1
fi

echo "Installing aether-agent…"
npm install -g aether-agent

echo ""
echo "✓ Aether Code installed."
echo ""
echo "Next:"
echo "  aether auth login     # authorize via aethersystems.net/platform"
echo "  aether                # start coding"
