> [!NOTE]
> **Early project.** Expect breaking changes before 1.0. What is measured so far, and how: **[benchmarks/](benchmarks/README.md)**.

<div align="center">

# 🛠️ Agent Context Forge

**A starting foundation for new agent-written projects: context files, settings and hooks that stay true as the repo changes, and a CLI that lets you pick today's popular tools for each pillar of context engineering.**

[![Context Engineering](https://img.shields.io/badge/Architecture-5%20Pillars-success)](#2-pick-your-tools-pillar-by-pillar)
[![Engine Support](https://img.shields.io/badge/Engine-Claude%20Code%20%7C%20Universal%20Git-blue)](#portability--roadmap)
[![Zero Telemetry](https://img.shields.io/badge/Privacy-Zero%20Telemetry-brightgreen)](#license)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## Quickstart

Run it in an **empty folder** to start a new project, or in an **existing repository** to audit or install the setup:

```bash
npx agent-context-forge
```

<p align="center">
  <img src="assets/demo.gif" alt="Agent Context Forge Interactive CLI Scaffolding Demo" width="900">
</p>

* **Empty folder, or Install mode:** a wizard asks one question per pillar and layer, then writes the setup.
* **Existing repository:** scores the current setup against the five pillars and opens an HTML report, or installs the setup.

---

## What It Is

Two things:

1. **A good starting foundation.** Context files (`CLAUDE.md`, `AGENTS.md`), Claude Code settings and hooks that keep that context true, and keep it alive, as the repo changes over many edits and long sessions.
2. **A starter CLI with choices.** For each pillar of context engineering, and for the planning layer on top, it explains the idea and lets you pick one of today's popular tools, with a sensible default.

It does not dictate how you plan or build features. It is the **Layer 1** foundation under whatever **Layer 2** methodology you use:

<p align="center">
  <img src="assets/diagrams/two-layer-architecture.svg" alt="The 2-Layer Stack: Harness vs. Methodology" width="880">
</p>

The guiding idea: the **context window is RAM** (finite, and attention thins as it fills), and the **repository, language servers and memory are disk** (queried on demand).

---

## 1. A Foundation That Stays True

### What install writes

* **A lean `CLAUDE.md`** with only rules that change how Claude works, since every line is sent with every request. Notes for you sit in an HTML comment, which Claude Code strips. An existing `AGENTS.md` is imported with `@AGENTS.md`, since Claude Code reads only `CLAUDE.md` when both exist.
* **Optional project context.** Describe what you are building in the wizard to generate a tailored `CLAUDE.md`, `AGENTS.md` and `.agents/rules/project-architecture.md`.
* **`.claude/settings.json`** with the hooks below, an environment doctor (`scripts/agent-gates/doctor.sh`), and a plain-git pre-commit hook (`.githooks/pre-commit`).
* **Project facts at session start** ([`session-context.sh`](scripts/agent-gates/session-context.sh)): how this project runs its tests (`uv run pytest`, `pnpm test`, `go test ./...`) and that `sed -i` needs `''` on macOS, so agents don't spend turns guessing. No paths, dates or counts, so they stay identical across sessions. Doctor warnings go to you, not to Claude.
* **Safe on existing repos.** `.claude/settings.json` is merged (your permissions and hooks kept, a `.bak` saved first). Your `CLAUDE.md`, `AGENTS.md`, agents, rules and git hooks are replaced only while unchanged since the last install; otherwise the new version is written beside them as `<file>.context-forge-new` for you to merge.

### Hooks that keep the context true

Models follow instructions well, and Claude Code keeps them well: in our pilots, Sonnet kept every rule of a session through one and through three compactions, and ignored stale `CLAUDE.md` lines when the code showed they were wrong. So these hooks don't promise that agents remember more. They check things that hold whatever the model does, and each says where it stops.

| Hook | What it does | Where it stops | Evidence |
| :--- | :--- | :--- | :--- |
| **Rule gates** | Rules in `.claude/enforced-rules.json` block the matching tool call: Bash commands that must or must not contain something, Edit/Write on protected paths, files that must change in the same commit, a check before Claude finishes. A denial names the rule and the fix. | Gates see tool calls, not intent: a path rule also sees Bash redirections, `tee`, `sed -i`/`perl -i`, `cp`/`mv`/`install` and `dd of=`, but not a write inside a script or `python -c`; a command run inside a script passes a command rule. | Holds by construction; covered by the test suite. Turning instruction files into executable checks raised compliance from 67% to 88% in [ContextCov](https://arxiv.org/abs/2603.00822). |
| **Drift check** | Stops a commit that deletes or renames a path, or removes a package script or make target, that `CLAUDE.md`, `AGENTS.md` or `.claude/rules` still name, naming the new path of a rename. Works in Claude Code and, with `core.hooksPath`, in plain git. At session start, tells Claude which named paths, scripts and targets are already gone. No model. | Paths, package scripts and make targets only: a stale convention or symbol passes. A bare `pnpm x` is judged only when `node_modules` is installed, since it may run a dependency's binary. | Replayed over 4,262 commits with context files: it fired once, on a real rename that left pydantic-ai's `CLAUDE.md` wrong for 37 commits. No false notes on next.js, n8n, ruff, pydantic-ai or echo. The command half gave no false notes and no real hits over 254 commits, so its recall is not measured yet. [Replay data](benchmarks/README.md#drift-check-replay-no-model). |
| **Rule capture** | Keeps the rules you state in chat and re-injects them word for word after compaction. | Only sentences phrased as rules ("always ...", "never ...", "from now on ..."). | No measured gain: in the [pilots](benchmarks/README.md#context-stability-pilots-one-run-per-arm), Claude Code already kept every rule. A safeguard for longer sessions. |
| **PreCompact handover** | Before compaction, adds `git status -s`, `git diff --stat` and preservation rules to the instructions for the summary. | It shapes the summary; it can't force what the summary keeps. | Not measured separately. |
| **Auto-compaction check** | The scan, the report and the session-start doctor say whether Claude Code will compact long sessions on its own, and which settings file decided. When it is off, the installer offers to turn it on for this project only (`"autoCompactEnabled": true` in `.claude/settings.local.json`, kept out of git). | `DISABLE_AUTO_COMPACT=1` can't be overridden by any setting, so it is only reported. | Not measured. |
| **Context size notes** | Tells you, never Claude, when the conversation passes 150k tokens and again at each multiple, and what resuming a large session with an expired cache will re-send. | A note, not an action: you decide whether to `/compact` or `/clear`. `ACF_CONTEXT_NOTE_TOKENS` changes the threshold; `0` turns it off. | Claude Code re-sends the whole conversation on every request ([prompt caching docs](https://code.claude.com/docs/en/prompt-caching)). The note itself is not measured. |

<details>
<summary><b>How these hooks work</b> (all in <a href=".claude/hooks/context-stability.py"><code>context-stability.py</code></a> unless noted)</summary>

* **Rule capture:** `UserPromptSubmit` stores rule sentences per session under `/tmp/agent_context_forge/`; `PreCompact` asks the summary to keep them; `SessionStart` (source `compact`) re-injects them word for word. Claude Code reloads `CLAUDE.md` itself after compaction.
* **Rule gates:** `command` rules (`when` / `require` / `forbid` / `unless` regexes, including `git commit -F` message files), `path` rules (globs), `commit` rules (e.g. `CHANGES.md` whenever `src/*` changes) and `stop` rules. Commits in other repositories are left alone. A no-op until the file has rules.
* **Drift check:** covers `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` and `.claude/rules/*.md`, and counts `git rm`, `git mv`, `git add` and `git commit -a` in the same command. Only paths the commit removes count, so already-stale references never block unrelated work. Commands count when the files run them (`npm run x`, `pnpm x`, `npm test`, `make x`); a Makefile with includes or pattern rules is never second-guessed. In plain git, [`.githooks/pre-commit`](.githooks/pre-commit) runs the same check after `git config core.hooksPath .githooks`.
* **Drift note:** a path counts only when its first directory exists and it is neither the tail of a tracked path nor git-ignored, so package names, URLs and examples don't trigger it. Nothing is added when there is no drift.
* **Context size notes:** read the last request's size from the session transcript and show it as a `systemMessage`. On `resume` or `fork`, the note appears when the cache has expired and the conversation is over 100k tokens. Claude never sees them.
* **PreCompact handover:** [`pre-compact-handover.sh`](.claude/hooks/pre-compact-handover.sh); Claude Code uses its stdout as instructions for the summary.

</details>

---

## 2. Pick Your Tools, Pillar by Pillar

The wizard asks one question per pillar and one for the planning layer. Each choice has a default, so pressing Enter all the way gives a working setup.

### Pillar 1: Prefix stability

* **What it is:** keeping the always-loaded instructions (`CLAUDE.md`, `AGENTS.md`) short and free of volatile state.
* **Why it matters:** these files ride along on every turn. In an agent-written project they collect sprint checklists, issue numbers and dead paths, which dilute the rules that matter.
* **What you get (no choice, always installed):** a commit gate, [`pre-commit-prefix-stability.sh`](.claude/hooks/pre-commit-prefix-stability.sh). Every other Bash command, and every commit that leaves `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.agents/` alone, passes through a shell regex in milliseconds. When a commit touches those paths, it runs a read-only check with `claude -p --model haiku` under your Claude Code login. That call sends your context files and diff to the model and uses tokens. It checks that the files stay under 150 lines, hold no volatile task state (checkboxes, issue IDs, deadlines), don't duplicate rules between `CLAUDE.md` and `.claude/agents/` or `.claude/skills/`, and name only paths and scripts that exist.

### Pillar 2: Progressive disclosure

* **What it is:** letting the agent look things up on demand (symbols, line ranges, grep) instead of loading whole files.
* **Why it matters:** a lockfile, minified bundle or source map read whole floods the context with noise.
* **Always installed:** a `PreToolUse` guard, [`guard-whole-file-reads.sh`](.claude/hooks/guard-whole-file-reads.sh), that blocks whole-file reads of those files and tells Claude to grep or read a range. Grepping them still works. (It replaces `permissions.deny` Read rules, which also blocked every grep of those files; upgrading from v0.1 removes them.)
* **What you can pick:**
  * **Text search** *(default)*: adds nothing. Claude Code searches with grep and reads line ranges.
  * **Claude Code native LSP** *(opt-in)*: definitions, references and diagnostics through a [code intelligence plugin](https://code.claude.com/docs/en/plugins/code-intelligence) for your language (e.g. `claude plugin install typescript-lsp@claude-plugins-official`); a language server on `PATH` alone is not enough, and the doctor checks both. For TypeScript, use `typescript@6`: TypeScript 7 no longer ships the `tsserver.js` the server needs. This choice adds a `CLAUDE.md` rule to prefer LSP references for "who calls X", since grep conflates same-named symbols and misses aliased imports. It is opt-in because it gave the only exact answers on that task but [cost more](benchmarks/README.md#cost-and-correctness-round-4-021-harness-6-paired-runs-per-arm).
  * **Bring your own** code intelligence tool or MCP: recorded in the manifest and, if you describe your project, named in the generated `CLAUDE.md`. Nothing is installed for it.

### Pillar 3: Observation masking

* **What it is:** filtering what tool output the agent sees.
* **Why it matters:** test and build runs dump hundreds of passing lines and ANSI codes into the conversation, where they stay for the rest of the session.
* **What you can pick:**
  * **[`rtk`](https://github.com/rtk-ai/rtk)** *(default)*: a [`PreToolUse` hook](.claude/hooks/rewrite-rtk.sh) passes each Bash command to rtk's own rewrite engine, which collapses passing suites and keeps failures, including in pipelines and `&&` chains (`uv run pytest -q | tail -40` becomes `uv run rtk pytest -q | tail -40`). `python -m pytest` and commands with file redirects or `$(...)` are left alone. Your normal permission prompts still apply. If rtk's own hook (`rtk init -g`) is set up, this one stands down; without rtk on `PATH`, it does nothing. Install with `brew install rtk` ([guide](https://github.com/rtk-ai/rtk#installation)), not `cargo install`, which fetches a different crate; the installer offers to do it.
  * **Bring your own** output filter: no hook is installed; if you describe your project, the generated `CLAUDE.md` names it.

### Pillar 4: Context isolation

* **What it is:** sending sprawling searches to a subagent, so the main conversation keeps only the conclusion.
* **Why it matters:** long inline exploration fills the main context before a line of code is written, and the details that matter get lost in the middle.
* **What you can pick:**
  * **Exploration guardrail** *(default)*: [`guard-subagent-isolation.py`](.claude/hooks/guard-subagent-isolation.py) counts consecutive reads and searches in the main session (`Read`, `Grep`, `Glob`, and Bash `grep`, `rg`, `find`, `cat`, `sed -n`, ...) and adds a non-blocking note suggesting a subagent every 15th call. It resets on `Agent`, `Write` or `Edit`. (Blocking instead only cost a retry in our runs; agents did not delegate in response.)
  * **Orchestrator template:** [`.claude/agents/orchestrator.md`](.claude/agents/orchestrator.md), an agent whose `tools` allowlist leaves out `Edit` and `Write`, so it plans and delegates.
  * **Both.**

### Pillar 5: Episodic memory

* **What it is:** keeping lessons and state across sessions and compactions, outside the repo's instruction files.
* **Why it matters:** compaction summaries drop exact `file:line` pointers and open hypotheses, and a new session starts from nothing.
* **What you can pick:**
  * **Claude Code Auto-Memory** *(default, no setup)*: the doctor ([`check-memory.sh`](scripts/agent-gates/check-memory.sh)) checks the two-tier `MEMORY.md` index and topic files at session start. The PreCompact handover and rule capture above work with it.
  * **[`context-mode`](https://github.com/mksglu/context-mode)**: an MCP server for context virtualization (SQLite FTS5/BM25). Install writes `.claude/context-mode-guide.md` with setup steps; you install the server yourself.

### Layer 2: Planning methodology (optional)

Layer 1 doesn't decide how you brainstorm, plan or review. Pick one, or none, and the wizard adds a short section to `CLAUDE.md` that points Claude at it. Install the methodology itself from its own docs.

* **None / decide later** *(default)*. Classic TDD or plain pair programming work fine on top of Layer 1.
* **[Superpowers](https://github.com/obra/superpowers)** (`obra/superpowers`): subagent-driven development with a red-green-refactor loop.
* **[GetShitDone, GSD](https://github.com/open-gsd/gsd-core)** (`open-gsd/gsd-core`): contract-first phases (discuss, plan, execute, verify) run in isolated subagents.
* **[Everything Claude Code, ECC](https://github.com/affaan-m/everything-claude-code)** (`affaan-m/everything-claude-code`): plan-test-implement-review-verify cycles with modular skills and agents.
* **[Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)** (`google/elephant-goldfish-model`): long-horizon memory on disk (the Elephant), fresh zero-context reviewers (the Goldfish).

Subagents these methodologies spawn run under the same project hooks and settings.

---

## Audit a Repo You Already Have

In an existing repository, choose **Scan**. It scores the setup against the five pillars in under 2 seconds and opens `.agent-context-report.html`. No model, no network.

<p align="center">
  <img src="assets/report-mocks/suggestion1-executive-dashboard.svg" alt="Context Health Audit Dashboard Simulation" width="880">
</p>

* **Score (0–100, grade A–F):** a setup checklist for the five pillars as this tool defines them, not a benchmark. A hook counts only when it is wired in settings and its script exists; equivalents count (rtk's own `rtk init -g` hook, any `PreCompact` or `SessionStart` `compact` hook). Two checks (16 points) look for this harness's own commit gate and exploration guardrail.
* **Measurements:** the size of the always-loaded instruction file (lines, approximate tokens), how large a whole-file read of an unprotected lockfile would be, and whether auto-compaction is on.
* **`file:line` findings:** volatile markers (`TODO`, checkboxes, dates) and dead paths in `CLAUDE.md` / `AGENTS.md`.
* **Fixes:** offers to install missing tools (`rtk`, `typescript-language-server`, `pyright`) and prints the code intelligence plugin for your language.

---

## See What Your Sessions Carry

```bash
npx agent-context-forge usage          # this project's sessions, last 30 days
npx agent-context-forge usage --all    # every project; --days N, --json
```

A visibility tool. It reads the session transcripts Claude Code keeps in `~/.claude/projects` and shows the context size per request, the fixed prompt on a session's first request, compactions, the heaviest sessions, and how the load splits between re-sent context, cache writes, output and fresh input (weighted at standard price ratios, not dollars). It suggests a change only where the numbers call for one, such as turning on auto-compaction or trimming plugins, skills and MCP servers that load on every request. No model, no network; subagent transcripts are not counted.

---

## Is It Safe to Adopt?

We check that the default setup doesn't make Claude Code worse than a plain setup. In paired runs on real open-source repos, graded against ground truth worked out without a model, the default setup was as correct as plain Claude Code on every measured task but one: on the hardest (find every caller of a function), neither usually succeeds (1 exact answer in 6 for plain Claude Code, 0 for the default). The opt-in LSP rule gave the only reliable exact answers there.

On cost, the check is for no harm, not for savings:

In the latest round (the default setup against plain Claude Code, five task types on Sonnet and Haiku, 6 pairs each, one folder per arm as in a real project), cost was:

* **Lower on 3 of 8:** fixing failing tests (−27% Sonnet, −49% Haiku) and a six-prompt session on Sonnet (−9%).
* **No clear difference on 3:** a lockfile question, explaining a request path, and finding callers on Haiku.
* **Higher on 2:** finding callers on Sonnet (+11%, 90% interval +1 to +21%) and the six-prompt session on Haiku (+23%, +5 to +42%).

So it is not free everywhere. On Sonnet test fixing, the project facts cut attempts to run the tests without `uv` from 9 to 1 across the six runs; the two higher arms are not explained yet.

An earlier round reported savings that a benchmark bug had inflated; it is kept for the record. Method, tasks, confidence intervals and every run: **[benchmarks/README.md](benchmarks/README.md)**.

---

## Portability & Roadmap

The hooks target **Claude Code** and **plain Git** today. The gates in `scripts/agent-gates/` are POSIX shell and Python, so they can be adapted to other runtimes.

| Agent / Runtime | Integration | Status |
| :--- | :--- | :--- |
| **Claude Code** | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PreCompact` and `Stop` hooks in `.claude/settings.json` | ✅ Supported |
| **Plain Git (CLI / IDEs)** | `.githooks/pre-commit` | ✅ Supported |
| **Gemini CLI / Antigravity** | `.agents/rules/` + tool execution policy adapters | 🚧 [Issue #1](https://github.com/Soufraz/agent-context-forge/issues/1) |
| **OpenCode / Aider** | `AGENTS.md` + `.agents/` | 🚧 [Issue #1](https://github.com/Soufraz/agent-context-forge/issues/1) |
| **More LSP and output-filter adapters** | Alternatives to the official LSP plugins and `rtk` | 🚧 [Issue #2](https://github.com/Soufraz/agent-context-forge/issues/2), [Issue #3](https://github.com/Soufraz/agent-context-forge/issues/3) |

---

## Running the Self-Test Suite

Node.js unit tests (CLI, scaffolder, scanner, HTML report) and shell integration tests (hooks and their fast paths):

```bash
git clone https://github.com/Soufraz/agent-context-forge.git
cd agent-context-forge
npm install
npm test
```

---

## Credits

This project invents little. It brings proven open-source tools and ideas together into one starting setup, and lets you swap them. Thanks to:

* **[`rtk`](https://github.com/rtk-ai/rtk)** by [@rtk-ai](https://github.com/rtk-ai): the output filter behind Pillar 3, which collapses passing test suites and keeps failures.
* **Anthropic and Claude Code:** code intelligence plugins, lifecycle hooks (`SessionStart`, `PreToolUse`, `PreCompact` and more) and two-tier Auto-Memory.
* **[`context-mode`](https://github.com/mksglu/context-mode)** by mksglu: SQLite FTS5/BM25 context virtualization over MCP.
* **[Superpowers](https://github.com/obra/superpowers)** by Jesse Vincent: subagent-driven development, strict TDD loops and structured planning.
* **[GetShitDone, GSD](https://github.com/open-gsd/gsd-core):** contract-first, phase-isolated spec workflows.
* **[Everything Claude Code, ECC](https://github.com/affaan-m/everything-claude-code)** by Affaan M: prompt-caching research, subagent patterns and engineering skills.
* **[The Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model):** the split between long-term disk memory and stateless, bias-free review.
* **[`@clack/prompts`](https://github.com/natemoo-re/clack)** and **[`picocolors`](https://github.com/alexeyraspopov/picocolors)** by Nate Moore and Alexey Raspopov: the terminal UI of the wizard.

---

## Contributing

Issues and pull requests are welcome, for example:
* Runtime adapters for **Gemini CLI / Antigravity**, **OpenCode / Aider**, **Cursor** or **Codex** ([Issue #1](https://github.com/Soufraz/agent-context-forge/issues/1))
* More tool choices for a pillar (language servers, output filters, memory tools)
* New scanner checks
* Hook edge cases and speed

See the **[Contributing Guide](CONTRIBUTING.md)** for setup, tests and PR guidelines.

---

## License

**[MIT](LICENSE)**. The CLI writes hooks, scripts and rule templates into your codebase, so the license puts no conditions on the projects you use it in: closed-source, personal, academic or commercial. You never have to open-source your project because you scaffolded it with `agent-context-forge`.
