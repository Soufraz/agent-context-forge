#!/usr/bin/env python3
"""
Claude Code PreToolUse Hook: Subagent Context Isolation Guardrail (Pillar 4)

Monitors the primary agent's tool calls to prevent runaway inline exploration.
If the agent executes too many consecutive exploratory calls (Read, Grep, Glob)
without dispatching a subagent (Task tool) or editing code, it triggers a
protective permission denial advising the agent to isolate context into a subagent.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

MAX_CONSECUTIVE_EXPLORATIONS = 10
EXPLORATORY_TOOLS = {"Read", "Grep", "Glob"}
RESET_TOOLS = {"Task", "Write", "Edit"}


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
    return {"count": 0, "warned": False}


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

    tool_name = payload.get("tool_name", "")
    session_id = payload.get("session_id") or os.environ.get("CLAUDE_SESSION_ID", "default")
    state_path = get_state_path(session_id)
    state = load_state(state_path)

    # 1. Reset exploration counter when task delegation or code writing occurs
    if tool_name in RESET_TOOLS:
        state["count"] = 0
        state["warned"] = False
        save_state(state_path, state)
        return 0

    # 2. Track consecutive exploratory search tool calls
    if tool_name in EXPLORATORY_TOOLS:
        count = state.get("count", 0) + 1
        warned = state.get("warned", False)
        state["count"] = count

        # Trigger guardrail at threshold once to guide the agent
        if count >= MAX_CONSECUTIVE_EXPLORATIONS and not warned:
            state["warned"] = True
            save_state(state_path, state)

            reason = (
                f"Context Isolation Guardrail: {count} consecutive exploratory search calls "
                f"({tool_name}) executed in the primary context window.\n"
                "To prevent context dilution (lost-in-the-middle) and save tokens, please delegate "
                "this investigation to a fresh research subagent (via the Task tool) and return "
                "only a concise synthesis to this session."
            )

            output = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
            print(json.dumps(output))
            return 0

        save_state(state_path, state)

    return 0


if __name__ == "__main__":
    sys.exit(main())
