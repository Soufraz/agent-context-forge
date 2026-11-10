# Context drift check: does it notice when a turn makes the context files untrue?

The [context drift check](../../README.md#hooks-that-keep-the-context-true) asks you, in the
terminal, when a turn of Claude's work made a statement in `CLAUDE.md`, `AGENTS.md` or a rule file
untrue. Its goal is that the context stays true. It is not a cost saver and nothing here measures
savings. This page shows the one thing that was measured: whether the check detects stale context
statements, and how often it asks when the context is still true.

> **Status.** Measured on 96 synthetic scenarios (two sets of 48). **Not yet measured on real
> sessions.** The scenario folders and the runner scripts are not published here; the per-scenario
> outcomes are in [`results/`](results/).

## Method

* **Scenarios.** Each is a before/after pair of small project directories with context files, plus
  the prompt that turned one into the other. Every project is fictional and was written by a model;
  nothing comes from a real repository or a real session.
* **Positives (24 per set).** The turn leaves one or more context statements false: stack (6),
  purpose and scope including "deliberately not" statements (6), principles and constraints (6),
  architecture and flow (6). Some are partial (half of a two-part stack changed) or meaning-level
  (no dependency change, no moved file).
* **Negatives (24 per set).** 16 are keyword bait: the diff touches a library, a path or a word the
  context files name, but every statement stays true. 8 are already-synced: the agent changed the
  code and also updated the context files correctly, so asking again would be wrong.
* **Two sets.** The dev set was written first and used while building the detectors. The held-out
  set was written afterwards, blind, by agents that never saw any detector: 9 ecosystems, several
  writing styles of context files, and meaning-level changes. The judge was not retuned on it.
* **Scoring.** One scorer for every detector: a positive is caught when the detector says "ask", a
  negative is a false alarm when it says "ask". A crash or timeout counts as "no ask" and is
  reported as an error; every run below has `errors: 0`.

## Results

Caught is out of 24 positives; false alarms are out of 24 negatives.

| Detector | Dev: caught / false alarms | Held-out: caught / false alarms |
|---|---|---|
| **The shipped hook** (`context-drift.py`) | 23/24, 0/24 | **22/24, 0/24** |
| Structural diff rules, no model | 24/24, 0/24 | 5/24, 0/24 |
| Claims-vs-reality checks, no model | 24/24, 0/24 | 9/24, 1/24 |
| Prototype of the judge (one `haiku` call) | 24/24 in five runs (one false alarm in the first) | 21/24, 0/24 |

* **The two free detectors collapsed.** They scored perfectly on scenarios they were tuned on after
  reading them, and 5/24 and 9/24 on scenarios written without them. That is why the shipped check
  uses a model and does not put those rules in front of it.
* **Misses of the shipped hook.** Dev: `stack-06-vue-to-react-web-only` (only the Vue half of a Go +
  Vue stack changed, so most statements stay true). Held-out: `h-flow-05-alerts-oban` (a new
  background-job system) and `h-principles-05-rosterly-multi-org` (a new tenancy rule). The
  prototype also missed `h-stack-04-slow-checkout` (a new worker process and a Redis dependency),
  which the shipped hook caught in its run. These are single runs, so a one-scenario difference is
  within run-to-run variation.
* **By category, held-out, shipped hook:** purpose 6/6, stack 6/6, flow 5/6, principles 5/6; no
  false alarms in any category.
* **The prompt** is the `PROMPT` constant in
  [`.claude/hooks/context-drift.py`](../../.claude/hooks/context-drift.py). It asks for a verbatim
  quote of the stale sentence and verbatim evidence from the diff, and the hook drops any finding
  whose quote or evidence is not in the files. It was ported from a prototype that was tuned once,
  on a dev failure.
* **Delay and cost, as seen while developing.** The shipped hook averaged 6.14 s per scenario on dev
  and 6.25 s on held-out (`avg_secs` in the result files), so plan on about 7 s. Cost was typically
  $0.001 to $0.002 per check; per-check cost is not recorded in `results/`. A few large diffs cost
  far more, up to about $0.18 for one call. The hook sets a budget of $0.05 per check; that flag is
  not a hard cap, and a call did exceed it. Past the budget or the 150-second timeout the stop goes
  through without a question.
* **When it does not run.** A turn that only changed docs other than the context files, tests or
  formatting makes no model call. Docs that are context files (`CLAUDE.md`, `AGENTS.md`, rule files)
  do trigger the check.

## Limits

* **Synthetic.** Every scenario is a fictional project written by a model. Real projects, real
  context files and real turns are messier. **No real session has been measured.**
* **Few negatives.** 24 per set. Zero false alarms in 24 is consistent with a true false-alarm rate
  of up to about 12%, so it is not evidence of a low rate on real work. The first number that
  matters is false asks on real sessions, and it is not measured yet.
* **Tuned on what it had read.** The free detectors' dev numbers come from rules written after
  reading those scenarios. The judge's prompt was tuned once on a dev scenario before the held-out
  set existed; the held-out set was not used to change it.
* **Incomplete but still true.** When a turn adds something the files never mention (a job system,
  a tenancy rule, a worker) and no existing sentence becomes false, detection is poor. The held-out
  set holds four such scenarios: the prototype caught one, the shipped hook two, in one run each.
  Do not rely on the check to tell you that the files are incomplete.
* **Partial staleness** can slip through, as in `stack-06-vue-to-react-web-only`.
* **One run per detector per set**, except the five dev runs of the prototype in
  [`results/C-prototype_dev_runs.json`](results/C-prototype_dev_runs.json). The judge is a model, so
  a rerun can differ by a scenario or two.
* **It sends your files.** The judge receives the context files and the turn's diff through
  `claude -p`, under your Claude Code login. Secret files (`.env*`, keys, `*secret*`,
  `credentials*`) never enter the diff or the prompt.

## Data

[`results/`](results/) holds, for each run, the scorer's summary and one row per scenario (`id`,
`category`, `kind`, `expected`, `ask`). Scenario text, the model's reasons and the corpora are left
out; the ids are the only thing that names a scenario.

| File | Run |
|---|---|
| `shipped-hook_dev.json`, `shipped-hook_heldout.json` | The shipped hook (`--judge-dirs` on each scenario). |
| `A-structural_dev.json`, `A-structural_heldout.json` | Structural diff rules, no model. |
| `B-claims_dev.json`, `B-claims_heldout.json` | Claims-vs-reality checks, no model. |
| `C-prototype_heldout.json` | Prototype of the judge on the held-out set. |
| `C-prototype_dev_runs.json` | Summaries of five dev runs of the prototype. |
