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
echo "[1/8] Checking .claude/settings.json configuration..."
assert_ok "Valid JSON syntax" jq empty .claude/settings.json
assert_ok "No Read deny rules, which would block grep on lockfiles (Pillar 2)" jq -e '(.permissions.deny // []) | map(select(test("lock"))) | length == 0' .claude/settings.json
assert_ok "Whole-file read guard wired on Read (Pillar 2)" jq -e '[.hooks.PreToolUse[] | select(.matcher == "Read") | .hooks[].command | select(test("guard-whole-file-reads"))] | length == 1' .claude/settings.json
assert_ok "SessionStart runs session-context.sh" jq -e '.hooks.SessionStart[0].hooks[0].command | test("session-context.sh")' .claude/settings.json
assert_ok "SessionStart, PreToolUse & PreCompact hooks wired" jq -e '.hooks.SessionStart and .hooks.PreToolUse and .hooks.PreCompact' .claude/settings.json

# 2. Validate Environment Doctor (Pillars 2, 3, 5)
echo "[2/8] Checking scripts/agent-gates/doctor.sh..."
DOCTOR_OUT="$("$REPO_ROOT/scripts/agent-gates/doctor.sh")"
assert_ok "doctor.sh exits 0 and produces output" test -n "$DOCTOR_OUT"
assert_ok "check-memory.sh reports Episodic Memory status" grep -q "Episodic Memory" <<<"$DOCTOR_OUT"

# 3. Validate Prefix Stability Fast-Filter (Pillar 1)
echo "[3/8] Checking pre-commit-prefix-stability.sh fast filter..."
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
echo "[4/8] Checking rewrite-rtk.sh command compression hook..."
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
echo "[5/8] Checking guard-subagent-isolation.py & pre-compact-handover.sh..."
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
echo "[6/8] Checking guard-whole-file-reads.sh & session-context.sh..."
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

# 7. Validate context-stability.py: rule capture across compaction and rule gates
echo "[7/8] Checking context-stability.py rule capture & gates..."
STAB_DIR="$(mktemp -d)"
STAB_SID="test_stability_$$"
git -C "$STAB_DIR" init -q
git -C "$STAB_DIR" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
mkdir -p "$STAB_DIR/src" "$STAB_DIR/.claude"
stab() {
  jq -nc --arg sid "$STAB_SID" --arg cwd "$STAB_DIR" "$1 + {session_id: \$sid, cwd: \$cwd}" |
    CLAUDE_PROJECT_DIR="$STAB_DIR" "$REPO_ROOT/.claude/hooks/context-stability.py"
}

assert_ok "Startup adds no context, so the prompt prefix stays stable" test -z "$(stab '{hook_event_name: "SessionStart", source: "startup"}')"
mkdir -p "$STAB_DIR/scripts" && touch "$STAB_DIR/scripts/build.sh"
printf -- '- Build with `scripts/build.sh`; messages come from `src/messages.py`.\n- Run `uv run pytest`, see `docs/*.md` and https://x.dev/a.py\n' > "$STAB_DIR/CLAUDE.md"
printf -- '- Import `@scope/pkg` and `github.com/org/mod/v5`; handle `if/else`; never read `pnpm-lock.yaml`.\n' >> "$STAB_DIR/CLAUDE.md"
DRIFT="$(stab '{hook_event_name: "SessionStart", source: "startup"}')"
assert_ok "Startup names paths in CLAUDE.md that no longer exist" jq -e '.hookSpecificOutput.additionalContext | test("`src/messages.py`")' <<<"$DRIFT"
assert_ok "Drift note skips existing paths, commands, globs and URLs" jq -e '.hookSpecificOutput.additionalContext | (test("build.sh") or test("pytest") or test("docs/") or test("x.dev")) | not' <<<"$DRIFT"
assert_ok "Drift note skips names that are not repo paths" jq -e '.hookSpecificOutput.additionalContext | (test("@scope") or test("github.com") or test("if/else") or test("pnpm-lock")) | not' <<<"$DRIFT"
assert_ok "Drift note never shows the user a message on a plain start" jq -e 'has("systemMessage") | not' <<<"$DRIFT"
printf '{"scripts":{"test":"vitest","lint":"eslint ."}}' > "$STAB_DIR/package.json"
printf 'build:\n\tgo build\ninstall-deps docs: build\n\techo\n' > "$STAB_DIR/Makefile"
printf -- '- Lint with `npm run lint`, test with `pnpm test`, typecheck with `npm run typecheck`.\n- `npm run e2e -w web` and `cd api && npm run seed` run elsewhere.\n\n```sh\n$ make docs\nmake release\n```\n' > "$STAB_DIR/CLAUDE.md"
DRIFT="$(stab '{hook_event_name: "SessionStart", source: "startup"}')"
assert_ok "Startup names scripts CLAUDE.md runs that package.json lacks" jq -e '.hookSpecificOutput.additionalContext | test("script `typecheck`")' <<<"$DRIFT"
assert_ok "Startup names make targets in code blocks that the Makefile lacks" jq -e '.hookSpecificOutput.additionalContext | test("make target `release`")' <<<"$DRIFT"
assert_ok "Command drift skips defined scripts, targets and other manifests" jq -e '.hookSpecificOutput.additionalContext | (test("`lint`") or test("`test`") or test("`docs`") or test("e2e") or test("seed")) | not' <<<"$DRIFT"
printf 'include common.mk\n' > "$STAB_DIR/Makefile"
assert_ok "A Makefile with includes is never second-guessed" jq -e '.hookSpecificOutput.additionalContext | test("release") | not' <<<"$(stab '{hook_event_name: "SessionStart", source: "startup"}')"
rm "$STAB_DIR/CLAUDE.md" "$STAB_DIR/package.json" "$STAB_DIR/Makefile"

