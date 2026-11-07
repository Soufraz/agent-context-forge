#!/usr/bin/env python3
"""
Claude Code PreToolUse Hook: Subagent Context Isolation Guardrail (Pillar 4)

Monitors the primary agent's tool calls for runaway inline exploration. Every time the
agent makes too many consecutive exploratory calls (Read, Grep, Glob, or searching and
reading through Bash, which is how Claude Code searches on macOS and Linux by default)
without dispatching a subagent or editing code, it adds a note suggesting a subagent.

The note never blocks the call: denying it only cost a retry in benchmarks, and agents did
not delegate in response.

Calls made inside subagents are ignored: hooks fire there too, with the parent's
session_id plus an agent_id, and exploring is exactly what a subagent is for.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

MAX_CONSECUTIVE_EXPLORATIONS = 15
EXPLORATORY_TOOLS = {"Read", "Grep", "Glob"}
# Bash commands that only search or read, optionally after a `cd dir &&`
EXPLORATORY_BASH = re.compile(
    r"^\s*(?:cd\s+\S+\s*(?:&&|;)\s*)?(?:grep|rg|find|fd|cat|head|tail|less|tree|ls|wc|sed\s+-n)\b"
)
# "Task" is the delegation tool's name before Claude Code v2.1.63 renamed it to "Agent"
RESET_TOOLS = {"Agent", "Task", "Write", "Edit"}


def get_state_path(session_id: str) -> Path:
    safe_id = "".join(c for c in session_id if c.isalnum() or c in ("-", "_")) or "default"
    tmp_dir = Path("/tmp/agent_context_forge")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    return tmp_dir / f"exploration_{safe_id}.json"


def load_state(path: Path) -> dict:
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"count": 0}


def save_state(path: Path, state: dict) -> None:
    try:
        path.write_text(json.dumps(state), encoding="utf-8")
    except Exception:
        pass


def main() -> int:
    if sys.stdin.isatty():
        return 0

    try:
        payload = json.loads(sys.stdin.read().strip() or "{}")
    except Exception:
        return 0

    # Subagent tool calls belong to the subagent's own context, not the primary one
    if payload.get("agent_id"):
        return 0

    tool_name = payload.get("tool_name", "")
    session_id = payload.get("session_id") or os.environ.get("CLAUDE_SESSION_ID", "default")
    state_path = get_state_path(session_id)
    state = load_state(state_path)

    # 1. Reset exploration counter when task delegation or code writing occurs
    if tool_name in RESET_TOOLS:
        state["count"] = 0
        save_state(state_path, state)
        return 0

    # 2. Track consecutive exploratory search tool calls
    command = (payload.get("tool_input") or {}).get("command") or ""
    if tool_name in EXPLORATORY_TOOLS or (tool_name == "Bash" and EXPLORATORY_BASH.match(command)):
        count = state.get("count", 0) + 1
        state["count"] = count

        # Trigger guardrail at the threshold, then re-arm for the next run of explorations
        if count >= MAX_CONSECUTIVE_EXPLORATIONS:
            state["count"] = 0
            save_state(state_path, state)

            note = (
                f"Context Isolation Guardrail: {count} consecutive search and read calls have run in "
                "the main session. A broad investigation like this can run in a subagent (Agent tool, "
                "Explore type) that returns only a summary, which keeps the main context small."
            )

            output = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": note,
                }
            }
            print(json.dumps(output))
            return 0

        save_state(state_path, state)

    return 0


if __name__ == "__main__":
    sys.exit(main())
