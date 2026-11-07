<div align="center">

# 🛠️ Agent Context Forge

**An open-source CLI auditor and context-engineering harness that stops AI coding agents from busting prompt caches, reading 80k-token lockfiles, and polluting their own context window.**

[![Context Engineering](https://img.shields.io/badge/Architecture-5%20Pillars-success)](#the-5-pillars-under-the-hood)
[![Engine Support](https://img.shields.io/badge/Engine-Claude%20Code%20%7C%20Universal%20Git-blue)](#portability--roadmap)
[![Zero Telemetry](https://img.shields.io/badge/Privacy-100%25%20Local%20%26%20Zero%20Telemetry-brightgreen)](#license)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## ⚡ Quickstart (One Command)

Run directly inside **any existing repository** (to audit context health) or an **empty directory** (to scaffold a new project):

```bash
npx agent-context-forge
```

* **In an existing codebase:** Audits your repository across the 5 Pillars of Context Engineering in `< 2 seconds` and opens a self-contained, dark-mode **HTML Context Health Dashboard** in your browser.
* **In an empty folder (or when installing):** Launches an interactive stack wizard to configure native LSP symbol navigation, [`rtk`](https://github.com/rtk-ai/rtk) test output compression, runaway exploration guardrails, episodic memory, and optional SDD rules.

---

## 💥 Why AI Coding Agents Degrade Mid-Session

When an AI coding agent starts a session, it feels sharp. Thirty minutes later, it forgets architectural rules, hallucinates file paths, and burns through API limits.

The root cause rarely lies in the model weights—it is **unmanaged context entropy**:

| Failure Mode | What Happens by Default | How `agent-context-forge` Fixes It |
| :--- | :--- | :--- |
| **1. Prompt Cache Thrashing** | Storing sprint checklists (`- [ ]`), issue IDs (`#123`), or `TODO`s in `CLAUDE.md` invalidates the provider's KV prefix cache on every edit. | **Pillar 1 (Prefix Stability):** Enforces a frozen `< 150 line` Tier-1 prefix and blocks volatile state or broken path references via a pre-commit gate. |
| **2. Lockfile & Full-File Token Bombs** | A single stray `Read` on `pnpm-lock.yaml`, `Cargo.lock`, or `dist/` dumps **30,000–100,000 tokens** of noise into working memory. | **Pillar 2 (Progressive Disclosure):** Enables native compiler LSP (`ENABLE_LSP_TOOL=1`) for ~50ms symbol jumps + hard `permissions.deny` rules on token-bomb files. |
| **3. Test & Build Output Floods** | Running `pytest`, `vitest`, or `cargo test` dumps hundreds of passing test lines and ANSI codes into the context window. | **Pillar 3 (Observation Masking):** A `PreToolUse` hook transparently rewrites standalone test/git commands through [`rtk`](https://github.com/rtk-ai/rtk), collapsing passing suites (`✓ 142 passed`) while keeping 100% of failure diffs. |
| **4. Runaway Inline Exploration** | The primary agent executes 25+ consecutive `Grep`/`Read` calls inline, suffering *"lost-in-the-middle"* attention decay before writing a line of code. | **Pillar 4 (Context Isolation):** A lightweight Python state machine counts consecutive exploratory calls and blocks at `10`, forcing delegation to an isolated subagent (`Task`). |
| **5. Lossy `/compact` Amnesia** | When the window fills up and `/compact` runs, default summarization strips away exact `file:line` pointers and active root-cause hypotheses. | **Pillar 5 (Episodic Memory):** Pairs two-tier Auto-Memory (`MEMORY.md` index + lazy topic files) with a `PreCompact` handover hook that snapshots active git state before compaction. |

---

## 🧠 Core Architecture: Context Window = RAM, Repo = Disk

Our guiding systems principle is simple:
* **Active Context Window = L1/RAM:** Finite, expensive, and prone to attention dilution. Keep it flat, static, and high-signal.
* **Repository, LSP & Memory = Disk:** Deep storage queried progressively on demand via symbol pointers and isolated subagents.

### The 2-Layer Stack: Harness vs. Methodology

`agent-context-forge` does **not** dictate how you brainstorm or plan features. It is the **Layer 1 infrastructure harness** that sits underneath your preferred **Layer 2 workflow**:

```text
┌────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: Workflow & Planning Methodology                              │
│  Superpowers SDD • GetShitDone (GSD) • ECC • Elephant-Goldfish • TDD   │
│  ↳ "How you brainstorm, decompose specs, and coordinate tasks."        │
├────────────────────────────────────────────────────────────────────────┤
│  ▲ ▲ ▲ ▲ ▲  LAYER 1: The Foundation Harness (agent-context-forge)      │
│  Prefix Cache Gate • Native LSP • RTK Compression • Isolation Hooks    │
│  ↳ "The rails that keep context lean, cached, and noise-free."         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🖥️ What the CLI & HTML Auditor Do

When you run `npx agent-context-forge`, it adapts to your directory:

```text
┌   🛠️  AGENT CONTEXT FORGE  v0.1.0 — Context Engineering Harness
│
◇  🔍 Existing project detected: /path/to/repo [TypeScript]
│
◆  What would you like to do?
│  ● ⚡ Scan & Generate HTML Context Audit Report (Recommended)
│  ○ 🚀 Install / Upgrade Context Forge Harness
│  ○ Exit
```

### 1. The 5-Pillar Context Audit & HTML Dashboard (`Scan` Mode)
Evaluates your repository offline in `< 2 seconds` and opens `.agent-context-report.html` in your default browser:
* **Context Health Score (0–100 / Grade A–F)** + estimated **Prompt Cache Hit Rate** and **Token Waste Risk**.
* **Exact `File:Line` Violations:** Pinpoints volatile markers (`TODO`, checkboxes, dates) and dead file paths inside `CLAUDE.md` / `AGENTS.md`.
* **Live Token-Bomb Exposure:** Scans the repo for unprotected lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`) and calculates how many thousands of tokens an accidental `Read` will cost.
* **Interactive Remediation:** Offers to automatically install missing binaries (`rtk`, `@vtsls/language-server`, `pyright`) right from the terminal.

### 2. Modular Stack Configurator (`Install` Mode)
Lets you customize each layer instead of forcing a rigid template:
* **Progressive Disclosure:** Claude Native LSP *(default)* or bring your own code-intelligence MCP/tool.
* **Observation Masking:** [`rtk` (Rust Token Killer)](https://github.com/rtk-ai/rtk) *(default)* or custom output filter.
* **Subagent Isolation:** `10-call` Exploration Guardrail Hook *(default)*, Orchestrator Tool Permission Scoping (`.claude/agents/orchestrator.md` with `Edit`/`Write` physically omitted), or both.
* **Episodic Memory:** Built-in Claude Auto-Memory *(default, zero setup)* or [`context-mode`](https://github.com/mksglu/context-mode) *(sandboxed FTS5/BM25 MCP virtualization)*.
* **SDD Pairing (Optional):** Pre-wires rules for [Superpowers SDD](https://github.com/obra/superpowers), [GetShitDone (GSD)](https://github.com/open-gsd/gsd-core), [ECC](https://github.com/affaan-m/everything-claude-code), or the [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model).
* **Custom Context Bootstrapping (Optional):** Describe what you're building right in the CLI to generate a tailored, prefix-stable `CLAUDE.md`, `AGENTS.md`, and `.agents/rules/project-architecture.md`.

---

## 🔧 The 5 Pillars Under the Hood (Latency & Hook Mechanics)

A common question with agent hooks is: *"Do these hooks slow down every tool call or burn extra tokens?"*

**No.** Every hook is designed around a **zero-token deterministic fast path**:

### Pillar 1: Hybrid Pre-Commit Prefix Stability Gate
* **File:** [`.claude/hooks/pre-commit-prefix-stability.sh`](.claude/hooks/pre-commit-prefix-stability.sh) + [`.githooks/pre-commit`](.githooks/pre-commit)
* **Fast Filter (`< 2ms`, `0 tokens`):** Every non-commit `Bash` command exits `0` immediately via a shell regex check.
* **Commit Audit:** Only when `git commit` is invoked (and context files are present), a headless read-only evaluation (`claude -p --model haiku`) verifies:
  1. `CLAUDE.md` / `AGENTS.md` stays `< 150 lines` (`~1,000 tokens`).
  2. Zero volatile task state (no checkboxes, issue IDs, or deadlines).
  3. Zero duplicate rules between Tier 1 (`CLAUDE.md`) and Tier 2 (`.claude/agents/`, `.claude/skills/`).
  4. Every referenced file path and script actually exists in the repository.

### Pillar 2: Progressive Disclosure via LSP & Token-Bomb Denials
* **Files:** [`.claude/settings.json`](.claude/settings.json) + [`scripts/agent-gates/check-lsp.sh`](scripts/agent-gates/check-lsp.sh)
* **Mechanism:** Exports `"ENABLE_LSP_TOOL": "1"` so Claude Code uses `LSPGoToDefinition`, `LSPFindReferences`, and `LSPDocumentSymbols` instead of reading full files.
* **Hard Denials:** Pre-populates `permissions.deny` for `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `node_modules/**`, `dist/**`, `.next/**`, and `*.min.js`.

### Pillar 3: Transparent Observation Masking (`rtk`)
* **File:** [`.claude/hooks/rewrite-rtk.sh`](.claude/hooks/rewrite-rtk.sh) + [`scripts/agent-gates/check-rtk.sh`](scripts/agent-gates/check-rtk.sh)
* **Mechanism:** Intercepts standalone high-noise commands (`pytest`, `vitest`, `jest`, `cargo test/check/clippy/build`, `pnpm/npm/yarn test`, `go test`, `git status/diff/log/show`) and transparently rewrites the command input to `rtk <cmd>` via Claude Code's `updatedInput` protocol.
* **Safety:** Automatically skips piped, chained, redirected, or multiline commands (`|`, `&&`, `;`, `>`) so raw stdout pipelines are never broken. If `rtk` is not installed on `PATH`, the hook exits `0` in `< 1ms`.

### Pillar 4: Subagent Context Isolation
* **Files:** [`.claude/hooks/guard-subagent-isolation.py`](.claude/hooks/guard-subagent-isolation.py) + [`.claude/agents/orchestrator.md`](.claude/agents/orchestrator.md)
* **Mechanism:** Tracks consecutive `Read`, `Grep`, and `Glob` calls per session in `/tmp/agent_context_forge/`.
* **Threshold:** Calls `1–9` pass silently (`< 5ms`, `0 tokens`). On call `10`, returns `permissionDecision: "deny"` instructing the primary agent to dispatch a fresh research subagent (`Task` tool) and return only a concise synthesis. Resets automatically when `Task`, `Write`, or `Edit` is called.

### Pillar 5: Episodic Memory & Lossy Compaction Handover
* **Files:** [`.claude/hooks/pre-compact-handover.sh`](.claude/hooks/pre-compact-handover.sh) + [`scripts/agent-gates/check-memory.sh`](scripts/agent-gates/check-memory.sh)
* **Mechanism:** Verifies Claude Code's native two-tier Auto-Memory (`~/.claude/projects/<slug>/memory/MEMORY.md`) on `SessionStart`, and triggers on `PreCompact` to snapshot `git status -s` + `git diff --stat` and inject preservation rules before context summarization occurs.

---

## 🧩 Pairing with SDD & Planning Methodologies

Because `agent-context-forge` operates strictly at **Layer 1 (The Context Harness)**, it pairs cleanly with any **Layer 2** engineering methodology:

1. **[Superpowers SDD](https://github.com/obra/superpowers) (`obra/superpowers`):** Superpowers dispatches fresh subagents per task for TDD/code-review loops. With this harness underneath, every spawned subagent automatically inherits LSP symbol navigation, `rtk` test compression, and lockfile protection.
2. **[GetShitDone — GSD](https://github.com/open-gsd/gsd-core) (`open-gsd/gsd-core`) & [Everything Claude Code — ECC](https://github.com/affaan-m/everything-claude-code) (`affaan-m/everything-claude-code`):** GSD and ECC enforce spec-driven phase loops and context compartmentalization; `agent-context-forge` ensures their workers don't leak raw stdout noise or dirty the root prefix cache.
3. **[The Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) (`google/elephant-goldfish-model`):** Keeps long-term architectural knowledge with the **Elephant** on disk while enforcing stateless, zero-bias **Goldfish** subagents in working RAM.
4. **Classic TDD or Interactive Pair Programming:** Prefer no framework at all? The harness works invisibly in the background while you code normally.

---

## 🌐 Portability & Roadmap

While all hooks are production-ready for **Claude Code** and **Universal Git** today, the core gates (`scripts/agent-gates/`) are written in portable POSIX shell and Python so they can be adapted across runtimes:

| Agent / Runtime | Integration Mechanism | Status |
| :--- | :--- | :--- |
| **Claude Code** | Native `SessionStart`, `PreToolUse` & `PreCompact` hooks in `.claude/settings.json` | ✅ **Production Ready** |
| **Universal Git (CLI / IDEs)** | Standard Git pre-commit wrapper in `.githooks/pre-commit` | ✅ **Production Ready** |
| **Gemini CLI / Antigravity** | `.agents/rules/` + Tool Execution Policy adapters | 🚧 [Issue #1](https://github.com/Soufraz/agent-context-forge/issues/1) |
| **OpenCode / Aider** | `AGENTS.md` + `.agents/` universal standard | 🚧 [Issue #1](https://github.com/Soufraz/agent-context-forge/issues/1) |
| **Multi-LSP & Compressor Adapters** | Pluggable LSP & output masking alternatives beyond `vtsls` / `rtk` | 🚧 [Issue #2](https://github.com/Soufraz/agent-context-forge/issues/2), [Issue #3](https://github.com/Soufraz/agent-context-forge/issues/3) |

---

## 🧪 Running the Self-Test Suite

The repository includes both Node.js unit tests (for the CLI, scaffolder, 5-Pillar scanner, and HTML generator) and shell integration tests (for all hook state machines and fast-filters):

```bash
git clone https://github.com/Soufraz/agent-context-forge.git
cd agent-context-forge
npm install
npm test
```

---

## 📄 License

[MIT](LICENSE) — Free to use, fork, and adapt across personal and commercial projects. Contributions and PRs for additional agent adapters are welcome!
