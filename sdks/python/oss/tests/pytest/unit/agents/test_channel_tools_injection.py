"""An agent connected to a Slack or Telegram bot gets the channel tools on
every run, without a change to its saved configuration. The API says which
tools the bot's settings allow; the author's own entries win; a failed check
adds nothing and never breaks the run."""

from __future__ import annotations

import asyncio
from typing import Any, List

import pytest

from agenta.sdk.agents.dtos import RunContext, RunContextReference, RunContextWorkflow
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.tools import PlatformToolConfig, ResolvedToolSet

from .test_agent_composition_seam import _FakeBackend, _no_connection, _request

pytestmark = pytest.mark.asyncio

ARTIFACT = "01a0d496-dd38-7c03-969c-f98da5eb8b45"
ALL = [
    "list_channel_destinations",
    "send_channel_message",
    "read_channel_messages",
    "search_channel_messages",
]


def _run_context():
    return RunContext(
        workflow=RunContextWorkflow(artifact=RunContextReference(id=ARTIFACT))
    )


async def _run(*, channel_tools, authored: List[dict] | None = None):
    seen: List[Any] = []
    asked: List[Any] = []

    async def _resolve_tools(tools, **kwargs):
        seen.append(list(tools))
        return ResolvedToolSet()

    async def _channel_tools(*, workflow_id):
        asked.append(workflow_id)
        if isinstance(channel_tools, Exception):
            raise channel_tools
        if channel_tools == "hang":
            await asyncio.sleep(3600)
        return channel_tools

    comp = AgentComposition(
        select_backend=lambda template: _FakeBackend(),
        resolve_connection=_no_connection,
        resolve_tools=_resolve_tools,
        resolve_channel_tools=_channel_tools,
        run_context=_run_context,
    )
    params = {"agent": {"harness": {"kind": "pi_core"}, "tools": authored or []}}
    await make_agent_handler(comp)(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters=params,
    )
    return seen[0], asked


def _ops(tools):
    return [t.op for t in tools if isinstance(t, PlatformToolConfig)]


async def test_a_connected_agent_gets_the_channel_tools():
    tools, asked = await _run(channel_tools=ALL)

    assert asked == [ARTIFACT]
    assert _ops(tools) == ALL


async def test_a_disconnected_agent_gets_none():
    tools, _ = await _run(channel_tools=[])

    assert _ops(tools) == []


async def test_the_bot_settings_decide_which_tools_come():
    tools, _ = await _run(channel_tools=["list_channel_destinations"])

    assert _ops(tools) == ["list_channel_destinations"]


async def test_an_author_entry_wins_and_is_not_duplicated():
    authored = [
        {"type": "platform", "op": "send_channel_message", "permission": "ask"},
        {"type": "platform", "op": "discover_tools"},
    ]

    tools, _ = await _run(channel_tools=ALL, authored=authored)

    ops = _ops(tools)
    assert ops.count("send_channel_message") == 1
    send = next(t for t in tools if getattr(t, "op", None) == "send_channel_message")
    assert send.permission == "ask"
    assert set(ops) == {*ALL, "discover_tools"}


async def test_a_failed_check_adds_nothing_and_the_run_goes_on():
    tools, _ = await _run(channel_tools=RuntimeError("api down"))

    assert _ops(tools) == []


async def test_a_slow_check_is_bounded(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_SESSION_CONTEXT_TIMEOUT", "0.05")

    tools, _ = await _run(channel_tools="hang")

    assert _ops(tools) == []


async def test_an_unknown_op_from_the_api_is_ignored():
    tools, _ = await _run(channel_tools=["list_channel_destinations", "rm_rf"])

    assert _ops(tools) == ["list_channel_destinations"]


async def test_a_tool_that_already_uses_an_ops_name_wins():
    authored = [{"type": "client", "name": "send_channel_message"}]

    tools, _ = await _run(channel_tools=ALL, authored=authored)

    assert "send_channel_message" not in _ops(tools)
    assert set(_ops(tools)) == {*ALL} - {"send_channel_message"}
