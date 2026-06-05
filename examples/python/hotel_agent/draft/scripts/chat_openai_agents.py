"""Smoke CLI — talk to the OpenAI Agents SDK vanilla agent against a real LLM.

Run from the draft/ directory with .env populated (OPENAI_API_KEY etc.):

    uv run python scripts/chat_openai_agents.py
    uv run python scripts/chat_openai_agents.py --persona guest_eve   # Platinum

The OpenAI Agents SDK counterpart to ``chat_pydanticai.py``. It streams text and
surfaces tool calls + results as they happen so you can spot prompt issues
quickly. Type ``exit`` or Ctrl-C to quit.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from agents import Runner
from agents.stream_events import RawResponsesStreamEvent, RunItemStreamEvent
from dotenv import load_dotenv
from openai.types.responses import ResponseTextDeltaEvent

# Load .env early so the Agents SDK sees OPENAI_API_KEY.
_DRAFT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_DRAFT_ROOT / ".env")

# Path setup for "uv run" without --package
sys.path.insert(0, str(_DRAFT_ROOT))

from core.container import build_default_deps  # noqa: E402
from runtimes.openai_agents.vanilla import agent  # noqa: E402

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


def _preview(value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= 240 else text[:237] + "..."


async def _chat_once(deps, user_msg: str, history: list[Any]) -> list[Any]:
    """One round-trip. Streams text + tool events to stdout. Returns updated history."""
    print()
    run_input = [*history, {"role": "user", "content": user_msg}]
    result = Runner.run_streamed(agent, input=run_input, context=deps)

    async for event in result.stream_events():
        if isinstance(event, RawResponsesStreamEvent):
            data = event.data
            if isinstance(data, ResponseTextDeltaEvent) and data.delta:
                sys.stdout.write("\033[36m" + data.delta)
                sys.stdout.flush()
        elif isinstance(event, RunItemStreamEvent):
            if event.name == "tool_called":
                item = event.item
                args = getattr(item.raw_item, "arguments", "")
                sys.stdout.write(f"\n\033[33m[tool] {item.tool_name}({args})\033[0m")
                sys.stdout.flush()
            elif event.name == "tool_output":
                sys.stdout.write(f"\n\033[32m[result] {_preview(event.item.output)}\033[0m")
                sys.stdout.flush()

    sys.stdout.write("\033[0m\n")
    return result.to_input_list()


async def main() -> None:
    args = _parse_args()
    db_url = (
        f"sqlite+aiosqlite:///{args.db}"
        if args.db != ":memory:"
        else "sqlite+aiosqlite:///:memory:"
    )

    print(f"Hotel agent — openai-agents vanilla (persona={args.persona})")
    print("Type 'exit' to quit.\n")

    deps = await build_default_deps(db_url=db_url, current_user_id=args.persona)
    history: list[Any] = []

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
