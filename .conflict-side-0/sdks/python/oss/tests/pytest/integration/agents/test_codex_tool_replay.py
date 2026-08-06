"""Replay a real Codex tool run through the SDK, with no live LLM.

The Milestone 2 QA proved Agenta tools reach and are invoked on Codex over the internal
``agenta-tools`` loopback MCP channel: a real Codex (``gpt-5.6-luna``) run called the platform
``discover_tools`` tool, delivered as ``mcp.agenta-tools.discover_tools`` (the Codex dot naming).
This pins that run so it stays green with no model call.

The recorded ``result`` is fed back through the REAL SDK path (the subprocess transport +
``result_from_wire`` inside the ``CodexHarness`` driver), and the test asserts the STRUCTURE the
run proves, never prose or the tool backend's success: which tool was invoked, over which channel,
the capability flags, and the stop reason. The recorded ``tool_result`` carries ``isError=True``
only because the QA deployment had no Composio provider; that is deliberately NOT asserted (a
replay test pins structure, per the ``agent-replay-test`` skill).

Provenance and redactions live in the fixture's own ``provenance`` block.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from agenta.sdk.agents import (
    AgentTemplate,
    CodexHarness,
    Environment,
    Message,
    SessionConfig,
)

from ._fake_runner_backend import FakeRunnerBackend

pytestmark = [pytest.mark.integration, pytest.mark.cost_free]

REC = Path(__file__).parent / "recordings"


def _load(name: str) -> dict:
    return json.loads((REC / name).read_text(encoding="utf-8"))


def _replay_backend(tmp_path, result: dict) -> FakeRunnerBackend:
    """A fake runner that ignores the request and prints the recorded result verbatim."""
    runner = tmp_path / "replay_runner.py"
    runner.write_text(
        "import sys, json\n"
        "sys.stdin.read()\n"
        f"sys.stdout.write(json.dumps({result!r}))\n",
        encoding="utf-8",
    )
    return FakeRunnerBackend(command=[sys.executable, str(runner)], cwd=str(tmp_path))


async def test_codex_agenta_tool_call_replays(tmp_path):
    rec = _load("codex-agenta-tools-call.json")
    harness = CodexHarness(Environment(_replay_backend(tmp_path, rec["result"])))
    config = SessionConfig(
        agent=AgentTemplate(
            instructions="find tools",
            model="gpt-5.6-luna",
            harness="codex",
        )
    )

    result = await harness.prompt(
        config,
        [Message(role="user", content="Find tools that can send email.")],
    )

    # Codex invoked exactly one Agenta tool, delivered over the internal agenta-tools MCP
    # channel with the Codex dot naming. This is the M2 claim the run proves.
    tool_calls = [e for e in result.events if e.type == "tool_call"]
    assert len(tool_calls) == 1
    assert tool_calls[0].data["name"] == "mcp.agenta-tools.discover_tools"
    assert tool_calls[0].data["input"]["server"] == "agenta-tools"
    assert tool_calls[0].data["input"]["tool"] == "discover_tools"

    # The call produced a tool result on the same tool-call id (the channel round-tripped).
    tool_results = [e for e in result.events if e.type == "tool_result"]
    assert len(tool_results) == 1
    assert tool_results[0].data["id"] == tool_calls[0].data["id"]

    # The harness advertises MCP tool delivery, and the turn reached a clean stop.
    assert result.capabilities is not None and result.capabilities.mcp_tools is True
    assert result.capabilities.tool_calls is True
    assert result.stop_reason == "end_turn"
    assert result.model == "gpt-5.6-luna"
