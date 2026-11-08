#!/usr/bin/env bash
# Claude Code PreToolUse Hook (Read): Token-Bomb Protection (Pillar 2)
#
# Blocks reading a lockfile, minified bundle, or source map whole, and tells Claude to search
# it instead. Ranged reads (offset/limit), Grep, and `grep` through Bash stay allowed, which
# `permissions.deny` Read rules can't do: those also block every search of the file.

set -euo pipefail

if [ -t 0 ]; then
  exit 0
fi

PAYLOAD="$(cat)"
FILE_PATH="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
RANGED="$(printf '%s' "$PAYLOAD" | jq -r '(.tool_input.offset != null) or (.tool_input.limit != null)' 2>/dev/null || echo false)"
if [ -z "$FILE_PATH" ] || [ "$RANGED" = "true" ]; then
  exit 0
fi

NAME="$(basename "$FILE_PATH")"
case "$NAME" in
  package-lock.json | npm-shrinkwrap.json | pnpm-lock.yaml | yarn.lock | bun.lock | bun.lockb | \
    Cargo.lock | poetry.lock | uv.lock | Pipfile.lock | Gemfile.lock | composer.lock | go.sum | \
    *.min.js | *.min.css | *.map) ;;
  *) exit 0 ;;
esac

jq -n --arg name "$NAME" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("\($name) is generated, and reading it whole wastes context. Search it instead, for example `grep -n \"<package-or-symbol>\" \($name)`, or Read a specific range with offset and limit.")
  }
}'
