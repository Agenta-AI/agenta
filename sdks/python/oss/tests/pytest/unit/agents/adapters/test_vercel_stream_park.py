"""Egress finish-on-park (F-040).

A parked HITL turn now ends gracefully on the runner with a terminal ``stopReason:"paused"``
result, so the streaming egress must drain to a clean ``finish`` frame (the FE then resumes on
the user's decision). Before the runner fix the parked turn never terminated, the stream hung,
and no ``finish`` ever arrived. This pins the egress side of that contract: given a parked
record stream, ``agent_run_to_vercel_parts`` yields the approval request AND a final ``finish``.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents.adapters.vercel.stream import agent_run_to_vercel_parts
from agenta.sdk.agents.streaming import AgentStream


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


def _parked_run() -> AgentStream:
    """A runner record stream for a parked turn: the gated tool call, the approval request,
    a ``done`` event, then the terminal ``paused`` result (what the F-040 runner fix emits)."""
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "github__get_user",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-1",
                        "kind": "permission",
                        "payload": {"toolCallId": "tool-1"},
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "paused"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "paused",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_parked_run_emits_approval_then_finish() -> None:
    parts = [part async for part in agent_run_to_vercel_parts(_parked_run())]
    types = [p.get("type") for p in parts]

    # The approval request reaches the FE so it can prompt the user ...
    assert "tool-approval-request" in types
    # ... and the stream drains to a clean finish (no immortal-park hang, F-040).
    assert types[-1] == "finish"
    assert types.count("finish") == 1

    # The approval request carries the gated tool-call id so it attaches to the tool part.
    approval = next(p for p in parts if p["type"] == "tool-approval-request")
    assert approval["approvalId"] == "perm-1"
    assert approval["toolCallId"] == "tool-1"

    # A park is intentional-but-incomplete, mapped to the AI SDK `other` finish reason (not
    # a model completion `stop`, not `unknown`).
    finish = parts[-1]
    assert finish["finishReason"] == "other"


def _parked_run_with_real_args() -> AgentStream:
    """A parked turn where the runner first surfaced the tool call with EMPTY input, then the
    approval request carries the REAL args on ``payload.toolCall.rawInput`` (the cold-replay
    resume shape of the HITL approve-empty-input bug)."""
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "commit_revision",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-1",
                        "kind": "permission",
                        "payload": {
                            "toolCallId": "tool-1",
                            "toolCall": {
                                "id": "tool-1",
                                "name": "commit_revision",
                                "rawInput": {"message": "ship it"},
                            },
                        },
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "paused"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "paused",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_parked_tool_call_refreshes_real_args_on_approval() -> None:
    """The approval request must refresh the parked tool call's input with the real args even
    when the tool-call id was already surfaced with empty input. Otherwise the FE persists the
    call with ``{}`` and a self-update tool (e.g. commit_revision) fires with no arguments."""
    parts = [
        part async for part in agent_run_to_vercel_parts(_parked_run_with_real_args())
    ]

    inputs = [p for p in parts if p.get("type") == "tool-input-available"]
    # The empty first emit from the `tool_call` event, then a refreshing emit from the approval
    # request carrying the real args.
    assert len(inputs) == 2
    assert inputs[0]["input"] == {}
    assert inputs[-1]["toolCallId"] == "tool-1"
    assert inputs[-1]["input"] == {"message": "ship it"}

    # The approval still attaches to the same tool-call id and the stream drains cleanly.
    approval = next(p for p in parts if p["type"] == "tool-approval-request")
    assert approval["toolCallId"] == "tool-1"
    assert parts[-1]["type"] == "finish"