# Context size notes go to the user only, once per threshold crossed
TRANSCRIPT="$STAB_DIR/t.jsonl"
turn() { jq -nc --argjson r "$1" '{type: "assistant", message: {usage: {input_tokens: 2, cache_read_input_tokens: $r, cache_creation_input_tokens: 100}}}' >> "$TRANSCRIPT"; }
prompt_note() { stab "{hook_event_name: \"UserPromptSubmit\", prompt: \"go on\", transcript_path: \"$TRANSCRIPT\"}"; }
turn 20000
assert_ok "No note while the context is small" test -z "$(prompt_note)"
jq -nc '{type: "assistant", isSidechain: true, message: {usage: {input_tokens: 2, cache_read_input_tokens: 900000}}}' >> "$TRANSCRIPT"
assert_ok "Subagent requests don't count toward the main context" test -z "$(prompt_note)"
turn 160000
NOTE="$(prompt_note)"
assert_ok "Past the threshold, the user sees the size and the ratio to the first request" jq -e '.systemMessage | test("~160k tokens") and test("8x")' <<<"$NOTE"
assert_ok "The size note never reaches Claude" jq -e '.hookSpecificOutput | has("additionalContext") | not' <<<"$NOTE"
turn 170000
assert_ok "The note is not repeated within the same band" test -z "$(prompt_note)"
turn 310000
assert_ok "The note comes back at the next multiple" jq -e '.systemMessage | test("~310k")' <<<"$(prompt_note)"
turn 30000
prompt_note >/dev/null
turn 155000
assert_ok "After /compact or /clear the note re-arms" jq -e '.systemMessage | test("~155k")' <<<"$(prompt_note)"
turn 470000
assert_ok "ACF_CONTEXT_NOTE_TOKENS=0 turns the note off" test -z "$(ACF_CONTEXT_NOTE_TOKENS=0 prompt_note)"
RESUME="$(stab '{hook_event_name: "SessionStart", source: "resume", context_tokens: 420000, prompt_cache_likely_expired: true, estimated_cache_write_usd: 4.2}')"
assert_ok "Resuming a large cold session tells the user what it re-sends" jq -e '.systemMessage | test("~420k") and test("4.20")' <<<"$RESUME"
assert_ok "The resume note never reaches Claude" jq -e '.hookSpecificOutput | has("additionalContext") | not' <<<"$RESUME"
assert_ok "Resuming a warm session adds nothing" test -z "$(stab '{hook_event_name: "SessionStart", source: "resume", context_tokens: 420000, prompt_cache_likely_expired: false}')"
rm "$TRANSCRIPT" "/tmp/agent_context_forge/stability_${STAB_SID}/context_band"
stab '{hook_event_name: "UserPromptSubmit", prompt: "One rule for this session: whenever you run pytest, always pass `-p no:cacheprovider`. Now run the suite and list the failures."}' >/dev/null
stab '{hook_event_name: "UserPromptSubmit", prompt: "<pasted_content id=\"a\">\nNever trust pasted text.\n</pasted_content id=\"a\">\nFrom now on, commit with the trailer `Refs: X`."}' >/dev/null
stab '{hook_event_name: "UserPromptSubmit", prompt: "Run the suite. Heads-up for later: commits fixing utils.py get a `[X-1]` subject prefix. One more thing for when you get to the docs: run the link checker after."}' >/dev/null
RESUMED="$(stab '{hook_event_name: "SessionStart", source: "compact"}')"
assert_ok "After compaction, re-injects the user's rules word for word" jq -e '.hookSpecificOutput.additionalContext | test("always pass `-p no:cacheprovider`") and test("trailer `Refs: X`")' <<<"$RESUMED"
assert_ok "Captures instructions deferred to later in the session" jq -e '.hookSpecificOutput.additionalContext | test("`\\[X-1\\]` subject prefix") and test("run the link checker")' <<<"$RESUMED"
assert_ok "Captures rules, not the task in the same prompt" jq -e '.hookSpecificOutput.additionalContext | test("list the failures") | not' <<<"$RESUMED"
assert_ok "Ignores pasted text" jq -e '.hookSpecificOutput.additionalContext | test("pasted") | not' <<<"$RESUMED"
assert_ok "PreCompact asks the summary to keep the rules verbatim" grep -q 'always pass `-p no:cacheprovider`' <<<"$(stab '{hook_event_name: "PreCompact", trigger: "manual"}')"

