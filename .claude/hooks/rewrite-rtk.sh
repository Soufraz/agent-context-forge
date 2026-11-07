#!/usr/bin/env bash
# Claude Code PreToolUse Hook: Transparent RTK Observation Masking (Pillar 3)
#
# When `rtk` (Rust Token Killer) is installed on PATH, automatically prefixes
# noisy standalone test, build, and git inspection commands with `rtk` via
# Claude Code's `updatedInput` protocol.
# If `rtk` is not installed, exits 0 immediately without modifying the command.
#
# The rewrite never approves the command: Claude Code's normal permission rules and
# prompts apply to the rewritten `rtk <cmd>`, because commands such as `npm test` run
# arbitrary project code. If rtk's own Claude Code hook (`rtk init -g`) is configured,
# this hook stands down so commands are not rewritten twice.

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

TOOL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null || true)"
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
if [ -z "$COMMAND" ]; then
  exit 0
fi

# 2. Do not rewrite if already using rtk, multiline, or using pipes/redirects/chains
if [ "$(printf '%s\n' "$COMMAND" | wc -l | tr -d ' ')" -gt 1 ]; then
  exit 0
fi
if printf '%s' "$COMMAND" | grep -qE '^[[:space:]]*rtk([[:space:]]|$)|[|;&><`$]'; then
  exit 0
fi

# 3. Match standalone high-noise test/build/git commands supported by rtk
if printf '%s' "$COMMAND" | grep -qE '^[[:space:]]*(pytest|vitest|jest|cargo[[:space:]]+(test|check|clippy|build)|pnpm[[:space:]]+test|npm[[:space:]]+test|yarn[[:space:]]+test|go[[:space:]]+test|git[[:space:]]+(status|diff|log|show))([[:space:]]|$)'; then
  TRIMMED="$(printf '%s' "$COMMAND" | sed -e 's/^[[:space:]]*//')"
  UPDATED_CMD="rtk $TRIMMED"

  jq -n --arg cmd "$UPDATED_CMD" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: {
        command: $cmd
      }
    }
  }'
fi

exit 0
