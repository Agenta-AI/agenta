"""The live stream shows the LETTER, not the envelope.

An MCP-routed harness wraps a tool's arguments in a transport envelope —
``{"tool": ..., "server": ..., "arguments": {...}}`` — and the durable records carry that
wrapper verbatim. Card bodies read their fields at the top level (``input.workflow_revision``),
so an enveloped input drops to the raw-JSON fallback the same call renders a card for. The replay
builder already strips the envelope (``unwrapToolArguments``, transcriptToMessages.ts); these pin
the live egress doing the same, under the same conservative rule, on every path — ordinary calls,
gated calls, and the ungated re-emit that lands after a gate.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents.adapters.vercel.stream import (
    _unwrap_tool_arguments,
    agent_run_to_vercel_parts,
    agent_stream_to_vercel_stream,
)
from agenta.sdk.agents.streaming import AgentStream

BARE_ARGS = {"workflow_revision": "rev-1", "message": "ship it"}
ENVELOPE = {"tool": "commit_revision", "server": "agenta-tools", "arguments": BARE_ARGS}


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


def _run(events: List[Dict[str, Any]]) -> AgentStream:
    records: List[Dict[str, Any]] = [{"kind": "event", "event": e} for e in events]
    records.append(
        {
            "kind": "result",
            "result": {
                "ok": True,
                "output": "",
                "stopReason": "stop",
                "sessionId": "conv-1",
            },
        }
    )
    return AgentStream(_records(records))


async def _live_inputs(events: List[Dict[str, Any]]) -> List[Any]:
    """The `input` of every `tool-input-available` the ROUTING-layer egress emits.

    `agent_stream_to_vercel_stream` is the function the live request path runs, so the assertions
    ride the real live shape rather than its dev-only twin.
    """

    async def gen() -> AsyncIterator[Dict[str, Any]]:
        for event in events:
            yield {"type": event.get("type"), "data": event}

    return [
        part["input"]
        async for part in agent_stream_to_vercel_stream(gen())
        if part.get("type") == "tool-input-available"
    ]


# ---------------------------------------------------------------------------
# The unwrap rule itself.
# ---------------------------------------------------------------------------


def test_unwrap_strips_the_mcp_envelope() -> None:
    assert _unwrap_tool_arguments(ENVELOPE) == BARE_ARGS


def test_unwrap_accepts_every_envelope_key_alias() -> None:
    """The harnesses spell the envelope's name fields differently; all of them are recognized,
    matching the replay builder's key set exactly."""
    for key in (
        "tool",
        "server",
        "name",
        "toolName",
        "serverName",
        "tool_name",
        "server_name",
    ):
        assert _unwrap_tool_arguments({key: "x", "arguments": BARE_ARGS}) == BARE_ARGS


def test_unwrap_leaves_a_tool_whose_real_args_include_arguments() -> None:
    """A tool whose own input carries an `arguments` field alongside a NON-envelope sibling is not
    an envelope — unwrapping it would silently discard the sibling."""
    real = {"arguments": {"a": 1}, "command": "run"}
    assert _unwrap_tool_arguments(real) == real


def test_unwrap_requires_string_valued_siblings() -> None:
    """A sibling that is not a string means this is the tool's own payload, not the transport
    wrapper (whose name fields are always strings)."""
    real = {"tool": {"nested": True}, "arguments": {"a": 1}}
    assert _unwrap_tool_arguments(real) == real


def test_unwrap_leaves_a_lone_arguments_field() -> None:
    """No siblings at all: `{"arguments": ...}` is the tool's own shape, not a stripped envelope."""
    real = {"arguments": {"a": 1}}
    assert _unwrap_tool_arguments(real) == real


@pytest.mark.parametrize("value", [None, "", "text", 7, [1, 2], {"a": 1}])
def test_unwrap_passes_non_envelopes_through_unchanged(value: Any) -> None:
    assert _unwrap_tool_arguments(value) == value