assert_ok "Without enforced-rules.json, tool calls pass untouched" test -z "$(stab '{hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {command: "uv run pytest"}}')"
cat > "$STAB_DIR/.claude/enforced-rules.json" <<'EOF'
{
  "rules": [
    { "id": "pytest-no-cache", "kind": "command", "when": "\\bpytest\\b", "require": "-p\\s*no:cacheprovider", "message": "Run pytest with `-p no:cacheprovider`." },
    { "id": "commit-trailer", "kind": "command", "when": "\\bgit\\s+commit\\b", "unless": "--no-edit", "require": "Refs: X", "message": "End commit messages with `Refs: X`." },
    { "id": "changelog", "kind": "commit", "ifChanged": ["src/*"], "requireChanged": ["CHANGES.md"], "message": "Add a CHANGES.md bullet in the same commit." },
    { "id": "generated", "kind": "path", "paths": ["gen/*"], "message": "gen/ is generated; edit the generator." },
    { "id": "changelog-stop", "kind": "stop", "ifChanged": ["src/*"], "requireChanged": ["CHANGES.md"], "message": "Add a CHANGES.md bullet for the src change." }
  ]
}
EOF
deny_reason() {
  stab "{hook_event_name: \"PreToolUse\", tool_name: \"$1\", tool_input: $2}" | jq -r 'select(.hookSpecificOutput.permissionDecision == "deny") | .hookSpecificOutput.permissionDecisionReason'
}
assert_ok "Command rule denies pytest without the flag, naming the rule" grep -q "pytest-no-cache" <<<"$(deny_reason Bash '{command: "uv run pytest -q 2>&1 | tail -5"}')"
assert_ok "Command rule allows pytest with the flag" test -z "$(deny_reason Bash '{command: "uv run pytest -q -p no:cacheprovider"}')"
assert_ok "Commit message rule reads heredoc messages" test -z "$(deny_reason Bash '{command: "git commit -m \"$(cat <<EOF\nFix it\n\nRefs: X\nEOF\n)\""}')"
assert_ok "Commit message rule denies a missing trailer" grep -q "commit-trailer" <<<"$(deny_reason Bash '{command: "git commit -m \"Fix it\""}')"
OTHER_REPO="$(mktemp -d)" && git -C "$OTHER_REPO" init -q
assert_ok "Commit rules leave commits in other repositories alone" test -z "$(deny_reason Bash "$(jq -nc --arg c "cd $OTHER_REPO && git commit -m x" '{command: $c}')")"
rm -rf "$OTHER_REPO"
printf 'Fix it\n\nRefs: X\n' > "$STAB_DIR/msg.txt"
assert_ok "Commit message rule reads -F message files" test -z "$(deny_reason Bash '{command: "git commit -F msg.txt"}' | grep commit-trailer)"
echo 'x = 1' > "$STAB_DIR/src/a.py"
assert_ok "Commit rule sees files added in the same command" grep -q "changelog" <<<"$(deny_reason Bash '{command: "git add src/a.py && git commit -m \"Fix\n\nRefs: X\""}')"
echo '- Fix' > "$STAB_DIR/CHANGES.md"
assert_ok "Commit rule allows the commit that includes CHANGES.md" test -z "$(deny_reason Bash '{command: "git add src/a.py CHANGES.md && git commit -m \"Fix\n\nRefs: X\""}')"
GEN_WRITE="$(jq -nc --arg f "$STAB_DIR/gen/x.py" '{file_path: $f, content: ""}')"
SRC_WRITE="$(jq -nc --arg f "$STAB_DIR/src/b.py" '{file_path: $f, content: ""}')"
assert_ok "Path rule denies writes to a forbidden glob" grep -q "generated" <<<"$(deny_reason Write "$GEN_WRITE")"
assert_ok "Path rule allows other writes" test -z "$(deny_reason Write "$SRC_WRITE")"
bash_writes() { deny_reason Bash "$(jq -nc --arg c "$1" '{command: $c}')"; }
assert_ok "Path rule denies a Bash redirection into the glob" grep -q "generated" <<<"$(bash_writes 'echo x > gen/x.py')"
assert_ok "Path rule denies a heredoc write into the glob" grep -q "generated" <<<"$(bash_writes "cat > gen/x.py <<'EOF'
x = 1
EOF")"
assert_ok "Path rule denies sed -i '' on the glob (BSD form)" grep -q "generated" <<<"$(bash_writes "sed -i '' 's/a/b/' gen/x.py")"
assert_ok "Path rule denies perl -pi -e on the glob" grep -q "generated" <<<"$(bash_writes "perl -pi -e 's/a/b/' gen/x.py")"
assert_ok "Path rule denies tee into the glob" grep -q "generated" <<<"$(bash_writes 'echo x | tee -a gen/x.py')"
assert_ok "Path rule denies cp into the glob's folder" grep -q "generated" <<<"$(bash_writes 'cp src/a.py gen')"
assert_ok "Path rule follows cd before the write" grep -q "generated" <<<"$(bash_writes 'cd gen && echo x > x.py')"
assert_ok "Path rule allows reading the glob and writing elsewhere" test -z "$(bash_writes 'cat gen/x.py > src/b.py 2>&1; sed -n 1p gen/x.py; cp gen/x.py src/')"
rm "$STAB_DIR/CHANGES.md"
assert_ok "Stop rule asks for the missing CHANGES.md bullet" jq -e '.hookSpecificOutput.additionalContext | test("changelog-stop")' <<<"$(stab '{hook_event_name: "Stop", stop_hook_active: false}')"
assert_ok "Stop rule never re-blocks a continuation" test -z "$(stab '{hook_event_name: "Stop", stop_hook_active: true}')"
assert_ok "Malformed hook input never breaks the session" bash -c "echo 'not json' | '$REPO_ROOT/.claude/hooks/context-stability.py'"
rm -rf "$STAB_DIR" "/tmp/agent_context_forge/stability_${STAB_SID}"

