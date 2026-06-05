"""Adapter-test fixtures for the LangChain vanilla runtime.

These tests do NOT call a real LLM. They use a fake chat model that returns a
scripted ``AIMessage`` with ``tool_calls`` first, then a final text answer — so
we can synthesize the exact tool call a real model might emit, run the
``create_agent`` graph against an ``AgentDeps`` context, and assert the right
``deps.pms.*`` method got hit. No env vars required.

The PMS / Clock / FakePMS fixtures come from the parent ``conftest.py``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, AsyncIterator, Callable, Sequence

import pytest_asyncio
from langchain.agents import create_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from core.clock import FixedClock
from core.db.seed_data import GUEST_SARAH_ID
from core.deps import AgentDeps
from core.integrations.pms.fake import FakePMS
from core.retrieval.store import InMemoryRetriever
from runtimes.langgraph.vanilla.adapters import ALL_TOOLS

_DOCS_DIR = Path(__file__).resolve().parents[3] / "core" / "retrieval" / "docs"


class SequencedChatModel(BaseChatModel):
    """Returns queued messages in order. ``bind_tools`` is a no-op because the
    tool calls are scripted, not chosen by a model."""

    responses: Sequence[BaseMessage]
    cursor: dict[str, int]

    @property
    def _llm_type(self) -> str:
        return "sequenced-fake"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        i = self.cursor.get("i", 0)
        msg = self.responses[min(i, len(self.responses) - 1)]
        self.cursor["i"] = i + 1
        return ChatResult(generations=[ChatGeneration(message=msg)])

    def bind_tools(self, tools, **kwargs) -> "SequencedChatModel":  # noqa: ARG002
        return self


def model_calling(tool_name: str, args: dict[str, Any], follow_up: str = "Done.") -> BaseChatModel:
    """A fake model that calls ``tool_name`` once, then answers with ``follow_up``."""
    return SequencedChatModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[{"name": tool_name, "args": args, "id": "call_1", "type": "tool_call"}],
            ),
            AIMessage(content=follow_up),
        ],
        cursor={},
    )


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
async def agent_factory() -> AsyncIterator[Callable[[BaseChatModel], Any]]:
    """Yield a function that builds a fresh agent graph bound to a fake model.

    Each test owns its own graph so module state never leaks. ``context_schema``
    is ``AgentDeps`` so the run ``context`` flows into every tool's ToolRuntime.
    """

    def _build(model: BaseChatModel) -> Any:
        return create_agent(model=model, tools=list(ALL_TOOLS), context_schema=AgentDeps)

    yield _build
