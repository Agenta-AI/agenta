"""Smoke CLI — talk to the Pydantic-AI vanilla agent against a real LLM.

Run from the draft/ directory with .env populated (OPENAI_API_KEY etc.):

    uv run python scripts/chat_pydanticai.py
    uv run python scripts/chat_pydanticai.py --persona guest_eve   # Platinum

This is for manual prompt iteration before wiring the FastAPI server. It
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
from pydantic_ai import RunContext
from pydantic_ai.messages import (
    AgentStreamEvent,
    FunctionToolResultEvent,
    ModelMessage,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ToolCallPart,
    ToolCallPartDelta,
)

# Load .env early so the model factory below sees OPENAI_API_KEY etc.
_DRAFT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_DRAFT_ROOT / ".env")

# Path setup for "uv run" without --package
sys.path.insert(0, str(_DRAFT_ROOT))

from core.container import build_default_deps  # noqa: E402
from runtimes.pydanticai.vanilla import agent  # noqa: E402


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


def _format_tool_args(args) -> str:
    if isinstance(args, dict):
        try:
            return json.dumps(args)
        except Exception:  # noqa: BLE001
            pass
    return str(args)


async def _print_event(event: AgentStreamEvent) -> None:
    if isinstance(event, PartStartEvent):
        if isinstance(event.part, TextPart):
            sys.stdout.write("\033[36m" + event.part.content)
            sys.stdout.flush()
        elif isinstance(event.part, ToolCallPart):
            sys.stdout.write(
                f"\n\033[33m[tool] {event.part.tool_name}({_format_tool_args(event.part.args)})\033[0m"
            )
            sys.stdout.flush()
    elif isinstance(event, PartDeltaEvent):
        if isinstance(event.delta, TextPartDelta):
            sys.stdout.write(event.delta.content_delta)
            sys.stdout.flush()
        elif isinstance(event.delta, ToolCallPartDelta):
            # Args trickle in piece by piece; the full call was shown on PartStart
            pass
    elif isinstance(event, FunctionToolResultEvent):
        content = event.result.content
        preview = content if isinstance(content, str) else json.dumps(content, default=str)
        if len(preview) > 240:
            preview = preview[:237] + "..."
        sys.stdout.write(f"\n\033[32m[result] {preview}\033[0m")
        sys.stdout.flush()


async def _event_handler(ctx: RunContext, events) -> None:
    async for event in events:
        await _print_event(event)


async def _chat_once(deps, user_msg: str, history: list[ModelMessage]) -> list[ModelMessage]:
    """One round-trip. Streams text + tool events to stdout. Returns updated history."""
    print()
    result = await agent.run(
        user_msg,
        deps=deps,
        message_history=history,
        event_stream_handler=_event_handler,
    )
    sys.stdout.write("\033[0m\n")
    return list(result.all_messages())


async def main() -> None:
    args = _parse_args()
    db_url = (
        f"sqlite+aiosqlite:///{args.db}"
        if args.db != ":memory:"
        else "sqlite+aiosqlite:///:memory:"
    )

    print(f"Hotel agent — pydantic-ai vanilla (persona={args.persona})")
    print("Type 'exit' to quit.\n")

    deps = await build_default_deps(db_url=db_url, current_user_id=args.persona)
    history: list[ModelMessage] = []

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
