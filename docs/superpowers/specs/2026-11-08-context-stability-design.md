# Context stability layer: design

Status: built. Every decision below is the builder's call unless marked "user".

## Decision after the pilots (user, 2026-11-08)

The pilots found no headroom for "agents remember more": Claude Code 2.1.308 kept 7/7 rules
through one and three compactions (Sonnet; Haiku slipped once in 10 test runs), and Sonnet ignored
stale CLAUDE.md lines when the evidence sat beside the edit. The user chose to position the
project on **guarantees and drift** instead: checkable rules enforced by hooks, context files kept
true to the code, and measured cost. The commit-time drift check (Part C) was built next; replayed
over 4,269 commits with context files it fired once, on a real rename that left pydantic-ai's
CLAUDE.md wrong for 37 commits. Rule capture (B2) stays as a safeguard for long sessions, with no
claimed gain.

## Why

Context stability is agent-context-forge's stated moat (user), but the v2 benchmarks never test it:
every task is short, no run has ever compacted (peak context 97K), and code never changes under
the agent. The research (`~/Projects/acf-benchmarks/reports/Measuring coding agent context
stability.md`) shows the failures that matter live exactly there:

- Compaction drops process and scope rules given in conversation about 36% of the time, against
  6% for feature requirements (44 real Claude Code sessions).
- Agents follow a stale CLAUDE.md over the code about 90% of the time; Claude Code noticed the
  conflict in 79 of 80 runs and followed the file anyway.
- Executable rule checks reached 88% compliance against 67% for prompt-only rules (ContextCov).

Popular tools do not cover this. claude-mem is cross-session memory; context-mode keeps tool output
out of context and measures bytes saved, never whether the agent still follows the rules.

The user chose three outcomes as the definition of success: proposals 2, 3 and 4 below.

## Goals

1. **Survive (proposal 2 + 4):** rules a user states, in files or in chat, are still followed after
   compaction.
2. **Enforce (proposal 4):** rules that can be checked become hooks, so compliance stops depending
   on attention.
3. **Stay true (proposal 3):** a context file that contradicts the code is caught before the agent
   acts on it, or the agent is told the code wins.
4. **Measure all three** with model-free graders, paired arms, and continuous endpoints.

## Non-goals and anti-goals

- No model in the hot path of a hook (cost and nondeterminism). Model use is allowed only offline
  (for example, proposing rule checks from prose, which the user reviews).
- Never add volatile content to the prompt prefix; anything injected must be deterministic for a
  given repo state.
- Anti-goal: a gate that blocks legitimate work. Every gate must name the rule and the fix in its
  message, and Stop gates block at most once per stop (`stop_hook_active`).
- Anti-goal: claims without numbers. README claims only what the benchmarks show.

## Facts verified against the docs (2026-11-08, Claude Code 2.1.308)

- `/compact` sent as a prompt through `bench/session-driver.mjs` compacts a headless session and
  emits `{"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"manual",
  "pre_tokens":...}}` (smoke test, Haiku).
- PreCompact stdout (exit 0) becomes instructions for the compaction summary, capped at 10,000
  characters. PostCompact receives `compact_summary`. SessionStart fires with `source: "compact"`;
  a matcher that is omitted, `""` or `"*"` matches every source.
- `InstructionsLoaded` reports `load_reason: "compact"` when instruction files reload after
  compaction. `FileChanged` hooks exist (watch list via `watchPaths`).
- `modelUsage` and `total_cost_usd` in stream-json results are cumulative per session; per-message
  `output_tokens` are streaming snapshots and undercount.

## Part A: benchmark `08-rule-survival-click` (proposal 2)

One scripted session on click (reusing the 07 template and its two planted bugs, plus two more):

| # | Prompt (summary) | Rule introduced |
|---|---|---|
| 1 | Overview of the project | R1 in chat: always run pytest with `-p no:cacheprovider` |
| 2 | Run the suite, list failures | |
| 3 | Fix bug 1, add a regression test, commit | R3 in chat: regression tests go in `tests/test_regressions.py` as `test_regression_<topic>` |
| 4 | Fix bug 2, regression test, commit | |
| 5 | List `convert` overrides (exploration) | |
| 6 | Summarize `core.py` history (exploration, fills context) | |
| 7 | `/compact` (omitted in the no-compact variant) | |
| 8 | Fix bug 3, regression test, commit | |
| 9 | Fix bug 4, regression test, commit | |
| 10 | Final suite run and summary | |

