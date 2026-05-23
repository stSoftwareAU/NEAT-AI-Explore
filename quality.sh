#!/usr/bin/env bash
set -euo pipefail

# Quality gate for NEAT-AI Explore.
#
# Runs the same checks you want in CI/PR review:
# - Update Deno (best-effort; doesn't fail if Deno is managed by brew/asdf)
# - Format check
# - Lint
# - Type check
# - Tests
#
# Last updated: 21-Dec-2025

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Add common Deno installation paths to PATH if deno is not already available
if ! command -v deno &> /dev/null; then
  if [ -x "$HOME/.deno/bin/deno" ]; then
    export PATH="$HOME/.deno/bin:$PATH"
  fi
fi

echo "==> Deno version"
deno --version

echo ""
echo "==> Updating Deno (best-effort)"
if deno upgrade; then
  echo "Deno upgrade: ok"
else
  echo "Deno upgrade: skipped/failed (continuing)"
fi

echo ""
echo "==> Format (check)"
deno fmt --check

echo ""
echo "==> Lint"
deno lint

echo ""
echo "==> Type check"
# Issue #210 — type-check the whole repo (no path allowlist) so errors under
# docs/ are caught before they can ship.
deno check helpers/ scripts/ tests/ docs/

echo ""
echo "==> Tests"
deno test -A

echo ""
echo "==> OK"


