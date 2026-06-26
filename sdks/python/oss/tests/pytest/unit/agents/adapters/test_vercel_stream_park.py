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
from agenta.sdk.agents.streaming import AgentRun


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


def _parked_run() -> AgentRun:
    """A runner record stream for a parked turn: the gated tool call, the approval request,
    a ``done`` event, then the terminal ``paused`` result (what the F-040 runner fix emits)."""
    return AgentRun(
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
