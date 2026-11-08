#!/usr/bin/env bash
# Language Server Protocol (LSP) Pre-Flight & Health Check (Pillar 2)
# Detects the project language and checks what Claude Code needs for symbol navigation
# instead of whole-file reads: the official code intelligence plugin for the language
# (Claude Code keeps its LSP tool off without one) and the language server binary it starts.
# Mapping: https://code.claude.com/docs/en/plugins/code-intelligence

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$PROJECT_ROOT"

# LSP navigation is opt-in: a project installed without it gets no warning about missing parts
INSTALLED_LSP="$(jq -r '.lsp // empty' .claude/context-forge.json 2>/dev/null || true)"
if [ -n "$INSTALLED_LSP" ] && [ "$INSTALLED_LSP" != "native" ]; then
  printf '· [LSP Code Intelligence]: off (opt-in; it costs more on most tasks). Choose it in the installer to turn it on.\n'
  exit 0
fi

DETECTED_LANG=""
PLUGIN=""
BINARY=""
INSTALL_CMD=""

# 1. Detect project stack based on repository marker files
if [ -f "tsconfig.json" ] || [ -f "package.json" ]; then
  DETECTED_LANG="TypeScript/JavaScript"
  PLUGIN="typescript-lsp"
  BINARY="typescript-language-server"
  # TypeScript 7 (the native port) ships no tsserver.js, which typescript-language-server needs
  INSTALL_CMD="npm install -g typescript-language-server typescript@6"
elif [ -f "pyproject.toml" ] || [ -f "requirements.txt" ] || [ -f "setup.py" ]; then
  DETECTED_LANG="Python"
  PLUGIN="pyright-lsp"
  BINARY="pyright-langserver"
  INSTALL_CMD="npm install -g pyright"
elif [ -f "go.mod" ]; then
  DETECTED_LANG="Go"
  PLUGIN="gopls-lsp"
  BINARY="gopls"
  INSTALL_CMD="go install golang.org/x/tools/gopls@latest"
elif [ -f "Cargo.toml" ]; then
  DETECTED_LANG="Rust"
  PLUGIN="rust-analyzer-lsp"
  BINARY="rust-analyzer"
  INSTALL_CMD="rustup component add rust-analyzer"
fi

# Generic or empty boilerplate repository
if [ -z "$DETECTED_LANG" ]; then
  exit 0
fi

# 2. Is the plugin enabled in user, project, or local settings?
SETTINGS_ENABLED=""
for SETTINGS in "$HOME/.claude/settings.json" ".claude/settings.json" ".claude/settings.local.json"; do
  if [ -f "$SETTINGS" ] && jq -e --arg p "$PLUGIN@" \
    '(.enabledPlugins // {}) | to_entries | any(.value == true and (.key | startswith($p)))' \
    "$SETTINGS" >/dev/null 2>&1; then
    SETTINGS_ENABLED="1"
  fi
done

# 3. Is it installed for this folder? Claude Code loads an enabled plugin only once it is
#    installed here (user scope, or local/project scope recorded for this path). Without the
#    claude CLI, trust the settings.
PLUGIN_ENABLED="$SETTINGS_ENABLED"
if command -v claude >/dev/null 2>&1 && LIST="$(claude plugin list --json 2>/dev/null)"; then
  PLUGIN_ENABLED=""
  if printf '%s' "$LIST" | jq -e --arg p "$PLUGIN@" --arg here "$(pwd -P)" \
    'any(.[]; (.id | startswith($p)) and .enabled != false and (.scope == "user" or .projectPath == $here))' \
    >/dev/null 2>&1; then
    PLUGIN_ENABLED="1"
  fi
fi

HAS_BINARY=""
if command -v "$BINARY" >/dev/null 2>&1; then
  HAS_BINARY="1"
  # typescript-language-server also needs a tsserver.js, from the project or global TypeScript
  if [ "$PLUGIN" = "typescript-lsp" ] && [ ! -f node_modules/typescript/lib/tsserver.js ] &&
    [ ! -f "$(npm root -g 2>/dev/null)/typescript/lib/tsserver.js" ]; then
    HAS_BINARY=""
  fi
fi

# 4. Output status & instructions (always exit 0 so it notifies without blocking hooks)
if [ -n "$PLUGIN_ENABLED" ] && [ -n "$HAS_BINARY" ]; then
  printf '✓ [LSP Code Intelligence]: Active (%s via the %s plugin and %s).\n' "$DETECTED_LANG" "$PLUGIN" "$BINARY"
  exit 0
fi

printf '⚠️  [LSP Notice]: %s project detected, but Claude Code LSP navigation is not set up.\n' "$DETECTED_LANG"
if [ -z "$HAS_BINARY" ]; then
  printf '   → Install the language server: %s\n' "$INSTALL_CMD"
fi
if [ -z "$PLUGIN_ENABLED" ] && [ -n "$SETTINGS_ENABLED" ]; then
  printf '   → The %s plugin is enabled in settings but not installed for this folder: claude plugin install %s@claude-plugins-official --scope local\n' "$PLUGIN" "$PLUGIN"
elif [ -z "$PLUGIN_ENABLED" ]; then
  printf '   → Install the code intelligence plugin: claude plugin install %s@claude-plugins-official\n' "$PLUGIN"
fi
exit 0
