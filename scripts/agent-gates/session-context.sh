#!/usr/bin/env bash
# Claude Code SessionStart Hook: project facts for Claude, environment warnings for the user.
#
# Gives Claude a few stable facts that save discovery turns, such as how this project runs its
# tests. Warnings from doctor.sh (missing rtk, language server, plugin) go to the user as a
# systemMessage, so they don't cost tokens on every request. The doctor's git notice is left
# out on purpose: it would repeat at every session start with no off switch, and its one-line
# form drops the consequence; the wizard and `doctor.sh` itself still report it.
# The facts contain no paths, dates, or counts, so the prompt prefix stays identical across
# sessions and caches well.

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

FACTS=""
add_fact() {
  FACTS="${FACTS}- $1"$'\n'
}

# Python: a bare `python` often lacks the project's dependencies
if [ -f uv.lock ]; then
  add_fact 'Python: run project tools through uv, for example `uv run pytest`.'
elif [ -x .venv/bin/python ]; then
  add_fact 'Python: use the project virtualenv, for example `.venv/bin/python -m pytest`.'
fi

# JavaScript / TypeScript: the package manager follows the lockfile
if [ -f package.json ]; then
  PM=npm
  [ -f yarn.lock ] && PM=yarn
  [ -f pnpm-lock.yaml ] && PM=pnpm
  { [ -f bun.lock ] || [ -f bun.lockb ]; } && PM=bun
  if jq -e '.scripts.test' package.json >/dev/null 2>&1; then
    add_fact "JavaScript: the package manager is $PM; run tests with \`$PM test\`."
  else
    add_fact "JavaScript: the package manager is $PM."
  fi
fi

[ -f go.mod ] && add_fact 'Go: run tests with `go test ./...`.'
[ -f Cargo.toml ] && add_fact 'Rust: run tests with `cargo test`.'
[ "$(uname -s)" = "Darwin" ] && add_fact "macOS: \`sed -i\` needs an explicit empty suffix, as in \`sed -i '' ...\`."

WARNINGS="$("$SCRIPT_DIR/doctor.sh" 2>/dev/null | grep -E '⚠️|→' | grep -v 'Git Notice' || true)"

jq -n --arg facts "$FACTS" --arg warnings "$WARNINGS" '
  (if $facts != "" then {hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: ("Project facts:\n" + $facts)}} else {} end)
  + (if $warnings != "" then {systemMessage: ("Agent Context Forge:\n" + $warnings)} else {} end)'
