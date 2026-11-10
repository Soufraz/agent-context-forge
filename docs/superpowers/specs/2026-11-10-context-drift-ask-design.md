# Context drift: ask the user when a turn changes core project context

## Intent

`acf` writes `CLAUDE.md`, `AGENTS.md` and `.agents/rules/project-architecture.md` from the user's
description of their project. Those files are sent with every request, so when they are wrong they
mislead every later turn. Today nothing tells the user when a coding agent has made them wrong:

- The commit gate (`.claude/hooks/pre-commit-prefix-stability.sh`) skips its audit unless a context file
  already has pending changes, so it never fires in the case that matters (agent changes the stack,
  leaves the context files alone). It also only runs on `git commit`, so it does nothing in a project
  without git.
- The drift check (`context-stability.py`) only sees removed paths, package scripts and make targets.
  "Stack: TypeScript / Node.js" going false is invisible to it.
- The generated `CLAUDE.md` carries no "update these when the project changes" instruction, and
  `enforced-rules.json` ships without a rule for it.

Goal: when a turn changes the core of the project, Claude asks the user in the terminal whether to update
the context files, naming what became false, before the turn ends. "Core" means: stack, purpose and scope
(including "deliberately not" statements), principles and constraints, architecture and flow, commands.
The user decides; nothing edits the context files without a yes.

## Evidence this design rests on

Dev set of 48 synthetic before/after scenarios, then a blind held-out set of 48 more written by agents that
never saw any detector (9 ecosystems, prose and template context files, keyword-bait negatives). 24 should
ask, 24 should not (including already-synced cases where the agent updated the files itself).

| Detector | Dev | Held-out caught | Held-out false alarms |
|---|---|---|---|
| Structural diff rules, no model | 24/24 | 5/24 | 0/24 |
| Claims-vs-reality checks, no model | 24/24 | 9/24 | 1/24 |
| One haiku call: context files + diff | 24/24 | 21/24 | 0/24 |

The free detectors were tuned on data they had read and did not generalize. The model judge was not
retuned on the held-out set. Its three misses are all "the context is still literally true but now
incomplete" (a new job system, a new tenancy rule, a new worker). About 7 s per check; about $0.001-0.002
typical, with two outliers near $0.18 in 5 full runs. Limits: synthetic scenarios written by a model, 24
negatives only (0 false alarms means an upper bound near 12%), not yet measured on real sessions.

Prototype to start from (session scratch, copy what you need into the repo):
`/private/tmp/claude-501/-Users-soufraz-Projects-agent-context-forge/0f001cc2-7506-4515-9a1f-ca1078f5dfeb/scratchpad/detectors/C-haiku-judge/`
(`prompt.md` is the rubric; `detect.py` is the harness: one `claude -p` call, structured JSON output,
quote verification, retry, cost cap, fail-open). Scorer: `.../scratchpad/score.py`. Corpora:
`.../scratchpad/fixtures` (dev) and `.../scratchpad/heldout`.

## Decided by the user

- Ask in the Claude terminal as a question, not a silent edit and not a hard block.
- Cover all core facts, not only the stack.
- The model is the detector; the free structural checks are not a gate in front of it.

## Design

1. **Baseline without git.** A hook keeps a snapshot of the project's text files using only the filesystem,
   so changes made by Bash (`npm install`, `cargo add`, `sed -i`) get a real diff like any other edit:
   - Take the snapshot at `SessionStart` into the hook's own state dir (not the `stability_<session>` dir the
     existing hook uses). After every `Stop`, once the judge has run (or been skipped), refresh it, so each
     diff covers exactly one turn.
   - At `Stop`, diff current files against the snapshot by content, not mtime, so dev servers, watchers and
     generated files that did not change content cause no noise. No content diff means no judge call.
   - Skip `.git`, `node_modules`, build output, lockfiles, binaries and files over a size cap. If the tree is
     over a total cap (file count or bytes), do nothing and allow the stop rather than guess.
   - This replaces any copy-on-first-touch idea; there is no `PreToolUse` hook in this design.
2. **When to judge.** At `Stop`, only if the turn changed at least one non-test, non-doc source or manifest
   file, or touched a context file (partial updates must still be checked). Docs-only, tests-only and
   formatting-only turns cost nothing.
3. **Judge.** One haiku call with the three context files and the unified diff, using the rubric
   from the prototype. It must quote the exact context sentence it says is stale; the hook drops findings
   whose quote is not in the files. Fails open on any error, timeout (150 s), or cost over the cap
   ($0.05). Runs with hooks disabled so it cannot recurse.
4. **Ask.** If findings survive, `Stop` returns a blocking decision whose reason tells Claude to use
   `AskUserQuestion` before finishing: name each stale statement and the change that caused it, offer
   "Update the context files now", "Skip this change" and "Turn this check off for this project". On yes,
   Claude edits the files minimally, keeping them short and free of task state per the existing
   prefix-stability rules. `stop_hook_active` makes it ask at most once per stop. "Skip this change" stores
   a hash of those findings so the same findings are not asked again; different findings ask again.
