<div align="center">

# 🛠️ Agent Context Forge

**An open-source CLI auditor and context-engineering harness that stops AI coding agents from busting prompt caches, reading 80k-token lockfiles, and polluting their own context window.**

[![Context Engineering](https://img.shields.io/badge/Architecture-5%20Pillars-success)](#the-5-pillars-under-the-hood)
[![Engine Support](https://img.shields.io/badge/Engine-Claude%20Code%20%7C%20Universal%20Git-blue)](#portability--roadmap)
[![Zero Telemetry](https://img.shields.io/badge/Privacy-100%25%20Local%20%26%20Zero%20Telemetry-brightgreen)](#license)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## ⚡ Quickstart (One Command)

Run directly inside **any existing repository** (to audit context health) or an **empty directory** (to scaffold a new project):

```bash
npx agent-context-forge
```

<p align="center">
  <img src="assets/demo.gif" alt="Agent Context Forge Interactive CLI Scaffolding Demo" width="900">
</p>

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
| **4. Runaway Inline Exploration** | The primary agent executes 25+ consecutive `Grep`/`Read` calls inline, suffering *"lost-in-the-middle"* attention decay before writing a line of code. | **Pillar 4 (Context Isolation):** A lightweight Python state machine counts consecutive exploratory calls in the primary session and blocks every `10th`, pushing delegation to an isolated subagent (`Agent` tool). |
| **5. Lossy `/compact` Amnesia** | When the window fills up and `/compact` runs, default summarization strips away exact `file:line` pointers and active root-cause hypotheses. | **Pillar 5 (Episodic Memory):** Pairs two-tier Auto-Memory (`MEMORY.md` index + lazy topic files) with a `PreCompact` handover hook that snapshots active git state before compaction. |

---

## 🧠 Core Architecture: Context Window = RAM, Repo = Disk

Our guiding systems principle is simple:
* **Active Context Window = L1/RAM:** Finite, expensive, and prone to attention dilution. Keep it flat, static, and high-signal.
* **Repository, LSP & Memory = Disk:** Deep storage queried progressively on demand via symbol pointers and isolated subagents.

### The 2-Layer Stack: Harness vs. Methodology

`agent-context-forge` does **not** dictate how you brainstorm or plan features. It is the **Layer 1 infrastructure harness** that sits underneath your preferred **Layer 2 workflow**:

<p align="center">
  <img src="assets/diagrams/two-layer-architecture.svg" alt="The 2-Layer Stack: Harness vs. Methodology" width="880">
</p>

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

<p align="center">
  <img src="assets/report-mocks/suggestion1-executive-dashboard.svg" alt="Context Health Audit Dashboard Simulation" width="880">
</p>

* **Context Health Score (0–100 / Grade A–F)** + estimated **Prompt Cache Hit Rate** and **Token Waste Risk**.
* **Exact `File:Line` Violations:** Pinpoints volatile markers (`TODO`, checkboxes, dates) and dead file paths inside `CLAUDE.md` / `AGENTS.md`.
* **Live Token-Bomb Exposure:** Scans the repo for unprotected lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`) and calculates how many thousands of tokens an accidental `Read` will cost.
* **Interactive Remediation:** Offers to automatically install missing binaries (`rtk`, `@vtsls/language-server`, `pyright`) right from the terminal.

### 2. Modular Stack Configurator (`Install` Mode)
Lets you customize each layer instead of forcing a rigid template:
* **Progressive Disclosure:** Claude Native LSP *(default)* or bring your own code-intelligence MCP/tool.
* **Observation Masking:** [`rtk` (Rust Token Killer)](https://github.com/rtk-ai/rtk) *(default)* or custom output filter.
* **Subagent Isolation:** `10-call` Exploration Guardrail Hook *(default)*, Orchestrator Tool Permission Scoping (`.claude/agents/orchestrator.md`, whose `tools` allowlist leaves out `Edit`/`Write`), or both.
* **Episodic Memory:** Built-in Claude Auto-Memory *(default, zero setup)* or [`context-mode`](https://github.com/mksglu/context-mode) *(sandboxed FTS5/BM25 MCP virtualization)*.
* **SDD Pairing (Optional):** Pre-wires rules for [Superpowers SDD](https://github.com/obra/superpowers), [GetShitDone (GSD)](https://github.com/open-gsd/gsd-core), [ECC](https://github.com/affaan-m/everything-claude-code), or the [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model).
* **Custom Context Bootstrapping (Optional):** Describe what you're building right in the CLI to generate a tailored, prefix-stable `CLAUDE.md`, `AGENTS.md`, and `.agents/rules/project-architecture.md`.
* **Safe on existing repos:** Install never discards your configuration. `.claude/settings.json` is merged (your permissions and hooks are kept, and a `.bak` copy is saved first). Your `CLAUDE.md`, `AGENTS.md`, agents, rules, and git hooks are replaced only while they are unchanged since the last install. Once you have edited one (or wrote it yourself), it is kept, and the harness version is written next to it as `<file>.context-forge-new` for you to merge.

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
* **Mechanism:** Tracks consecutive `Read`, `Grep`, and `Glob` calls per session in `/tmp/agent_context_forge/`. Calls made inside subagents (hook input carries an `agent_id`) are not counted.
* **Threshold:** Calls `1–9` pass silently (`< 5ms`, `0 tokens`). On call `10`, returns `permissionDecision: "deny"` instructing the primary agent to dispatch a fresh research subagent (`Agent` tool) and return only a concise synthesis, then re-arms for the next `10`. Resets when `Agent`, `Write`, or `Edit` is called.

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

## 💖 Standing on the Shoulders of Giants & Fair-Use Attribution

### The Philosophy: Proven Solutions, One Cohesive Foundation
We did not reinvent the wheel, nor do we claim to have discovered revolutionary new neural algorithms. The pain points of unmanaged context—prompt cache thrashing, token bloat from lockfiles, test output pollution, and runaway inline exploration—are felt by engineers and AI researchers every day.

Brilliant creators across the open-source community have built focused, high-impact utilities and methodologies to address individual facets of this challenge.

**Agent Context Forge** exists to synthesize these proven open-source solutions into a clean, reproducible, and standardized **Layer-1 boilerplate generator and health auditor**. It gives developers a solid context-engineering foundation in under 10 seconds, eliminating hours of manual configuration, trial-and-error, and expensive token burn.

### Deep Gratitude to the Open-Source Ecosystem
We extend our deepest respect and fair-use attribution to the creators whose tools, research, and ideas made this project possible:

* **[`rtk` (Rust Token Killer)](https://github.com/rtk-ai/rtk) by [@rtk-ai](https://github.com/rtk-ai):** An outstanding, blisteringly fast Rust tool that revolutionizes tool-call observation masking by collapsing passing test suites while retaining 100% of failure diffs.
* **Anthropic & Claude Code:** For pioneering native compiler-backed LSP tool discovery (`LSPGoToDefinition`, `LSPFindReferences`), deterministic shell lifecycle hooks (`SessionStart`, `PreToolUse`, `PreCompact`), and machine-local two-tier Auto-Memory.
* **[`@clack/prompts`](https://github.com/natemoo-re/clack) & [`picocolors`](https://github.com/alexeyraspopov/picocolors) by Nate Moore & Alexey Raspopov:** For crafting the clean, accessible, terminal UI and formatting primitives that power the interactive CLI wizard.
* **Layer-2 Methodology Creators & Communities:**
  * **[Superpowers SDD](https://github.com/obra/superpowers) by Jesse Vincent (`obra/superpowers`):** For pioneering systematic subagent dispatching, strict TDD red-green-refactor loops, and structured planning.
  * **[GetShitDone — GSD](https://github.com/open-gsd/gsd-core) (`open-gsd/gsd-core`):** For proving the effectiveness of contract-first, phase-isolated spec workflows.
  * **[Everything Claude Code — ECC](https://github.com/affaan-m/everything-claude-code) by Affaan M (`affaan-m/everything-claude-code`):** For insightful prompt-caching research, subagent patterns, and engineering skills.
  * **[The Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) (`google/elephant-goldfish-model`):** For the conceptual distinction between long-term disk memory (Elephant) and stateless, bias-free execution (Goldfish).
  * **[`context-mode`](https://github.com/mksglu/context-mode) by mksglu:** For pioneering SQLite FTS5/BM25 MCP sandboxing for context virtualization.

---

## 🤝 Contributing

We warmly welcome contributions, issue reports, and pull requests! 

Whether you want to:
* Build runtime adapters for **Gemini CLI / Google Antigravity**, **OpenCode / Aider**, **Cursor**, or **Codex** ([Issue #1](https://github.com/Soufraz/agent-context-forge/issues/1))
* Add new scanner checks to detect context leaks or token-bomb formats
* Implement alternative language server or output compressor integrations
* Improve hook execution performance and edge cases

Please read our **[Contributing Guide](CONTRIBUTING.md)** for local development setup, test instructions, and PR guidelines.

---

## 📄 License & Why MIT

This project is licensed under the **[MIT License](LICENSE)**.

### Why MIT?
`agent-context-forge` is designed as a foundational scaffolding tool. When you run `npx agent-context-forge`, it injects hooks, scripts, and rule templates directly into your codebase.

The **MIT License** was deliberately chosen because:
1. **Unrestricted Adoption:** You can freely scaffold, adapt, and run these hooks across any project—including closed-source, personal, academic, and proprietary enterprise software—without licensing friction or legal ambiguity.
2. **Zero Contagion:** Unlike copyleft licenses (such as GPL), MIT never requires you to open-source your own project simply because you used `agent-context-forge` to scaffold your agent rules.
3. **Open Collaboration:** Anyone can freely audit, fork, benchmark, and contribute enhancements back to the community.
