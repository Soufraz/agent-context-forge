> [!NOTE]
> **What is measured so far.** Cost and correctness come from 6 paired runs per task on the 0.2.1 harness. The compaction and stale-`CLAUDE.md` results are pilots, one run per arm. Method, tables with confidence intervals, and every run: **[benchmarks/](benchmarks/README.md)**. Expect breaking changes before 1.0.

<div align="center">

# 🛠️ Agent Context Forge

**An open-source starter for Claude Code: one command sets up a repo's context tooling, plus hooks that keep that setup true as the repo changes.**

[![Benchmarks](https://img.shields.io/badge/Benchmarks-paired%20runs%20on%20real%20repos-informational)](benchmarks/README.md)
[![Context Engineering](https://img.shields.io/badge/Architecture-5%20Pillars-success)](#the-5-pillars-under-the-hood)
[![Engine Support](https://img.shields.io/badge/Engine-Claude%20Code%20%7C%20Universal%20Git-blue)](#portability--roadmap)
[![Zero Telemetry](https://img.shields.io/badge/Privacy-Zero%20Telemetry-brightgreen)](#license)
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

* **In an existing codebase:** Audits your repository across the 5 Pillars of Context Engineering in `< 2 seconds` and opens a self-contained, dark-mode **HTML Context Health Dashboard** in your browser, or installs the setup there.
* **In an empty folder (or when installing):** Launches an interactive stack wizard to configure opt-in LSP symbol navigation, [`rtk`](https://github.com/rtk-ai/rtk) test output compression, an exploration note, episodic memory, and optional SDD rules.

---

## 🎯 What It Does, and What We Measured

### 1. Sets up the tools

`npx agent-context-forge` asks a few questions and writes the setup into a new or existing repo: a lean `CLAUDE.md` that imports your `AGENTS.md`, [`rtk`](https://github.com/rtk-ai/rtk) to compress Bash output, stable project facts at session start (how this project runs its tests, BSD `sed`), a guard on whole-file reads of lockfiles and bundles, a note that suggests a subagent during long searches, Auto-Memory checks with a compaction handover, and an optional planning methodology. It offers to install `rtk`. LSP navigation (a language server, Claude Code's code intelligence plugin and a references rule in `CLAUDE.md`) is opt-in, because it cost more in every measured run.

**Measured** in paired runs on real repos (6 pairs per task, 0.2.1 harness):
- **Tool output:** 14–25% less on the click tasks (fixing failing tests on Sonnet and Haiku, a six-prompt session on Sonnet).
- **Fewer wasted turns:** on Sonnet, the project facts removed every failed attempt to find the test command.
- **No clear cost saving on any task:** cost changes ranged from −9% to +6%, each with a 90% interval that includes zero.
- **Higher cost where there is little to save:** +22% on a one-question lockfile task, but that came mostly from the benchmark copying each run into a new folder. With one folder per arm, as in a real project, the default setup (without the LSP rule) cost 21% less on that task (−29 to −13%) and +11% (−2 to +22%) on finding callers. [Details](benchmarks/README.md#lsp-rule-ablation-and-the-fresh-folder-artifact-6-paired-runs-per-arm-sonnet-unless-noted).
- **The LSP references rule:** +49% on Sonnet, where it gave the only exact answers (2 of 6 runs), and +51% on Haiku, with no gain. It is now opt-in: the default setup leaves it out.

An earlier round reported 10–35% savings; a benchmark bug inflated them. Tables with 90% confidence intervals, the tasks and graders, every run, and the bug: [benchmarks/](benchmarks/README.md).

### 2. Keeps the setup true as the repo changes

Models are good at following instructions, and Claude Code is good at keeping them: in our pilot runs (Claude Code 2.1.308, one run per arm), Sonnet kept all seven rules of a session through one and through three compactions, and ignored stale `CLAUDE.md` lines when the code beside the edit showed they were wrong. So these hooks don't promise that agents remember more. They check things that hold whatever the model does, and each one says where it stops:

| Hook | What it does | Where it stops | Evidence |
| :--- | :--- | :--- | :--- |
| **Rule gates** | Rules in `.claude/enforced-rules.json` block the matching tool call: Bash commands that must or must not contain something, Edit/Write on protected paths, files that must change in the same commit, a check before Claude finishes. A denial names the rule and the fix. | Gates see tool calls, not intent: a path rule also sees Bash redirections, `tee`, `sed -i`/`perl -i`, `cp`/`mv`/`install` and `dd of=`, but not a write inside a script or `python -c`; a command run inside a script passes a command rule. | Holds by construction and is covered by the test suite. Turning instruction files into executable checks raised compliance from 67% to 88% in [ContextCov](https://arxiv.org/abs/2603.00822). |
| **Drift check** | Stops a commit that deletes or renames a path, or removes a package script or make target, that `CLAUDE.md`, `AGENTS.md` or `.claude/rules` still name, in Claude Code and (with `core.hooksPath`) in plain git, naming the new path. At session start, tells Claude which named paths, scripts and targets are already gone. No model, no tokens. | Paths, package scripts and make targets only: a stale convention or symbol passes. A bare `pnpm x` is judged only when `node_modules` is installed, since it may run a dependency's binary. | Replayed over 4,262 commits with context files (agent-context-forge, echo, pydantic-ai): it fired once, on a real rename that left pydantic-ai's `CLAUDE.md` wrong for 37 commits. No false notes on next.js, n8n, ruff, pydantic-ai or echo. The command half, replayed over 254 commits of four repos, gave no false notes or denials and no real hits either, so its recall on real history is not measured yet. [Replay data](benchmarks/README.md#drift-check-replay-no-model). |
| **Rule capture** | Keeps the rules you state in chat and re-injects them word for word after compaction. | Only sentences phrased as rules ("always ...", "never ...", "from now on ..."). | No measured gain: in the [pilots](benchmarks/README.md#context-stability-pilots-one-run-per-arm) above, Claude Code already kept every rule. A safeguard for longer sessions. |
| **Context size notes** | Tells you, never Claude, when the conversation passes 150k tokens and again at each multiple, and what resuming a large session with an expired cache will re-send. Adds no tokens. | A note, not an action: you decide whether to `/compact` or `/clear`. Set `ACF_CONTEXT_NOTE_TOKENS` to change the threshold, `0` to turn it off. | Claude Code re-sends the whole conversation on every request ([prompt caching docs](https://code.claude.com/docs/en/prompt-caching)), so a long session pays for its size on every turn; a public breakdown of one 1,270-turn session put re-sent context at 66% of its cost ([write-up](https://dev.to/wartzarbee/i-ran-a-single-claude-code-session-for-1270-turns-it-cost-1278-heres-the-breakdown-554c), n=1). The note itself is not measured. |

### 3. Audits a repo you already have

Run inside an existing repository, it scores the setup against the five pillars in under 2 seconds and opens a self-contained HTML report. No model, no network. The score is a setup checklist, not a benchmark.

The failure modes below are what each pillar targets:

| Failure Mode | What Happens by Default | How `agent-context-forge` Fixes It |
| :--- | :--- | :--- |
| **1. Root Context Bloat & Churn** | Sprint checklists (`- [ ]`), issue IDs (`#123`), and `TODO`s pile up in `CLAUDE.md`. That file is re-sent on every turn, so each stale line costs tokens and dilutes the rules that matter. (Each edit also costs one prompt-cache miss at the next session start, but caches expire within minutes to an hour anyway, so size and focus matter more.) | **Pillar 1 (Prefix Stability):** Enforces a frozen `< 150 line` Tier-1 prefix and blocks volatile state or broken path references via a pre-commit gate. |
| **2. Lockfile & Full-File Token Bombs** | Reading a lockfile, minified bundle, or source map whole loads up to 25,000 tokens of noise per call (Claude Code refuses files over 256 KB, so smaller ones are the risk). | **Pillar 2 (Progressive Disclosure):** Guides you to Claude Code's code intelligence plugin for your language (compiler-backed symbol lookups) + a hook that blocks only whole-file reads of those files, so grepping them still works. |
| **3. Test & Build Output Floods** | Running `pytest`, `vitest`, or `cargo test` dumps hundreds of passing test lines and ANSI codes into the context window. | **Pillar 3 (Observation Masking):** A `PreToolUse` hook hands every Bash command to [`rtk`](https://github.com/rtk-ai/rtk)'s own rewrite engine, which covers piped and chained commands too (`uv run pytest -q \| tail -40` → `uv run rtk pytest -q \| tail -40`), collapsing passing suites while keeping failures. |
| **4. Runaway Inline Exploration** | The primary agent executes 25+ consecutive `Grep`/`Read` calls inline, suffering *"lost-in-the-middle"* attention decay before writing a line of code. | **Pillar 4 (Context Isolation):** A lightweight Python state machine counts consecutive searches and reads in the primary session (including `grep`/`find` through Bash) and, every `15`, adds a non-blocking note suggesting a subagent. |
| **5. Lossy `/compact` Amnesia** | When the window fills up and `/compact` runs, default summarization strips away exact `file:line` pointers and active root-cause hypotheses. | **Pillar 5 (Episodic Memory):** Pairs two-tier Auto-Memory (`MEMORY.md` index + lazy topic files) with a `PreCompact` handover hook that feeds active git state and preservation rules into the compaction summary. |

### 4. Shows where your tokens actually go

```bash
npx agent-context-forge usage          # this project's sessions, last 30 days
npx agent-context-forge usage --all    # every project; --days N, --json
```

It reads the session transcripts Claude Code keeps in `~/.claude/projects` and prints, for the last 30 days, the share of cost that re-sent context, cache writes, output and fresh input take (at standard price ratios, not dollars), the fixed prompt on a session's first request, the context size per request, compactions, and the costliest sessions. It suggests a change only where the numbers call for one. No model, no network. Subagent transcripts are not counted.

Why this matters more than output compression: Claude Code re-sends the whole conversation on every request, so a long session pays for its context size times its number of requests. Tool output is only part of that context, so shrinking it moves the total less than the per-command figures suggest. Run the report on your own machine to see your numbers; it prints them and keeps them there. The usual levers are `/clear` between tasks, auto-compaction, a smaller fixed prompt (plugins, skills and MCP servers load on every request), and the model choice.

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

* **Context Health Score (0–100 / Grade A–F)** + measured **Tier-1 size** (lines, ~tokens) and **Unprotected Lockfile Exposure** (~tokens one stray `Read` could load). The tool doesn't report cache hit rates or token savings it hasn't measured.
* **Exact `File:Line` Violations:** Pinpoints volatile markers (`TODO`, checkboxes, dates) and dead file paths inside `CLAUDE.md` / `AGENTS.md`.
* **Live Token-Bomb Exposure:** Scans the repo for unprotected lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`) and calculates how many thousands of tokens an accidental `Read` will cost.
* **What the score measures:** how closely the repo follows the five pillars as this tool defines them. Treat it as a setup checklist, not a benchmark. A hook earns points only when it is wired in settings and its script exists, and equivalents count (rtk's own `rtk init -g` hook, any `PreCompact` or `SessionStart` `compact` hook). Two checks (16 points) look specifically for this harness's commit gate and exploration guardrail.
* **Interactive Remediation:** Offers to automatically install missing binaries (`rtk`, `typescript-language-server`, `pyright`) right from the terminal, and prints the code intelligence plugin to install for your language.

### 2. Modular Stack Configurator (`Install` Mode)
Lets you customize each layer instead of forcing a rigid template:
* **Progressive Disclosure:** text search *(default)*, Claude Native LSP *(opt-in)*, or bring your own code-intelligence MCP/tool.
* **Observation Masking:** [`rtk` (Rust Token Killer)](https://github.com/rtk-ai/rtk) *(default)* or custom output filter.
* **Subagent Isolation:** Exploration Guardrail note after 15 consecutive searches *(default)*, Orchestrator Tool Permission Scoping (`.claude/agents/orchestrator.md`, whose `tools` allowlist leaves out `Edit`/`Write`), or both.
* **Episodic Memory:** Built-in Claude Auto-Memory *(default, zero setup)* or [`context-mode`](https://github.com/mksglu/context-mode) *(sandboxed FTS5/BM25 MCP virtualization)*.
* **SDD Pairing (Optional):** Pre-wires rules for [Superpowers SDD](https://github.com/obra/superpowers), [GetShitDone (GSD)](https://github.com/open-gsd/gsd-core), [ECC](https://github.com/affaan-m/everything-claude-code), or the [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model).
* **Custom Context Bootstrapping (Optional):** Describe what you're building right in the CLI to generate a tailored, prefix-stable `CLAUDE.md`, `AGENTS.md`, and `.agents/rules/project-architecture.md`.
* **Lean `CLAUDE.md`:** The `CLAUDE.md` the harness writes holds only rules that change how Claude works (your stack and constraints, a references rule for the LSP tool when you choose LSP, and grepping lockfiles), because every line is sent with every request. Guidance for you sits in an HTML comment, which Claude Code strips before loading the file. When your repo already has an `AGENTS.md`, the new `CLAUDE.md` imports it with `@AGENTS.md`, since Claude Code reads only `CLAUDE.md` when both exist.
* **Safe on existing repos:** Install never discards your configuration. `.claude/settings.json` is merged (your permissions and hooks are kept, and a `.bak` copy is saved first). Your `CLAUDE.md`, `AGENTS.md`, agents, rules, and git hooks are replaced only while they are unchanged since the last install. Once you have edited one (or wrote it yourself), it is kept, and the harness version is written next to it as `<file>.context-forge-new` for you to merge.

---

## 🔧 The 5 Pillars Under the Hood (Latency & Hook Mechanics)

A common question with agent hooks is: *"Do these hooks slow down every tool call or burn extra tokens?"*

**Almost never.** Every hook has a **zero-token deterministic fast path**. The one exception is the commit gate below, which calls a model only when a commit touches your agent context files:

### Pillar 1: Hybrid Pre-Commit Prefix Stability Gate
* **File:** [`.claude/hooks/pre-commit-prefix-stability.sh`](.claude/hooks/pre-commit-prefix-stability.sh) + [`.githooks/pre-commit`](.githooks/pre-commit)
* **Fast Filter (`< 2ms`, `0 tokens`):** Every non-commit `Bash` command exits `0` immediately via a shell regex check, and so does every `git commit` while `CLAUDE.md`, `AGENTS.md`, `.claude/`, and `.agents/` have no pending changes.
* **Commit Audit (not free, not local):** When a commit does touch those paths, a headless read-only evaluation (`claude -p --model haiku`) runs under your Claude Code login. It sends your context files and diff to the model and uses tokens. It verifies:
  1. `CLAUDE.md` / `AGENTS.md` stays `< 150 lines` (`~1,000 tokens`).
  2. Zero volatile task state (no checkboxes, issue IDs, or deadlines).
  3. Zero duplicate rules between Tier 1 (`CLAUDE.md`) and Tier 2 (`.claude/agents/`, `.claude/skills/`).
  4. Every referenced file path and script actually exists in the repository.

### Pillar 2: Progressive Disclosure via LSP & Whole-File Read Guard
* **Files:** [`.claude/hooks/guard-whole-file-reads.sh`](.claude/hooks/guard-whole-file-reads.sh) + [`scripts/agent-gates/check-lsp.sh`](scripts/agent-gates/check-lsp.sh)
* **Mechanism:** Claude Code's `LSP` tool (go to definition, find references, diagnostics after edits) stays off until you install a [code intelligence plugin](https://code.claude.com/docs/en/plugins/code-intelligence) for your language, and a language server on `PATH` is not enough on its own. The doctor and scanner check that the plugin is installed for the project folder (e.g. `claude plugin install typescript-lsp@claude-plugins-official`), not just enabled in settings, and that the binary it starts can run. For TypeScript that means `npm install -g typescript-language-server typescript@6`: TypeScript 7 no longer ships the `tsserver.js` the server needs.
* **References rule (opt-in):** When you choose LSP navigation, the generated `CLAUDE.md` asks Claude to use the `LSP` tool's references lookup for "who calls X" questions. Left to itself, Claude almost always reaches for grep, which conflates same-named symbols and misses aliased imports. It is off by default: it gave the only exact answers on Sonnet (2 of 6 runs) but cost 49–51% more.
* **Whole-File Read Guard:** A `PreToolUse` hook on `Read` blocks reading lockfiles, minified bundles, and source maps whole, and tells Claude to grep them or read a range instead. It replaces `permissions.deny` Read rules, which also block every Grep and `grep` of those files and made agents fail questions like "which version is locked". Upgrading from v0.1 removes the deny rules it added.

### Pillar 3: Transparent Observation Masking (`rtk`)
* **File:** [`.claude/hooks/rewrite-rtk.sh`](.claude/hooks/rewrite-rtk.sh) + [`scripts/agent-gates/check-rtk.sh`](scripts/agent-gates/check-rtk.sh)
* **Mechanism:** Passes each Bash command to `rtk hook claude`, rtk's own rewrite engine, through Claude Code's `updatedInput` protocol. Agents usually trim output themselves (`2>&1 | tail -40`), so a hook that skipped piped commands never fired; rtk rewrites the first stage of such pipelines and each part of `&&` chains. If `rtk` is not installed on `PATH`, the hook exits `0` in `< 1ms`.
* **Safety:** `python -m pytest` is left alone, because rtk would run whichever `pytest` is first on `PATH`. rtk refuses to rewrite commands with file redirects or `$(...)`. The project settings set `RTK_SUPPRESS_HOOK_WARNING=1`, since rtk's "no hook installed" notice only looks at global settings.
* **No auto-approval:** rtk approves a rewrite only when your own allow rules already match the command, and leaves deny rules to Claude Code. Commands like `npm test` run arbitrary project code, so otherwise your normal permission prompt applies.
* **rtk's own hook:** rtk ships a Claude Code hook of its own (`rtk init -g`). When it is configured, this hook stands down so commands are not rewritten twice. Install rtk with `brew install rtk` (or see [its install guide](https://github.com/rtk-ai/rtk#installation)), not `cargo install`: a different crate named `rtk` exists on crates.io.

### Pillar 4: Subagent Context Isolation
* **Files:** [`.claude/hooks/guard-subagent-isolation.py`](.claude/hooks/guard-subagent-isolation.py) + [`.claude/agents/orchestrator.md`](.claude/agents/orchestrator.md)
* **Mechanism:** Tracks consecutive `Read`, `Grep`, and `Glob` calls, plus Bash commands that only search or read (`grep`, `rg`, `find`, `cat`, `sed -n`, ...), per session in `/tmp/agent_context_forge/`. Claude Code searches through Bash by default on macOS and Linux. Calls made inside subagents (hook input carries an `agent_id`) are not counted.
* **Threshold:** Calls `1–14` pass silently (`< 5ms`, `0 tokens`). On call `15`, it adds a note (`additionalContext`) suggesting a subagent, without blocking the call, then re-arms for the next `15`. Denying the call only cost a retry in benchmarks, and agents did not delegate in response. Resets when `Agent`, `Write`, or `Edit` is called.

### Pillar 5: Episodic Memory & Lossy Compaction Handover
* **Files:** [`.claude/hooks/pre-compact-handover.sh`](.claude/hooks/pre-compact-handover.sh) + [`scripts/agent-gates/check-memory.sh`](scripts/agent-gates/check-memory.sh)
* **Mechanism:** Verifies Claude Code's native two-tier Auto-Memory (`~/.claude/projects/<slug>/memory/MEMORY.md`) on `SessionStart`, and triggers on `PreCompact` to print `git status -s` + `git diff --stat` and preservation rules. Claude Code uses a PreCompact hook's stdout as instructions for the compaction summary.
* **Auto-compaction check:** the scan, the HTML report and the session-start doctor say whether Claude Code will compact long sessions on its own, and which settings file decided it. With it off, a session grows until the context window is full: every request re-sends the whole conversation, and models answer less reliably as input grows. When it is off, the installer explains this and offers to turn it on for that project only (`"autoCompactEnabled": true` in `.claude/settings.local.json`, which overrides the user setting and stays out of git). `DISABLE_AUTO_COMPACT=1` can't be overridden by any setting, so the tool only reports it.

### Context Stability: Rules That Outlive Compaction, Rule Gates, and Drift Notes
* **Files:** [`.claude/hooks/context-stability.py`](.claude/hooks/context-stability.py) + `.claude/enforced-rules.json`
* **Rule capture:** on `UserPromptSubmit`, keeps the sentences of your prompts that state a rule ("always ...", "never ...", "from now on ...", "heads-up for later ...") in a per-session file under `/tmp/agent_context_forge/`. Before compaction, `PreCompact` asks the summary to carry them word for word; after it, `SessionStart` (source `compact`) re-injects them word for word, so they no longer depend on the summary. CLAUDE.md itself is reloaded by Claude Code after compaction.
* **Rule gates:** the checkable rules in `.claude/enforced-rules.json` are enforced by hooks instead of instructions. `command` rules check Bash commands (`when` / `require` / `forbid` / `unless` regexes, including `git commit -F` message files); `path` rules deny Edit/Write on globs, and Bash commands that write there through a redirection, `tee`, `sed -i`/`perl -i`, `cp`/`mv`/`install` or `dd of=`; `commit` rules require a file in the same commit (for example `CHANGES.md` whenever `src/*` changes, counting `git add` in the same command); `stop` rules are checked once before Claude finishes. A denial names the rule and how to comply. Commits in other repositories are left alone. Gates see tool calls, not intent: a write made inside a script or `python -c` is not seen by a `path` rule, and a command run inside a script is not the command a `command` rule reads.
* **Drift check at commit time:** a commit that deletes or renames a path still named by `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` or `.claude/rules/*.md` is denied until the instruction file is updated in the same commit; the message names the new path of a rename. It counts `git rm`, `git mv`, `git add` and `git commit -a` in the same command. Only paths the commit removes count, so references that were already stale never block unrelated work. The same holds for commands: a commit that removes a `package.json` script or a `Makefile` target that the instruction files run (`npm run x`, `pnpm x`, `npm test`, `make x`, in backticks or in code blocks) is denied. Workspace packages count, and a Makefile with includes or pattern rules is never second-guessed. A convention or symbol that goes stale is not caught. Outside Claude Code, `.githooks/pre-commit` runs the same check (`context-stability.py --check-staged`) once you set `git config core.hooksPath .githooks`.
* **Drift note:** at session start, names backticked paths, package scripts and make targets in those files that no longer exist, and tells Claude to trust the code over those lines. A path counts only when its first directory exists in the repo and it is neither the tail of a tracked path nor git-ignored, so package names, URLs and examples don't trigger it (no false notes on next.js, n8n, ruff, pydantic-ai or echo). Startup adds nothing when there is no drift, so the prompt prefix stays stable.
* **Context size notes:** on `UserPromptSubmit`, reads the size of the last request from the session transcript (at most the first and last MiB of the file) and, past `ACF_CONTEXT_NOTE_TOKENS` (default 150000) and again at each multiple, shows you a `systemMessage` with the size and its ratio to the first request. On `SessionStart` from `resume` or `fork`, when the cache has expired and the conversation is over 100k tokens, it says what resuming will re-send. Both go to you only: Claude never reads them, so they cost no tokens and leave the prompt prefix alone.
* **Measured:** the commit-time check, replayed over 4,262 commits with context files, fired once, on a real rename that left pydantic-ai's `CLAUDE.md` wrong for 37 commits. Rule capture showed no gain in our pilot runs (one run per arm) because Claude Code already kept every rule through one and three compactions; it is a safeguard for longer sessions, not a measured improvement.

### Session Start: Project Facts
* **File:** [`scripts/agent-gates/session-context.sh`](scripts/agent-gates/session-context.sh)
* **Mechanism:** Gives Claude a few stable facts that save discovery turns, such as how this project runs its tests (`uv run pytest`, `pnpm test`, `go test ./...`) and that `sed -i` needs `''` on macOS. Agents otherwise spent several turns trying `python`, `python3`, and finally `uv run`. Warnings from the environment doctor (missing rtk, language server, or plugin) go to you as a message instead of into Claude's context. The facts contain no paths, dates, or counts, so the prompt prefix stays identical across sessions and caches well.

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
| **Multi-LSP & Compressor Adapters** | Pluggable LSP & output masking alternatives beyond the official LSP plugins / `rtk` | 🚧 [Issue #2](https://github.com/Soufraz/agent-context-forge/issues/2), [Issue #3](https://github.com/Soufraz/agent-context-forge/issues/3) |

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
* **Anthropic & Claude Code:** For native compiler-backed code intelligence through LSP plugins, deterministic shell lifecycle hooks (`SessionStart`, `PreToolUse`, `PreCompact`), and machine-local two-tier Auto-Memory.
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
