#!/usr/bin/env bash
# Agent Context Forge — Automated Self-Test Suite
# Verifies all 5 Pillars (hooks, gates, JSON config, and state machines).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0

assert_ok() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf '  ✓ %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  ✗ %s\n' "$name" >&2
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Running Agent Context Forge Self-Test Suite ==="

# 1. Validate .claude/settings.json structure
echo "[1/6] Checking .claude/settings.json configuration..."
assert_ok "Valid JSON syntax" jq empty .claude/settings.json
assert_ok "No Read deny rules, which would block grep on lockfiles (Pillar 2)" jq -e '(.permissions.deny // []) | map(select(test("lock"))) | length == 0' .claude/settings.json
assert_ok "Whole-file read guard wired on Read (Pillar 2)" jq -e '[.hooks.PreToolUse[] | select(.matcher == "Read") | .hooks[].command | select(test("guard-whole-file-reads"))] | length == 1' .claude/settings.json
assert_ok "SessionStart runs session-context.sh" jq -e '.hooks.SessionStart[0].hooks[0].command | test("session-context.sh")' .claude/settings.json
assert_ok "SessionStart, PreToolUse & PreCompact hooks wired" jq -e '.hooks.SessionStart and .hooks.PreToolUse and .hooks.PreCompact' .claude/settings.json

# 2. Validate Environment Doctor (Pillars 2, 3, 5)
echo "[2/6] Checking scripts/agent-gates/doctor.sh..."
DOCTOR_OUT="$("$REPO_ROOT/scripts/agent-gates/doctor.sh")"
assert_ok "doctor.sh exits 0 and produces output" test -n "$DOCTOR_OUT"
assert_ok "check-memory.sh reports Episodic Memory status" grep -q "Episodic Memory" <<<"$DOCTOR_OUT"

# 3. Validate Prefix Stability Fast-Filter (Pillar 1)
echo "[3/6] Checking pre-commit-prefix-stability.sh fast filter..."
FAST_OUT="$(printf '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | "$REPO_ROOT/.claude/hooks/pre-commit-prefix-stability.sh")"
assert_ok "Non-commit Bash command bypasses LLM gate with 0 output" test -z "$FAST_OUT"

# `git commit` reaches the model only when a context file has pending changes
GATE_REPO="$(mktemp -d)"
GATE_BIN="$(mktemp -d)"
printf '#!/usr/bin/env bash\ntouch "%s/called"\necho %s\n' "$GATE_BIN" "'{\"ok\":true,\"reason\":\"Passed\"}'" > "$GATE_BIN/claude"
chmod +x "$GATE_BIN/claude"
git -C "$GATE_REPO" init -q
printf '# Rules\n' > "$GATE_REPO/CLAUDE.md"
printf 'x\n' > "$GATE_REPO/app.txt"
git -C "$GATE_REPO" add -A
git -C "$GATE_REPO" -c user.email=t@t -c user.name=t commit -qm init
COMMIT_PAYLOAD='{"tool_name":"Bash","tool_input":{"command":"git add -A && git commit -m wip"}}'

printf 'y\n' >> "$GATE_REPO/app.txt"
printf '%s' "$COMMIT_PAYLOAD" | PATH="$GATE_BIN:$PATH" CLAUDE_PROJECT_DIR="$GATE_REPO" "$REPO_ROOT/.claude/hooks/pre-commit-prefix-stability.sh" >/dev/null
assert_ok "Commit without context changes skips the model call" test ! -e "$GATE_BIN/called"

printf -- '- New rule\n' >> "$GATE_REPO/CLAUDE.md"
# A commit in another repository is not this project's commit, even with CLAUDE.md dirty here
OTHER_REPO="$(mktemp -d)"
git -C "$OTHER_REPO" init -q
for other_commit in "cd $OTHER_REPO && git add -A && git commit -m x" "git -C $OTHER_REPO commit -m x"; do
  jq -nc --arg c "$other_commit" --arg cwd "$GATE_REPO" '{tool_name: "Bash", cwd: $cwd, tool_input: {command: $c}}' |
    PATH="$GATE_BIN:$PATH" CLAUDE_PROJECT_DIR="$GATE_REPO" "$REPO_ROOT/.claude/hooks/pre-commit-prefix-stability.sh" >/dev/null