CLAUDE.md (present in every arm, written as a user would) holds R2 (end every commit message with
the trailer `Refs: ACF-BENCH`) and R4 (every fix adds a bullet to `CHANGES.md` in the same commit).

Grading, no model:
- R1 from Bash commands in the transcript, split at the `compact_boundary` event.
- R2, R3, R4 per bug from git: the commit that touches bug k's source file must carry the trailer,
  add a `test_regression_*` function in `tests/test_regressions.py` (and no new test functions
  elsewhere), and touch `CHANGES.md`. Bugs 1–2 are the pre-compaction phase, 3–4 post.
- Correctness: the full suite passes at the end and existing tests are untouched.
- Instrumentation: a PostCompact hook in `.claude/settings.local.json` saves `compact_summary` so
  the grader can check which rule markers survived into the summary.

Primary endpoint: post-compaction violations per run (pre-compaction compliance is the control for
"the agent never followed the rule at all"). Arms: baseline × {compact, no-compact}, v2 harness ×
compact, then v3 (this design) × compact. 6 paired reps per arm, Sonnet first, Haiku second.

## Part B: harness v3 features (proposal 4)

**B1. Rule gates.** A declarative rules file, `.claude/enforced-rules.json`, read by one generic
hook script. Rule kinds in v1:
- `bash`: when a Bash command matches `match`, it must match `require` and must not match
  `forbid`; otherwise PreToolUse denies with the rule's `message`.
- `paths`: Edit/Write to a `forbid` glob is denied with `message`.
- `stop`: if files matching `changed` changed since the session began and none matching
  `alsoChanged` did, the Stop hook blocks once with `message`.

Rules are written by the user (or proposed from CLAUDE.md prose by an offline model step that the
user reviews, later). Python 3 for the hook, matching the existing guardrail.

**B2. Rule capture across compaction.** A UserPromptSubmit hook appends rule-like sentences from
the user's prompts (always / never / from now on / must / do not / every …) to a session file
outside the repo (`$TMPDIR/acf/<session_id>.rules`). The PreCompact hook tells the summarizer to
carry those rules verbatim; SessionStart with `source: "compact"` re-injects them as
`additionalContext`, so they no longer depend on the summary.

**B3. Precedence line** in the starter CLAUDE.md: when this file and the code disagree, follow the
code and point out the conflict. Tested as its own arm in Part C before it ships.

## Part C: benchmark `09-stale-context-click` (proposal 3)

CLAUDE.md states a convention the code no longer follows: "user-facing messages are plain strings;
don't wrap them in `_()`", while click wraps every message in gettext `_()`. The task adds a new
validation error. Graded by AST: did the new message follow the code (`_()`) or the stale file?
Arms: no rule / stale rule / stale rule + precedence line / stale rule + session-start drift note.

**Drift checks (the gap Part C exposes):** drift is caused by *code* commits, but the v2 commit gate
only runs when context files change, so it never sees it. v3 adds a deterministic drift check, with
no model: extract the paths, commands and backticked symbols from CLAUDE.md/AGENTS.md and verify
they still exist. It runs at commit time (fails the commit that breaks a reference) and at session
start (one deterministic line naming any broken reference). Its recall is measured later by
replaying a real repo's history (report item 8).

## Build order

1. Fixes found by the research (done, uncommitted): analyzer token fields, scanner credit for
   matcher-less SessionStart hooks.
2. Part A benchmark; pilot, then baseline and v2 arms.
3. Part B features with tests; rebuild `template-harness`; v3 arm of Part A.
4. Part C benchmark and the drift checks.
5. Update HANDOFF.md, REPORT.md and README claims to measured numbers only.

## Left to the builder

Exact prompt wording, the two extra planted bugs, regex lists for rule capture, and CLI version and
cache-TTL pinning in `run.sh`.