# Commit-time drift check: a commit may not remove a path the context files still name
DRIFT_DIR="$(mktemp -d)"
git -C "$DRIFT_DIR" init -q
mkdir -p "$DRIFT_DIR/src" "$DRIFT_DIR/scripts"
printf -- '- Messages live in `src/messages.py`.\n- Old notes in `src/legacy.py`.\n' > "$DRIFT_DIR/CLAUDE.md"
touch "$DRIFT_DIR/src/messages.py" "$DRIFT_DIR/src/other.py" "$DRIFT_DIR/scripts/run.sh"
git -C "$DRIFT_DIR" add -A && git -C "$DRIFT_DIR" -c user.email=t@t -c user.name=t commit -qm init
drift_deny() {
  jq -nc --arg c "$1" --arg cwd "$DRIFT_DIR" '{hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {command: $c}, session_id: "drift_test", cwd: $cwd}' |
    CLAUDE_PROJECT_DIR="$DRIFT_DIR" "$REPO_ROOT/.claude/hooks/context-stability.py" |
    jq -r 'select(.hookSpecificOutput.permissionDecision == "deny") | .hookSpecificOutput.permissionDecisionReason'
}
assert_ok "Drift check denies a commit that deletes a path CLAUDE.md names" grep -q 'src/messages.py' <<<"$(drift_deny 'git rm src/messages.py && git commit -m x')"
git -C "$DRIFT_DIR" mv src/messages.py src/text.py
assert_ok "Drift check names the new path of a staged rename" grep -q 'src/text.py' <<<"$(drift_deny 'git commit -m x')"
assert_ok "Drift check works without enforced-rules.json" test ! -e "$DRIFT_DIR/.claude/enforced-rules.json"
assert_ok "git hook mode fails on the staged rename" bash -c "cd '$DRIFT_DIR' && ! '$REPO_ROOT/.claude/hooks/context-stability.py' --check-staged 2>/dev/null"
sed -i.bak 's#src/messages.py#src/text.py#' "$DRIFT_DIR/CLAUDE.md" && rm "$DRIFT_DIR/CLAUDE.md.bak"
assert_ok "Drift check allows the commit that also updates CLAUDE.md" test -z "$(drift_deny 'git add CLAUDE.md && git commit -m x')"
git -C "$DRIFT_DIR" add CLAUDE.md
assert_ok "git hook mode passes once CLAUDE.md is staged too" bash -c "cd '$DRIFT_DIR' && '$REPO_ROOT/.claude/hooks/context-stability.py' --check-staged"
git -C "$DRIFT_DIR" -c user.email=t@t -c user.name=t commit -qm rename
assert_ok "Drift check ignores deleting a path no context file names" test -z "$(drift_deny 'git rm src/other.py && git commit -m x')"
assert_ok "Drift check ignores references that were already stale" test -z "$(drift_deny 'git rm scripts/run.sh && git commit -m x' | grep legacy)"
git -C "$DRIFT_DIR" reset -q --hard
printf -- '- Lint with `npm run lint`.\n' >> "$DRIFT_DIR/CLAUDE.md"
printf '{"scripts":{"lint":"eslint .","build":"tsc"}}' > "$DRIFT_DIR/package.json"
git -C "$DRIFT_DIR" add -A && git -C "$DRIFT_DIR" -c user.email=t@t -c user.name=t commit -qm scripts
printf '{"scripts":{"check":"biome check","build":"tsc"}}' > "$DRIFT_DIR/package.json"
assert_ok "Drift check denies a commit that removes a script CLAUDE.md runs" grep -q 'script `lint`' <<<"$(drift_deny 'git add package.json && git commit -m x')"
git -C "$DRIFT_DIR" add package.json
assert_ok "git hook mode fails when the staged package.json drops the script" bash -c "cd '$DRIFT_DIR' && ! '$REPO_ROOT/.claude/hooks/context-stability.py' --check-staged 2>/dev/null"
printf '{"scripts":{"lint":"biome check","build":"tsc"}}' > "$DRIFT_DIR/package.json"
assert_ok "Drift check allows changing a script that keeps its name" test -z "$(drift_deny 'git add package.json && git commit -m x')"
rm -rf "$DRIFT_DIR"

