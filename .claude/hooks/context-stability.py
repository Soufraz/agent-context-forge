#!/usr/bin/env python3
"""
Claude Code Hooks: Context Stability (Pillar 5). Keeps the user's rules alive through a session.

Compaction keeps what lives in files and summarizes the conversation, and rules a user states
only in chat are the first thing summaries drop. Rules that a hook checks stop depending on
the model's attention altogether. One script, dispatched on the hook event:

- UserPromptSubmit: keeps the rule-like sentences of each prompt ("always ...", "never ...",
  "from now on ...") in a per-session file outside the repo. Tells the user (never Claude) when
  the conversation has grown past ACF_CONTEXT_NOTE_TOKENS (default 150000; 0 turns it off):
  every request re-sends the whole conversation, so its size is what a long session costs.
- PreCompact: prints those rules, so the compaction summary carries them word for word.
- SessionStart: after compaction (source "compact"), re-injects the rules word for word, so they
  no longer depend on the summary. On other sources it records the commit the session started
  from and adds nothing, so the prompt prefix stays stable. Resuming a large conversation whose
  cache has expired gets a note to the user with what re-sending it costs.
- PreToolUse: enforces the checkable rules in .claude/enforced-rules.json before a tool runs.
- Stop: checks the "stop" rules once before Claude finishes.

Rule kinds in .claude/enforced-rules.json (globs use fnmatch, where `*` also matches `/`):
  command  Bash commands matching `when` must match `require` and must not match `forbid`,
           unless they match `unless`. A `git commit -F file` message is checked too.
  path     Edit/Write to a file matching one of `paths` is denied, and so is a Bash command that
           writes one through a redirection, `tee`, `sed -i`/`perl -i`, `cp`/`mv`/`install` or
           `dd of=`. Writes made inside a script or `python -c` are not seen.
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
# A command that runs a package script or a make target, at the start of a backticked span or of
# a line in a fenced block. Workspace and directory flags point at another manifest: skipped.
SCRIPT_COMMAND = re.compile(
    r"^(?:(?:npm|pnpm|yarn|bun)\s+run\s+([\w:.@/-]+)|(?:npm|pnpm|yarn)\s+(test|start)|(?:pnpm|yarn)\s+([\w:.-]+))(?=\s|$)"
)
# pnpm and yarn run a script when the word isn't one of their own commands (bun build and bun
# test are bun's own tools, so bun counts only with `run`)
PM_BUILTINS = set(
    "access add approve-builds audit autoclean bin cache catalog check config constraints create dedupe "
    "deploy dlx doctor env exec explain fetch generate-lock-entry global help i import info init install "
    "install-test it licenses link list login logout ls node npm outdated owner pack patch patch-commit "
    "patch-remove plugin policies prune publish rebuild recursive remove rm root run search self-update "
    "server set setup store tag team un uninstall unlink unplug up update upgrade version why workspace "
    "workspaces".split()
)
MAKE_COMMAND = re.compile(r"^make\s+([\w.-]+)(?=\s|$)")
OTHER_MANIFEST = re.compile(r"\s(-w|--workspace|--filter|-F|-C|--prefix|--cwd|--dir|-f)\b")
FENCE = re.compile(r"^```[^\n]*\n(.*?)^```", re.MULTILINE | re.DOTALL)
INLINE_CODE = re.compile(r"`([^`\n]+)`")
CONTEXT_NOTE_TOKENS = 150_000
TRANSCRIPT_TAIL = 1 << 20


def state_dir(session_id: str) -> Path:
    safe_id = "".join(c for c in session_id if c.isalnum() or c in ("-", "_")) or "default"
    path = Path("/tmp/agent_context_forge") / f"stability_{safe_id}"
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, timeout=10)
    return result.stdout if result.returncode == 0 else ""


def emit(event: str, system_message: str = "", **fields: str) -> None:
    """One JSON reply. `fields` reach Claude; `system_message` is shown to the user only."""
    reply: dict = {"hookSpecificOutput": {"hookEventName": event, **fields}}
    if system_message:
        reply["systemMessage"] = system_message
    print(json.dumps(reply))


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
    note = context_note(data)
    if note:
        emit("UserPromptSubmit", system_message=note)


# --- Context size ---------------------------------------------------------------------------
# In long sessions the money goes to re-sending the conversation: every request carries all of
# it, so cost grows with its size times the number of requests. Notes go to the user only (a
# systemMessage), so they cost no tokens and never change what Claude reads.


def note_threshold() -> int:
    try:
        return max(0, int(os.environ.get("ACF_CONTEXT_NOTE_TOKENS", CONTEXT_NOTE_TOKENS)))
    except ValueError:
        return CONTEXT_NOTE_TOKENS


def request_tokens(entry: dict) -> int | None:
    """Prompt tokens of one main-conversation response in the transcript, or None."""
    message = entry.get("message") or {}
    usage = message.get("usage")
    if entry.get("type") != "assistant" or entry.get("isSidechain") or not isinstance(usage, dict):
        return None
    return sum(usage.get(k) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))


def transcript_tokens(path: str) -> tuple[int | None, int | None]:
    """(first, last) request sizes in a transcript: its fixed prompt and its current size.

    Reads at most the first and last MiB, so the cost stays flat however long the session gets.
    """
    def scan(lines):
        for line in lines:
            try:
                tokens = request_tokens(json.loads(line))
            except Exception:
                continue
            if tokens:
                return tokens
        return None

    with open(path, "rb") as f:
        head = f.read(TRANSCRIPT_TAIL).decode("utf-8", "replace").splitlines()
        size = f.seek(0, os.SEEK_END)
        start = max(0, size - TRANSCRIPT_TAIL)
        f.seek(start)
        tail = f.read().decode("utf-8", "replace").splitlines()
    # A read that stops or starts mid-file cuts a line in two: drop the partial one
    return scan(head[:-1] if size > TRANSCRIPT_TAIL else head), scan(reversed(tail[1:] if start else tail))


def context_note(data: dict) -> str:
    """A note each time the conversation grows past another multiple of the threshold."""
    step = note_threshold()
    path = data.get("transcript_path")
    if not step or not path or not os.path.exists(path):
        return ""
    first, last = transcript_tokens(path)
    if not last:
        return ""
    band_file = state_dir(data["session_id"]) / "context_band"
    try:
        noted = int(band_file.read_text(encoding="utf-8"))
    except Exception:
        noted = 0
    band = last // step
    band_file.write_text(str(band), encoding="utf-8")  # drops back after /compact or /clear
    if band < 1 or band <= noted:
        return ""
    times = f", {last / first:.0f}x what its first request carried" if first and last >= 2 * first else ""
    return (
        f"Context is ~{last // 1000}k tokens{times}. Every request re-sends all of it, so in a long "
        "session its size is most of the cost. New task: /clear (save notes first). Same task: "
        "/compact. (agent-context-forge; ACF_CONTEXT_NOTE_TOKENS=0 turns this off)"
    )


def resume_note(data: dict) -> str:
    """Resuming after the cache expired re-sends the whole conversation at the cache-write price."""
    tokens = data.get("context_tokens") or 0
    if data.get("source") not in ("resume", "fork") or not data.get("prompt_cache_likely_expired") or tokens < 100_000:
        return ""
    usd = data.get("estimated_cache_write_usd")
    price = f" (about ${usd:.2f})" if isinstance(usd, (int, float)) else ""
    return (
        f"Resuming re-sends ~{tokens // 1000}k tokens with an expired cache{price} before any work. "
        "If what's left is a new task, a fresh session with a short handover note is cheaper."
    )


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


NEGATED = re.compile(r"\b(?:no|not|never|without|instead of|rather than|don't|doesn't)\W*$", re.IGNORECASE)


def command_spans(text: str) -> list[str]:
    """Commands a context file shows: lines of fenced blocks, then backticked spans, leaving out
    spans the sentence negates ("there is no `pnpm dev`")."""
    text = HTML_COMMENT.sub("", text)
    spans = [line.strip().removeprefix("$ ").strip() for block in FENCE.findall(text) for line in block.splitlines()]
    prose = FENCE.sub("", text)
    spans += [m.group(1).strip() for m in INLINE_CODE.finditer(prose) if not NEGATED.search(prose[max(0, m.start() - 30) : m.start()])]
    return [s for s in spans if s]


def command_references(text: str) -> list[tuple[str, str]]:
    """What a context file runs: ("script", name) for `npm run x` and `npm test`, ("bare", name)
    for `pnpm x` / `yarn x` (a script, or else a dependency's binary), ("make", target)."""
    refs: list[tuple[str, str]] = []
    for span in command_spans(text):
        if OTHER_MANIFEST.search(span):
            continue
        script = SCRIPT_COMMAND.match(span)
        target = MAKE_COMMAND.match(span)
        if script and script.group(3):
            ref = None if script.group(3) in PM_BUILTINS else ("bare", script.group(3))
        elif script:
            ref = ("script", script.group(1) or script.group(2))
        else:
            ref = ("make", target.group(1)) if target else None
        if ref and ref not in refs:
            refs.append(ref)
    return refs


def manifests() -> list[str]:
    """Tracked package.json files and Makefiles: a workspace package can define what the root lacks."""
    tracked = git("ls-files", "--", "package.json", "*/package.json", "Makefile", "*/Makefile").splitlines()
    return [f for f in tracked if "node_modules/" not in f] or ["package.json", "Makefile"]


def defined_commands(read, files: list[str]) -> dict[str, set[str] | None]:
    """Scripts, binaries and make targets the manifests define, read through `read(name)`.

    None for a kind means "can't tell": no manifest of that kind, one that doesn't parse, a
    Makefile whose targets come from includes or patterns, or (for bare `pnpm x`) no installed
    node_modules/.bin to check binaries against.
    """
    scripts: set[str] | None = None
    targets: set[str] | None = None
    make_unknown = False
    for name in files:
        text = read(name)
        if text is None:
            continue
        if name.endswith("package.json"):
            try:
                found = json.loads(text).get("scripts") or {}
            except Exception:
                return {"script": None, "bare": None, "make": None}
            scripts = (scripts or set()) | (set(found) if isinstance(found, dict) else set())
        elif re.search(r"^\s*-?include\b|^[^\s#:=]*%[^\s:=]*\s*:", text, re.MULTILINE):
            make_unknown = True
        else:
            found = {t for line in re.findall(r"^([\w.\- ]+?)\s*::?(?!=)", text, re.MULTILINE) for t in line.split()}
            targets = (targets or set()) | found
    bins = Path("node_modules", ".bin")
    bare = scripts | {p.name for p in bins.iterdir()} if scripts is not None and bins.is_dir() else None
    return {"script": scripts, "bare": bare, "make": None if make_unknown else targets}


def describe(kind: str, name: str) -> str:
    return f"make target `{name}` (Makefile)" if kind == "make" else f"script `{name}` (package.json)"


def missing_commands() -> list[str]:
    """Scripts and make targets the context files run that the repo doesn't define."""
    defined = defined_commands(read_working, manifests())
    missing: list[str] = []
    for name in context_files():
        for kind, ref in command_references(read_working(name) or ""):
            label = describe(kind, ref)
            if defined[kind] is not None and ref not in defined[kind] and label not in missing:
                missing.append(label)
    return missing


def command_drift(before, after) -> list[str]:
    """Context files (read through `after`) that run a script or make target the commit removes."""
    files = manifests()
    old, new = defined_commands(before, files), defined_commands(after, files)
    reasons = []
    for name in context_files():
        for kind, ref in command_references(after(name) or ""):
            if old[kind] is not None and new[kind] is not None and ref in old[kind] and ref not in new[kind]:
                reasons.append(f"{name} runs {describe(kind, ref)}, which this commit removes")
    return reasons


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
        "next session isn't sent to a path or command that no longer exists."
    )


