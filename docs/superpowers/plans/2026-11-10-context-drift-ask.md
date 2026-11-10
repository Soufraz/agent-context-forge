# Context Drift Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a turn changes the core of a project, Claude asks the user in the terminal whether to update the context files, naming the statements that became false.

**Architecture:** One new stdlib-Python hook, `.claude/hooks/context-drift.py`, on `SessionStart` and `Stop`. It keeps a per-session snapshot of the project's text files, diffs the current tree against it at `Stop`, sends the context files and the diff to one `claude -p --model haiku` call, verifies the quotes in the answer, and returns a blocking Stop decision that tells Claude to ask the user with `AskUserQuestion`. The scaffolder wires it on for new installs and only on opt-in for existing acf projects.

**Tech Stack:** Python 3 stdlib (hook), Node ESM (`src/scaffolder.js`, `src/index.js`), `node:test` and bash tests, the `claude` CLI.

**Spec:** `docs/superpowers/specs/2026-11-10-context-drift-ask-design.md`. Judge prototype to port (session scratch, copy what you need): `/private/tmp/claude-501/-Users-soufraz-Projects-agent-context-forge/0f001cc2-7506-4515-9a1f-ca1078f5dfeb/scratchpad/detectors/C-haiku-judge/{prompt.md,detect.py}` (`walk`, `read_text`, `udiff`, `build_inputs`, `quote_found`, `evidence_found`, `SCHEMA`, `main`). Scorer and corpora: `.../scratchpad/score.py`, `.../scratchpad/fixtures` (dev), `.../scratchpad/heldout`.

## Global Constraints

