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
    "tool-output-denied": ["type", "toolCallId"],
    "tool-approval-request": ["type", "toolCallId", "approvalId"],
    "file": ["type", "url", "mediaType"],
    "error": ["type", "errorText"],
}
# These chunks are strict objects with an EXACT allowed key set (no extra agenta-only fields may
# leak onto them). `tool-output-denied` is `{type, toolCallId}` only — no errorText/output.
_EXACT_KEYS = {
    "error": {"type", "errorText"},
    "tool-approval-request": {"type", "approvalId", "toolCallId"},
    "tool-output-denied": {"type", "toolCallId"},
}


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


def assert_error_pair(
    parts: List[Dict[str, Any]], *, code: str, error_text: str
) -> None:
    error_index = next(
        index for index, part in enumerate(parts) if part["type"] == "error"
    )
    assert error_index > 0
    assert parts[error_index - 1] == {
        "type": "data-agent-error",
        "data": {"code": code, "errorText": error_text},
    }
    assert parts[error_index] == {"type": "error", "errorText": error_text}


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


# A denied gated call: the tool surfaces, then a denied-marked failed result closes it. Both
# egress paths must project a conforming `tool-output-denied` chunk (not `tool-output-error`).
_DENY_EVENTS: List[Dict[str, Any]] = [
    {"type": "tool_call", "data": {"id": "c1", "name": "deleteFile", "input": {}}},
    {
        "type": "tool_result",
        "data": {
            "id": "c1",
            "output": "denied by user",
            "isError": True,
            "denied": True,
        },
    },
    {"type": "done", "data": {"stopReason": "stop"}},
]


@pytest.mark.asyncio
async def test_live_deny_projects_conforming_denied_frame() -> None:
    parts = [
        part
        async for part in agent_stream_to_vercel_stream(
            _records(_DENY_EVENTS), trace_id="td"
        )
    ]
    for part in parts:
        assert_conforms(part)
    denied = next(p for p in parts if p["type"] == "tool-output-denied")
    assert denied["toolCallId"] == "c1"
    assert not any(p["type"] == "tool-output-error" for p in parts)


