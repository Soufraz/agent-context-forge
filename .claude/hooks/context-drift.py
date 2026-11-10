#!/usr/bin/env python3
"""
Claude Code Hooks: Context Drift. Finds statements in the context files that a turn made false.

CLAUDE.md, AGENTS.md and the rule files are sent with every request, so a sentence that a turn
made false (the stack, the scope, a never/always rule, the flow, a command) misleads every later
turn. Nothing else notices when the agent changes the project and leaves those files alone.
One script, dispatched on the hook event:

- SessionStart: snapshots the project's text files into a per-session dir outside the repo. An
  existing snapshot is kept: compaction and resume fire SessionStart again mid-session.
- Stop: diffs the tree against the snapshot by content, so changes made through Bash count like
  any edit. If the turn changed source or a manifest (not only docs, tests or formatting), or
  touched a context file, one cheap model call (`claude -p --model haiku`, hooks disabled) reads
  the context files and the diff and names the sentences the turn made false. A finding is kept
  only when its quote is in the context files and its evidence is in the diff. The snapshot is
  then refreshed, so the next diff covers one turn.

The judge sends the context files and the turn's diff to a model under the user's login. Secret
files (.env*, *.pem, id_rsa*, *secret*, credentials*, ...) never enter the snapshot, the diff or
the prompt. A tree over the file or byte cap is left alone. The judge gets 150 s
(ACF_CONTEXT_DRIFT_TIMEOUT overrides) and a $0.05 budget; past either, the stop goes through.

`--judge-dirs BEFORE AFTER` runs the same diff and judge on two directories and prints
{"ask": bool, "reasons": [str], "stale_files": [str]}, for scoring against a corpus.

Any error lets the stop through: a broken hook must never break the session.
"""

from __future__ import annotations

import difflib
import fnmatch
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional, Tuple

# (path relative to the project, "A" | "M" | "D", text before, text after); text is None when
# the file is absent on that side, binary, or a lockfile
Change = Tuple[str, str, Optional[str], Optional[str]]

STATE_ROOT = Path("/tmp/agent_context_forge")
MANIFEST = "manifest.json"  # path -> {"sha", "text"} for every file the snapshot covers
SNAPSHOT = "snapshot"  # copies of the text files, at their project paths
MAX_FILES = 10_000  # over either cap the tree is left alone: no snapshot, no judge
MAX_BYTES = 50 * 1024 * 1024
MAX_FILE_BYTES = 1024 * 1024  # bigger files are skipped (lockfiles excepted: they are hashed only)
DIFF_LIMIT = 40_000
JUDGE_TIMEOUT = 150  # seconds; ACF_CONTEXT_DRIFT_TIMEOUT overrides
JUDGE_BUDGET_USD = "0.05"
JUDGE_MODEL = "haiku"

SKIP_DIRS = {".git", "node_modules", "dist", "build", ".next", "__pycache__", ".venv", "venv", "target",
             ".hg", ".svn", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".turbo", ".cache", "coverage"}
LOCKFILES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "poetry.lock",
             "Pipfile.lock", "bun.lockb", "Gemfile.lock", "composer.lock", "go.sum", "uv.lock"}
# Matched against every path component, lowercased
SECRET_NAMES = (".env*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_dsa*", "id_ecdsa*", "id_ed25519*",
                "*secret*", "credentials*", ".netrc", ".npmrc", ".pypirc",
                "settings.local.json", ".mcp.json")  # Claude Code files whose env blocks often hold tokens
CONTEXT_NAMES = ("CLAUDE.md", "AGENTS.md", "CLAUDE.local.md")
CONTEXT_DIRS = (".agents/rules/", ".claude/rules/")
DOC_SUFFIXES = {".md", ".mdx", ".markdown", ".rst", ".adoc", ".txt"}
DOC_STEMS = {"LICENSE", "LICENCE", "COPYING", "NOTICE", "AUTHORS", "CHANGELOG", "CHANGES"}
NOT_DOCS = ("requirements*.txt", "constraints*.txt", "CMakeLists.txt")  # manifests with a doc suffix
DOC_DIRS = {"docs", "doc"}
TEST_DIRS = {"test", "tests", "__tests__", "spec", "specs", "e2e"}
TEST_NAMES = ("test_*", "*_test.*", "*.test.*", "*.spec.*", "*_spec.*", "conftest.py")

