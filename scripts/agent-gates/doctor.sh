#!/usr/bin/env bash
# Agent Context Forge Environment Doctor
# Runs pre-flight checks for LSP Code Intelligence (Pillar 2),
# RTK Observation Masking (Pillar 3), and Episodic Auto-Memory (Pillar 5).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"$SCRIPT_DIR/check-lsp.sh"
"$SCRIPT_DIR/check-rtk.sh"
"$SCRIPT_DIR/check-memory.sh"

# Git: the commit gate, the drift check on commit and .githooks/pre-commit run when you commit,
# and the Stop rules find changed files through git. Soft check: warns, never fails.
GIT_DIR_TO_CHECK="${CLAUDE_PROJECT_DIR:-$PWD}"
if ! command -v git >/dev/null 2>&1; then
  printf '⚠️  [Git Notice]: `git` is not found on PATH.\n'
  printf '   The commit-time protections and the Stop rules that read changed files through git do nothing without it.\n'
elif git -C "$GIT_DIR_TO_CHECK" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf '✓ [Git]: inside a git repository. Commit-time protections can run.\n'
else
  printf '⚠️  [Git Notice]: this folder is not a git repository.\n'
  printf '   The commit gate, the drift check on commit and `.githooks/pre-commit` run at commit time, and the Stop rules read changes through git, so they do nothing until `git init`.\n'
fi
