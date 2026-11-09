# Benchmarks

What we check before asking anyone to adopt the default setup: that it is no worse than plain
Claude Code, in correctness and in cost, and what the context-stability hooks actually do. The
goal is a no-harm check, not proof of savings. The method is paired runs of Claude Code on real
open-source repositories, with and without the harness, graded against ground truth that no
model produced. Each table below links to its per-run data; the [main README](../README.md)
summarizes the result.

> **Status.** Round 4 (the 0.2.1 harness) is the current result. Round 2 (the v2 harness) is
> kept for the record, but a benchmark bug inflated its savings on the click tasks; see
> [Round 2 and the benchmark bug](#round-2-and-the-benchmark-bug). The context-stability results
> are pilots with one run per arm. The runner scripts are not published yet; see
> [What is not here yet](#what-is-not-here-yet).

## Cost and correctness (round 4: 0.2.1 harness, 6 paired runs per arm)

| Task | Model | Correct (base / harness) | Cost change (90% CI) | Tool output (90% CI) | Peak context | Harness cheaper in |
|---|---|---|---|---|---|---|
| Fix failing tests (click) | Sonnet | 6/6 / 6/6 | +2% (−6% to +11%) | **−25%** (−37% to −11%) | −2% | 3/6 pairs |
| Fix failing tests (click) | Haiku | 6/6 / 6/6 | −9% (−33% to +16%) | **−24%** (−35% to −14%) | −8% | 3/6 |
| Six-prompt session (click) | Sonnet | 6/6 / 6/6 | −1% (−8% to +4%) | **−14%** (−25% to −4%) | −2% | 2/6 |
| Six-prompt session (click) | Haiku | 6/6 / 6/6 | +6% (−6% to +16%) | +7% (−21% to +35%) | +3% | 2/6 |
| Explain request dispatch (gin) | Sonnet | 6/6 / 6/6 | 0% (−12% to +10%) | −5% (−19% to +9%) | −1% | 3/6 |
| Lockfile question (TanStack/query) | Sonnet | 6/6 / 6/6 | **+22%** (+16% to +30%) | −7% (−20% to +7%) | +2% | 0/6 |
| All callers of a same-named function (date-fns) | Sonnet | 0/6 / **2/6** exact | **+49%** (+38% to +58%) | +30% (−7% to +69%) | +15% | 0/6 |
| All callers of a same-named function (date-fns) | Haiku | 0/6 / 0/6 | **+51%** (+34% to +68%) | +17% (−5% to +40%) | +13% | 0/6 |

**What this shows:**
- **No clear cost saving on any task.** Every cost decrease has a 90% interval that includes zero.
- **Less tool output on three click tasks** (−14% to −25%), which doesn't move the total cost.
- **Clear cost increases** on a small task (+22%) and with the LSP references rule (+49%, +51%).
- **Correctness is the same in both conditions** except the date-fns task. There, the harness's
  LSP rule gave the only exact answers (2 of 6 Sonnet runs).

How to read the table:
- **Correct:** graded against ground truth worked out without a model; [tasks.md](tasks.md) has
  each prompt and grader.
- **Cost:** Claude Code's reported cost per run (`total_cost_usd`), failed runs included. The change is
  the mean of per-pair relative changes. The interval is a 90% bootstrap over the 6 pairs.
- **Data:** [paired table](results/round-4-v0.2.1/paired.md) and
  [every run](results/round-4-v0.2.1/runs.csv) (cost, tokens, turns, tool calls, grade).

### What the harness changes

These come from reading the transcripts; the harness was tested as a bundle.

- **Project facts at session start.** On the test-fixing task, Sonnet without the harness tried
  plain `python` or `pytest` before `uv run` in every run (7 attempts in 6 runs); with the
  harness's "run project tools through uv" fact, none. That cut turns from 7.7 to 5.5, but not
  cost.
- **rtk compression.** It also rewrites piped commands (`uv run pytest -q 2>&1 | tail -40`), which
  is how agents run tests, and it cut tool output by 14–25% on the click tasks. Tool output is a
  small share of a run's cost: in round 1, cache writes were 57% of spend, the model's output
  29% and cache reads 14%. So compression alone barely moves the total.
- **The LSP references rule.** Sonnet called the LSP tool and found all 19 call sites in 2 of 6
  runs, the only exact answers in either condition, at +49% cost. Haiku gained nothing, at +51%.
- **The context-stability hook (new in 0.2).** In all 48 harness runs, it added no context and
  blocked nothing: these tasks configure no rules, and their `CLAUDE.md` has no drift. Within
  each pair, the harness added the same session-start context as v2 (+307 tokens on test
  fixing).

### Where it costs more

- **Lockfile question (+22%).** Both conditions answer correctly. Most of this turned out to
  be the benchmark's own setup, not the harness: see the next section.
- **The LSP rule (+49% on Sonnet, +51% on Haiku).** It's worth it only where exact answers
  matter more than cost, and only on Sonnet. Since then it is opt-in.

## LSP-rule ablation and the fresh-folder artifact (6 paired runs per arm, Sonnet unless noted)

The harness arm here is the 0.2.1 harness without the `CLAUDE.md` LSP references line (the
plugin stays installed on the date-fns task), which is the new default.

| Task | Fresh folder per run | Fixed folder per arm | Correct (base / harness) |
|---|---|---|---|
| Lockfile question | +18% (+13 to +22) | **−21% (−29 to −13)**, cheaper in 6/6 pairs | 6/6 / 6/6 |
| Find callers (date-fns) | +34% (+25 to +42) | +11% (−2 to +22) | 0/6 / 0/6, then 1/6 / 1/6 |
| Find callers (date-fns), Haiku | −2% (−14 to +10) | not rerun | 0/6 / 0/6 |

**Why the folder matters.** Claude Code labels the loaded `CLAUDE.md` with its path, and that
block sits early in the prompt. Every earlier round copied each run into a new timestamped
folder, so the harness's first request missed the cache from that block on (6.6k tokens written
vs the baseline's 3.5k, whose `AGENTS.md` loads later). Run twice in the same folder, both arms
write nothing on the second run. A real project keeps its path, so the fixed-folder column is the
realistic one. In it, rep 0 warms each arm's cache and is left out. Removing the LSP rule alone
did not remove the fresh-folder overhead; the fixed folder did. Earlier rounds' small-task
overheads carry the same bias. Data: `results-v5-nolsp`, `results-v5-fixed`; probe:
`bench/cache-probe.sh`.

## Round 2 and the benchmark bug

Round 2 (the v2 harness, which in these tasks gives the model the same context as 0.2.1) reported savings that
round 4 did not reproduce. The click-task savings were inflated by a bug, and the gin saving did
not replicate:

| Task | Model | Round 2 | Round 4 |
|---|---|---|---|
| Fix failing tests (click) | Haiku | −35% (−53% to −9%) | −9% (−33% to +16%) |
| Fix failing tests (click) | Sonnet | −10% (−18% to −3%), correct 5/6 → 6/6 | +2% (−6% to +11%), 6/6 → 6/6 |
| Explain request dispatch (gin) | Sonnet | −12% (−18% to −6%) | 0% (−12% to +10%) |

- **The bug.** The click task templates carried compiled Python caches (`__pycache__`) whose
  paths pointed at the benchmark's shared clone of the repo, not the run's own copy. So every
  click run's test tracebacks named files outside its copy.
  - One round-2 baseline run (Sonnet, test fixing, pair 1) followed those paths, fixed the
    shared clone instead of its copy, and failed. That run is the "5/6", and its pair is −30% of
    the −10%. Without it, the Sonnet saving was about −6%.
  - Runs that didn't wander were still slowed down. Haiku baselines ran the test suite 5–11
    times per run with the leak and 3–7 times without it. The harness, whose rtk output is
    shorter, was hurt less, so the leak widened the gap.
- **The fix, in round 4.** The caches are removed from the templates and the shared clone is
  restored. Each run now records whether its copy held foreign caches and whether the shared
  clone changed. No round-4 run touched it.
- **Variance.** Gin is a Go task, untouched by the bug, and its −12% fell to 0%. At 6 pairs, an
  effect of that size doesn't reliably replicate.

Round 2's data stays in [results/round-2-v2/](results/round-2-v2/) for the record. Its tables are
not evidence for the current harness.

## Context stability (pilots, one run per arm)

| Pilot | Result |
|---|---|
| **Rule survival through compaction** (seven rules, three first needed after `/compact`) | Sonnet kept 7/7 rules through one compaction in every arm (no harness, v2 harness, 0.2 harness) and through three compactions without the harness. Every rule survived in every compaction summary, and Claude Code reloaded `CLAUDE.md` after each compaction. Haiku without the harness slipped once after one compaction (1 of 10 test runs lost a flag) and kept 7/7 through three. |
| **Stale `CLAUDE.md`** (two false lines, one valid migration rule) | Sonnet, in every arm including the stale one, followed the code on both false lines, followed the migration rule, and told the user which lines were stale. |

With Claude Code 2.1.308 these behaviours are already at the ceiling, so the harness's rule
capture ships as a safeguard with no claimed gain. These are single runs: a rerun with 6 runs per
arm is planned. The pilot templates carried the same compiled caches as round 2: one pilot run
was shown a path outside its copy, none followed one, and no shared clone changed. The rerun
will use clean templates.

## Drift check replay (no model)

The commit-time drift check was replayed over each repository's history (first-parent, oldest
first), using the hook's own code: would it have stopped the commit, and was the reference fixed
later?

| Repository | Commits | With a context file | Stopped | True positives | Stale for |
|---|---|---|---|---|---|
| agent-context-forge | 39 | 32 | 0 | — | — |
| [labstack/echo](https://github.com/labstack/echo) | 1,680 | 176 | 0 | — | — |
| [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) | 4,956 | 4,054 | 1 | 1 | 37 commits |
| **Total** | 6,675 | **4,262** | **1** | **1** | |

The hit is pydantic-ai `574540234f`, which turned `pydantic_ai/agent.py` into
`agent/__init__.py` while `CLAUDE.md` still named the old path; it was fixed 37 commits later.
The session-start drift note produced no false notes on next.js, n8n, ruff, pydantic-ai or echo.
Data: [results/drift-replay/](results/drift-replay/).

## Method

- **Runs:** Claude Code 2.1.308, headless (`claude -p`), Sonnet (`claude-sonnet-5-5`) and Haiku
  (`claude-haiku-5-5`). Each run starts from a fresh copy-on-write clone of a pinned commit. A
  rep's baseline and harness runs run in parallel.
- **Same for both conditions:** identical prompts and flags, `--setting-sources project,local`
  (no user-level plugins, hooks or settings), `--strict-mcp-config`, auto-memory off, and a
  per-run budget cap. Grep and Glob aren't pre-granted, matching a default macOS session, where
  Claude Code searches with `grep` and `find` through Bash.
- **Clean environment (round 4):** each run clears inherited `CLAUDE*` and `RTK_*` variables, so
  it starts like a session opened in a terminal. Templates hold no compiled caches.
- **Harness condition:** the harness installed with the wizard's defaults, pinned to the released
  tag. For the date-fns task, the `typescript-lsp` plugin is installed for each run's folder.
- **Sessions:** in the six-prompt task, each prompt is sent only after the previous answer.
- **Metrics:** from Claude Code's stream-json events. Output and cache tokens come from
  `modelUsage`, since per-message counts are streaming snapshots.

## Limitations

- **Small samples:** five repositories, two models, 6 pairs per arm. Effects under about 10% don't
  reliably replicate at this size (see gin above).
- **Short sessions:** under 80k tokens of peak context. These runs say nothing about long
  sessions with many compactions.
- **Bundle, not components:** the harness was tested as a whole, not one mechanism at a time.
- **One machine, one account type:** all runs used a Claude subscription, whose prompt cache
  lives one hour. With an API key the cache lives five minutes, which changes how much cache
  writes cost.
- **Spend at API prices:** $6.82 for round 4's 96 runs, plus $3.70 for click runs discarded after
  the bug was found. Round 2 cost $6.87 for 96 runs, and round 1 $2.04 for 24.

## Earlier round (v0.1 harness, 3 runs per arm, Sonnet)

Round 1 is why v2 exists. The v0.1 lockfile deny rules also blocked `grep`, so the lockfile task
went from 3/3 to **0/3** correct. The rtk hook skipped piped commands and fired 0 times. A
guardrail that denied the 10th search caused retries, never delegation. The LSP tool loaded but
was never called.

## What is not here yet

- **The runner scripts** (`run.sh`, the session driver, analysis and graders) still contain
  machine-specific paths. They will be published with setup instructions, so the runs can be
  repeated.
- **The repositories** are pinned upstream commits (see [tasks.md](tasks.md)). The planted bugs
  will be published as patches.
- **Transcripts** are kept locally. The CSVs hold every run's metrics and grade.