5. **Packaging.** A new script `.claude/hooks/context-drift.py` (stdlib Python) registered for
   `SessionStart` and `Stop` only. Installed by `src/scaffolder.js` like the other hooks, merged into
   `settings.json` with the same rules (user hooks kept, `.bak` saved). Its `Stop` timeout must exceed the
   judge's own timeout. It is a separate entry from the existing `context-stability.py` Stop hook; both
   may run on the same stop and must not share state files. Off switch: an environment variable set in the
   generated `settings.json` `env` block (name left to the builder), documented in the README.
6. **No human at the terminal.** Skip the check, allow the stop, when the session is non-interactive
   (`claude -p`, SDK, CI) if the hook can tell; the spike settles what signal exists. `SubagentStop` is
   not registered. Nothing here can loop: findings hash plus `stop_hook_active`.

## Goals

- Catches changes that make an existing context statement false, including meaning-level ones with no
  dependency change and no moved file.
- Near-zero false alarms: a user who gets two wrong asks will disable it.
- Works in a project with no git repository.
- Ordinary turns (no source change) add no latency and no cost.

## Non-goals

- Does not edit context files without the user's yes.
- Does not detect staleness that existed before the turn.
- Does not replace the commit gate or the existing drift check (paths, scripts, make targets).
- No claim that it catches "incomplete but still true" context reliably; it caught 0 of 3 such cases.

## Anti-goals (failure even if it technically works)

- Asking after every code turn, or twice about the same change.
- Looping the Stop hook, or blocking the user from ending a session.
- Sending code to a model without the user having been told (see below).
- Growing the generated `CLAUDE.md` to carry this: it must stay short and static.

## Constraints

- The judge sends the context files and the turn's diff to a model through `claude -p` under the user's
  login, as the commit gate already does. The README section for the commit gate states this; do the same
  here, and make the switch to turn it off easy to find.
- Repo conventions apply: `CLAUDE.md` of this repo stays under 150 lines and gets a pointer for the new
  hook; README and any CLI wording are updated in the same commit; small `feat:`/`docs:`/`test:` commits;
  `./tests/run-tests.sh` and `npm test` must pass; every README claim needs evidence under `benchmarks/`.
- macOS and Linux; Python 3 stdlib and the `claude` CLI only; no new npm dependencies.
- Hook scripts must never raise to the user: any error is silent and allows the stop.

## Spike result (Stop hook asking a question)

Confirmed on 2026-11-10 with a throwaway hook in a scratch project:

- A top-level `{"decision":"block","reason":...}` from a `Stop` hook makes Claude continue once. The hook
  runs again with `stop_hook_active: true`, so it can stay silent the second time; there was no loop.
  In an interactive session, Claude showed the question with the offered options, the user picked
  "Update now", and Claude acted on that choice. (`additionalContext`, the shape `context-stability.py`
  uses for `Stop`, also made Claude continue under `claude -p`; it was not tried interactively. This design
  uses the block shape.)
- Interactive sessions have `CLAUDE_CODE_SESSION_ATTENDED=1` and `CLAUDE_CODE_ENTRYPOINT=cli`; `claude -p`
  has `0` and `sdk-cli`. The hook skips only when `CLAUDE_CODE_SESSION_ATTENDED` is `"0"`, so an older
  Claude Code that does not set it still asks.
- The `Stop` stdin carries `stop_hook_active`, `last_assistant_message`, `session_id`, `cwd` and
  `transcript_path`, among others.
- `AskUserQuestion` is not in the tool list under `claude -p`; there Claude fell back to plain text with
  the same options. That is why the non-interactive skip matters.

## Left to the builder

- Exact file-size caps, ignore list and the mtime window.
- Judge prompt wording, as long as it keeps the rubric's behavior; re-score on both corpora before
  and after any change, and keep the held-out set unseen by the prompt author where practical.
- Message text shown to the user, config key name, state file layout.
- Whether the "Don't ask again" choice is per change or stored per project.
- Test layout, following `tests/cli.test.js` and `tests/run-tests.sh`.

## My calls (not yet agreed with the user)

- Own script instead of adding to the 32 KB `context-stability.py`, with its own state dir.
- One baseline mechanism (session snapshot refreshed after each Stop, content diff) everywhere,
  including git repos, for one code path. The corpora are before/after directory pairs, so the measured
  judge accuracy applies to this input shape unchanged.
- Off switch is an environment variable in the generated `settings.json`, not a new config file.
- "Skip this change" suppresses only identical findings; there is no separate "Not now".
- Publish method and results under `benchmarks/` but not the 96-scenario corpora (9.7 MB, synthetic).
  The README states the measured numbers together with their limits (synthetic scenarios, 24
  negatives, not measured on real sessions); a real-session measurement is a follow-up, not a release gate.

## Decided by the user (rollout)

- New installs get it on by default; existing acf projects that re-run the installer get it only if they
  opt in. It sends source diffs to a model, so both paths show an explicit disclosure in the wizard and CLI
  output (not only the README). The installer must tell a new install from an upgrade (for example, no
  existing acf-managed settings or hook files in the project means new) and the settings merge must be
  conditional on that. Tests cover both paths: new install gets the hook; upgrade without opt-in does not;
  upgrade with opt-in does.
