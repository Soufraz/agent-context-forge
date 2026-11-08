#!/usr/bin/env python3
"""
Claude Code Hooks: Context Stability (Pillar 5). Keeps the user's rules alive through a session.

Compaction keeps what lives in files and summarizes the conversation, and rules a user states
only in chat are the first thing summaries drop. Rules that a hook checks stop depending on
the model's attention altogether. One script, dispatched on the hook event:

- UserPromptSubmit: keeps the rule-like sentences of each prompt ("always ...", "never ...",
  "from now on ...") in a per-session file outside the repo.
- PreCompact: prints those rules, so the compaction summary carries them word for word.
- SessionStart: after compaction (source "compact"), re-injects the rules word for word, so they
  no longer depend on the summary. On other sources it records the commit the session started
  from and adds nothing, so the prompt prefix stays stable.
- PreToolUse: enforces the checkable rules in .claude/enforced-rules.json before a tool runs.
- Stop: checks the "stop" rules once before Claude finishes.

Rule kinds in .claude/enforced-rules.json (globs use fnmatch, where `*` also matches `/`):
  command  Bash commands matching `when` must match `require` and must not match `forbid`,
           unless they match `unless`. A `git commit -F file` message is checked too.
  path     Edit/Write to a file matching one of `paths` is denied.
  commit   A `git commit` whose files match `ifChanged` must include a file matching
           `requireChanged`. Files added with `git add` in the same command count.
  stop     Before Claude finishes: if the session changed files matching `ifChanged` and none
           matching `requireChanged`, Claude is asked to finish the job.

Any error lets the call through: a broken hook must never break the session.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

RULES_FILE = Path(".claude") / "enforced-rules.json"
# Words that make a sentence a standing or deferred instruction rather than part of the task.
# A task sentence caught by mistake costs a line after compaction; a rule missed costs the rule.
RULE_WORDS = re.compile(
    r"\b(always|never|from now on|going forward|whenever|every time|each time|any time|make sure|"
    r"must|should|needs? to|do not|don't|avoid|instead of|only use|convention|rule|remember|"
    r"heads[- ]up|for later|when you get to|once you get to|one more thing)\b",
    re.IGNORECASE,
)
MAX_RULES = 30
MAX_RULE_CHARS = 400
PASTED = re.compile(r"^<pasted_content id=\"[^\"]*\">\n.*?^</pasted_content id=\"[^\"]*\">\n?", re.MULTILINE | re.DOTALL)
SENTENCE_END = re.compile(r"(?<=[.!?])\s+|\n+")
COMMIT = re.compile(r"\bgit\s+(?:-C\s+\S+\s+)?commit\b")
# Files whose paths are checked against the repo at session start (the drift note)
CONTEXT_FILES = ("CLAUDE.md", "CLAUDE.local.md", "AGENTS.md")
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)  # Claude Code strips these before loading
BACKTICKED = re.compile(r"`([^`\s]+)`")
# A path with a directory part. Globs, placeholders, package scopes, variables and URLs contain
# characters outside this set; bare file names are skipped as too often generic examples.
PATH_LIKE = re.compile(r"^(?:\./)?[\w.-]+(?:/[\w.-]+)+/?$")


def state_dir(session_id: str) -> Path:
    safe_id = "".join(c for c in session_id if c.isalnum() or c in ("-", "_")) or "default"
    path = Path("/tmp/agent_context_forge") / f"stability_{safe_id}"
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, timeout=10)
    return result.stdout if result.returncode == 0 else ""


def emit(event: str, **fields: str) -> None:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, **fields}}))


# --- Rule capture -------------------------------------------------------------------------


def rule_sentences(prompt: str) -> list[str]:
    text = PASTED.sub("", prompt)
    sentences = [s.strip() for s in SENTENCE_END.split(text)]
    return [s[:MAX_RULE_CHARS] for s in sentences if s and RULE_WORDS.search(s)]


def captured_rules(session_id: str) -> list[str]:
    path = state_dir(session_id) / "rules.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def capture(data: dict) -> None:
    rules = captured_rules(data["session_id"])
    for sentence in rule_sentences(data.get("prompt") or ""):
        if sentence not in rules:
            rules.append(sentence)
    path = state_dir(data["session_id"]) / "rules.json"
    path.write_text(json.dumps(rules[-MAX_RULES:]), encoding="utf-8")


def bullet_list(rules: list[str]) -> str:
    return "\n".join(f"- {rule}" for rule in rules)


def pre_compact(data: dict) -> None:
    rules = captured_rules(data["session_id"])
    if rules:
        print(
            "Rules the user stated in this session. Copy them into the summary word for word, "
            "under the heading 'User rules (verbatim)':\n" + bullet_list(rules)
        )


def context_files() -> list[str]:
    return list(CONTEXT_FILES) + [str(p) for p in sorted(Path(".claude", "rules").glob("*.md"))]


def path_references(text: str) -> list[str]:
    """Backticked repo paths (with a directory part) in a context file, without `./` or a trailing `/`."""
    refs: list[str] = []
    for token in BACKTICKED.findall(HTML_COMMENT.sub("", text)):
        bare = (token[2:] if token.startswith("./") else token).rstrip("/")
        if PATH_LIKE.match(token) and "..." not in bare and "/" in bare and bare not in refs:
            refs.append(bare)
    return refs


def names(path: str, ref: str) -> bool:
    """Whether a tracked file is the referenced path, lies under it, or ends with it (a path relative to a package)."""
    return path == ref or path.startswith(ref + "/") or path.endswith("/" + ref) or f"/{ref}/" in path


def missing_references() -> list[str]:
    """Backticked repo paths in the context files that no longer exist, in file order.

    Precision over recall: a false note tells Claude to distrust a correct instruction. So a
    path counts only when its first directory exists in the repo (which rules out package names,
    domains and `if/else`), and not when it exists, is the tail of a tracked path (a path
    relative to a package), or is git-ignored generated output.
    """
    missing: list[str] = []
    tracked = None
    for name in context_files():
        try:
            text = Path(name).read_text(encoding="utf-8")
        except Exception:
            continue
        for ref in path_references(text):
            if ref in missing or not Path(ref.split("/")[0]).is_dir() or Path(ref).exists():
                continue
            if tracked is None:
                tracked = git("ls-files").splitlines()
            if any(names(f, ref) for f in tracked):
                continue
            if subprocess.run(["git", "check-ignore", "-q", "--", ref], capture_output=True).returncode == 0:
                continue
            missing.append(ref)
    return missing


# --- Drift check at commit time ------------------------------------------------------------
# Drift starts in code commits: a rename or a deletion leaves CLAUDE.md naming a path that is
# gone. Only paths this commit removes count, so references that were already stale (the
# startup note covers those) never block unrelated work.


def staged_removals() -> dict[str, str | None]:
    """Paths the index removes from HEAD, mapped to their new path when renamed."""
    removed: dict[str, str | None] = {}
    for line in git("diff", "--cached", "--name-status", "-M", "HEAD").splitlines():
        parts = line.split("\t")
        if parts[0].startswith("D") and len(parts) > 1:
            removed[parts[1]] = None
        elif parts[0].startswith("R") and len(parts) > 2:
            removed[parts[1]] = parts[2]
    return removed


def command_removals(command: str) -> dict[str, str | None]:
    """Paths a Bash command's commit will remove: staged already, or by `git rm`, `git mv`,
    `git add` or `git commit -a` earlier in the same command (it has not run yet)."""
    removed = staged_removals()
    for segment in re.split(r"&&|\|\||;|\n", command):
        try:
            words = shlex.split(segment)
        except ValueError:
            continue
        args = [w for w in words[2:] if not w.startswith("-")]
        if words[:2] == ["git", "rm"]:
            for spec in args:
                removed.update((f, None) for f in git("ls-files", "--", spec).split())
        elif words[:2] == ["git", "mv"] and len(args) == 2:
            removed.update((f, args[1] + f[len(args[0]):]) for f in git("ls-files", "--", args[0]).split())
        elif words[:2] == ["git", "add"] or (words[:2] == ["git", "commit"] and any(re.fullmatch(r"-\w*a\w*|--all", w) for w in words[2:])):
            specs = [] if words[1] == "commit" or not args or "." in args or any(w in ("-A", "--all") for w in words) else args
            for line in git("status", "--porcelain", "--", *specs).splitlines():
                if line[1] == "D":
                    removed[line[3:]] = None
    return removed


def drift_reasons(removed: dict[str, str | None], read) -> list[str]:
    """Context files that would still name a path the commit removes, read through `read(name)`."""
    if not removed:
        return []
    remaining = [f for f in git("ls-files").splitlines() if f not in removed]
    remaining += [new for new in removed.values() if new]
    reasons = []
    for name in context_files():
        text = read(name)
        if text is None:
            continue
        for ref in path_references(text):
            gone = [old for old in removed if names(old, ref)]
            if gone and not any(names(f, ref) for f in remaining):
                renamed = sorted({removed[old] for old in gone if removed[old]})
                where = f" (renamed to {', '.join(f'`{r}`' for r in renamed)})" if renamed else ""
                reasons.append(f"{name} names `{ref}`, which this commit removes{where}")
    return reasons


def drift_message(reasons: list[str]) -> str:
    return (
        "Context drift: " + "; ".join(reasons) + ". Update the instruction file in the same commit, so the "
        "next session isn't sent to a path that no longer exists."
    )


def read_working(name: str) -> str | None:
    try:
        return Path(name).read_text(encoding="utf-8")
    except Exception:
        return None


def read_staged(name: str) -> str | None:
    result = subprocess.run(["git", "show", f":{name}"], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def check_staged() -> int:
    """`--check-staged`: the git pre-commit hook's entry point, for commits outside Claude Code."""
    os.chdir(git("rev-parse", "--show-toplevel").strip() or ".")
    reasons = drift_reasons(staged_removals(), read_staged)
    if reasons:
        print(drift_message(reasons), file=sys.stderr)
        return 1
    return 0


