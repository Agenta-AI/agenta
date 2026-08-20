"""Pins the SSE half of the silent-turn contract (ASD-EST100): a turn that produced nothing
must never reach the browser as a clean, empty finish, and a turn that DID fail must reach it
carrying the real reason.

The runner is being changed to fail loud on an empty turn (`{ok: false, error: ...}` where it
used to return `{ok: true, output: ""}`). These tests pin what the adapter must do with that
result, and — just as importantly — pin the two turns that legitimately carry no assistant text
(a turn that only called tools, a turn parked on an approval gate) as NOT failures, so the
zero-content backstop cannot start firing on them.

The sibling `test_vercel_stream_conformance.py` covers the case where a live `error` event and a
terminal `ok: false` describe the SAME failure (exactly one frame must go out). What is pinned
here is the other shape: a failure that only the TERMINAL result knows about, which is what an
acquire failure and the empty-turn guardrail both look like on the wire.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents.adapters.vercel.stream import (
    agent_run_to_vercel_parts,
    agent_stream_to_vercel_stream,
)
from agenta.sdk.agents.errors import AgentRunFailed
from agenta.sdk.agents.streaming import AgentStream

# The backstop's failure CODE, not its prose. Asserting the code is what keeps these tests
# honest: the generic message's wording can be reworded at any time, and a `not in text` check
# would then pass vacuously while the backstop was still burying the real error.
_NO_OUTPUT_CODE = "no_output"

# The concise message the runner puts on a failed turn, as `conciseError` renders it.
_PROVIDER_ERROR = (
    "pi_core: the model provider account has insufficient credit "
    "(check the project's OpenAI key)."
)


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


def _error_texts(parts: List[Dict[str, Any]]) -> List[str]:
    return [p["errorText"] for p in parts if p["type"] == "error"]


@pytest.mark.asyncio
async def test_terminal_only_failure_carries_the_providers_message() -> None:
    """A run whose ONLY signal is `{ok: false, error: ...}` — no live error event — must surface
    that message. This is the wire shape of the empty-turn guardrail and of an acquire failure.
    """
    run = AgentStream(
        _records(
            [{"kind": "result", "result": {"ok": False, "error": _PROVIDER_ERROR}}]
        )
    )
    parts = [part async for part in agent_run_to_vercel_parts(run)]

    errors = _error_texts(parts)
    assert len(errors) == 1, f"expected exactly one error frame, got {errors!r}"
    # Substring, not equality: `result_from_wire` prefixes the raised failure. What must not
    # change is that the caller's own reason reaches the browser.
    assert _PROVIDER_ERROR in errors[0]
    # The failure code rides the paired data frame, so a client can branch on it. This is also
    # the structural form of "the real reason was not replaced by the generic no-output message".
    data_frames = [p for p in parts if p["type"] == "data-agent-error"]
    assert len(data_frames) == 1
    assert data_frames[0]["data"]["code"] == AgentRunFailed.failure_code
    assert data_frames[0]["data"]["code"] != _NO_OUTPUT_CODE
    assert data_frames[0]["data"]["errorText"] == errors[0]
    # And a consumer waiting on the terminator must not hang because the turn failed.
    types = [p["type"] for p in parts]
    assert types[-1] == "finish"
    assert types.index("error") < types.index("finish")


@pytest.mark.asyncio
async def test_live_terminal_only_failure_carries_the_providers_message() -> None:
    """Live-routing counterpart: the failure arrives as a raise out of the event stream with no
    error event ahead of it.
    """

    async def events() -> AsyncIterator[Dict[str, Any]]:
        raise AgentRunFailed(_PROVIDER_ERROR)
        yield {}  # pragma: no cover - makes this an async generator

    parts = [
        part async for part in agent_stream_to_vercel_stream(events(), trace_id="t1")
    ]

    errors = _error_texts(parts)
    assert len(errors) == 1, f"expected exactly one error frame, got {errors!r}"
    assert _PROVIDER_ERROR in errors[0]
    codes = [p["data"]["code"] for p in parts if p["type"] == "data-agent-error"]
    assert codes == [AgentRunFailed.failure_code]
    assert _NO_OUTPUT_CODE not in codes
    assert [p["type"] for p in parts][-1] == "finish"


@pytest.mark.asyncio
async def test_a_turn_with_no_events_at_all_never_finishes_silently() -> None:
    """The bare-`done` turn from the incident: nothing streamed, nothing to render. Whatever the
    runner reports, an empty turn must not reach the browser as a clean finish with no frame
    explaining it.
    """
    run = AgentStream(
        _records([{"kind": "result", "result": {"ok": True, "output": ""}}])
    )
    parts = [part async for part in agent_run_to_vercel_parts(run)]

    assert _error_texts(parts), "an empty turn produced no error frame at all"
    # Order, not just presence: a browser treats `finish` as terminal, so an error frame that
    # arrives after it is an error the user never sees.
    types = [part["type"] for part in parts]
    assert types[-1] == "finish"
    assert types.index("error") < types.index("finish")


@pytest.mark.asyncio
async def test_a_tool_only_turn_is_not_reported_as_no_output() -> None:
    """A turn that ran tools and ended without prose is a normal turn, not a silent failure.
    Guards the zero-content backstop against firing on it.
    """
    events = [
        {
            "type": "tool_call",
            "data": {"id": "c1", "name": "bash", "input": {"command": "ls"}},
        },
        {"type": "tool_result", "data": {"id": "c1", "output": "AGENTS.md"}},
        {"type": "done", "data": {"stopReason": "stop"}},
    ]
    parts = [
        part
        async for part in agent_stream_to_vercel_stream(_records(events), trace_id="t2")
    ]

    # No error frame of ANY kind: stronger than checking for the generic wording, and it cannot
    # rot if that wording changes in the adapter.
    assert _error_texts(parts) == []


@pytest.mark.asyncio
async def test_a_parked_turn_is_not_reported_as_no_output() -> None:
    """A turn paused on an approval gate carries no assistant text by design; it must not be
    reported as a turn that produced nothing (the reported "No response" on a reloaded paused
    turn is this exact confusion).
    """
    events = [
        {
            "type": "interaction_request",
            "data": {
                "id": "perm-1",
                "kind": "user_approval",
                "payload": {"toolCallId": "c1"},
            },
        },
        {"type": "done", "data": {"stopReason": "paused"}},
    ]
    parts = [
        part
        async for part in agent_stream_to_vercel_stream(_records(events), trace_id="t3")
    ]

    assert _error_texts(parts) == []