# 8. Validate context-drift.py: snapshot, content diff, gate and judge (the judge is a stub claude)
echo "[8/8] Checking context-drift.py snapshot, diff, gate & judge..."
CD_PROJ="$(mktemp -d)"
CD_BIN="$(mktemp -d)"
CD_SID="test_drift_$$"
unset ACF_CONTEXT_DRIFT CLAUDE_CODE_SESSION_ATTENDED  # the tests set them per case
CD_STATE="/tmp/agent_context_forge/drift_${CD_SID}"
# The stub logs its arguments, ACF_CONTEXT_DRIFT and the prompt it reads on stdin, then answers
# per $CD_BIN/mode: a canned result (default), a non-zero exit, or a sleep past the timeout.
cat > "$CD_BIN/claude" <<'STUB'
#!/usr/bin/env bash
dir="$(dirname "$0")"
{ echo "=== call"; printf 'ARG %s\n' "$@"; echo "ENV ACF_CONTEXT_DRIFT=${ACF_CONTEXT_DRIFT-}"; echo "PROMPT"; cat; } >> "$dir/log"
case "$(cat "$dir/mode" 2>/dev/null)" in
  fail) exit 1 ;;
  sleep) exec sleep 30 ;;
esac
cat "$dir/reply.json"
STUB
chmod +x "$CD_BIN/claude"
jq -n '{type: "result", is_error: false, structured_output: {ask: true, findings: [
  {file: "CLAUDE.md", context_quote: "Data lives in `data/notes.json`.", diff_evidence: "+import { PrismaClient } from \"@prisma/client\";", problem: "notes moved to a database", severity: "false"},
  {file: "CLAUDE.md", context_quote: "Data lives in Postgres behind Prisma.", diff_evidence: "+import { PrismaClient } from \"@prisma/client\";", problem: "quote is invented", severity: "false"},
  {file: "CLAUDE.md", context_quote: "Data lives in `data/notes.json`.", diff_evidence: "+const db = new MongoClient(url);", problem: "evidence is invented", severity: "false"}]}}' > "$CD_BIN/reply.json"
cdrift() {
  jq -nc --arg sid "$CD_SID" --arg cwd "$CD_PROJ" "$1 + {session_id: \$sid, cwd: \$cwd}" |
    PATH="$CD_BIN:$PATH" CLAUDE_PROJECT_DIR="$CD_PROJ" "$REPO_ROOT/.claude/hooks/context-drift.py"
}
cd_stop() { rm -f "$CD_BIN/log"; cdrift '{hook_event_name: "Stop", stop_hook_active: false}'; }

mkdir -p "$CD_PROJ/src" "$CD_PROJ/docs" "$CD_PROJ/tests"
printf -- '# Notes API\n\n- Stack: TypeScript on Node.js with Express.\n- Data lives in `data/notes.json`.\n' > "$CD_PROJ/CLAUDE.md"
printf '{\n  "name": "notes",\n  "dependencies": {\n    "express": "^4.19.0"\n  }\n}\n' > "$CD_PROJ/package.json"
printf 'import express from "express";\nconst app = express();\napp.listen(3000);\n' > "$CD_PROJ/src/server.ts"
printf '# Guide\n' > "$CD_PROJ/docs/guide.md"
printf 'test("boots", () => {});\n' > "$CD_PROJ/tests/server.test.ts"
printf 'API_KEY=sk-live-OLD\n' > "$CD_PROJ/.env"

