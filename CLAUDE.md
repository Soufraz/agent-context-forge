# Project Context & Architectural Laws (Tier 1)

> **Prefix Stability Rule:** Keep this file static, concise (< 150 lines), and free of volatile task state (no active issue numbers, dates, or checkboxes) to preserve prompt cache hit rates (>80%).

## 1. Core Stack & Commands
- **Environment Doctor:** `./scripts/agent-gates/doctor.sh`
- **Prefix Stability Gate:** `./.claude/hooks/pre-commit-prefix-stability.sh`
- **Build / Test / Lint:** Run the build, test, and lint scripts the project's package manifest defines rather than ad-hoc commands.

## 2. Context Engineering & Tool Discipline
- **Progressive Disclosure (LSP First):** When the `LSP` tool is available (a code intelligence plugin is installed), prefer its symbol queries (`goToDefinition`, `findReferences`, `documentSymbol`, `workspaceSymbol`) over reading entire files when exploring types, interfaces, or call sites.
- **Observation Masking (`rtk`):** When running test suites, builds, or verbose git inspections, prefer `rtk <command>` (when installed) so passing test noise is collapsed and only actionable failures enter working context.
- **Token-Bomb Avoidance:** Never read lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`), build artifacts (`dist/`, `build/`, `.next/`), or minified bundles into context.
- **Subagent Context Isolation:** Keep the primary session context flat. If an investigation requires 10+ exploratory `Read`, `Grep`, or `Glob` calls, delegate the exploration to a fresh subagent (`Agent` tool) and return only a concise synthesis with exact `file:line` pointers.

## 3. Repository Structure & On-Demand Pointers
- `.claude/settings.json` — Hook bindings (`SessionStart`, `PreToolUse`, `PreCompact`) and token-bomb read denials.
- `.claude/hooks/` — Automated guardrails for prefix stability, subagent isolation, and command compression.
- `scripts/agent-gates/` — Portable environment health checks for LSP, `rtk`, and Episodic Auto-Memory.
- `.agents/rules/` — Portable cross-agent rule definitions.
- `.githooks/` — Standard Git hook wrappers for CLI and IDE commits.

## 4. Coding & Commit Standards
- Write small, focused commits with clear commit messages (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- Update documentation or architectural rules in the same commit when changing repository structure or scripts so context never drifts from code.