@pytest.mark.asyncio
async def test_dev_twin_deny_projects_conforming_denied_frame() -> None:
    # The dev-twin projects an AgentStream, whose Event.data is the FLAT runner AgentEvent (id /
    # isError / denied at the top level), unlike the routing path's `{type, data}` envelope.
    flat_deny_events = [
        {"type": "tool_call", "id": "c1", "name": "deleteFile", "input": {}},
        {
            "type": "tool_result",
            "id": "c1",
            "output": "denied by user",
            "isError": True,
            "denied": True,
        },
        {"type": "done", "stopReason": "stop"},
    ]
    run = _run_with(flat_deny_events, result={"output": ""})
    parts = [part async for part in agent_run_to_vercel_parts(run)]
    for part in parts:
        assert_conforms(part)
    denied = next(p for p in parts if p["type"] == "tool-output-denied")
    assert denied["toolCallId"] == "c1"
    assert not any(p["type"] == "tool-output-error" for p in parts)


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
    assert_error_pair(
        parts, code="no_output", error_text="The agent produced no output."
    )


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
    assert_error_pair(
        parts, code="no_output", error_text="The agent produced no output."
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
    assert_error_pair(
        parts, code="no_output", error_text="The agent produced no output."
    )


@pytest.mark.asyncio
async def test_swallowed_provider_error_emits_exactly_one_error_frame() -> None:
    """F-5317-followup: a turn that recovers a swallowed provider error (out-of-credit, bad
    key, ...) streams a real error live AND fails its terminal result -- the runner's
    `findSwallowedPiError` path both `emitEvent({type:"error"})`s the recovered message and
    returns `{ok:false, error:...}` for the SAME failure (`sandbox_agent.ts` around the
    `swallowedError` branch). On the wire that means the live event surfaces as one `error`
    frame here, and the failed terminal record raises out of the event iterator and is caught
    by this adapter's `except Exception` as a second `error` frame.

    Before the fix, the zero-content-parts backstop then piled a THIRD, generic frame on top
    ("The agent produced no output.") because neither error frame incremented
    `content_parts_emitted` -- burying the actionable message under a useless one. QA observed
    exactly this on a real out-of-credit run: frames were
    ``[error(real), error("Agent run failed: " + real), error("The agent produced no
    output.")]`` and the UI showed only the last frame. This test pins that the generic
    backstop no longer fires once a real error went out.
    """
    real_error = (
        "pi_core: the model provider account has insufficient credit "
        "(check the project's OpenAI key)."
    )

    async def _events_with_uncaught_failure():
        yield {"type": "error", "data": {"message": real_error}}
        # Mirrors the terminal `ok:false` result raising out of the event iterator uncaught
        # (streaming.py's AgentStream.__aiter__ -> result_from_wire -> RuntimeError, propagated
        # through handler.py's agent_event_stream with no enclosing except).
        raise RuntimeError(f"Agent run failed: {real_error}")

    parts = [
        part
        async for part in agent_stream_to_vercel_stream(
            _events_with_uncaught_failure(), trace_id="t-swallowed"
        )
    ]
    for part in parts:
        assert_conforms(part)

    error_parts = [p for p in parts if p["type"] == "error"]
    assert len(error_parts) == 1, (
        f"expected exactly one error frame, got {error_parts!r}"
    )
    assert error_parts[0]["errorText"] == real_error
    assert_error_pair(parts, code="runner_error", error_text=real_error)
    assert not any(p.get("errorText") == "The agent produced no output." for p in parts)


@pytest.mark.asyncio
async def test_swallowed_provider_error_emits_exactly_one_error_frame_dev_twin() -> (
    None
):
    """Dev-twin counterpart: the live error event AND the terminal `ok:false` both come off the
    same ``AgentStream`` (`kind:"event"` then `kind:"result"`), matching the real runner's NDJSON
    record shape (`server.ts` `liveEmit` then the terminal `{kind:"result"}` write).
    """
    real_error = (
        "pi_core: the model provider account has insufficient credit "
        "(check the project's OpenAI key)."
    )
    # `Event.from_wire` keeps the raw record verbatim as `.data` (it does not unwrap a nested
    # `data` key), so a live error event's `message` rides at the TOP level -- mirrors the
    # runner's actual `run.emitEvent({type:"error", message: swallowedError})` shape
    # (`sandbox_agent.ts`). The terminal result's `error` is the concise message UNPREFIXED
    # (`{ok:false, error: swallowedError}`, same file) -- `result_from_wire` adds the
    # "Agent run failed: " prefix itself when it raises.
    records = [
        {"kind": "event", "event": {"type": "error", "message": real_error}},
        {"kind": "result", "result": {"ok": False, "error": real_error}},
    ]
    run = AgentStream(_records(records))
    parts = [part async for part in agent_run_to_vercel_parts(run)]
    for part in parts:
        assert_conforms(part)

    error_parts = [p for p in parts if p["type"] == "error"]
    assert len(error_parts) == 1, (
        f"expected exactly one error frame, got {error_parts!r}"
    )
    assert error_parts[0]["errorText"] == real_error
    assert_error_pair(parts, code="runner_error", error_text=real_error)
    assert not any(p.get("errorText") == "The agent produced no output." for p in parts)


@pytest.mark.asyncio
async def test_runner_error_code_reaches_the_data_part() -> None:
    """The runner classifies some failures (a budgeted-proxy refusal, throttling) into a stable
    code so a client can render a purposeful state instead of parsing the prose. That code has to
    survive the adapter: the `data-agent-error` part is the only frame that carries it, since the
    standard `error` frame is pinned to two keys.
    """
    message = (
        "Your free Agenta credits are used up. Add your own provider key to keep going."
    )

    async def _events():
        yield {
            "type": "error",
            "data": {"message": message, "code": "starter_credits_exhausted"},
        }

    parts = [
        part
        async for part in agent_stream_to_vercel_stream(_events(), trace_id="t-code")
    ]
    for part in parts:
        assert_conforms(part)
    assert_error_pair(parts, code="starter_credits_exhausted", error_text=message)


@pytest.mark.asyncio
async def test_runner_error_code_reaches_the_data_part_dev_twin() -> None:
    message = "Agenta credits are temporarily unavailable. Try again in a moment."
    records = [
        {
            "kind": "event",
            "event": {
                "type": "error",
                "message": message,
                "code": "starter_credits_unavailable",
            },
        },
        {"kind": "result", "result": {"ok": False, "error": message}},
    ]
    parts = [
        part async for part in agent_run_to_vercel_parts(AgentStream(_records(records)))
    ]
    for part in parts:
        assert_conforms(part)
    assert_error_pair(parts, code="starter_credits_unavailable", error_text=message)


@pytest.mark.asyncio
async def test_a_non_slug_runner_code_falls_back_to_the_generic_code() -> None:
    """The code field is a stable slug, never prose. An older runner sends none, and a confused
    one could send a raw provider string — neither may reach the client as a code, or a consumer
    switching on it would branch on attacker- or vendor-controlled text.
    """
    message = "something went wrong"

    for bad_code in [
        None,
        "",
        429,
        "Budget has been exceeded! Key=sk-EXAMPLE-not-a-real-key",
        "Starter_Credits_Exhausted",
    ]:

        async def _events(bad_code=bad_code):
            yield {"type": "error", "data": {"message": message, "code": bad_code}}

        parts = [
            part
            async for part in agent_stream_to_vercel_stream(
                _events(), trace_id="t-bad-code"
            )
        ]
        for part in parts:
            assert_conforms(part)
        assert_error_pair(parts, code="runner_error", error_text=message)


def test_vendored_version_matches_package_pin() -> None:
    # CI-grep-able tripwire: bump this const (and re-audit the shape above) whenever
    # web/oss/package.json's "ai" pin changes.
    assert _AI_PACKAGE_VERSION == "6.0.0-beta.150"


# ---------------------------------------------------------------------------
# The turn id pass-through.
#
# The runner mints the turn id per execution and, until this, told no one. The `start` frame is
# built and emitted before the runner replies at all, so it CANNOT carry a runner-minted id —
# which is why `expected_execution_id` on the public Cancel had no first-party caller able to fill
# it. The runner now emits a `turn` event as its first frame and the egress forwards it unchanged
# as `data-agent-turn`, the earliest part that can carry it.
# ---------------------------------------------------------------------------

_TURN_ID = "d3b4a1c2-0000-4000-8000-abcdefabcdef"

# The runner's AgentEvent is FLAT (`{type, turnId}`, like `{type, message, code}` for an error),
# and each path wraps it differently. The live handler yields `{"type", "data"}` where `data` is
# the whole flat runner event; `AgentStream` (the dev twin) hands the flat record through
# `Event.from_wire`, which also sets `data` to the whole record. Both fixtures below are the real
# shapes, not a convenient one — a fixture that reshapes the event tests nothing about the wire.
_TURN_EVENTS_LIVE: List[Dict[str, Any]] = [
    {"type": "turn", "data": {"type": "turn", "turnId": _TURN_ID}},
    {"type": "message", "data": {"text": "hello"}},
    {"type": "done", "data": {"stopReason": "stop"}},
]
_TURN_EVENTS_RUN: List[Dict[str, Any]] = [
    {"type": "turn", "turnId": _TURN_ID},
    {"type": "message", "text": "hello"},
    {"type": "done", "stopReason": "stop"},
]


@pytest.mark.asyncio
async def test_live_projection_forwards_the_turn_id_unchanged() -> None:
    parts = [
        part
        async for part in agent_stream_to_vercel_stream(
            _records(_TURN_EVENTS_LIVE), trace_id="t1"
        )
    ]
    for part in parts:
        assert_conforms(part)

    turn_parts = [p for p in parts if p["type"] == "data-agent-turn"]
    assert turn_parts == [{"type": "data-agent-turn", "data": {"turnId": _TURN_ID}}], (
        "the egress must forward the runner's id verbatim, exactly once"
    )

    # It must land before any content, so a client that Stops early already holds the id.
    turn_index = next(i for i, p in enumerate(parts) if p["type"] == "data-agent-turn")
    first_text = next(
        (i for i, p in enumerate(parts) if p["type"].startswith("text-")), None
    )
    assert first_text is None or turn_index < first_text


@pytest.mark.asyncio
async def test_dev_twin_projection_forwards_the_turn_id_unchanged() -> None:
    run = _run_with(_TURN_EVENTS_RUN, result={"output": "hello"})
    parts = [part async for part in agent_run_to_vercel_parts(run)]
    for part in parts:
        assert_conforms(part)
    assert {"type": "data-agent-turn", "data": {"turnId": _TURN_ID}} in parts


@pytest.mark.asyncio
async def test_a_turn_event_with_no_usable_id_emits_nothing() -> None:
    # An older runner, or a malformed frame, must not put an empty id on the stream: a client
    # would send it as `expected_execution_id` and cancel nothing, or worse, read it as "no
    # guard". Dropping it leaves the client in the honest "I do not know the id" state.
    for bad in ({}, {"turnId": None}, {"turnId": ""}, {"turnId": 7}):
        parts = [
            part
            async for part in agent_stream_to_vercel_stream(
                _records([{"type": "turn", "data": bad}]), trace_id="t1"
            )
        ]
        assert not [p for p in parts if p["type"] == "data-agent-turn"], (
            f"a turn event with data={bad!r} must emit no part"
        )