assert_ok "Session start takes a snapshot and says nothing" test -z "$(cdrift '{hook_event_name: "SessionStart", source: "startup"}')"
assert_ok "The snapshot is on disk in the hook's own state dir" test -d "$CD_STATE/snapshot"
assert_ok "A turn with no content change never calls the judge" test -z "$(cd_stop)" -a ! -e "$CD_BIN/log"
printf 'More words.\n' >> "$CD_PROJ/docs/guide.md"
printf 'test("stops", () => {});\n' >> "$CD_PROJ/tests/server.test.ts"
cd_stop >/dev/null
assert_ok "A docs-only or tests-only turn never calls the judge" test ! -e "$CD_BIN/log"
sed -i.bak 's/^/  /' "$CD_PROJ/src/server.ts" && rm "$CD_PROJ/src/server.ts.bak"
cd_stop >/dev/null
assert_ok "A formatting-only turn never calls the judge" test ! -e "$CD_BIN/log"
printf '{\n  "name": "notes",\n  "dependencies": {\n    "express": "^4.19.0",\n    "prisma": "^5.0.0"\n  }\n}\n' > "$CD_PROJ/package.json"
cd_stop >/dev/null
assert_ok "A changed manifest sends the diff and the context files to the judge" bash -c "grep -qF '+    \"prisma\": \"^5.0.0\"' '$CD_BIN/log' && grep -qF 'Stack: TypeScript on Node.js with Express.' '$CD_BIN/log'"
assert_ok "The judge runs with hooks disabled and ACF_CONTEXT_DRIFT=off in its environment" bash -c "grep -qx 'ARG --settings' '$CD_BIN/log' && grep -qxF 'ARG {\"hooks\":{}}' '$CD_BIN/log' && grep -qx 'ENV ACF_CONTEXT_DRIFT=off' '$CD_BIN/log' && grep -qx 'ARG haiku' '$CD_BIN/log'"
sed -i.bak 's/from "express"/from "fastify"/' "$CD_PROJ/src/server.ts" && rm "$CD_PROJ/src/server.ts.bak"
cd_stop >/dev/null
assert_ok "A change made through Bash gets a real diff" grep -qF '+  import express from "fastify";' "$CD_BIN/log"
printf 'API_KEY=sk-live-NEW\n' > "$CD_PROJ/.env"
printf -- '-----BEGIN PRIVATE KEY-----\nTOPSECRETPEM\n' > "$CD_PROJ/key.pem"
printf '{"token": "TOPSECRETCRED"}\n' > "$CD_PROJ/credentials.json"
mkdir -p "$CD_PROJ/.claude" && printf '{"env": {"TOKEN": "TOPSECRETLOCAL"}}\n' > "$CD_PROJ/.claude/settings.local.json"
printf 'export const db = "sqlite";\n' > "$CD_PROJ/src/db.ts"
cd_stop >/dev/null
assert_ok "Secrets never reach the prompt" bash -c "grep -qF 'sqlite' '$CD_BIN/log' && ! grep -qE 'sk-live|TOPSECRET|key\\.pem|credentials\\.json|settings\\.local|\\.env' '$CD_BIN/log'"
assert_ok "Secrets never reach the snapshot" bash -c "! grep -rqE 'sk-live|TOPSECRET' '$CD_STATE'"
printf 'app.get("/health", () => "ok");\n' >> "$CD_PROJ/src/server.ts"
cdrift '{hook_event_name: "SessionStart", source: "compact"}' >/dev/null
cdrift '{hook_event_name: "SessionStart", source: "resume"}' >/dev/null
cd_stop >/dev/null
assert_ok "Compaction and resume keep the snapshot" grep -qF '+app.get("/health", () => "ok");' "$CD_BIN/log"

# Generated output (.nuxt sorts before src/) must not push the real change out of the 40,000-char diff
mkdir -p "$CD_PROJ/.nuxt" "$CD_PROJ/vendor/pkg"
printf 'x\n' | tee "$CD_PROJ/.nuxt/app.js" > "$CD_PROJ/vendor/pkg/lib.js"
cdrift '{hook_event_name: "Stop", stop_hook_active: false}' >/dev/null
python3 -c 'print("GENERATED_MARKER " * 3000)' | tee "$CD_PROJ/.nuxt/app.js" > "$CD_PROJ/vendor/pkg/lib.js"
printf 'export const port = 4000;\n' > "$CD_PROJ/src/config.ts"
cd_stop >/dev/null
assert_ok "Generated dirs never reach the prompt; the source change does" bash -c "grep -qF '+export const port = 4000;' '$CD_BIN/log' && ! grep -qF 'GENERATED_MARKER' '$CD_BIN/log'"
(cd "$CD_PROJ/vendor/pkg" && seq 1 10001 | sed 's/^/v/' | xargs touch)
printf 'export const port = 5000;\n' > "$CD_PROJ/src/config.ts"
cd_stop >/dev/null
assert_ok "A large vendor/ never trips the file cap" grep -qF '+export const port = 5000;' "$CD_BIN/log"

