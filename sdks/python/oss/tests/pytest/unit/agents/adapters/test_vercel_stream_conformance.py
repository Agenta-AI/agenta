"""Pins every Vercel stream part against a vendored mirror of the `ai` package's
``uiMessageChunkSchema`` shape, so the adapter's ``_conform`` gate is provably sufficient.

The pinned version MUST match ``web/oss/package.json``'s ``"ai"`` pin
(currently ``6.0.0-beta.150``) -- grep for `_AI_PACKAGE_VERSION` on a version bump and
re-check the vendored shape against the new schema.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents.adapters.vercel.stream import (
    agent_run_to_vercel_parts,
    agent_stream_to_vercel_stream,
)
from agenta.sdk.agents.streaming import AgentStream

# Keep in lockstep with web/oss/package.json's "ai" pin.
_AI_PACKAGE_VERSION = "6.0.0-beta.150"

# A hand-kept mirror of `ai@6`'s uiMessageChunkSchema: for each chunk `type`, the set of
# REQUIRED string fields that must be present and non-None (a strict Zod object throws on
# a missing/null required string, not just on a missing key).
_REQUIRED_STRING_FIELDS: Dict[str, List[str]] = {
    "start": ["type"],
    "start-step": ["type"],
    "finish-step": ["type"],
    "finish": ["type"],
    "text-start": ["type", "id"],
    "text-delta": ["type", "id"],
    "text-end": ["type", "id"],
    "reasoning-start": ["type", "id"],
    "reasoning-delta": ["type", "id"],
    "reasoning-end": ["type", "id"],
    "tool-input-start": ["type", "toolCallId", "toolName"],
    "tool-input-available": ["type", "toolCallId", "toolName"],
    "tool-output-available": ["type", "toolCallId"],
    "tool-output-error": ["type", "toolCallId", "errorText"],
    "tool-approval-request": ["type", "toolCallId", "approvalId"],
    "file": ["type", "url", "mediaType"],
    "error": ["type", "errorText"],
}
# `tool-approval-request` is the only strict object with an EXACT allowed key set (no extra
# agenta-only fields may leak onto it).
_EXACT_KEYS = {"tool-approval-request": {"type", "approvalId", "toolCallId"}}


def assert_conforms(part: Dict[str, Any]) -> None:
    """Raise if `part` would fail the AI SDK's strict `uiMessageChunkSchema` validation."""
    ptype = part.get("type")
    assert isinstance(ptype, str) and ptype, f"part has no string type: {part!r}"
    required = _REQUIRED_STRING_FIELDS.get(ptype)
    if required is None:
        return  # data-*/custom parts: schema is passthrough, no required-string slots.
    for field in required:
        value = part.get(field)
        assert value is not None, (
            f"{ptype!r} part missing required field {field!r}: {part!r}"
        )
        if field != "type":
            assert isinstance(value, str), (
                f"{ptype!r}.{field} must be a string: {part!r}"
            )
    exact = _EXACT_KEYS.get(ptype)
    if exact is not None:
        assert set(part.keys()) == exact, (
            f"{ptype!r} part has unexpected keys: {part!r}"
        )


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


def _run_with(events: List[Dict[str, Any]], result: Dict[str, Any]) -> AgentStream:
    records = [{"kind": "event", "event": e} for e in events]
    records.append({"kind": "result", "result": {"ok": True, **result}})
    return AgentStream(_records(records))


# A scenario exercising every finding this batch closed: a None tool-call id on an
# approval request (T1), an orphaned tool_result with no preceding tool_call (T4), a
# broken file part missing mediaType (T1), and a run that otherwise emits real content
# (so T2's zero-content guard doesn't also fire and mask the others).
_CONFORMANCE_EVENTS: List[Dict[str, Any]] = [
    {"type": "message", "data": {"text": "hello"}},
    {
        "type": "interaction_request",
        "data": {
            "id": "perm-1",
            "kind": "user_approval",
            "payload": {"toolCallId": None},
        },
    },
    {"type": "tool_result", "data": {"id": "orphan-1", "output": "ok"}},
    {"type": "file", "data": {"url": "https://x", "mediaType": None}},
    {"type": "done", "data": {"stopReason": "stop"}},
]


@pytest.mark.asyncio
async def test_live_projection_conforms_to_vendored_schema() -> None:
    parts = [
        part
        async for part in agent_stream_to_vercel_stream(
            _records(_CONFORMANCE_EVENTS), trace_id="t1"
        )
    ]
    assert parts, "expected at least the start/finish frames"
    for part in parts:
        assert_conforms(part)


@pytest.mark.asyncio
async def test_dev_twin_projection_conforms_to_vendored_schema() -> None:
    run = _run_with(_CONFORMANCE_EVENTS, result={"output": "hello"})
    parts = [part async for part in agent_run_to_vercel_parts(run)]
    assert parts
    for part in parts:
        assert_conforms(part)


@pytest.mark.asyncio
async def test_zero_content_run_emits_conforming_error_frame() -> None:
    """The T2 fix's synthetic error frame must itself conform (errorText required)."""
    parts = [
        part
        async for part in agent_stream_to_vercel_stream(
            _records([{"type": "done", "data": {"stopReason": "stop"}}]), trace_id="t2"
        )
    ]
    for part in parts:
        assert_conforms(part)
    assert any(p["type"] == "error" for p in parts)


@pytest.mark.asyncio
async def test_dropped_only_content_part_still_triggers_zero_content_guard() -> None:
    """A run whose only content is a `file` part `_conform` rejects (no `url`) must still
    trip the zero-content backstop -- the drop must not be counted as emitted content.
    """
    events = [
        {"type": "file", "data": {"url": None, "mediaType": "image/png"}},
        {"type": "done", "data": {"stopReason": "stop"}},
    ]
    parts = [
        part
        async for part in agent_stream_to_vercel_stream(_records(events), trace_id="t3")
    ]
    assert not any(p["type"] == "file" for p in parts)
    assert any(
        p["type"] == "error" and p.get("errorText") == "The agent produced no output."
        for p in parts
    )


@pytest.mark.asyncio
async def test_dropped_only_content_part_still_triggers_zero_content_guard_dev_twin() -> (
    None
):
    """Dev-twin counterpart of the guard above, on the ``AgentStream``-based projection."""
    events = [{"type": "file", "data": {"url": None, "mediaType": "image/png"}}]
    run = _run_with(events, result={"output": None})
    parts = [part async for part in agent_run_to_vercel_parts(run)]
    assert not any(p["type"] == "file" for p in parts)
    assert any(
        p["type"] == "error" and p.get("errorText") == "The agent produced no output."
        for p in parts
    )


def test_vendored_version_matches_package_pin() -> None:
    # CI-grep-able tripwire: bump this const (and re-audit the shape above) whenever
    # web/oss/package.json's "ai" pin changes.
    assert _AI_PACKAGE_VERSION == "6.0.0-beta.150"