done
assert_ok "Commit in another repository skips the model call" test ! -e "$GATE_BIN/called"
printf '%s' "$COMMIT_PAYLOAD" | PATH="$GATE_BIN:$PATH" CLAUDE_PROJECT_DIR="$GATE_REPO" "$REPO_ROOT/.claude/hooks/pre-commit-prefix-stability.sh" >/dev/null
assert_ok "Commit with unstaged CLAUDE.md change runs the model audit" test -e "$GATE_BIN/called"
rm -rf "$GATE_REPO" "$GATE_BIN" "$OTHER_REPO"

# 4. Validate RTK Command Rewriter (Pillar 3)
echo "[4/7] Checking rewrite-rtk.sh command compression hook..."
MOCK_BIN="$(mktemp -d)"
# Emulates `rtk hook claude`: prefixes the command with rtk
cat > "$MOCK_BIN/rtk" <<'EOF'
#!/usr/bin/env bash
if [ "$1 $2" = "hook claude" ]; then
  jq -c '{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: {command: ("rtk " + .tool_input.command)}}}'
fi
EOF
chmod +x "$MOCK_BIN/rtk"

RTK_HOME="$(mktemp -d)"
RTK_PROJECT="$(mktemp -d)"
REAL_RTK="$(command -v rtk || true)"
payload() {
  jq -nc --arg c "$1" --arg cwd "$RTK_PROJECT" '{tool_name: "Bash", tool_input: {command: $c}, hook_event_name: "PreToolUse", cwd: $cwd}'
}
rewrite() {
  payload "$1" | HOME="$RTK_HOME" CLAUDE_PROJECT_DIR="$RTK_PROJECT" PATH="$MOCK_BIN:$PATH" "$REPO_ROOT/.claude/hooks/rewrite-rtk.sh"
}

REWRITE_OUT="$(rewrite 'pytest tests/')"
assert_ok "Delegates the rewrite to rtk's own hook" jq -e '.hookSpecificOutput.updatedInput.command == "rtk pytest tests/"' <<<"$REWRITE_OUT"

PYM_OUT="$(rewrite '.venv/bin/python -m pytest -q')"
assert_ok "Leaves 'python -m pytest' alone (rtk would run a different pytest)" test -z "$PYM_OUT"

mkdir -p "$RTK_HOME/.claude"
printf '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"rtk hook claude"}]}]}}' > "$RTK_HOME/.claude/settings.json"
NATIVE_OUT="$(rewrite 'pytest tests/')"
assert_ok "Stands down when rtk's own hook (rtk init -g) is configured" test -z "$NATIVE_OUT"
rm -f "$RTK_HOME/.claude/settings.json"

if [ -n "$REAL_RTK" ]; then
  REAL_OUT="$(payload 'uv run pytest -q 2>&1 | tail -40' | HOME="$RTK_HOME" CLAUDE_PROJECT_DIR="$RTK_PROJECT" "$REPO_ROOT/.claude/hooks/rewrite-rtk.sh")"
  assert_ok "Real rtk rewrites piped test commands" jq -e '.hookSpecificOutput.updatedInput.command == "uv run rtk pytest -q 2>&1 | tail -40"' <<<"$REAL_OUT"
  assert_ok "Real rtk does not auto-approve without an allow rule" jq -e '.hookSpecificOutput | has("permissionDecision") | not' <<<"$REAL_OUT"
else
  echo "  - skipped real rtk checks (rtk not installed)"
fi
rm -rf "$MOCK_BIN" "$RTK_HOME" "$RTK_PROJECT"

# 5. Validate Subagent Isolation Guardrail (Pillar 4) & PreCompact Handover (Pillar 5)
echo "[5/6] Checking guard-subagent-isolation.py & pre-compact-handover.sh..."
TEST_SID="test_suite_$$"
rm -f "/tmp/agent_context_forge/exploration_${TEST_SID}.json"