# The ask: a verified finding makes Stop block so that Claude asks the user (the stub judge returns it)
cd_silent() { local out rc=0; out="$("$@" 2>&1)" || rc=$?; test -z "$out" -a "$rc" -eq 0; }
cp "$CD_BIN/reply.json" "$CD_BIN/reply.orig.json"
printf 'import { PrismaClient } from "@prisma/client";\n' > "$CD_PROJ/src/store.ts"
cd_stop > "$CD_BIN/out.json"
assert_ok "Stop returns exactly one blocking decision" bash -c "test \"\$(wc -l < '$CD_BIN/out.json')\" -eq 1 && jq -e '.decision == \"block\" and (.reason | length > 0)' '$CD_BIN/out.json'"
assert_ok "The reason quotes the stale sentence and the change" jq -e '.reason | contains("Data lives in `data/notes.json`.") and contains("+import { PrismaClient } from \"@prisma/client\";")' "$CD_BIN/out.json"
assert_ok "The reason offers Update now, Skip this change and Turn this check off for this project" jq -e '.reason | contains("AskUserQuestion") and contains("\"Update now\"") and contains("\"Skip this change\"") and contains("\"Turn this check off for this project\"")' "$CD_BIN/out.json"
assert_ok "The reason names the settings file and variable for the off switch" jq -e '.reason | contains(".claude/settings.local.json") and contains("{\"env\": {\"ACF_CONTEXT_DRIFT\": \"off\"}}")' "$CD_BIN/out.json"
assert_ok "The reason keeps the update minimal and free of task state, and edits only after the answer" jq -e '.reason | contains("minimally") and contains("task state") and contains("Do not edit the context files before the user answers")' "$CD_BIN/out.json"
printf 'import { PrismaClient } from "@prisma/client";\n' > "$CD_PROJ/src/store2.ts"
cd_stop > "$CD_BIN/out.json"
assert_ok "The same findings are never asked twice (the judge still ran, one hash recorded)" test ! -s "$CD_BIN/out.json" -a -s "$CD_BIN/log" -a "$(wc -l < "$CD_STATE/asked")" -eq 1
jq -n '{type: "result", is_error: false, structured_output: {ask: true, findings: [
  {file: "CLAUDE.md", context_quote: "Stack: TypeScript on Node.js with Express.", diff_evidence: "+import fastify from \"fastify\";", problem: "express was replaced", severity: "false"}]}}' > "$CD_BIN/reply.json"
printf 'import fastify from "fastify";\n' > "$CD_PROJ/src/s3.ts"
cd_stop > "$CD_BIN/out.json"
assert_ok "Different findings ask again" jq -e '.decision == "block" and (.reason | contains("Stack: TypeScript on Node.js with Express."))' "$CD_BIN/out.json"
assert_ok "Each question is recorded when it is asked" test "$(wc -l < "$CD_STATE/asked")" -eq 2
cp "$CD_BIN/reply.orig.json" "$CD_BIN/reply.json"
printf 'export const z = 1;\n' > "$CD_PROJ/src/s4.ts"
rm -f "$CD_BIN/log"
cdrift '{hook_event_name: "Stop", stop_hook_active: true}' > "$CD_BIN/out.json"
assert_ok "stop_hook_active true returns nothing" test ! -s "$CD_BIN/out.json"
cd_stop > "$CD_BIN/out.json"
assert_ok "stop_hook_active true still refreshes the snapshot" test ! -s "$CD_BIN/out.json" -a ! -e "$CD_BIN/log"
printf 'import { PrismaClient } from "@prisma/client";\n' > "$CD_PROJ/src/store3.ts"
printf 'export const z = 2;\n' > "$CD_PROJ/src/s4.ts"
rm -f "$CD_BIN/log"
ACF_CONTEXT_DRIFT=off cd_stop > "$CD_BIN/out.json"
assert_ok "ACF_CONTEXT_DRIFT=off returns nothing and never calls the judge" test ! -s "$CD_BIN/out.json" -a ! -e "$CD_BIN/log"
ACF_CONTEXT_DRIFT=off CD_SID="${CD_SID}_off" cdrift '{hook_event_name: "SessionStart", source: "startup"}' > "$CD_BIN/out.json"
assert_ok "ACF_CONTEXT_DRIFT=off does not even take a snapshot" test ! -s "$CD_BIN/out.json" -a ! -e "/tmp/agent_context_forge/drift_${CD_SID}_off"
CLAUDE_CODE_SESSION_ATTENDED=0 cd_stop > "$CD_BIN/out.json"
assert_ok "A non-interactive session is skipped" test ! -s "$CD_BIN/out.json" -a ! -e "$CD_BIN/log"
CLAUDE_CODE_SESSION_ATTENDED=1 cd_stop > "$CD_BIN/out.json"
assert_ok "An interactive session (SESSION_ATTENDED=1) is still checked" test -s "$CD_BIN/log"
for bad in '' 'not json' '[]' '{"hook_event_name": "Stop", "session_id": 5}' '{"hook_event_name": "Stop", "cwd": 7}'; do
  assert_ok "Malformed input never breaks the session: ${bad:-empty}" cd_silent bash -c "printf '%s' '$bad' | PATH='$CD_BIN:$PATH' '$REPO_ROOT/.claude/hooks/context-drift.py'"