def read_working(name: str) -> str | None:
    try:
        return Path(name).read_text(encoding="utf-8")
    except Exception:
        return None


def read_staged(name: str) -> str | None:
    result = subprocess.run(["git", "show", f":{name}"], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def read_head(name: str) -> str | None:
    result = subprocess.run(["git", "show", f"HEAD:{name}"], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def check_staged() -> int:
    """`--check-staged`: the git pre-commit hook's entry point, for commits outside Claude Code."""
    os.chdir(git("rev-parse", "--show-toplevel").strip() or ".")
    reasons = drift_reasons(staged_removals(), read_staged) + command_drift(read_head, read_staged)
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
        stale = [f"`{m}`" for m in missing_references()] + missing_commands()
        note = resume_note(data)
        if stale or note:
            fields = {}
            if stale:
                fields["additionalContext"] = (
                    "Paths and commands named in the project's instruction files that do not exist in this "
                    f"repo: {', '.join(stale)}. The lines naming them are probably out of date: "
                    "trust the code over them, and point out the conflict to the user."
                )
            emit("SessionStart", system_message=note, **fields)
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


def project_path(target: str) -> str:
    """A path relative to the project, or "" when it lies outside it."""
    # realpath on both sides: on macOS the project dir may be reached through /var -> /private/var
    rel = os.path.relpath(os.path.realpath(target), os.path.realpath("."))
    return "" if rel == ".." or rel.startswith("../") else rel


REDIRECT = re.compile(r"^(?:\d|&)?>>?(.*)$")
IN_PLACE = re.compile(r"^-(?:i\S*|[a-hj-zA-Z]*i[a-zA-Z]*)$|^--in-place")
WRAPPERS = {"sudo", "env", "command", "nohup", "time"}


def bash_write_targets(command: str, cwd: str) -> list[str]:
    """Files a Bash command writes in place: redirections, `tee`, `sed -i`, `perl -i`, the
    destination of `cp`/`mv`/`install`, and `dd of=`. Relative paths follow `cd` in the command.

    Writes inside scripts and interpreters (`python -c`, `node -e`) are not seen.
    """
    targets: list[str] = []
    here = cwd
    for segment in re.split(r"&&|\|\||;|\||\n", command):
        try:
            words = shlex.split(segment)
        except ValueError:
            continue
        while words and (words[0] in WRAPPERS or re.match(r"^\w+=", words[0])):
            words = words[1:]
        if not words:
            continue
        if words[0] == "cd" and len(words) > 1:
            here = os.path.join(here, os.path.expanduser(words[1]))
            continue
        found: list[str] = []
        args: list[str] = []
        skip_next = False
        for i, word in enumerate(words[1:], start=1):
            if skip_next:
                skip_next = False
                continue
            if word.startswith("<"):  # input: `< file`, `<<EOF`, `<<< text`
                skip_next = word in ("<", "<<", "<<<", "<<-")
                continue
            redirect = REDIRECT.match(word)
            if redirect:
                target = redirect.group(1) or (words[i + 1] if i + 1 < len(words) else "")
                skip_next = not redirect.group(1)
                if target and not target.startswith("&") and not target.startswith("/dev/"):
                    found.append(target)
                continue
            args.append(word)
        name = os.path.basename(words[0])
        plain = [a for a in args if a and not a.startswith("-")]
        if name == "tee":
            found += plain
        elif name in ("sed", "gsed", "perl") and any(IN_PLACE.match(a) for a in args):
            # Drop the script: the value after -e/-f, or else the first plain argument
            values = {args[k + 1] for k, a in enumerate(args[:-1]) if a in ("-e", "-f", "--expression") or re.fullmatch(r"-\w*e", a)}
            files = [a for a in plain if a not in values]
            found += files if values else files[1:]
        elif name in ("cp", "mv", "install") and len(plain) >= 2:
            dest = plain[-1]
            found.append(dest)
            found += [os.path.join(dest, os.path.basename(src.rstrip("/"))) for src in plain[:-1]]
        elif name == "dd":
            found += [a[3:] for a in args if a.startswith("of=")]
        targets += [t if os.path.isabs(t) else os.path.join(here, os.path.expanduser(t)) for t in found]
    return targets


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
            committed = files_to_commit(command)
            drift = drift_reasons(command_removals(command), read_working) + command_drift(
                read_head, lambda name: read_working(name) if name in committed else read_staged(name)
            )
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
        path_rules = [r for r in rules if r.get("kind") == "path"]
        if path_rules:
            written = [project_path(t) for t in bash_write_targets(command, data.get("cwd") or ".")]
            broken += [r for r in path_rules if any(w and matches_any(w, r.get("paths", [])) for w in written)]
    elif tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        rel = project_path(target) if os.path.isabs(target) else target
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
