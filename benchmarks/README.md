# Benchmarks

The evidence behind the numbers in the [main README](../README.md): paired runs of Claude Code on
real open-source repositories, with and without the harness, graded against ground truth that
no model produced. Each table below links to its per-run data.

> **Status.** The cost results were measured on the v2 harness. A rerun on 0.2.1 (same tasks,
> models and CLI version) is in progress, and its table will be added here. The context-stability
> results are pilots with one run per arm. The runner scripts are not published yet; see
> [What is not here yet](#what-is-not-here-yet).

## Cost and correctness (round 2: v2 harness, 6 paired runs per arm)

| Task | Model | Correct (base / harness) | Cost change (90% CI) | Tool output | Peak context | Harness cheaper in |
|---|---|---|---|---|---|---|
| Fix failing tests (click) | Haiku | 6/6 / 6/6 | **−35%** (−53% to −9%) | −31% | −15% | 5/6 pairs |
| Explain request dispatch (gin) | Sonnet | 6/6 / 6/6 | **−12%** (−18% to −6%) | −14% | −4% | 6/6 |
| Fix failing tests (click) | Sonnet | 5/6 / **6/6** | **−10%** (−18% to −3%) | **−34%** | −5% | 4/6 |
| Six-prompt session (click) | Haiku | 6/6 / 6/6 | −7% (−21% to +7%) | −12% | −7% | 3/6 |
| Six-prompt session (click) | Sonnet | 6/6 / 6/6 | +3% (−7% to +12%) | −12% | −2% | 3/6 |
| All callers of a same-named function (date-fns) | Haiku | 0/6 / 0/6 | +21% (+5% to +39%) | −28% | +4% | 1/6 |
| Lockfile question (TanStack/query) | Sonnet | 6/6 / 6/6 | +23% (+12% to +34%) | +11% | +4% | 0/6 |
| All callers of a same-named function (date-fns) | Sonnet | 0/6 / **3/6** exact | +49% (+40% to +58%) | +5% | +11% | 0/6 |

- **Correct:** graded against ground truth worked out without a model; [tasks.md](tasks.md) has
  each prompt and grader.
- **Cost:** Claude Code's reported cost per run (`total_cost_usd`), failed runs included. The change is
  the mean of per-pair relative changes. The interval is a 90% bootstrap over the 6 pairs.
- **Data:** [paired table with all three metrics](results/round-2-v2/paired.md) and
  [every run](results/round-2-v2/runs.csv) (cost, tokens, turns, tool calls, grade).

### Where the savings come from

These attributions come from reading the transcripts; the harness was tested as a bundle.

- **Project facts at session start (test fixing).** Without the harness, agents tried
  `python -m pytest`, then `python3`, before finding `uv run`: 12 environment failures in 6
  Sonnet runs and 9 in 6 Haiku runs. With the fact "run project tools through uv", Sonnet hit 0
  and Haiku 3.
- **rtk through its own rewrite engine.** It also rewrites piped commands
  (`uv run pytest -q 2>&1 | tail -40`), which is how agents run tests. Tool output fell 31–34%
  in test fixing and 14% in exploration.
- **The LSP references rule.** Sonnet called the LSP tool in 3 of 6 runs, and those were the only
  runs in either condition to find all 19 call sites with no false positive.

### Where it costs more

- **Lockfile question (+23%).** Both conditions answer correctly. On a ~$0.05 task, the harness's
  fixed overhead (+300 to +850 tokens per request) and rtk's grouped grep output show up as cost.
- **LSP rule (+49% on Sonnet, +21% on Haiku).** It bought exact answers on Sonnet. Haiku called
  LSP but cited import lines as call sites, so it got no better.
- **Six-prompt sessions: no significant difference.** Sonnet keeps such a session under ~40k
  tokens of context, so there is little to compress.

## Context stability (pilots, one run per arm)

| Pilot | Result |
|---|---|
| **Rule survival through compaction** (seven rules, three first needed after `/compact`) | Sonnet kept 7/7 rules through one compaction in every arm (no harness, v2 harness, 0.2 harness) and through three compactions without the harness. Every rule survived in every compaction summary, and Claude Code reloaded `CLAUDE.md` after each compaction. Haiku without the harness slipped once after one compaction (1 of 10 test runs lost a flag) and kept 7/7 through three. |
| **Stale `CLAUDE.md`** (two false lines, one valid migration rule) | Sonnet, in every arm including the stale one, followed the code on both false lines, followed the migration rule, and told the user which lines were stale. |

With Claude Code 2.1.308 these behaviours are already at the ceiling, so the harness's rule
capture ships as a safeguard with no claimed gain. These are single runs: a rerun with 6 runs per
arm is planned.

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
- **Harness condition:** the harness installed with the wizard's defaults. For the date-fns task,
  the `typescript-lsp` plugin is installed for each run's folder.
- **Sessions:** in the six-prompt task, each prompt is sent only after the previous answer.
- **Metrics:** from Claude Code's stream-json events. Output and cache tokens come from
  `modelUsage`, since per-message counts are streaming snapshots.

## Limitations

- **Small samples:** five repositories, two models, 6 pairs per arm. Intervals are wide for the
  session task.
- **Short sessions:** at most ~40k tokens of peak context on Sonnet. These runs say nothing about
  long sessions with many compactions.
- **Bundle, not components:** the harness was tested as a whole, not one mechanism at a time.
- **One machine, one account type:** all runs used a Claude subscription, whose prompt cache
  lives one hour. With an API key the cache lives five minutes, which changes how much cache
  writes cost.
- **Environment:** round 2's runs may have inherited environment variables from the Claude Code
  session that launched them, such as its reasoning-effort setting; this was not recorded. Later
  rounds clear those variables, so each run starts like a session opened in a terminal. Paired
  comparisons are unaffected; comparing baselines across rounds is not reliable.
- **Spend:** about $6.87 at API prices for round 2's 96 runs, and $2.04 for round 1's 24.

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