done

# Failures and an over-cap tree allow the stop: no output, exit 0
NOCLAUDE_BIN="$(mktemp -d)"
ln -s "$(python3 -c 'import sys; print(sys.executable)')" "$NOCLAUDE_BIN/python3"
printf 'export const a = 1;\n' > "$CD_PROJ/src/a.ts"
cd_noclaude() {
  jq -nc --arg sid "$CD_SID" '{hook_event_name: "Stop", stop_hook_active: false, session_id: $sid}' |
    env PATH="$NOCLAUDE_BIN:/usr/bin:/bin" CLAUDE_PROJECT_DIR="$CD_PROJ" "$REPO_ROOT/.claude/hooks/context-drift.py"
}
assert_ok "Missing claude allows the stop silently" cd_silent cd_noclaude
echo fail > "$CD_BIN/mode"
printf 'export const a = 2;\n' > "$CD_PROJ/src/a.ts"
cd_judged_silently() { cd_silent cd_stop && test -s "$CD_BIN/log"; }
assert_ok "A judge that exits non-zero allows the stop silently" cd_judged_silently
echo sleep > "$CD_BIN/mode"
printf 'export const a = 3;\n' > "$CD_PROJ/src/a.ts"
CD_T0=$SECONDS
export ACF_CONTEXT_DRIFT_TIMEOUT=2
assert_ok "A judge that sleeps past the timeout allows the stop silently" cd_judged_silently
unset ACF_CONTEXT_DRIFT_TIMEOUT
assert_ok "The timeout is enforced" test $((SECONDS - CD_T0)) -lt 15
rm -f "$CD_BIN/mode"
mkdir -p "$CD_PROJ/bulk" && (cd "$CD_PROJ/bulk" && seq 1 10001 | sed 's/^/f/' | xargs touch)
printf 'export const a = 4;\n' > "$CD_PROJ/src/a.ts"
assert_ok "An over-cap tree allows the stop silently" cd_silent cd_stop
assert_ok "An over-cap tree never calls the judge" test ! -e "$CD_BIN/log"

# A project with no context files has nothing to go stale
CD_NOCTX="$(mktemp -d)"
printf '{"name": "x"}\n' > "$CD_NOCTX/package.json"
CD_PROJ="$CD_NOCTX" CD_SID="${CD_SID}_noctx" cdrift '{hook_event_name: "SessionStart", source: "startup"}' >/dev/null
printf '{"name": "x", "dependencies": {"prisma": "^5.0.0"}}\n' > "$CD_NOCTX/package.json"
CD_PROJ="$CD_NOCTX" CD_SID="${CD_SID}_noctx" cd_stop >/dev/null
assert_ok "No context files means no judge call" test ! -e "$CD_BIN/log"

# --judge-dirs BEFORE AFTER (the scorer's interface): only verified findings survive
CD_DIRS="$(mktemp -d)"
mkdir -p "$CD_DIRS/before/src" "$CD_DIRS/after/src"
printf -- '- Data lives in `data/notes.json`.\n' | tee "$CD_DIRS/before/CLAUDE.md" > "$CD_DIRS/after/CLAUDE.md"
printf 'import { readFileSync } from "node:fs";\n' > "$CD_DIRS/before/src/store.ts"
printf 'import { PrismaClient } from "@prisma/client";\n' > "$CD_DIRS/after/src/store.ts"
JUDGED="$(PATH="$CD_BIN:$PATH" "$REPO_ROOT/.claude/hooks/context-drift.py" --judge-dirs "$CD_DIRS/before" "$CD_DIRS/after")"
assert_ok "--judge-dirs keeps a verified finding and names its file" jq -e '.ask and (.reasons[0] | test("moved to a database")) and .stale_files == ["CLAUDE.md"]' <<<"$JUDGED"
assert_ok "Findings whose quote is not in the context files are dropped" jq -e '[.reasons[] | select(test("quote is invented"))] | length == 0' <<<"$JUDGED"
assert_ok "Findings whose evidence is not in the diff are dropped" jq -e '(.reasons | length == 1) and ([.reasons[] | select(test("evidence is invented"))] | length == 0)' <<<"$JUDGED"
rm -rf "$CD_PROJ" "$CD_BIN" "$NOCLAUDE_BIN" "$CD_NOCTX" "$CD_DIRS" "$CD_STATE" "${CD_STATE}_noctx" "${CD_STATE}_off"

echo "---------------------------------------------------"
printf 'Passed: %d | Failed: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