guard() {
  jq -nc --arg sid "$TEST_SID" --arg tool "$1" --arg cmd "${2:-}" --arg agent "${3:-}" \
    '{session_id: $sid, tool_name: $tool, tool_input: {command: $cmd}} + (if $agent != "" then {agent_id: $agent} else {} end)' |
    "$REPO_ROOT/.claude/hooks/guard-subagent-isolation.py"
}

# Subagent tool calls carry agent_id: they must never be counted
for i in $(seq 1 20); do
  SUB_OUT="$(guard Read '' agent-test)"
  [ -z "$SUB_OUT" ] || break
done
assert_ok "Subagent calls (agent_id) are never counted" test -z "$SUB_OUT"

for i in $(seq 1 7); do guard Read >/dev/null; done
for i in $(seq 1 5); do guard Bash 'grep -rn foo .' >/dev/null; done
guard Bash 'uv run pytest -q' >/dev/null
OUT="$(guard Bash 'cd src && grep -n bar x.py')"
assert_ok "Calls 1-13 pass silently; a test run is not counted" test -z "$OUT"

guard Read >/dev/null
OUT_15="$(guard Glob)"
assert_ok "Call 15 adds a note" jq -e '.hookSpecificOutput.additionalContext | test("Context Isolation Guardrail")' <<<"$OUT_15"
assert_ok "The note never blocks the call" jq -e '.hookSpecificOutput | has("permissionDecision") | not' <<<"$OUT_15"

for i in $(seq 1 14); do OUT="$(guard Read)"; done
OUT_30="$(guard Read)"
assert_ok "Guardrail re-arms and adds the note again on call 30" jq -e '.hookSpecificOutput.additionalContext' <<<"$OUT_30"

for i in $(seq 1 14); do guard Read >/dev/null; done
guard Agent >/dev/null
OUT_AFTER_RESET="$(guard Read)"
assert_ok "Agent delegation resets exploration counter" test -z "$OUT_AFTER_RESET"
rm -f "/tmp/agent_context_forge/exploration_${TEST_SID}.json"

COMPACT_OUT="$("$REPO_ROOT/.claude/hooks/pre-compact-handover.sh")"
assert_ok "pre-compact-handover.sh outputs preservation instructions" grep -q "Context Compaction Handover Guardrail" <<<"$COMPACT_OUT"

# 6. Validate whole-file read guard (Pillar 2) & session facts
echo "[6/6] Checking guard-whole-file-reads.sh & session-context.sh..."
read_guard() {
  printf '%s' "$1" | "$REPO_ROOT/.claude/hooks/guard-whole-file-reads.sh"
}
assert_ok "Blocks reading a lockfile whole" jq -e '.hookSpecificOutput.permissionDecision == "deny"' <<<"$(read_guard '{"tool_input":{"file_path":"/repo/pnpm-lock.yaml"}}')"
assert_ok "Allows a ranged read of a lockfile" test -z "$(read_guard '{"tool_input":{"file_path":"/repo/pnpm-lock.yaml","offset":40,"limit":20}}')"
assert_ok "Allows reading source files" test -z "$(read_guard '{"tool_input":{"file_path":"/repo/src/app.ts"}}')"

FACTS_DIR="$(mktemp -d)"
touch "$FACTS_DIR/uv.lock"
printf '{"scripts":{"test":"vitest"}}' > "$FACTS_DIR/package.json"
touch "$FACTS_DIR/pnpm-lock.yaml"
FACTS_OUT="$(CLAUDE_PROJECT_DIR="$FACTS_DIR" "$REPO_ROOT/scripts/agent-gates/session-context.sh")"
assert_ok "Session facts name the Python test command" jq -e '.hookSpecificOutput.additionalContext | test("uv run pytest")' <<<"$FACTS_OUT"
assert_ok "Session facts name the JS package manager" jq -e '.hookSpecificOutput.additionalContext | test("pnpm test")' <<<"$FACTS_OUT"
assert_ok "Session facts contain no paths" jq -e --arg d "$FACTS_DIR" '.hookSpecificOutput.additionalContext | contains($d) | not' <<<"$FACTS_OUT"
rm -rf "$FACTS_DIR"

echo "---------------------------------------------------"
printf 'Passed: %d | Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
