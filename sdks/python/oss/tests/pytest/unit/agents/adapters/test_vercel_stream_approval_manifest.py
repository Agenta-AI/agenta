"""Egress delivery of the approval manifest (slice S3b).

When a gated commit references workspace files, the runner resolves and freezes them at the
permission gate and puts a manifest — the imported files, and a unified diff for a field
replaced from one file — on the ``interaction_request`` payload. The human approves THAT.

It cannot ride ``tool-approval-request``: that chunk is a strict object with an exact key set
(``{type, approvalId, toolCallId}``), pinned by the conformance test. It also must not ride the
tool's ``input``, which is the model's own arguments — the manifest is runner-derived, and
folding it in would show the human a payload the model never wrote. So it travels as its own
``data-approval-manifest`` part, which the AI SDK schema passes through untouched.

Without this the manifest reaches the FE only on a cold replay, so the card would be empty
live and populated after a page reload — exactly backwards.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents.adapters.vercel.stream import agent_run_to_vercel_parts
from agenta.sdk.agents.streaming import AgentStream

MANIFEST: Dict[str, Any] = {
    "version": 1,
    "files": [
        {
            "operationIndex": 0,
            "valuePointer": "/",
            "requestedPath": ".agenta-imports/instructions.md",
            "relativePath": "instructions.md",
            "bytes": 24,
            "digest": "a" * 64,
            "executableBit": False,
        }
    ],
    "totalBytes": 24,
    "diffs": [
        {
            "operationIndex": 0,
            "targetField": "instructions",
            "baseRevisionId": "rev-1",
            "diff": "@@ -1,1 +1,1 @@\n-old\n+new",
            "addedLines": 1,
            "removedLines": 1,
        }
    ],
    "catalogGeneration": "gen-1",
    "contentDigest": "b" * 64,
}


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


def _gated_commit_run(payload: Dict[str, Any]) -> AgentStream:
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "commit_revision",
                        "input": {"workflow_revision": {"base_revision_id": "rev-1"}},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-1",
                        "kind": "user_approval",
                        "payload": payload,
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
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_manifest_rides_its_own_data_part() -> None:
    parts = [
        part
        async for part in agent_run_to_vercel_parts(
            _gated_commit_run({"toolCallId": "tool-1", "manifest": MANIFEST})
        )
    ]

    manifest_parts = [p for p in parts if p.get("type") == "data-approval-manifest"]
    assert len(manifest_parts) == 1
    data = manifest_parts[0]["data"]
    assert data["toolCallId"] == "tool-1"
    assert data["approvalId"] == "perm-1"
    assert data["manifest"] == MANIFEST

    # It precedes the approval request, so the card has its content the moment it renders.
    types = [p.get("type") for p in parts]
    assert types.index("data-approval-manifest") < types.index("tool-approval-request")


@pytest.mark.asyncio
async def test_the_strict_approval_chunk_is_untouched() -> None:
    parts = [
        part
        async for part in agent_run_to_vercel_parts(
            _gated_commit_run({"toolCallId": "tool-1", "manifest": MANIFEST})
        )
    ]

    approval = next(p for p in parts if p["type"] == "tool-approval-request")
    assert set(approval.keys()) == {"type", "approvalId", "toolCallId"}


@pytest.mark.asyncio
async def test_the_manifest_never_pollutes_the_models_arguments() -> None:
    parts = [
        part
        async for part in agent_run_to_vercel_parts(
            _gated_commit_run({"toolCallId": "tool-1", "manifest": MANIFEST})
        )
    ]

    for part in parts:
        if part.get("type") == "tool-input-available":
            assert "manifest" not in (part.get("input") or {})


@pytest.mark.asyncio
async def test_no_manifest_part_when_the_gate_carries_none() -> None:
    parts = [
        part
        async for part in agent_run_to_vercel_parts(
            _gated_commit_run({"toolCallId": "tool-1"})
        )
    ]

    assert not [p for p in parts if p.get("type") == "data-approval-manifest"]
    assert any(p.get("type") == "tool-approval-request" for p in parts)