- Hook is Python 3 standard library only, run as `python3`; no new npm dependencies; macOS and Linux.
- Hook never raises to the user: any error is silent and allows the stop (fail open).
- Judge: `claude -p --model haiku` with `--settings '{"hooks":{}}'`, timeout 150 s, cost cap $0.05 (keep the prototype's flag), diff truncated at 40,000 characters.
- The hook's `Stop` timeout in `settings.json` must exceed the judge timeout (use 180).
- Nothing edits the context files without the user's yes. Asks at most once per stop (`stop_hook_active`) and never twice for identical findings.
- Off switch: environment variable `ACF_CONTEXT_DRIFT=off` (read by the hook; settable in the `settings.json` `env` block).
- Rollout: new install on by default; existing acf project (a `.claude/context-forge.json` already exists) gets it only if it opts in; both paths print the disclosure that source diffs are sent to a model.
- Repo rules: this repo's `CLAUDE.md` stays under 150 lines and gets a pointer line; README and CLI wording change in the same commit as behavior; commits are small and start `feat:`/`fix:`/`docs:`/`test:`; `npm test` and `./.claude/hooks/pre-commit-prefix-stability.sh` must pass; every README claim has evidence under `benchmarks/`.
- Work on branch `feat/context-drift-ask`, not `main`.

## Review Focus

1. Secrets: `.env*`, `*.pem`, `id_rsa*`, `*secret*`, `credentials*` never enter a snapshot, a diff or a prompt (Task 2).
2. Compaction and resume fire `SessionStart` again: the existing snapshot must survive, or the turn's changes vanish (Task 2).
3. A project with no context files has nothing to be stale: silent, no model call (Task 2).
4. The nested `claude -p` must not trigger this hook again: hooks disabled and `ACF_CONTEXT_DRIFT=off` in its environment, or it recurses (Task 2).
5. `claude` missing from PATH, a timeout, or an over-cap tree: silent allow, never a blocked session (Task 2).

## File Structure

- Create `.claude/hooks/context-drift.py`: snapshot, diff, gate, judge, ask. One file, one job; `context-stability.py` is already 32 KB and is not touched.
- Modify `src/scaffolder.js`: `contextDrift` option, new-install vs upgrade, hook wiring and copy, manifest key.
- Modify `src/index.js`: wizard prompt and disclosure.
- Modify `tests/run-tests.sh` (new section 8) and `tests/cli.test.js`.
- Create `benchmarks/context-drift/README.md`; modify `README.md`, `CLAUDE.md`.

### Task 1: Spike, can a blocking Stop hook make Claude ask?

Throwaway; nothing here ships. Needs a human at the terminal for step 3.

**Files:** scratch project in `$TMPDIR` only; the result is recorded in the spec's "Open technical risk" section.

**Interfaces:** Produces: the confirmed Stop output shape (`{"decision":"block","reason":...}` vs `hookSpecificOutput.additionalContext`), whether `AskUserQuestion` is callable after it, and the signal that distinguishes a non-interactive session (`claude -p`).

- [ ] **Step 1:** In a scratch project, add a Stop hook script that, when `stop_hook_active` is false, prints `{"decision":"block","reason":"Before finishing, use AskUserQuestion to ask: 'Update the context files?' with options 'Update now', 'Skip this change'."}`; when true, prints nothing.
- [ ] **Step 2:** Run `claude -p "say hi"` there; record whether the hook ran, and which stdin fields or environment variables differ from an interactive session (the non-interactive signal).
- [ ] **Step 3 (human):** Open an interactive session, send "say hi". Expected: Claude continues after finishing and shows the question; answering ends the turn without a loop.
- [ ] **Step 4:** Repeat step 1 with `hookSpecificOutput.additionalContext` instead (the shape `context-stability.py` uses). Record whether Claude continues.
- [ ] **Step 5:** Write the findings into the spec under "Open technical risk". If `AskUserQuestion` is unavailable, record the plain-text fallback wording and use it in Task 3.

### Task 2: Snapshot, diff, gate and judge

**Files:**
- Create: `.claude/hooks/context-drift.py`
- Modify: `tests/run-tests.sh` (add section `[8/8]`; renumber the existing `[n/7]` headers to `[n/8]`)

**Interfaces:**
- Produces (inside `context-drift.py`):
  - `Change = tuple[str, str, str | None, str | None]` (rel path, `'A'|'M'|'D'`, old text, new text)
  - `take_snapshot(root: Path, state: Path) -> bool` (False when over the file or byte cap)
  - `turn_changes(root: Path, state: Path) -> list[Change]` (content diff against the snapshot)
  - `needs_judging(changes: list[Change], context_rels: set[str]) -> bool` (true if any non-test, non-doc source or manifest file changed, or any context file changed)
  - `judge(context: dict[str, str], changes: list[Change]) -> list[dict] | None` (findings with `context_quote`, `diff_evidence`, `severity`, `reason`; `None` on any failure)
  - `verify(findings, context, diff_text) -> list[dict]` (drops findings whose quote or evidence is not verbatim present)
  - `main()` also accepts `--judge-dirs BEFORE AFTER`, printing `{"ask": bool, "reasons": [str], "stale_files": [str]}` so `score.py` can run it.
- Consumes: the prototype's prompt (embed it as a `PROMPT` constant, so the installed hook is one file).

- [ ] **Step 1: Write failing tests** in `tests/run-tests.sh` section 8. Use a temp project and a stub `claude` placed first on `PATH` that records its arguments and prompt to a file and prints a canned structured result. Test names and assertions:
  - "Session start takes a snapshot and says nothing" (empty stdout).
  - "A turn with no content change never calls the judge" (stub log empty).
  - "A docs-only or tests-only turn never calls the judge".
  - "A changed manifest sends the diff and the context files to the judge" (stub prompt contains the `+` line and the CLAUDE.md text).
  - "A change made through Bash gets a real diff" (file rewritten with `sed`, not an edit tool, appears in the prompt).
  - "Findings whose quote is not in the context files are dropped".
  - "Secrets never reach the prompt" (`.env`, `key.pem`, `credentials.json` changed, absent from the stub's prompt).
  - "Compaction and resume keep the snapshot" (second `SessionStart` with `source: "compact"` after an edit still yields that edit in the next Stop).
  - "No context files means no judge call".
  - "The judge runs with hooks disabled and ACF_CONTEXT_DRIFT=off in its environment" (stub log shows both).
  - "Missing claude, a stub that exits non-zero, a stub that sleeps past the timeout, and an over-cap tree all allow the stop silently".
- [ ] **Step 2:** Run `./tests/run-tests.sh`; expected: section 8 fails, sections 1-7 pass.
- [ ] **Step 3:** Implement the functions above in `context-drift.py`, porting `walk`, `read_text`, `udiff`, `quote_found` and `evidence_found` from the prototype; add the secret-name skip list and a total file-count and byte cap; snapshot copies live in `/tmp/agent_context_forge/drift_<session>/snapshot/`; `SessionStart` with an existing snapshot (any `source`) does nothing; `Stop` refreshes the snapshot after judging or skipping.
- [ ] **Step 4:** Run `./tests/run-tests.sh`; expected: all sections pass.
- [ ] **Step 5 (acceptance):** Run `python3 score.py "python3 .claude/hooks/context-drift.py --judge-dirs" --jobs 4` against both corpora (`--fixtures` for `heldout`). Acceptance bounds, not guarantees: dev recall at least 23/24 with 0 false alarms; held-out recall at least 20/24 with at most 1 false alarm. If outside them, compare the embedded prompt with the prototype's before touching anything else.
- [ ] **Step 6:** Commit `feat: add the context drift hook (snapshot, diff, judge)`.

### Task 3: Ask output, dedupe, off switch

**Files:**
- Modify: `.claude/hooks/context-drift.py`, `tests/run-tests.sh` (section 8)

**Interfaces:**
- Consumes: `judge`, `verify`, `turn_changes` from Task 2; the output shape and non-interactive signal recorded by Task 1.
- Produces: `findings_hash(findings: list[dict]) -> str` (sha256 of sorted `context_quote` + `diff_evidence`), `ask_reason(findings: list[dict]) -> str`, `handle_stop(data: dict) -> dict | None`.

- [ ] **Step 1: Write failing tests** (stub judge returning one verified finding):
  - "Stop returns a blocking decision whose reason quotes the stale sentence and the change".
  - "The reason offers Update now, Skip this change and Turn this check off for this project" and names `.claude/settings.local.json` and `ACF_CONTEXT_DRIFT` for the third.
  - "stop_hook_active true returns nothing and still refreshes the snapshot".
  - "The same findings are never asked twice" (second turn with an identical finding returns nothing; a different finding asks again).
  - "ACF_CONTEXT_DRIFT=off returns nothing and never calls the judge".
  - "A non-interactive session is skipped" (using the signal from Task 1).
  - "Malformed input never breaks the session".
- [ ] **Step 2:** Run `./tests/run-tests.sh`; expected: the new tests fail.
- [ ] **Step 3:** Implement `findings_hash`, `ask_reason` and `handle_stop`; record the hash in the session state dir at the moment of asking. The reason text must tell Claude to edit the context files minimally on "Update now", keeping them short and free of task state.
- [ ] **Step 4:** Run `./tests/run-tests.sh`; expected: all pass.
- [ ] **Step 5:** Commit `feat: ask the user before ending a turn that made context stale`.

### Task 4: Scaffolder wiring and rollout

**Files:**
- Modify: `src/scaffolder.js` (`HARNESS_HOOK_SCRIPTS`, `scaffoldProject`)
- Test: `tests/cli.test.js`

**Interfaces:**
- Produces: `scaffoldProject(targetDir, { contextDrift: 'on' | 'off' | undefined, ... })`. Resolution when undefined: no previous `.claude/context-forge.json` means `'on'`; a previous manifest means its stored `contextDrift`, or `'off'` if the key is absent. The manifest gains `contextDrift`.
- Consumes: `isHarnessHook`/`mergeSettings` behavior (adding the script to `HARNESS_HOOK_SCRIPTS` makes re-installs replace or drop its entries).

- [ ] **Step 1: Write failing tests** (`node:test`, temp dirs like the existing scaffold tests):
  - "scaffoldProject: a new install wires context-drift.py on SessionStart and Stop with a Stop timeout above 150".
  - "scaffoldProject: re-running on an existing acf project without the option does not add the hook".
  - "scaffoldProject: re-running with contextDrift 'on' adds it, and the manifest records it".
  - "scaffoldProject: contextDrift 'off' on a project that had it removes its hook entries and keeps user hooks".
  - "scaffoldProject: the hook script is installed executable only when on".
- [ ] **Step 2:** Run `node --test tests/cli.test.js`; expected: the new tests fail.
- [ ] **Step 3:** Implement: add `.claude/hooks/context-drift.py` to `HARNESS_HOOK_SCRIPTS`; resolve `contextDrift` as above; when on, copy the script (`isExecutable` true) and add `{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/context-drift.py"', timeout: 180 }` to the `SessionStart` group and `Stop`; write `contextDrift` into the manifest.
- [ ] **Step 4:** Run `npm test`; expected: pass.
- [ ] **Step 5:** Commit `feat: install the context drift hook (on for new installs, opt-in on upgrades)`.

### Task 5: Wizard question and disclosure

**Files:**
- Modify: `src/index.js` (`runCustomizationWizardAndScaffold`, before the scaffold call at line ~435)
- Test: `tests/cli.test.js` (only what the wizard's pure helpers allow; the prompts themselves are not unit tested in this repo)

**Interfaces:**
- Consumes: Task 4's `contextDrift` option and the existing-manifest check.
- Produces: `explainContextDrift(): string` (the disclosure text, exported for the test) and a `p.confirm` whose `initialValue` is true for a new install and false for an existing acf project.

- [ ] **Step 1: Write failing test** "explainContextDrift: states that source diffs are sent to a model through claude -p under the user's login, the typical cost, and the off switch".
- [ ] **Step 2:** Run `node --test tests/cli.test.js`; expected: fails (undefined export).
- [ ] **Step 3:** Implement `explainContextDrift`, show it with `p.log.warn`, ask with `p.confirm`, pass the answer as `contextDrift: 'on' | 'off'`. The wording follows the commit-gate disclosure in the README.
- [ ] **Step 4:** Run `npm test`; expected: pass. Run `node bin/cli.js` in a scratch directory by hand to read the prompt once.
- [ ] **Step 5:** Commit `feat: ask about the context drift check in the wizard, with a disclosure`.

### Task 6: Docs, evidence and the real-world check

**Files:**
- Create: `benchmarks/context-drift/README.md`
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1:** Write `benchmarks/context-drift/README.md`: method (two synthetic corpora of 48 scenarios, held-out written blind), the table from the spec including the two free detectors' collapse, the limits (synthetic, 24 negatives, not measured on real sessions, 0 of 3 "incomplete" cases caught), and the prompt. Do not add the corpora.
- [ ] **Step 2:** Add a README row and section for the check beside the commit gate: what it sends, cost and delay, the off switch, the opt-in rule for upgrades; link the benchmark. Add one pointer line for the hook to this repo's `CLAUDE.md` section 3 (keep it under 150 lines).
- [ ] **Step 3:** Run `npm test` and `./.claude/hooks/pre-commit-prefix-stability.sh`; expected: both pass.
- [ ] **Step 4:** Commit `docs: document the context drift check and its evidence`.
- [ ] **Step 5 (human, then record):** Install into a copy of `todo-acf`, send the Python/Flask rewrite prompt from the conversation, and note whether Claude asks and which lines it names. Then run three ordinary sessions and count false asks; add the counts to `benchmarks/context-drift/README.md` as real-session results, whatever they are.
