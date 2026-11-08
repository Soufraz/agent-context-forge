# Benchmark tasks

Each task runs on a pinned commit of a real open-source repository. The prompt below is sent
verbatim, and the answer is graded against ground truth worked out without a model. Both
conditions get the same prompt, the same flags and a fresh copy of the same commit; the only
difference is whether the harness was installed with the wizard's defaults.

## 01 · Lockfile question (TanStack/query)

- **Repo:** [TanStack/query](https://github.com/TanStack/query) at `8f6da1e2a1` (single-commit clone, 1.8 MB `pnpm-lock.yaml`).
- **Prompt:**
  > A security scanner flagged the npm package `streamsearch` in this repository. Find the exact version of `streamsearch` that the lockfile resolves, which workspace project depends on it, and the full chain of packages that pulls it in. Do not modify any files. Answer with the version and the dependency chain.
- **Graded:** the answer must name `streamsearch` 1.1.0, `busboy` 1.6.0, `next` 14.2.35 and the `next-14` workspace project. Ground truth comes from parsing the lockfile.

## 02 · Fix failing tests (pallets/click)

- **Repo:** [pallets/click](https://github.com/pallets/click) at `b5f74d6e3a`, with one bug planted in `src/click/types.py` (a `<=`/`<` swap in range checking) and folded into the commit.
- **Prompt:**
  > Some tests in this project's test suite are failing. Run the test suite, find the root cause in the library source code, and fix it. Do not modify the tests. When you are done, make sure the full test suite passes and summarize the fix.
- **Graded:** after the session, the full suite is rerun. It must pass, the tests must be untouched, and the fix must be in `src/click/types.py`.

## 03 · Explain request dispatch (gin-gonic/gin)

- **Repo:** [gin-gonic/gin](https://github.com/gin-gonic/gin) at `v1.10.1`.
- **Prompt:**
  > Explain how gin dispatches an incoming HTTP request to the matching handler. Start at the net/http entry point and cover: how the per-request Context is obtained and reset, how the route is looked up in the radix tree, what happens when no route matches (redirects, 404 and 405), and how the middleware/handler chain runs, including how c.Next() and c.Abort() work. Cite file:line for each step. Do not modify any files.
- **Graded:** a nine-item checklist (`ServeHTTP`, the context pool, `reset()`, `handleHTTPRequest`, `getValue`, trailing-slash and fixed-path redirects, 405, `c.Next()` advancing the index, `abortIndex`). At least 8 of 9 counts as correct. Every cited `file:line` is also checked against the repo.

## 04 · All callers of a same-named function (date-fns)

- **Repo:** [date-fns/date-fns](https://github.com/date-fns/date-fns) at `a9739fb3e5`.
- **Prompt:**
  > List every call site of the internal function `getDefaultOptions` defined in `pkgs/core/src/_lib/defaultOptions/index.ts`. Do not include the separate public `getDefaultOptions` in `pkgs/core/src/getDefaultOptions/index.ts` or calls to that public function. Exclude test files. Answer with one `path:line` per call site, then the total count. Do not modify any files.
- **Graded:** exact match against 19 call sites found with the TypeScript compiler API: every site listed and no false positive. The trap: `parse/index.ts` calls the *public* function of the same name, and one call goes through an alias. In the harness condition, Claude Code's `typescript-lsp` plugin is installed for the run's folder.

## 07 · Six-prompt session (pallets/click)

- **Repo:** [pallets/click](https://github.com/pallets/click) at `99ca244ad6` (420 commits of history), with two bugs planted (`types.py` comparison, `formatting.py` indent).
- **Prompts**, sent one at a time, each after the previous answer:
  1. Give me a short overview of how this project is organized and how its test suite is run.
  2. Run the full test suite and tell me which tests fail.
  3. Find the root causes of those failures in the library source code and fix them. Do not modify the tests.
  4. List every class in src/click that overrides the `convert` method of `ParamType`, with file:line for each override.
  5. Summarize what changed in src/click/core.py across the last 30 commits that touched it, grouped by theme.
  6. Run the full test suite one more time and confirm everything passes. Then give me a short summary of all the changes you made in this session.
- **Graded:** the suite passes at the end, tests untouched, both planted bugs fixed, and at least 90% of the 12 `convert` overrides (found by AST) named in answer 4.

## Context stability pilots (one run per arm)

- **08 · Rule survival (click):** one session states seven rules, in `CLAUDE.md` or in chat. Four are used before `/compact`, and three are first needed after it. Variants run with one compaction and with three. Graded from git and the transcript, without a model: which rules were still followed after compaction.
- **09 · Stale `CLAUDE.md` (click):** `CLAUDE.md` makes two false claims: that messages are plain f-strings without `_()`, and that path errors go through a `fail_path()` helper in a module that doesn't exist. It also has one valid line: new file-system code uses `pathlib`, although the surrounding code still uses `os.path`. Arms: fresh, stale, stale plus a precedence line, stale plus the harness drift note, and the full harness. Graded on whether the agent followed the code on the two false lines, followed the migration rule, and left the tests passing.

## Drift replay (no model)

`drift-replay.py` replays a repository's history through the harness's commit-time drift check: for every commit, would the check have stopped it, and was the reference fixed later? It ran on agent-context-forge, [labstack/echo](https://github.com/labstack/echo) and [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai).
