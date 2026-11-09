#!/usr/bin/env bash
# Episodic Memory Pre-Flight Check (Pillar 5)
# Verifies that Claude Code Auto-Memory (or local project memory) is enabled
# and ready to capture cross-session learnings without dirtying tracked project files.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$PROJECT_ROOT"

# 0. Auto-compaction: the most specific settings file that sets autoCompactEnabled wins
#    (project local, then project, then user); DISABLE_AUTO_COMPACT overrides them all.
#    Without it a session grows until the window is full: every request re-sends all of it,
#    and models answer less reliably as input grows.
COMPACT=""
for f in .claude/settings.local.json .claude/settings.json "${HOME:-~}/.claude/settings.json"; do
  [ -f "$f" ] || continue
  COMPACT="$(jq -r 'if has("autoCompactEnabled") then (.autoCompactEnabled|tostring) else empty end' "$f" 2>/dev/null || true)"
  if [ -n "$COMPACT" ]; then COMPACT_FILE="$f"; break; fi
done
if [ "${DISABLE_AUTO_COMPACT:-}" = "1" ] || [ "${DISABLE_AUTO_COMPACT:-}" = "true" ]; then
  printf '⚠️  [Auto-Compaction]: off (DISABLE_AUTO_COMPACT is set). Long sessions grow until the window is full, re-sending everything on every request.\n'
elif [ "$COMPACT" = "false" ]; then
  printf '⚠️  [Auto-Compaction]: off (autoCompactEnabled: false in %s). Long sessions grow until the window is full, re-sending everything on every request.\n' "$COMPACT_FILE"
  printf '   → Turn it on for this project only: "autoCompactEnabled": true in .claude/settings.local.json\n'
else
  printf '✓ [Auto-Compaction]: on.\n'
fi

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
