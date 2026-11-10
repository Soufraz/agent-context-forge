#!/usr/bin/env bash
# Agent Context Forge Environment Doctor
# Runs pre-flight checks for LSP Code Intelligence (Pillar 2),
# RTK Observation Masking (Pillar 3), Episodic Auto-Memory (Pillar 5), and whether the
# folder is a git repository (most protections run at commit time or read changes through git).

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
elif GIT_OUT="$(LC_ALL=C git -C "$GIT_DIR_TO_CHECK" rev-parse --is-inside-work-tree 2>&1)"; then
  printf '✓ [Git]: inside a git repository. Commit-time protections can run.\n'
elif grep -qi 'not a git repository' <<<"$GIT_OUT"; then
  printf '⚠️  [Git Notice]: this folder is not a git repository.\n'
  printf '   The commit gate, the drift check on commit and `.githooks/pre-commit` run at commit time, and the Stop rules read changes through git, so they do nothing until `git init`.\n'
else
  # Any other failure (dubious ownership, git not runnable): do not claim the folder is not a repository
  printf '⚠️  [Git Notice]: git could not confirm a repository here, so commit-time protections may not run.\n'
fi
