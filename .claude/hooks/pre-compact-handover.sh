#!/usr/bin/env bash
# Claude Code PreCompact Hook: Lossy Compaction Protection (Pillar 5)
#
# Triggered before `/compact` or auto-compaction runs. Captures active Git
# working state and outputs structural preservation instructions so the
# compactor retains exact file paths, active diffs, and architectural rules.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$PROJECT_ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
MODIFIED="$(git status -s 2>/dev/null | head -n 20 || true)"
DIFF_STAT="$(git diff --stat 2>/dev/null | tail -n 10 || true)"

mkdir -p /tmp/agent_context_forge
cat <<EOF > /tmp/agent_context_forge/pre_compact_snapshot.txt
Branch: $BRANCH
Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Modified Files:
${MODIFIED:-  (working tree clean)}
Diff Stat:
${DIFF_STAT:-  (no unstaged diff)}
EOF

cat <<EOF
[Context Compaction Handover Guardrail]
When summarizing this session, DO NOT compress away:
1. Exact file paths and line numbers (file:line) modified or investigated.
2. Unresolved test failures, compiler errors, or root-cause hypotheses.
3. Architectural invariants and user constraints established in this session.
Current Branch: $BRANCH
Active Working Tree State:
${MODIFIED:-  (clean)}
EOF

exit 0
