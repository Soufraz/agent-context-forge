#!/usr/bin/env bash
# Episodic Memory Pre-Flight Check (Pillar 5)
# Verifies that Claude Code Auto-Memory (or local project memory) is enabled
# and ready to capture cross-session learnings without dirtying tracked project files.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$PROJECT_ROOT"

# 1. Check if Auto-Memory is disabled via environment variable
if [ "${CLAUDE_CODE_DISABLE_AUTO_MEMORY:-0}" = "1" ] || [ "${CLAUDE_CODE_DISABLE_AUTO_MEMORY:-0}" = "true" ]; then
  printf '⚠️  [Episodic Memory Notice]: Auto-Memory is disabled via `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.\n'
  printf '   Sessions will not retain debugging insights or corrections across restarts.\n'
  exit 0
fi

# 2. Check if Auto-Memory is explicitly disabled in .claude/settings.json
if [ -f ".claude/settings.json" ]; then
  DISABLED_IN_SETTINGS="$(jq -r '.autoMemoryEnabled // empty' .claude/settings.json 2>/dev/null || true)"
  if [ "$DISABLED_IN_SETTINGS" = "false" ]; then
    printf '⚠️  [Episodic Memory Notice]: Auto-Memory is explicitly set to `false` in `.claude/settings.json`.\n'
    exit 0
  fi
fi

# 3. Check ~/.claude/projects/<slug>/memory state
HOME_DIR="${HOME:-~}"
PROJECT_SLUG="$(echo "$PROJECT_ROOT" | tr '/' '-')"
PROJECT_MEMORY_DIR="$HOME_DIR/.claude/projects/$PROJECT_SLUG/memory"

if [ -d "$PROJECT_MEMORY_DIR" ] && [ -f "$PROJECT_MEMORY_DIR/MEMORY.md" ]; then
  TOPIC_COUNT=$(find "$PROJECT_MEMORY_DIR" -name "*.md" -not -name "MEMORY.md" | wc -l | tr -d ' ')
  printf '✓ [Episodic Memory]: Active (Auto-Memory initialized with %s topic(s) in %s).\n' "$TOPIC_COUNT" "$PROJECT_MEMORY_DIR"
else
  printf '✓ [Episodic Memory]: Ready (Auto-Memory active. Will record observations to ~/.claude/projects/.../memory/).\n'
fi

exit 0
