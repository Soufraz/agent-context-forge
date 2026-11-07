#!/usr/bin/env bash
# Hybrid PreToolUse Hook:
# 1. Fast shell filter: exits 0 immediately (0 tokens) if the Bash command is not
#    `git commit`, or if no agent context file has pending changes.
# 2. LLM gate: otherwise runs a read-only `claude -p --model haiku` evaluation, which
#    sends the context files and diff to the model, to enforce Prefix Stability &
#    Cache Optimization rules for any project.

set -euo pipefail

# 1. Read PreToolUse payload from stdin (if invoked by Claude Code hook)
if [ ! -t 0 ]; then
  PAYLOAD="$(cat)"
  if [ -n "$PAYLOAD" ]; then
    TOOL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null || true)"
    COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

    if [ "$TOOL_NAME" != "Bash" ]; then
      exit 0
    fi

    # Only run on `git commit` commands
    if ! printf '%s' "$COMMAND" | grep -qE '(^|[;&|]\s*)git\s+commit\b'; then
      exit 0
    fi
  fi
fi

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$PROJECT_ROOT"

# 2. Skip if the project has no agent context files yet
if [ ! -f "CLAUDE.md" ] && [ ! -f "AGENTS.md" ] && [ ! -d ".claude/agents" ] && [ ! -d ".claude/skills" ]; then
  exit 0
fi

# 3. Skip unless a context path has pending changes (same paths as .githooks/pre-commit).
#    In Claude Code this runs before the command, so `git add ... && git commit` has not
#    staged anything yet: check the working tree as well as the index.
if [ -z "$(git status --porcelain -- CLAUDE.md AGENTS.md .claude .agents 2>/dev/null)" ]; then
  exit 0
fi

# 4. Prefix Stability & Cache Optimization - LLM Audit
read -r -d '' PROMPT << 'EOF' || true
Audit this repository's agent context files (`CLAUDE.md`, `AGENTS.md`, `.claude/agents/`, `.claude/skills/`) and the pending changes (`git diff --cached` and `git diff`) against these Prefix Stability & Cache Optimization rules:

1. Tier 1 Immutability & Compactness (`CLAUDE.md` / `AGENTS.md`):
   - Must stay compact (< 150 lines / ~1,000 tokens) and contain only static, project-wide architecture rules, conventions, commands, and on-demand pointers.
   - Must NOT contain volatile task/sprint state (active issue numbers, calendar deadlines/due dates, `TODO`/`FIXME`/`WIP` notes, or task checkboxes `- [ ]`) that goes stale, crowds out durable rules, and changes the prompt prefix on every edit.

2. Tier 2 Delta-Only & On-Demand Loading (`.claude/agents/` & `.claude/skills/`):
   - Agent and skill files must only define role-specific or skill-specific deltas; they must NOT duplicate rules, commands, or stack descriptions already in `CLAUDE.md` / `AGENTS.md`.
   - Agent frontmatter must NOT eagerly preload general project-wide stack skills that repeat Tier 1 context.

3. Zero Split-Brain Contradictions:
   - Instructions across `CLAUDE.md`, `AGENTS.md`, `.claude/agents/`, and `.claude/skills/` must not contradict each other or any architectural changes in `git diff --cached`.

4. Valid References:
   - Every file path, directory, and CLI script referenced in context files must exist in the repository.

If all rules pass, return {"ok": true, "reason": "Passed"}. If any rule is violated, return {"ok": false, "reason": "<concise list of exact file/line violations to fix before committing>"}.
EOF

SCHEMA='{"type":"object","properties":{"ok":{"type":"boolean"},"reason":{"type":"string"}},"required":["ok","reason"]}'

RESULT="$(claude -p "$PROMPT" \
  --model haiku \
  --no-session-persistence \
  --settings '{"hooks":{}}' \
  --allowedTools "Read,Grep,Glob,Bash(git diff:*)" \
  --output-format json \
  --json-schema "$SCHEMA" 2>/dev/null || true)"

if [ -z "$RESULT" ]; then
  exit 0
fi

# Extract structured output (handles both direct JSON and wrapped .structured_output / .result)
VERDICT="$(printf '%s' "$RESULT" | jq -r '
  if type == "object" and has("ok") then .
  elif type == "object" and (.structured_output | type == "object") then .structured_output
  elif type == "object" and (.result | type == "string") then (.result | fromjson? // {ok: true})
  else {ok: true}
  end
' 2>/dev/null || echo '{"ok":true}')"

OK="$(printf '%s' "$VERDICT" | jq -r 'if .ok == false then "false" else "true" end')"
REASON="$(printf '%s' "$VERDICT" | jq -r '.reason // "Prefix stability check failed."')"

if [ "$OK" != "true" ]; then
  printf 'Pre-commit Prefix Stability Gate blocked this commit:\n%s\n' "$REASON" >&2
  exit 2
fi

exit 0
