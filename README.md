# 🛠️ Agent Context Forge
### *An open boilerplate and quality harness for sustainable AI-assisted software development*

[![Context Status](https://img.shields.io/badge/Context%20Engineering-Pillar%201%20Ready-success)](#roadmap--future-solutions)
[![Platform](https://img.shields.io/badge/Portability-Claude%20%7C%20OpenCode%20%7C%20Antigravity%20%7C%20Universal%20Git-blue)](#universal-agent-portability)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

An open-source starting point for modern projects, designed to help developers and AI coding agents collaborate smoothly, maintain clean project context, and build reliable software together from Day 1.

---

## 🤝 What We Are Solving Together

As developers increasingly pair with AI coding agents (such as Claude Code, OpenCode, Cursor, and Antigravity) on growing codebases, a common challenge emerges: **context management over time**.

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
│    Prefix    │   │ Progressive  │   │ Observation  │   │  Episodic    │   │Deterministic │
│  Stability   │   │  Disclosure  │   │   Masking    │   │    Memory    │   │ Architecture │
│   [ACTIVE]   │   │  [PLANNED]   │   │  [PLANNED]   │   │  [PLANNED]   │   │  [PLANNED]   │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

| Pillar | Focus | Status | Description |
| :--- | :--- | :--- | :--- |
| **1. Prefix Stability** | Token Caching & Drift Gate | ✅ **Implemented** | Strict immutability for Tier 1 root context; pre-commit gate blocking volatile state and drift. |
| **2. Progressive Disclosure** | AST & Symbol Navigation | 🚧 *Planned* | LSP / Tree-sitter MCP integration to query interfaces without reading whole file bodies. |
| **3. Observation Masking** | Tool Output Trimming | 🚧 *Planned* | Terminal/test runner proxy that collapses raw stdout into compact failure diffs. |
| **4. Episodic Memory** | Cross-Session Learning | 🚧 *Planned* | Background memory ledger capturing debug insights across git worktrees without touching prefix files. |
| **5. Deterministic Gates** | Architectural Linters | 🚧 *Planned* | AST graph boundary checks replacing fuzzy negative prompt instructions with hard CI rules. |

---

## ⚡ Pillar 1 (Current Foundation): Prefix Stability Gate

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

## 🌐 Universal Agent Portability

This boilerplate is designed to be **agent-agnostic**. While the initial hook is wired for Claude Code, the core quality gates sit in a portable layer ready to plug into any agent platform:

```
agent-context-forge/
├── .claude/                             # Claude Code Configuration
│   ├── settings.json                    # PreToolUse hook binding
│   └── hooks/
│       └── pre-commit-prefix-stability.sh  # Hybrid git-commit interceptor
│
├── .agents/                             # Universal Agent Standard (OpenCode / AGENTS.md)
│   └── rules/                           # Portable rule definitions
│
├── .githooks/                           # Universal Git Pre-Commit Hook
│   └── pre-commit                       # Runs identical gate in standard Git (Aider, Zed, IDEs)
│
├── scripts/
│   └── agent-gates/                     # Portable, tool-agnostic validation logic
│
└── README.md
```

### Supported & Target Agent Runtimes

| Agent / Environment | Integration Method | Status |
| :--- | :--- | :--- |
| **Claude Code** | Native `PreToolUse` hook in `.claude/settings.json` | ✅ Ready |
| **Universal Git CLI** | Git pre-commit hook in `.githooks/pre-commit` | 🔄 Adaptable |
| **OpenCode / Aider** | `.agents/` / `AGENTS.md` root standard | 🚧 Roadmap |
| **Antigravity / Gemini** | `.agents/rules/` + Tool Execution Policy | 🚧 Roadmap |
| **Cursor / Windsurf** | `.cursor/rules/` + background linters | 🚧 Roadmap |

---

## 🚀 Quickstart: Starting a New Project

1. **Clone or copy this scaffold into your new repository:**
   ```bash
   git clone https://github.com/your-org/agent-context-forge my-app
   cd my-app
   ```

2. **Verify the hook is active:**
   The hook runs automatically inside Claude Code whenever an agent attempts `git commit`.

3. **Keep Tier 1 Clean:**
   When adding rules to `CLAUDE.md` or `AGENTS.md`, keep them concise and static. Put active sprint plans in issue trackers or dedicated task files, never in the root prefix!

---

## 🗺️ Roadmap & Future Solutions

- [x] **Pillar 1:** Universal Prefix Stability & Pre-Commit Hook (Active)
- [ ] **Pillar 2:** AST / Symbol Code-Graph MCP Integration (`Serena` / `mcp-language-server`)
- [ ] **Pillar 3:** Terminal Output Compression & Test Trimming Proxy (`rtk` / `oo`)
- [ ] **Pillar 4:** Background Episodic Memory Ledger (`claude-mem` integration with cache-protection)
- [ ] **Pillar 5:** Deterministic Monorepo / Boundary Linters (`dependency-cruiser` configs)
- [ ] **Multi-Agent Adapters:** Out-of-the-box configuration files for OpenCode, Aider, and Antigravity.

---

## 📄 License

MIT — feel free to use this boilerplate across commercial and open-source projects.