def session_start(data: dict) -> None:
    state = state_dir(data["session_id"])
    if data.get("source") != "compact":
        head = git("rev-parse", "HEAD").strip()
        if head and not (state / "base").exists():
            (state / "base").write_text(head, encoding="utf-8")
        missing = missing_references()
        if missing:
            emit(
                "SessionStart",
                additionalContext="Paths named in the project's instruction files that do not exist in this "
                f"repo: {', '.join(f'`{m}`' for m in missing)}. The lines naming them are probably out of date: "
                "trust the code over them, and point out the conflict to the user.",
            )
        return
    rules = captured_rules(data["session_id"])
    if rules:
        emit(
            "SessionStart",
            additionalContext="Rules the user gave earlier in this session, word for word. They still "
            "apply unless the user changed them since:\n" + bullet_list(rules),
        )


# --- Rule gates -----------------------------------------------------------------------------


def load_rules() -> list[dict]:
    try:
        rules = json.loads(RULES_FILE.read_text(encoding="utf-8")).get("rules", [])
        return [r for r in rules if isinstance(r, dict) and r.get("id")]
    except Exception:
        return []


def matches_any(path: str, globs: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, g) for g in globs)


def commit_message_files(command: str) -> str:
    """Contents of message files passed with `git commit -F <file>` or `--file=<file>`."""
    texts = []
    for match in re.finditer(r"(?:-F\s*|--file[=\s])(\S+)", command):
        try:
            texts.append(Path(match.group(1).strip("'\"")).read_text(encoding="utf-8"))
        except Exception:
            pass
    return "\n".join(texts)


