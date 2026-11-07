# 🛠️ Agent Context Forge
### *An open boilerplate and quality harness for sustainable AI-assisted software development*

[![Context Status](https://img.shields.io/badge/Context%20Engineering-All%205%20Pillars%20Ready-success)](#roadmap--future-solutions)
[![Platform](https://img.shields.io/badge/Portability-Claude%20%7C%20OpenCode%20%7C%20Antigravity%20%7C%20Universal%20Git-blue)](#universal-agent-portability)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

An open-source starting point for modern projects, designed to help developers and AI coding agents collaborate smoothly, maintain clean project context, and build reliable software together from Day 1.

---

## 🤝 What We Are Solving Together

As developers increasingly pair with AI coding agents on growing codebases, a common challenge emerges: **context management over time**.

When projects scale, it becomes tricky to keep agents aligned with the codebase without overloading them:
1. **Keeping Instructions Fresh & Aligned:** As architectures and features evolve, instructions in agent rules, skills, and documentation can unintentionally drift or contradict each other.
2. **Efficient Cache & Token Utilization:** Re-sending frequently changing task notes or volatile sprint trackers in root configuration files can invalidate provider prompt caches, making iterations slower and more expensive.
3. **Maintaining High Reasoning Fidelity:** Finding the sweet spot between giving agents enough context to succeed without flooding the context window with raw terminal dumps, whole files, or historical noise.

**Agent Context Forge** is a collaborative effort to bring proven, open-source context engineering patterns into a simple boilerplate that any team can use to start a new project on solid ground.

Our guiding principle is simple: **treat the active context window like working RAM** (kept lean, stable, and high-signal) while **using repository files, tools, and memory systems as deep disk storage** (queried progressively on demand).

---

## 🏛️ The 5 Pillars of Context Engineering

```
┌────────────────────────────────────────────────────────────────────────┐
│                   LLM CONTEXT WINDOW = RAM (Fast & Lean)               │
└────────────────────────────────────────────────────────────────────────┘
                                    │
  ┌──────────────────┬──────────────┴───────┬──────────────────┬──────────────┐
  ▼                  ▼                      ▼                  ▼              ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Pillar 1    │   │  Pillar 2    │   │  Pillar 3    │   │  Pillar 4    │   │  Pillar 5    │
│    Prefix    │   │ Progressive  │   │ Observation  │   │   Context    │   │  Episodic    │
│  Stability   │   │  Disclosure  │   │   Masking    │   │  Isolation   │   │    Memory    │
│   [ACTIVE]   │   │   [ACTIVE]   │   │   [ACTIVE]   │   │   [ACTIVE]   │   │   [ACTIVE]   │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

| Pillar | Focus | Status | Description |
| :--- | :--- | :--- | :--- |
| **1. Prefix Stability** | Token Caching & Drift Gate | ✅ **Implemented** | Strict immutability for Tier 1 root context; pre-commit gate blocking volatile state and drift. |
| **2. Progressive Disclosure** | Language Server Protocol (LSP) | ✅ **Implemented** | `ENABLE_LSP_TOOL=1` + `SessionStart` pre-flight check for compiler-backed symbol navigation. |
| **3. Observation Masking** | Smart Tool Output Compression | ✅ **Implemented** | `rtk` (Rust Token Killer) doctor check + proxying to collapse test/build noise (~60–90% savings). |
| **4. Context Isolation** | Subagent Trajectory Separation | ✅ **Implemented** | Runaway exploration guardrails + orchestrator permission scoping to keep primary context flat. |
| **5. Episodic Memory** | Cross-Session Learning | ✅ **Implemented** | Two-tier Auto-Memory (`MEMORY.md` + topic files) verified via `check-memory.sh` on session start. |

---

## ⚡ Pillar 1: Prefix Stability Gate

The foundation of every project is **Prefix Stability**: keeping the root prompt prefix frozen and cache-friendly (>80% KV cache hit rate).

### The 3-Tier Prefix Model
1. **Tier 1 — Universal Laws (`CLAUDE.md` / `AGENTS.md`):** Frozen, compact (< 150 lines / ~1,000 tokens). Holds only universal repo laws, core stack commands, and on-demand pointers. **Zero volatile task state allowed.**
2. **Tier 2 — Role & Skill Deltas (`.claude/agents/`, `.claude/skills/`):** Loaded only when relevant. Strictly *delta-only*—must never repeat Tier 1 instructions or eagerly preload universal stack skills.
3. **Tier 3 — Dynamic Task State (The Uncached Tail):** Ephemeral scratchpads, git diffs, and conversational turns that change on every prompt.

### The Hybrid Pre-Commit Gate
Before any `git commit` is finalized by an agent:
- **Fast Filter (< 2ms, 0 tokens):** Non-commit shell commands bypass the gate instantly.
- **LLM Context Audit (`claude -p --model haiku`):** When `git commit` runs, an isolated evaluator inspects staged changes and context files against:
  - Token budget & line limits (< 150 lines).
  - Absence of volatile markers (`due YYYY-MM-DD`, issue IDs like `#123`, task lists `- [ ]`, `TODO:`).
  - Delta-only compliance (no duplicate instructions between Tier 1 and Tier 2).
  - Broken file path references or nonexistent package scripts.
- **Enforcement:** If violations are detected, the gate exits with code `2`, blocking the commit and returning actionable feedback so the agent fixes the context drift automatically.

---

## 🔍 Pillar 2: Progressive Disclosure via Native LSP

Instead of reading 400-line files or guessing line numbers via `grep`, coding agents perform best when equipped with the **Language Server Protocol (LSP)**.

### How It Works in This Boilerplate
1. **Native LSP Flag:** `.claude/settings.json` exports `"env": { "ENABLE_LSP_TOOL": "1" }`, activating Claude Code's native code intelligence engine.
2. **Instant Symbol Resolution:** Rather than dumping entire source files into context RAM, the agent queries:
   - **`LSPGoToDefinition`** & **`LSPFindReferences`**: Resolves symbols across files in ~50ms.
   - **`LSPDocumentSymbols`** & **`LSPWorkspaceSymbols`**: Inspects interface shapes and function signatures without loading implementation bodies (~70% token savings).
4. **`SessionStart` Pre-Flight Doctor:** A non-blocking startup hook (`scripts/agent-gates/check-lsp.sh`) detects the project's language (TypeScript, Python, Go, Rust) and confirms the language server binary (`@vtsls/language-server`, `pyright`, `gopls`, `rust-analyzer`) is present on `PATH`. If missing, it provides copy-paste install commands right in the agent's startup console.
5. **Token-Bomb Read Denials (`permissions.deny`):** `.claude/settings.json` blocks accidental `Read` calls on lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`), build artifacts (`dist/`, `build/`, `.next/`), and minified bundles (`*.min.js`) so a single stray read never dumps 30,000+ tokens into context RAM.

---

## 🛡️ Pillar 3: Observation Masking via `rtk` (Rust Token Killer)

When testing or compiling code, raw terminal output can dump thousands of passing tests, ANSI color codes, and verbose compiler lines into context RAM—pushing critical instructions out of the LLM's attention window.

### Why Not Rely Only on Native Truncation?
Standard terminal truncation is "dumb": it chops characters from the middle or end of output without knowing which lines are errors, frequently discarding the exact stack trace or assertion diff the agent needs.

### How It Works in This Boilerplate
1. **Transparent Command Rewriting (`PreToolUse` Hook):** `.claude/hooks/rewrite-rtk.sh` automatically intercepts standalone noisy test, build, and git inspection commands (`pytest`, `vitest`, `jest`, `cargo test`, `pnpm test`, `npm test`, `go test`, `git status`, `git diff`, `git log`) and transparently rewrites them to `rtk <cmd>` via Claude Code's `updatedInput` protocol when `rtk` is installed on `PATH`.
2. **Smart Test Compression:** Wrapping test runs with [`rtk`](https://github.com/rtk-ai/rtk) collapses passing suites into a single line (`✓ 48 passed`) while preserving 100% of failing assertions and stack traces.
3. **Environment Doctor Hook:** Integrated into `scripts/agent-gates/doctor.sh` and checked on `SessionStart`. If `rtk` is missing, it alerts the developer with installation commands (`cargo install rtk-ai`).
4. **Noise Stripping:** Automatically removes non-semantic ANSI escape codes and progress spinners before tool outputs reach the agent.

---

## 🤖 Pillar 4: Subagent Context Isolation

Agents are naturally prone to running sprawling inline explorations—grepping dozens of files, hitting dead ends, and filling the primary context window with thousands of tokens of search noise.

### Active by Default: Exploration Guardrail
* **The Guardrail:** `.claude/hooks/guard-subagent-isolation.py` intercepts `PreToolUse` events for `Read`, `Grep`, and `Glob`.
* **Exploration Threshold:** If the primary agent executes **10+ consecutive exploratory calls** without delegating to a subagent or editing code, the hook triggers a structured permission denial:
  > *"Context Isolation Guardrail: 10 consecutive exploratory calls executed in the primary context window. To prevent context dilution, please delegate this investigation to a fresh research subagent (via Task tool) and return a concise synthesis."*
* **Auto-Reset:** Calling the `Task` tool (subagent dispatch) or making code changes (`Write`, `Edit`) resets the counter.

### Orchestrator Pattern: Tool Permission Scoping
For large-scale feature planning, you can enforce context isolation structurally by removing write permissions from the orchestrator:
* See the included template: [`.claude/agents/orchestrator.md`](.claude/agents/orchestrator.md)
* **How it works:** The orchestrator agent is granted `[Read, Glob, Grep, Task, Bash]`, but **`Edit` and `Write` are completely omitted**.
* **Why it's bulletproof:** Because the orchestrator physically lacks write tools, it is **mechanically incapable** of writing code inline—it is forced to dispatch fresh implementer subagents for every task, keeping its own context window pristine.

### The Elephant-Goldfish Principle
Inspired by the [Elephant-Goldfish Model (EGM)](https://github.com/google/elephant-goldfish-model):
* **The Elephant (Persistent Memory):** Long-term project memory (ADRs, schemas, git commit history) lives on disk and persists across months.
* **The Goldfish (Disposable Working Context):** Implementer and research subagents are given short, disposable working memory. They execute a single task in an isolated scope, commit their changes, report a concise summary back to the parent, and their noisy trajectory is discarded.

---

## 🧠 Pillar 5: Episodic Memory (Cross-Session Learning)

Coding agents shouldn't suffer from amnesia between sessions, but storing past lessons and debugging insights directly in `CLAUDE.md` breaks **Prefix Stability (Pillar 1)** by constantly busting the prompt cache.

### How It Works in This Boilerplate
1. **Built-in Two-Tier Memory:** Relies on Claude Code's native Auto-Memory located machine-locally in `~/.claude/projects/<slug>/memory/`.
   - **`MEMORY.md` Index:** Only the top ~200 lines (~25KB) are loaded at session startup as a lightweight catalog.
   - **Topic Markdown Files:** Detailed debugging findings and user corrections are stored in separate topic files and read lazily on demand.
2. **Environment Doctor Verification:** `scripts/agent-gates/check-memory.sh` runs automatically on `SessionStart` (via `doctor.sh`), verifying that auto-memory is enabled and reporting how many memory topics are currently active.
3. **Lossy Compaction Protection (`PreCompact` Hook):** `.claude/hooks/pre-compact-handover.sh` runs automatically before `/compact` or auto-compaction, snapshotting active Git working state and instructing the compactor to retain exact `file:line` pointers, active test failures, and architectural constraints.
4. **Pluggable Architecture:** While native Auto-Memory is the zero-dependency default, teams with heavy cross-worktree or sandboxed execution needs can easily plug in external MCP memory layers like [`claude-mem`](https://github.com/thedotmack/claude-mem) or [`context-mode`](https://github.com/mksglu/context-mode).

---

## 🧩 Harness vs. Methodology: Pairing with Planning Frameworks

A common question in agentic development is: *Does this replace frameworks like [Superpowers SDD](https://github.com/obra/superpowers), [GetShitDone (GSD)](https://github.com/open-gsd/gsd-core), [ECC](https://github.com/affaan-m/everything-claude-code), or the [Elephant-Goldfish model](https://github.com/google/elephant-goldfish-model)?*

The answer is **no—they complement each other**. They operate at two different layers of the development stack:

```
┌────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: Workflow & Execution Methodology                             │
│  (Superpowers SDD, GetShitDone, ECC, Elephant-Goldfish, TDD)           │
│  "How you brainstorm, decompose features, and coordinate tasks."       │
├────────────────────────────────────────────────────────────────────────┤
│  LAYER 1: The Context Engineering Harness                              │
│  (agent-context-forge)                                                 │
│  "The rails, token filters, LSP bridges, and cache gates."             │
└────────────────────────────────────────────────────────────────────────┘
```

### Recommended Methodologies & How They Fit Better Here

1. **[Superpowers SDD (Subagent-Driven Development)](https://github.com/obra/superpowers):**
   * *How it fits:* Superpowers dispatches fresh implementer and reviewer subagents per task. In `agent-context-forge`, those subagents automatically inherit compiler-backed symbol navigation (Pillar 2), compressed test outputs via `rtk` (Pillar 3), and pre-commit prefix verification (Pillar 1)—preventing the subagent fleet from burning unnecessary tokens or dirtying `CLAUDE.md`.
2. **[GetShitDone (GSD)](https://github.com/open-gsd/gsd-core) & [ECC (Everything Claude Code)](https://github.com/affaan-m/everything-claude-code):**
   * *How it fits:* GSD and ECC structure the agent development lifecycle through spec-driven planning, context compartmentalization, and disciplined execution loops. Paired with `agent-context-forge`, each compartmentalized worker stays lean and reports concise diffs back to the plan ledger without leaking exploratory noise into the parent coordinator.
3. **[The Elephant-Goldfish Model (EGM)](https://github.com/google/elephant-goldfish-model):**
   * *How it fits:* Long-term knowledge (ADRs, memory topics, git history) stays with the **Elephant** on disk; short-lived, zero-context reviewers and implementers act as the **Goldfish** in context RAM to eliminate conversational bias and context bloat.

### 💡 Use Whatever Methodology Works Best for You
`agent-context-forge` is strictly **methodology-agnostic**:
* If you love **Superpowers SDD**, **GSD**, or **ECC**, this harness makes them significantly cheaper, faster, and more token-efficient.
* If you prefer classic **Test-Driven Development (TDD)**, single-session pair programming, interactive chat, or your own team's custom planning workflow, that is completely fine!

This boilerplate provides the **underlying context and safety harness**; you remain in total control of how you plan and write code.

---

## 🌐 Universal Agent Portability

This boilerplate is designed to be **agent-agnostic**. While the initial hook is wired for Claude Code, the core quality gates sit in a portable layer ready to plug into any agent platform:

```
agent-context-forge/
├── CLAUDE.md                            # Tier-1 static architectural rules (Claude Code)
├── AGENTS.md                            # Tier-1 universal agent instructions (OpenCode / Aider)
├── .claude/                             # Claude Code Configuration
│   ├── settings.json                    # SessionStart, PreToolUse, PreCompact & permissions.deny
│   ├── agents/
│   │   └── orchestrator.md              # Tool Permission Scoping template
│   └── hooks/
│       ├── pre-commit-prefix-stability.sh  # Pre-commit context audit (Pillar 1)
│       ├── rewrite-rtk.sh                  # Transparent rtk command rewriter (Pillar 3)
│       ├── guard-subagent-isolation.py     # Runaway exploration guardrail (Pillar 4)
│       └── pre-compact-handover.sh         # Lossy compaction protection (Pillar 5)
│
├── .agents/                             # Universal Agent Standard (OpenCode / AGENTS.md)
│   └── rules/                           # Portable rule definitions
│
├── .githooks/                           # Universal Git Pre-Commit Hook
│   └── pre-commit                       # Runs identical gate in standard Git (Aider, Zed, IDEs)
│
├── scripts/
│   └── agent-gates/                     # Portable, tool-agnostic validation logic
│       ├── doctor.sh                    # Unified environment pre-flight doctor
│       ├── check-lsp.sh                 # Language Server Protocol readiness (Pillar 2)
│       ├── check-rtk.sh                 # Observation masking check (Pillar 3)
│       └── check-memory.sh              # Episodic memory verification (Pillar 5)
│
├── tests/
│   └── run-tests.sh                     # Automated self-test suite for all 5 Pillars
│
├── LICENSE
└── README.md
```

### Supported & Target Agent Runtimes

| Agent / Environment | Integration Method | Status |
| :--- | :--- | :--- |
| **Claude Code** | Native `PreToolUse` hook in `.claude/settings.json` | ✅ Ready |
| **Universal Git CLI** | Git pre-commit hook in `.githooks/pre-commit` | ✅ Ready |
| **OpenCode / Aider** | `.agents/` / `AGENTS.md` root standard | 🚧 Roadmap |
| **Antigravity / Gemini** | `.agents/rules/` + Tool Execution Policy | 🚧 Roadmap |
| **Cursor / Windsurf** | `.cursor/rules/` + background linters | 🚧 Roadmap |

---

## 🚀 Quickstart: Starting a New Project

1. **Clone or copy this scaffold into your new repository:**
   ```bash
   git clone https://github.com/Soufraz/agent-context-forge my-app
   cd my-app
   ```

2. **Run the self-test & environment doctor:**
   ```bash
   ./tests/run-tests.sh
   ./scripts/agent-gates/doctor.sh
   ```

3. **Optional — Enable the Universal Git Pre-Commit Hook (for CLI / IDE commits):**
   ```bash
   git config core.hooksPath .githooks
   ```

4. **Keep Tier 1 Clean:**
   When adding rules to `CLAUDE.md` or `AGENTS.md`, keep them concise and static. Put active sprint plans in issue trackers or dedicated task files, never in the root prefix!

---

## 🗺️ Roadmap & Future Solutions

- [x] **Pillar 1:** Universal Prefix Stability & Pre-Commit Hook (Active)
- [x] **Pillar 2:** Progressive Disclosure via Native Language Server Protocol & Token-Bomb Denials (Active)
- [x] **Pillar 3:** Smart Observation Masking & Transparent `rtk` Rewriting (Active)
- [x] **Pillar 4:** Subagent Context Isolation & Exploration Guardrails (Active)
- [x] **Pillar 5:** Episodic Memory & Lossy Compaction Handover Hook (Active)
- [ ] **Multi-Agent Adapters:** Out-of-the-box configuration files for OpenCode, Aider, and Antigravity.

---

## 📄 License

MIT — feel free to use this boilerplate across commercial and open-source projects.