PROMPT = r"""You audit one turn of a coding agent's work on a software project.

The project keeps static context files (CLAUDE.md, AGENTS.md, and rule files such as .agents/rules/*.md). They are loaded into EVERY future agent prompt and describe the project's stack, purpose and scope, principles and constraints, architecture and data flow, and commands. Nobody re-reads them after a change, so a sentence that became wrong keeps misleading every future agent.

You receive the context files as they are NOW (after the turn), the list of changed files, any edits the agent already made to the context files, and the code diff of the turn.

Question: did this turn make a statement in the CURRENT context files false, or so incomplete that a future agent trusting it would make a wrong decision? If yes, the user will be interrupted with "you changed core context; update the context files?". A false alarm is expensive: users learn to ignore the question. A miss leaves wrong guidance in every future prompt. Flag only what you can tie to one specific sentence in the context files AND one specific piece of the diff.

## Report a finding (severity "false" or "misleading-gap") when the diff makes a context sentence untrue:
- STACK: a named language, framework, runtime, database, package manager, test runner, build tool or key library was removed or replaced (e.g. the files name ORM X and the diff swaps it for ORM Y; the files name one package manager and the diff deletes its lockfile and adds another manager's lockfile).
- COMMANDS / PATHS: a command, script, entry point, directory or file that the context files name was renamed, moved or deleted, so following the files would fail.
- PURPOSE / SCOPE: the product now does something the description excludes, serves users it rules out, or has become a different kind of product (e.g. the files say "read-only dashboard" and the diff adds editing and payments; the files say "internal tool" and the diff adds public signup; the files describe a recipe app and the code is now an inventory system).
- PRINCIPLES / CONSTRAINTS: the new code breaks a stated "never / always / only / no / zero" rule (e.g. "pure core, all I/O in adapters" and the core now reads files; "no ORM, hand-written SQL" and an ORM was added; "stateless handlers" and handlers now keep in-process state; "every module has a test with tool X" and tests now use tool Y).
- ARCHITECTURE / FLOW: the described layering or data flow no longer matches (a described layer was removed or bypassed, a step moved to another process or service, the repository layout the files describe was restructured, where data lives or how it is fetched changed), or a new runtime subsystem was added that changes how core data moves and the files describe that flow in a way that is now incomplete enough to mislead ("misleading-gap").

## Do NOT report (or use severity "minor") when:
- The change is a feature, bug fix, refactor, performance or style change that stays inside the described scope and follows the described stack and conventions. New features that fit the stated purpose do not make the purpose stale.
- A library or dev tool was ADDED (linter, formatter, CI workflow, validation or utility library, editor config) and no context sentence says otherwise. Context files are not an inventory; something merely missing from them is not stale. Only flag an addition when a sentence forbids it or names a competing tool that it replaces.
- A version bump of a technology the files already name, unless the files state the version or a rule that the new version invalidates.
- Internal functions, files, variables, labels or UI copy were renamed or moved, and the context files do not mention them.
- The code follows an exception or escape hatch that the context files themselves allow.
- The new code might have a bug, or might not fully achieve what a context sentence describes. You are not reviewing code quality: if the sentence describes what the code is designed to do, it is not stale. Report drift (the files describe the old design), not defects.
- The agent already edited the context files this turn so that the CURRENT text matches the new code. Judge the current text only: if the current sentence is already correct, it is not stale. Only flag a context sentence that is still wrong after those edits.

## How to work
1. List the concrete claims in the current context files: technologies, commands, paths, scope limits, never/always rules, flow descriptions.
2. For each claim, look in the diff for something that contradicts it. Read deleted lines (-) and added lines (+) and dependency manifests carefully.
3. For every finding, copy `context_quote` VERBATIM from the current context file (one sentence or bullet; no paraphrase) and copy `diff_evidence` VERBATIM from the diff (one or two lines, including the + or -, or a changed-file line such as "D src/foo.ts"). If you cannot quote both, it is not a finding.
4. Severity: "false" = the sentence now states something untrue; "misleading-gap" = the sentence is technically true but omits a change big enough that a future agent following it would do the wrong thing; "minor" = true or harmless, not worth interrupting the user.
5. Set `ask` to true only if there is at least one finding with severity "false" or "misleading-gap". An empty findings list with ask=false is the correct answer for most ordinary turns.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "file": {"type": "string"},
                    "context_quote": {"type": "string"},
                    "diff_evidence": {"type": "string"},
                    "problem": {"type": "string"},
                    "severity": {"type": "string", "enum": ["false", "misleading-gap", "minor"]},
                },
                "required": ["file", "context_quote", "diff_evidence", "problem", "severity"],
            },
        },
        "ask": {"type": "boolean"},
    },
    "required": ["findings", "ask"],
}


def state_dir(session_id: str) -> Path:
    safe_id = "".join(c for c in session_id if c.isalnum() or c in ("-", "_")) or "default"
    return STATE_ROOT / f"drift_{safe_id}"


def is_context(rel: str) -> bool:
    return os.path.basename(rel) in CONTEXT_NAMES or rel.startswith(CONTEXT_DIRS)


def is_secret(name: str) -> bool:
    name = name.lower()
    return any(fnmatch.fnmatch(name, pattern) for pattern in SECRET_NAMES)


def is_doc(rel: str) -> bool:
    path = Path(rel)
    if any(fnmatch.fnmatch(path.name, pattern) for pattern in NOT_DOCS):
        return False
    return (path.suffix.lower() in DOC_SUFFIXES or path.stem.upper() in DOC_STEMS
            or any(part in DOC_DIRS for part in path.parts[:-1]))


def is_test(rel: str) -> bool:
    path = Path(rel)
    return (any(part in TEST_DIRS for part in path.parts[:-1])
            or any(fnmatch.fnmatch(path.name, pattern) for pattern in TEST_NAMES))


def walk(root: Path) -> dict[str, str] | None:
    """The files a snapshot covers, by path relative to root; None when the tree is over a cap."""
    out: dict[str, str] = {}
    total = 0
    for dirpath, dirnames, filenames in os.walk(root):  # symlinked dirs are listed, never entered
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not is_secret(d))
        for name in sorted(filenames):
            if is_secret(name):
                continue
            path = os.path.join(dirpath, name)
            try:
                st = os.lstat(path)
            except OSError:
                continue
            if not stat.S_ISREG(st.st_mode) or (st.st_size > MAX_FILE_BYTES and name not in LOCKFILES):
                continue
            total += st.st_size
            out[os.path.relpath(path, root)] = path
            if len(out) > MAX_FILES or total > MAX_BYTES:
                return None
    return out


def read_bytes(path: str | Path) -> bytes | None:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def as_text(data: bytes | None) -> str | None:
    if data is None or b"\0" in data[:8192]:
        return None
    return data.decode("utf-8", "replace")


def read_text(path: str | Path) -> str | None:
    return as_text(read_bytes(path))


def keeps_text(rel: str, data: bytes) -> bool:
    return os.path.basename(rel) not in LOCKFILES and len(data) <= MAX_FILE_BYTES and as_text(data) is not None


def load_manifest(state: Path) -> dict:
    try:
        manifest = json.loads((state / MANIFEST).read_text(encoding="utf-8"))
        return manifest if isinstance(manifest, dict) else {}
    except Exception:
        return {}


def take_snapshot(root: Path, state: Path) -> bool:
    """Record the tree under state (copying only files that changed); False when over a cap."""
    snapshot = state / SNAPSHOT
    files = walk(root)
    if files is None:
        shutil.rmtree(snapshot, ignore_errors=True)
        (state / MANIFEST).unlink(missing_ok=True)
        return False
    state.mkdir(parents=True, exist_ok=True)
    os.chmod(state, 0o700)  # the copies are the user's source code
    old = load_manifest(state)
    new = {}
    for rel, path in files.items():
        data = read_bytes(path)
        if data is None:
            continue
        sha = hashlib.sha256(data).hexdigest()
        text = keeps_text(rel, data)
        new[rel] = {"sha": sha, "text": text}
        copy = snapshot / rel
        if text and ((old.get(rel) or {}).get("sha") != sha or not copy.is_file()):
            copy.parent.mkdir(parents=True, exist_ok=True)
            copy.write_bytes(data)
    for rel in old:
        if not (new.get(rel) or {}).get("text"):
            (snapshot / rel).unlink(missing_ok=True)
    tmp = state / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(new), encoding="utf-8")
    os.replace(tmp, state / MANIFEST)
    return True


def turn_changes(root: Path, state: Path) -> list[Change]:
    """Files whose content differs from the snapshot; empty when the tree is over a cap."""
    old = load_manifest(state)
    files = walk(root)
    if files is None:
        return []
    changes: list[Change] = []
    for rel in sorted(set(old) | set(files)):
        data = read_bytes(files[rel]) if rel in files else None
        if rel in files and data is None:
            continue
        before = old.get(rel) or {}
        if data is not None and before.get("sha") == hashlib.sha256(data).hexdigest():
            continue
        status = "D" if data is None else "M" if rel in old else "A"
        old_text = read_text(state / SNAPSHOT / rel) if before.get("text") else None
        new_text = as_text(data) if data is not None and keeps_text(rel, data) else None
        changes.append((rel, status, old_text, new_text))
    return changes


def read_context(root: Path) -> dict[str, str]:
    files = walk(root) or {}
    context = {}
    for rel in sorted(files):
        if is_context(rel):
            text = read_text(files[rel])
            if text is not None:
                context[rel] = text
    return context


def needs_judging(changes: list[Change], context_rels: set[str]) -> bool:
    """A context file changed, or a source or manifest file changed by more than whitespace."""
    for rel, status, old, new in changes:
        if rel in context_rels:
            return True
        if is_doc(rel) or is_test(rel):
            continue
        if status == "M" and old is not None and new is not None and "".join(old.split()) == "".join(new.split()):
            continue
        return True
    return False


def udiff(rel: str, a: str | None, b: str | None) -> str:
    al = a.splitlines(keepends=True) if a else []
    bl = b.splitlines(keepends=True) if b else []
    lines = difflib.unified_diff(al, bl, "a/" + rel if a is not None else "/dev/null",
                                 "b/" + rel if b is not None else "/dev/null", n=3)
    return "".join(line if line.endswith("\n") else line + "\n" for line in lines)


def render(context: dict[str, str], changes: list[Change]) -> tuple[str, str]:
    """The judge's input, and the text that a finding's diff evidence must come from."""
    ctx_diff, code_diff, summary = [], [], []
    for rel, status, old, new in changes:
        summary.append(f"{status} {rel}")
        if is_context(rel):
            ctx_diff.append(udiff(rel, old, new))
        elif os.path.basename(rel) in LOCKFILES:
            done = "added" if status == "A" else "deleted" if status == "D" else "modified"
            code_diff.append(f"(lockfile {rel} {done}; content omitted)\n")
        elif (status != "A" and old is None) or (status != "D" and new is None):
            code_diff.append(f"(binary file {rel} {status})\n")
        else:
            code_diff.append(udiff(rel, old, new))
    code = "".join(code_diff)
    if len(code) > DIFF_LIMIT:
        code = code[:DIFF_LIMIT] + "\n... (diff truncated at 40,000 characters)\n"
    parts = ["## Context files as they are NOW (after the turn)\n"]
    for rel, text in context.items():
        parts.append(f"### {rel}\n```markdown\n{text.rstrip()}\n```\n")
    parts.append("## Files changed this turn (A=added, M=modified, D=deleted)\n```\n"
                 + ("\n".join(summary) or "(none)") + "\n```\n")
    parts.append("## Edits the agent made to the context files this turn\n"
                 + ("```diff\n" + "".join(ctx_diff) + "```\n" if ctx_diff else "(none: the context files were not edited)\n"))
    parts.append("## Code diff this turn (everything except the context files)\n```diff\n"
                 + (code or "(no code changes)\n") + "```\n")
    return "\n".join(parts), "\n".join(summary) + "\n" + code + "".join(ctx_diff)


def judge(context: dict[str, str], changes: list[Change]) -> list[dict] | None:
    """Ask the model which context sentences the changes made false; None on any failure."""
    prompt, _ = render(context, changes)
    timeout = float(os.environ.get("ACF_CONTEXT_DRIFT_TIMEOUT") or JUDGE_TIMEOUT)
    cwd = STATE_ROOT / "drift-judge-cwd"  # empty: the judge discovers no CLAUDE.md from here
    cwd.mkdir(parents=True, exist_ok=True)
    cmd = ["claude", "-p", "--model", JUDGE_MODEL, "--no-session-persistence",
           "--settings", '{"hooks":{}}', "--setting-sources", "project", "--tools", "",
           "--system-prompt", PROMPT, "--max-budget-usd", JUDGE_BUDGET_USD,
           "--output-format", "json", "--json-schema", json.dumps(SCHEMA)]
    env = {**os.environ, "ACF_CONTEXT_DRIFT": "off"}  # the nested session must never run this hook
    start = time.monotonic()
    for attempt in range(2):  # one retry for an empty or malformed reply; never after a timeout
        left = timeout - (time.monotonic() - start)
        if attempt and left < 10:
            return None
        try:
            run = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                                 errors="replace", timeout=left, cwd=cwd, env=env)
        except (subprocess.TimeoutExpired, OSError):
            return None
        try:
            result = json.loads(run.stdout)
            if result.get("is_error"):
                if "budget" in str(result.get("subtype")):
                    return None
                continue
            verdict = result.get("structured_output")
            if not isinstance(verdict, dict):
                verdict = json.loads(result.get("result") or "")
            findings = verdict["findings"]
            if not isinstance(findings, list):
                continue
        except Exception:
            continue
        return [{"file": str(f.get("file", "")), "context_quote": str(f.get("context_quote", "")),
                 "diff_evidence": str(f.get("diff_evidence", "")), "severity": str(f.get("severity", "")),
                 "reason": str(f.get("problem", ""))} for f in findings if isinstance(f, dict)]
    return None


def norm(s: str) -> str:
    s = s.replace("`", "").replace("*", "").replace("—", "-").replace("–", "-")
    return re.sub(r"\s+", " ", s).strip().lower()


def quote_found(quote: str, haystack_norm: str) -> bool:
    q = norm(quote)
    if len(q) < 8:
        return False
    if q in haystack_norm:
        return True
    # tolerate an ellipsis or a trimmed quote: every long fragment must be present
    frags = [f.strip() for f in re.split(r"\.\.\.|…", q) if len(f.strip()) >= 8]
    return bool(frags) and all(f in haystack_norm for f in frags)


def evidence_found(ev: str, diff_norm: str) -> bool:
    """Diff evidence often joins several snippets with ' / ', '(and)' or '(file.ts) and';
    accept it when any snippet appears verbatim in the diff or the changed-file list."""
    frags = []
    for line in ev.splitlines():
        for part in re.split(r"\s+/\s+|\s+\|\s+|\(and\)|\)\s+and\s+|\s+and\s+(?=[+\-D]\s)", line):
            part = re.sub(r"\s*\([^()]*\)?\s*$", "", part.strip())
            part = re.sub(r"^[+\-]+\s*|^[AMD]\s+", "", part).strip()
            if len(part) >= 8:
                frags.append(part)
    return quote_found(ev, diff_norm) or any(quote_found(f, diff_norm) for f in frags)


def verify(findings: list[dict], context: dict[str, str], diff_text: str) -> list[dict]:
    """Keep findings that matter and whose quote and evidence are really in the files and the diff."""
    ctx_norm = {rel: norm(text) for rel, text in context.items()}
    all_ctx = " ".join(ctx_norm.values())
    diff_norm = norm(diff_text)
    kept = []
    for finding in findings:
        quote = finding.get("context_quote", "")
        if finding.get("severity") not in ("false", "misleading-gap") or not quote_found(quote, all_ctx):
            continue
        if not evidence_found(finding.get("diff_evidence", ""), diff_norm):
            continue
        files = [rel for rel, text in ctx_norm.items() if quote_found(quote, text)] or [finding.get("file", "")]
        kept.append({**finding, "stale_files": files})
    return kept


def findings_for(context: dict[str, str], changes: list[Change]) -> list[dict]:
    context_rels = set(context) | {rel for rel, *_ in changes if is_context(rel)}
    if not context or not changes or not needs_judging(changes, context_rels):
        return []
    found = judge(context, changes)
    if not found:
        return []
    return verify(found, context, render(context, changes)[1])


def session_start(data: dict) -> None:
    state = state_dir(data["session_id"])
    if not (state / MANIFEST).is_file():  # compaction and resume keep the turn's baseline
        take_snapshot(Path.cwd(), state)


def stop_findings(data: dict) -> list[dict]:
    """The verified findings for this turn; refreshes the snapshot whatever happens."""
    root, state = Path.cwd(), state_dir(data["session_id"])
    if not (state / MANIFEST).is_file():  # hook installed mid-session: the next turn has a baseline
        take_snapshot(root, state)
        return []
    try:
        return findings_for(read_context(root), turn_changes(root, state))
    finally:
        take_snapshot(root, state)


def judge_dirs(before: str, after: str) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        state = Path(tmp)
        changes = turn_changes(Path(after), state) if take_snapshot(Path(before), state) else []
    findings = findings_for(read_context(Path(after)), changes)
    stale = []
    for finding in findings:
        stale += [rel for rel in finding["stale_files"] if rel not in stale]
    return {"ask": bool(findings), "stale_files": stale,
            "reasons": [f"{f['file']}: \"{f['context_quote']}\" -> {f['reason']}" for f in findings]}


HANDLERS = {
    "SessionStart": session_start,
    "Stop": stop_findings,
}


def main() -> int:
    if sys.argv[1:2] == ["--judge-dirs"]:
        try:
            out = judge_dirs(sys.argv[2], sys.argv[3])
        except Exception:
            out = {"ask": False, "reasons": [], "stale_files": []}
        print(json.dumps(out))
        return 0
    try:
        data = json.load(sys.stdin)
        os.chdir(os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or ".")
        data.setdefault("session_id", "default")
        handler = HANDLERS.get(data.get("hook_event_name", ""))
        if handler:
            handler(data)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