def files_to_commit(command: str) -> set[str]:
    """The files a Bash command will commit: already staged, plus `git add` in the same command."""
    files = set(git("diff", "--cached", "--name-only").split())
    for segment in re.split(r"&&|\|\||;|\n", command):
        try:
            words = shlex.split(segment)
        except ValueError:
            continue
        if words[:2] == ["git", "add"]:
            specs = [w for w in words[2:] if not w.startswith("-")]
            if not specs or "." in specs or any(w in ("-A", "--all") for w in words[2:]):
                specs = []
            status = git("status", "--porcelain", "--untracked-files=all", "--", *specs)
            files.update(line[3:].split(" -> ")[-1] for line in status.splitlines())
        elif words[:2] == ["git", "commit"] and any(w in ("-a", "--all") or re.fullmatch(r"-\w*a\w*", w) for w in words[2:]):
            files.update(git("diff", "--name-only").split())
    return files


def commit_dir(command: str) -> str:
    """The directory a commit runs in: its last `cd` or `git -C`, relative to the shell's cwd."""
    target = ""
    for segment in re.split(r"&&|\|\||;|\n", command):
        try:
            words = shlex.split(segment)
        except ValueError:
            continue
        if words[:1] == ["cd"] and len(words) > 1:
            target = words[1]
        if words[:1] == ["git"] and "commit" in words:
            if len(words) > 2 and words[1] == "-C":
                target = words[2]
            break
    return target


