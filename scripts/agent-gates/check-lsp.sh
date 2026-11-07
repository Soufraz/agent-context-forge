#!/usr/bin/env bash
# Language Server Protocol (LSP) Pre-Flight & Health Check (Pillar 2)
# Detects project language and checks if language server binaries are available
# so Claude Code / agents can use fast symbol navigation instead of whole-file reads.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$PROJECT_ROOT"

DETECTED_LANG=""
MISSING_LSP=""
INSTALL_CMD=""
ACTIVE_LSP=""

# 1. Detect project stack based on repository marker files
if [ -f "tsconfig.json" ] || [ -f "package.json" ]; then
  DETECTED_LANG="TypeScript/JavaScript"
  if command -v vtsls >/dev/null 2>&1 || [ -x "node_modules/.bin/vtsls" ]; then
    ACTIVE_LSP="vtsls"
  elif command -v typescript-language-server >/dev/null 2>&1 || [ -x "node_modules/.bin/typescript-language-server" ]; then
    ACTIVE_LSP="typescript-language-server"
  else
    MISSING_LSP="@vtsls/language-server (or typescript-language-server)"
    INSTALL_CMD="npm install -g @vtsls/language-server typescript"
  fi
elif [ -f "pyproject.toml" ] || [ -f "requirements.txt" ] || [ -f "setup.py" ]; then
  DETECTED_LANG="Python"
  if command -v pyright >/dev/null 2>&1; then
    ACTIVE_LSP="pyright"
  elif command -v pylsp >/dev/null 2>&1; then
    ACTIVE_LSP="pylsp"
  else
    MISSING_LSP="pyright"
    INSTALL_CMD="npm install -g pyright"
  fi
elif [ -f "go.mod" ]; then
  DETECTED_LANG="Go"
  if command -v gopls >/dev/null 2>&1; then
    ACTIVE_LSP="gopls"
  else
    MISSING_LSP="gopls"
    INSTALL_CMD="go install golang.org/x/tools/gopls@latest"
  fi
elif [ -f "Cargo.toml" ]; then
  DETECTED_LANG="Rust"
  if command -v rust-analyzer >/dev/null 2>&1; then
    ACTIVE_LSP="rust-analyzer"
  else
    MISSING_LSP="rust-analyzer"
    INSTALL_CMD="rustup component add rust-analyzer"
  fi
fi

# 2. Output status & instructions
if [ -n "$ACTIVE_LSP" ]; then
  printf '✓ [LSP Code Intelligence]: Active (%s via %s). Progressive symbol navigation enabled.\n' "$DETECTED_LANG" "$ACTIVE_LSP"
  exit 0
elif [ -n "$DETECTED_LANG" ]; then
  printf '⚠️  [LSP Notice]: %s project detected, but language server `%s` is not found on PATH.\n' "$DETECTED_LANG" "$MISSING_LSP"
  printf '   To enable instant go-to-definition, symbol queries, and ~70%% token savings, install it:\n'
  printf '   → %s\n' "$INSTALL_CMD"
  # Exit 0 so it notifies without blocking non-interactive hooks
  exit 0
else
  # Generic or empty boilerplate repository
  exit 0
fi
