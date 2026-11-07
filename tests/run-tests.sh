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
echo "[1/5] Checking .claude/settings.json configuration..."
assert_ok "Valid JSON syntax" jq empty .claude/settings.json
assert_ok "LSP flag enabled (Pillar 2)" jq -e '.env.ENABLE_LSP_TOOL == "1"' .claude/settings.json
assert_ok "Token-bomb read denials present (Pillar 2)" jq -e '.permissions.deny | length >= 10' .claude/settings.json
assert_ok "SessionStart, PreToolUse & PreCompact hooks wired" jq -e '.hooks.SessionStart and .hooks.PreToolUse and .hooks.PreCompact' .claude/settings.json

# 2. Validate Environment Doctor (Pillars 2, 3, 5)
echo "[2/5] Checking scripts/agent-gates/doctor.sh..."
DOCTOR_OUT="$("$REPO_ROOT/scripts/agent-gates/doctor.sh")"
assert_ok "doctor.sh exits 0 and produces output" test -n "$DOCTOR_OUT"
assert_ok "check-memory.sh reports Episodic Memory status" grep -q "Episodic Memory" <<<"$DOCTOR_OUT"

# 3. Validate Prefix Stability Fast-Filter (Pillar 1)
echo "[3/5] Checking pre-commit-prefix-stability.sh fast filter..."
FAST_OUT="$(printf '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | "$REPO_ROOT/.claude/hooks/pre-commit-prefix-stability.sh")"
assert_ok "Non-commit Bash command bypasses LLM gate with 0 output" test -z "$FAST_OUT"

# 4. Validate RTK Command Rewriter (Pillar 3)
echo "[4/5] Checking rewrite-rtk.sh command compression hook..."
MOCK_BIN="$(mktemp -d)"
printf '#!/usr/bin/env bash\nexit 0\n' > "$MOCK_BIN/rtk"
chmod +x "$MOCK_BIN/rtk"

REWRITE_OUT="$(printf '{"tool_name":"Bash","tool_input":{"command":"pytest tests/"}}' | PATH="$MOCK_BIN:$PATH" "$REPO_ROOT/.claude/hooks/rewrite-rtk.sh")"
assert_ok "Rewrites standalone 'pytest tests/' to 'rtk pytest tests/'" jq -e '.hookSpecificOutput.updatedInput.command == "rtk pytest tests/"' <<<"$REWRITE_OUT"

PIPE_OUT="$(printf '{"tool_name":"Bash","tool_input":{"command":"pytest tests/ | tee out.log"}}' | PATH="$MOCK_BIN:$PATH" "$REPO_ROOT/.claude/hooks/rewrite-rtk.sh")"
assert_ok "Skips piped commands ('pytest tests/ | tee out.log')" test -z "$PIPE_OUT"
rm -rf "$MOCK_BIN"

# 5. Validate Subagent Isolation Guardrail (Pillar 4) & PreCompact Handover (Pillar 5)
echo "[5/5] Checking guard-subagent-isolation.py & pre-compact-handover.sh..."
TEST_SID="test_suite_$$"
rm -f "/tmp/agent_context_forge/exploration_${TEST_SID}.json"

for i in $(seq 1 9); do
  OUT="$(printf '{"session_id":"%s","tool_name":"Read"}' "$TEST_SID" | "$REPO_ROOT/.claude/hooks/guard-subagent-isolation.py")"
done
assert_ok "Calls 1-9 allowed silently" test -z "$OUT"

OUT_10="$(printf '{"session_id":"%s","tool_name":"Grep"}' "$TEST_SID" | "$REPO_ROOT/.claude/hooks/guard-subagent-isolation.py")"
assert_ok "Call 10 triggers permissionDecision=deny" jq -e '.hookSpecificOutput.permissionDecision == "deny"' <<<"$OUT_10"

printf '{"session_id":"%s","tool_name":"Task"}' "$TEST_SID" | "$REPO_ROOT/.claude/hooks/guard-subagent-isolation.py" >/dev/null
OUT_AFTER_RESET="$(printf '{"session_id":"%s","tool_name":"Read"}' "$TEST_SID" | "$REPO_ROOT/.claude/hooks/guard-subagent-isolation.py")"
assert_ok "Task delegation resets exploration counter" test -z "$OUT_AFTER_RESET"
rm -f "/tmp/agent_context_forge/exploration_${TEST_SID}.json"

COMPACT_OUT="$("$REPO_ROOT/.claude/hooks/pre-compact-handover.sh")"
assert_ok "pre-compact-handover.sh outputs preservation instructions" grep -q "Context Compaction Handover Guardrail" <<<"$COMPACT_OUT"

echo "---------------------------------------------------"
printf 'Passed: %d | Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
