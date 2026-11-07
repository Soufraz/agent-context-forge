# Universal Agent Instructions (AGENTS.md — Tier 1)

> **Prefix Stability Rule:** This file is part of the static root prompt prefix. Keep it under 150 lines and never store sprint checklists, issue numbers, or temporary notes here.

## 1. Environment & Verification Commands
- **Run Environment Doctor:** `./scripts/agent-gates/doctor.sh`
- **Run Prefix Stability Audit:** `./.claude/hooks/pre-commit-prefix-stability.sh`

## 2. Context Hygiene Rules
1. **Symbol Navigation Over Full-File Reads:** Use LSP symbol queries whenever available before reading full implementation files.
2. **Compress Noisy Command Output:** Prefix test and build runs with `rtk` (Rust Token Killer) when available to strip passing test output and ANSI noise.
3. **Isolate Deep Exploration:** Delegate multi-file research trajectories (10+ search/read calls) to isolated subagents and return only a concise summary with `file:line` references.
4. **Zero Context Drift:** Every file path or script referenced in `CLAUDE.md`, `AGENTS.md`, or `.claude/` must exist in the repository.

## 3. Key Directories
- `.claude/` — Claude Code settings, hooks, and agent templates.
- `.agents/rules/` — Universal agent rule definitions.
- `.githooks/` — Git hook entrypoints.
- `scripts/agent-gates/` — Environment readiness checks (`doctor.sh`, `check-lsp.sh`, `check-rtk.sh`, `check-memory.sh`).