# ---------------------------------------------------------------------------
# The egress paths.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ordinary_tool_call_streams_bare_arguments() -> None:
    """The ordinary (non-gated) MCP tool call — the case behind `rename_agent`, `discover_tools`
    and friends streaming the envelope live while replaying bare."""
    events = [
        {
            "type": "tool_call",
            "id": "tool-1",
            "name": "rename_agent",
            "input": ENVELOPE,
        },
        {"type": "done", "stopReason": "stop"},
    ]
    assert await _live_inputs(events) == [BARE_ARGS]

    parts = [part async for part in agent_run_to_vercel_parts(_run(events))]
    inputs = [p["input"] for p in parts if p.get("type") == "tool-input-available"]
    assert inputs == [BARE_ARGS]


@pytest.mark.asyncio
async def test_raw_input_envelope_is_unwrapped_too() -> None:
    """`rawInput` still wins over `input`, and is unwrapped on the way out."""
    events = [
        {
            "type": "tool_call",
            "id": "tool-1",
            "name": "read_config",
            "input": {},
            "rawInput": ENVELOPE,
        },
        {"type": "done", "stopReason": "stop"},
    ]
    assert await _live_inputs(events) == [BARE_ARGS]


@pytest.mark.asyncio
async def test_ungated_reemit_after_a_gate_keeps_the_bare_input() -> None:
    """The gate re-stamps the call with the tool's bare args; a later ungated `tool_call` for the
    same id used to overwrite them with the envelope, so one call showed two different shapes live
    depending on when you looked. Both emissions now agree.
    """
    events = [
        {"type": "tool_call", "id": "tool-1", "name": "execute", "input": {}},
        {
            "type": "interaction_request",
            "id": "perm-1",
            "kind": "user_approval",
            "payload": {
                "toolCallId": "tool-1",
                "toolCall": {
                    "id": "tool-1",
                    "resolvedName": "commit_revision",
                    "rawInput": BARE_ARGS,
                },
            },
        },
        # The runner re-emits the call ungated once it runs, carrying the raw envelope.
        {
            "type": "tool_call",
            "id": "tool-1",
            "name": "execute",
            "input": ENVELOPE,
        },
        {"type": "done", "stopReason": "stop"},
    ]
    inputs = await _live_inputs(events)
    # The initial empty emit, the gate's refresh, then the ungated re-emit — the last two agree.
    assert inputs[-1] == BARE_ARGS
    assert inputs[-1] == inputs[-2]


@pytest.mark.asyncio
async def test_gated_call_streams_bare_arguments_when_the_gate_carries_the_envelope() -> (
    None
):
    """A gate whose `rawInput` is itself the envelope (no bare args anywhere upstream) still shows
    the letter."""
    events = [
        {
            "type": "interaction_request",
            "id": "perm-1",
            "kind": "user_approval",
            "payload": {
                "toolCallId": "tool-1",
                "toolCall": {
                    "id": "tool-1",
                    "name": "commit_revision",
                    "rawInput": ENVELOPE,
                },
            },
        },
        {"type": "done", "stopReason": "paused"},
    ]
    assert await _live_inputs(events) == [BARE_ARGS]


@pytest.mark.asyncio
async def test_client_tool_request_streams_bare_arguments() -> None:
    """The client-tool path feeds the elicitation/connect widgets, which read `input` fields at the
    top level — an envelope there breaks the widget, not just the payload block."""
    events = [
        {
            "type": "interaction_request",
            "id": "client-1",
            "kind": "client_tool",
            "payload": {
                "toolCallId": "tool-client-1",
                "toolName": "request_connection",
                "input": {
                    "tool": "request_connection",
                    "server": "agenta-tools",
                    "arguments": {"integration": "slack"},
                },
                "render": {"kind": "connect"},
            },
        },
        {"type": "done", "stopReason": "paused"},
    ]
    assert await _live_inputs(events) == [{"integration": "slack"}]


@pytest.mark.asyncio
async def test_a_non_enveloped_call_is_untouched() -> None:
    """The harnesses that send bare names/args are unaffected — no shape change for them."""
    events = [
        {
            "type": "tool_call",
            "id": "tool-1",
            "name": "read_file",
            "input": {"path": "a.md"},
        },
        {"type": "done", "stopReason": "stop"},
    ]
    assert await _live_inputs(events) == [{"path": "a.md"}]
