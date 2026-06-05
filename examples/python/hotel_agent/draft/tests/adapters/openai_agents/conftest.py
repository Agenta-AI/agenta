"""Adapter-test fixtures for the OpenAI Agents SDK runtime.

These tests do NOT call a real LLM. The OpenAI Agents SDK has no public test
model, so instead of driving the full agent loop we invoke each tool the way the
SDK would once the model has chosen it: synthesize the JSON args, build a
``ToolContext`` carrying our ``AgentDeps``, and call ``tool.on_invoke_tool``.

That exercises exactly the adapter shim (arg parsing, the ``deps.pms.*`` call,
the JSON serialization, the error handler) without any network. The
PMS / Clock / FakePMS fixtures come from the parent ``conftest.py``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable

import pytest_asyncio
from agents.tool_context import ToolContext

from core.clock import FixedClock
from core.db.seed_data import GUEST_SARAH_ID
from core.deps import AgentDeps
from core.integrations.pms.fake import FakePMS
from core.retrieval.store import InMemoryRetriever
from runtimes.openai_agents.vanilla import ALL_TOOLS

_DOCS_DIR = Path(__file__).resolve().parents[3] / "core" / "retrieval" / "docs"
_TOOLS = {t.name: t for t in ALL_TOOLS}


@pytest_asyncio.fixture
async def retriever() -> InMemoryRetriever:
    return InMemoryRetriever.from_dir(_DOCS_DIR)


@pytest_asyncio.fixture
async def deps(
    pms: FakePMS,
    retriever: InMemoryRetriever,
    fixed_clock: FixedClock,
) -> AgentDeps:
    """Default AgentDeps for tests, scoped to Sarah (Standard tier)."""
    return AgentDeps(
        pms=pms,
        retriever=retriever,
        clock=fixed_clock,
        current_user_id=GUEST_SARAH_ID,
    )


CallTool = Callable[[AgentDeps, str, dict[str, Any]], Awaitable[Any]]


@pytest_asyncio.fixture
async def call_tool() -> AsyncIterator[CallTool]:
    """Yield ``await call_tool(deps, name, args)`` — invokes a tool by name.

    Returns the parsed JSON the tool produced (dict / list), or the raw string
    when the output isn't JSON (e.g. the ``_tool_error`` recovery message).
    """

    async def _call(deps: AgentDeps, name: str, args: dict[str, Any]) -> Any:
        payload = json.dumps(args)
        ctx = ToolContext(
            deps,
            tool_name=name,
            tool_call_id=f"call_{name}",
            tool_arguments=payload,
        )
        raw = await _TOOLS[name].on_invoke_tool(ctx, payload)
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return raw

    yield _call