def gate(data: dict) -> None:
    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    rules = load_rules()
    broken = []
    reasons = []
    if tool == "Bash":
        command = tool_input.get("command", "")
        is_commit = bool(COMMIT.search(command))
        if is_commit:
            # A commit in another repository is outside this project's rules
            target = os.path.join(data.get("cwd") or ".", os.path.expanduser(commit_dir(command)))
            top = subprocess.run(["git", "-C", target, "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
            if top and os.path.realpath(top) != os.path.realpath(git("rev-parse", "--show-toplevel").strip() or "."):
                return
            drift = drift_reasons(command_removals(command), read_working)
            if drift:
                reasons.append(drift_message(drift))
        text = command + ("\n" + commit_message_files(command) if is_commit else "")
        for rule in (r for r in rules if r.get("kind") == "command"):
            if not re.search(rule.get("when", "$^"), command) or (rule.get("unless") and re.search(rule["unless"], command)):
                continue
            if (rule.get("require") and not re.search(rule["require"], text)) or (rule.get("forbid") and re.search(rule["forbid"], text)):
                broken.append(rule)
        commit_rules = [r for r in rules if r.get("kind") == "commit"]
        if is_commit and commit_rules:
            files = files_to_commit(command)
            for rule in commit_rules:
                if any(matches_any(f, rule.get("ifChanged", [])) for f in files) and not any(
                    matches_any(f, rule.get("requireChanged", [])) for f in files
                ):
                    broken.append(rule)
    elif tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        # realpath on both sides: on macOS the project dir may be reached through /var -> /private/var
        rel = os.path.relpath(os.path.realpath(target), os.path.realpath(".")) if os.path.isabs(target) else target
        broken = [r for r in rules if r.get("kind") == "path" and matches_any(rel, r.get("paths", []))]
    reasons += [f"Rule `{r['id']}` (.claude/enforced-rules.json): {r.get('message', '')}" for r in broken]
    if reasons:
        emit("PreToolUse", permissionDecision="deny", permissionDecisionReason="; ".join(reasons))


def stop(data: dict) -> None:
    rules = [r for r in load_rules() if r.get("kind") == "stop"]
    if not rules or data.get("stop_hook_active"):
        return
    base_file = state_dir(data["session_id"]) / "base"
    base = base_file.read_text(encoding="utf-8").strip() if base_file.exists() else "HEAD"
    changed = set(git("diff", "--name-only", base).split()) | set(git("ls-files", "--others", "--exclude-standard").split())
    broken = [
        r
        for r in rules
        if any(matches_any(f, r.get("ifChanged", [])) for f in changed)
        and not any(matches_any(f, r.get("requireChanged", [])) for f in changed)
    ]
    if broken:
        emit("Stop", additionalContext="\n".join(f"Rule `{r['id']}` (.claude/enforced-rules.json): {r.get('message', '')}" for r in broken))


HANDLERS = {
    "UserPromptSubmit": capture,
    "PreCompact": pre_compact,
    "SessionStart": session_start,
    "PreToolUse": gate,
    "Stop": stop,
}


def main() -> int:
    if sys.argv[1:] == ["--check-staged"]:
        return check_staged()
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
