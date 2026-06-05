"""Smoke CLI — talk to the LangChain vanilla agent against a real LLM.

Run from the draft/ directory with .env populated (OPENAI_API_KEY etc.):

    uv run python scripts/chat_langgraph.py
    uv run python scripts/chat_langgraph.py --persona guest_eve   # Platinum

This is for manual prompt iteration before relying on the FastAPI server. It
streams text and surfaces tool calls + results as they happen so you can spot
prompt issues quickly. Type ``exit`` or Ctrl-C to quit.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, ToolMessage

# Load .env early so the model factory sees OPENAI_API_KEY etc.
_DRAFT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_DRAFT_ROOT / ".env")

# Path setup for "uv run" without --package
sys.path.insert(0, str(_DRAFT_ROOT))

from core.container import build_default_deps  # noqa: E402
from runtimes.langgraph.vanilla import agent, build_input_messages  # noqa: E402

_VALID_PERSONAS = (
    "guest_sarah",
    "guest_bob",
    "guest_carla",
    "guest_dan",
    "guest_eve",
    "guest_frank",
    "guest_grace",
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--persona",
        default="guest_sarah",
        choices=_VALID_PERSONAS,
        help="Which seed guest to act as. Default: guest_sarah (Standard).",
    )
    p.add_argument(
        "--db",
        default=":memory:",
        help='SQLite path. ":memory:" (default) is fresh per session.',
    )
    return p.parse_args()


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    return ""


async def _chat_once(deps, user_msg: str, history: list[BaseMessage]) -> list[BaseMessage]:
    """One round-trip. Streams text + tool events to stdout. Returns updated history."""
    messages = await build_input_messages(deps, history, user_msg)
    new_messages: list[BaseMessage] = []
    print()
    async for mode, payload in agent.astream(
        {"messages": messages}, context=deps, stream_mode=["updates", "messages"]
    ):
        if mode == "messages":
            msg, _meta = payload
            if isinstance(msg, (AIMessage, AIMessageChunk)):
                text = _text_of(msg.content)
                if text:
                    sys.stdout.write("\033[36m" + text + "\033[0m")
                    sys.stdout.flush()
        elif mode == "updates":
            for _node, update in (payload or {}).items():
                if not isinstance(update, dict):
                    continue
                for m in update.get("messages", []):
                    new_messages.append(m)
                    if isinstance(m, AIMessage) and m.tool_calls:
                        for tc in m.tool_calls:
                            sys.stdout.write(
                                f"\n\033[33m[tool] {tc.get('name')}({json.dumps(tc.get('args'))})\033[0m"
                            )
                    elif isinstance(m, ToolMessage):
                        preview = str(m.content)
                        if len(preview) > 240:
                            preview = preview[:237] + "..."
                        sys.stdout.write(f"\n\033[32m[result] {preview}\033[0m")
                    sys.stdout.flush()
    sys.stdout.write("\033[0m\n")
    return [*history, *messages[-1:], *new_messages]


async def main() -> None:
    args = _parse_args()
    db_url = (
        f"sqlite+aiosqlite:///{args.db}"
        if args.db != ":memory:"
        else "sqlite+aiosqlite:///:memory:"
    )

    print(f"Hotel agent — langchain vanilla (persona={args.persona})")
    print("Type 'exit' to quit.\n")

    deps = await build_default_deps(db_url=db_url, current_user_id=args.persona)
    history: list[BaseMessage] = []

    while True:
        try:
            user_msg = input("\033[1myou>\033[0m ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not user_msg:
            continue
        if user_msg.lower() in {"exit", "quit"}:
            return
        history = await _chat_once(deps, user_msg, history)


if __name__ == "__main__":
    asyncio.run(main())
