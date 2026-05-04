"""Adapter-test fixtures.

These tests do NOT call a real LLM. They build a fresh ``Agent`` per test
with the deterministic ``FunctionModel`` so they can synthesize the exact
tool calls a real LLM might emit, then assert the right ``deps.pms.*``
method got hit and the result flowed back. No env vars required.

The PMS / Clock / FakePMS fixtures come from the parent ``conftest.py``.
"""

from __future__ import annotations

from pathlib import Path
from typing import AsyncIterator

import pytest_asyncio
from pydantic_ai import Agent

from core.clock import FixedClock
from core.deps import AgentDeps
from core.db.seed_data import GUEST_SARAH_ID
from core.integrations.pms.fake import FakePMS
from core.retrieval.store import InMemoryRetriever
from runtimes.pydanticai.vanilla.adapters import register_tools


_DOCS_DIR = Path(__file__).resolve().parents[3] / "core" / "retrieval" / "docs"


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


@pytest_asyncio.fixture
async def agent_factory() -> AsyncIterator[callable]:
    """Yield a function that builds a fresh Agent with a custom model.

    Each test owns its own Agent so module state never leaks. The factory
    accepts a model (typically ``FunctionModel`` or ``TestModel``) and a
    minimal system prompt suitable for a one-shot tool-call test.
    """

    def _build(model, system_prompt: str = "Test agent.") -> Agent:
        agent = Agent(
            model,
            deps_type=AgentDeps,
            system_prompt=system_prompt,
        )
        register_tools(agent)
        return agent

    yield _build
