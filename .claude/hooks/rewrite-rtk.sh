#!/usr/bin/env bash
# Claude Code PreToolUse Hook: Transparent RTK Observation Masking (Pillar 3)
#
# Delegates to rtk's own Claude Code hook (`rtk hook claude`), which rewrites the commands
# agents actually run, including piped and chained ones: `uv run pytest -q 2>&1 | tail -40`
# becomes `uv run rtk pytest -q 2>&1 | tail -40`. rtk approves a rewrite only when the user's
# own allow rules already match the command, and leaves deny rules to Claude Code.
#
# Exits 0 without output when rtk is missing, or when rtk's hook is already configured in
# settings (`rtk init -g`), so commands are never rewritten twice.

set -euo pipefail

# 1. Fast exit if rtk is not installed or stdin is a terminal
if ! command -v rtk >/dev/null 2>&1 || [ -t 0 ]; then
  exit 0
fi

PAYLOAD="$(cat)"
if [ -z "$PAYLOAD" ]; then
  exit 0
fi

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
if grep -qsE 'rtk hook claude|rtk-rewrite\.sh' \
  "$HOME/.claude/settings.json" \
  "$PROJECT_ROOT/.claude/settings.json" \
  "$PROJECT_ROOT/.claude/settings.local.json"; then
  exit 0
fi

# 2. rtk turns `python -m pytest` into `rtk pytest`, which runs whatever pytest is first on
#    PATH and drops `-m`'s sys.path behaviour, so it can test the wrong environment.
COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
if printf '%s' "$COMMAND" | grep -qE '(^|[^[:alnum:]_./-])(\S*/)?python[0-9.]*[[:space:]]+-m[[:space:]]+pytest'; then
  exit 0
fi

# 3. Let rtk decide the rewrite. Its "no hook installed" notice only checks the global
#    settings, so silence it for this project-level install.
export RTK_SUPPRESS_HOOK_WARNING=1
printf '%s' "$PAYLOAD" | rtk hook claude || true
