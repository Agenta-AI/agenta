"""Live streaming finishReason: the terminal result's stop_reason is authoritative.

The live path is ``agent_stream_to_vercel_stream`` (routing projects the handler's neutral
``{type, data}`` event stream — it never sees the terminal ``AgentResult``). The live runner
settles paused-vs-ended AFTER the event stream closes, so its ``done`` event carries NO
stopReason; the authoritative value lands only on the terminal result record. The handler
(``agent_event_stream``) surfaces it by appending a corrective terminal ``done`` when the
result disagrees with the streamed ``done``; the adapter then honors last-non-null precedence
so the paused reason reaches the finish frame. This mirrors the batch
``fold(events, stop_reason=result.stop_reason)`` precedence.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

import pytest

from agenta.sdk.agents.adapters.vercel.stream import agent_stream_to_vercel_stream
from agenta.sdk.agents.dtos import AgentResult, Event
from agenta.sdk.agents.handler import agent_event_stream
from agenta.sdk.agents.streaming import AgentStream


async def _events(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


async def _collect(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [part async for part in agent_stream_to_vercel_stream(_events(events))]


# --- the adapter: last non-null stop reason wins ------------------------------


@pytest.mark.asyncio
async def test_terminal_paused_done_wins_over_earlier_reasonless_done() -> None:
    """(a) The runner's ``done`` omits stopReason; the handler's corrective terminal
    ``done`` (paused) follows -> the finish frame carries the paused reason (AI SDK ``other``)."""
    parts = await _collect(
        [
            {"type": "message", "data": {"text": "one moment"}},
            {"type": "done", "data": {}},  # runner omits stopReason on a HITL pause
            {"type": "done", "data": {"stopReason": "paused"}},  # handler's correction
        ]
    )
    finish = parts[-1]
    assert finish["type"] == "finish"
    assert finish["finishReason"] == "other"


@pytest.mark.asyncio
async def test_normal_turn_finish_reason_unchanged() -> None:
    """(b) A normal completion (a single ``done`` with ``stop``) still finishes ``stop``."""
    parts = await _collect(
        [
            {"type": "message", "data": {"text": "here you go"}},
            {"type": "done", "data": {"stopReason": "stop"}},
        ]
    )
    finish = parts[-1]
    assert finish["type"] == "finish"
    assert finish["finishReason"] == "stop"


@pytest.mark.asyncio
async def test_reasonless_correction_does_not_clobber_real_reason() -> None:
    """(c) A ``done`` WITH a stopReason and no corrective terminal value is still honored:
    a later null-carrying ``done`` must never clobber a real earlier one (fallback)."""
    parts = await _collect(
        [
            {"type": "message", "data": {"text": "done thinking"}},
            {"type": "done", "data": {"stopReason": "end_turn"}},
            {"type": "done", "data": {}},  # a stray reasonless done must not win
        ]
    )
    finish = parts[-1]
    assert finish["type"] == "finish"
    assert finish["finishReason"] == "stop"  # end_turn -> stop


# --- the handler: surfaces the terminal stop_reason into the stream -----------


class _FakeHarness:
    """Duck-typed harness for ``agent_event_stream``: setup/stream/cleanup + a run
    whose terminal result carries the authoritative stop_reason."""

    def __init__(self, records: List[Dict[str, Any]]) -> None:
        self._records = records
        self.cleaned_up = False

    async def setup(self) -> None:
        return None

    async def cleanup(self) -> None:
        self.cleaned_up = True

    async def stream(self, config, messages) -> AgentStream:
        async def _gen() -> AsyncIterator[Dict[str, Any]]:
            for record in self._records:
                yield record

        return AgentStream(_gen())


def _paused_records(done_stop_reason: Optional[str], result_stop_reason: Optional[str]):
    done_event: Dict[str, Any] = {"type": "done"}
    if done_stop_reason is not None:
        done_event["stopReason"] = done_stop_reason
    result: Dict[str, Any] = {"ok": True, "output": "", "sessionId": "c1"}
    if result_stop_reason is not None:
        result["stopReason"] = result_stop_reason
    return [
        {"kind": "event", "event": {"type": "message", "text": "one moment"}},
        {"kind": "event", "event": done_event},
        {"kind": "result", "result": result},
    ]


@pytest.mark.asyncio
async def test_handler_appends_corrective_terminal_done_on_pause() -> None:
    """The runner's ``done`` has no stopReason but the terminal result says ``paused`` ->
    the handler appends a corrective terminal ``done`` carrying ``paused``."""
    harness = _FakeHarness(
        _paused_records(done_stop_reason=None, result_stop_reason="paused")
    )
    out = [event async for event in agent_event_stream(harness, object(), [])]

    dones = [e for e in out if e["type"] == "done"]
    assert len(dones) == 2
    assert dones[0]["data"].get("stopReason") is None  # the runner's reasonless done
    assert dones[-1]["data"]["stopReason"] == "paused"  # the handler's correction
    assert harness.cleaned_up is True


@pytest.mark.asyncio
async def test_handler_does_not_duplicate_done_when_result_agrees() -> None:
    """A normal turn (done ``stop`` == terminal ``stop``) is not corrected: no duplicate done."""
    harness = _FakeHarness(
        _paused_records(done_stop_reason="stop", result_stop_reason="stop")
    )
    out = [event async for event in agent_event_stream(harness, object(), [])]

    dones = [e for e in out if e["type"] == "done"]
    assert len(dones) == 1
    assert dones[0]["data"]["stopReason"] == "stop"


@pytest.mark.asyncio
async def test_handler_stream_then_adapter_carries_paused_end_to_end() -> None:
    """End to end: the handler's neutral stream fed straight into the live adapter yields a
    finish frame with the paused reason, proving the two halves compose."""
    harness = _FakeHarness(
        _paused_records(done_stop_reason=None, result_stop_reason="paused")
    )
    neutral = [event async for event in agent_event_stream(harness, object(), [])]
    parts = await _collect(neutral)

    finish = parts[-1]
    assert finish["type"] == "finish"
    assert finish["finishReason"] == "other"


# Guard the DTO import surface the fakes lean on (Event/AgentResult stay importable here).
def test_dto_imports_present() -> None:
    assert Event is not None and AgentResult is not None


# --- a raw mid-stream exception still drains to a finish frame ----------------


async def _events_then_raise(
    items: List[Dict[str, Any]],
) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item
    raise ValueError("unexpected adapter bug")


@pytest.mark.asyncio
async def test_raw_exception_mid_stream_still_emits_finish() -> None:
    """An unexpected exception raised while iterating the event stream (not a graceful
    terminal-failure result) must still drain to a `finish` frame, or a consumer waiting
    on it hangs forever."""
    parts = [
        part
        async for part in agent_stream_to_vercel_stream(
            _events_then_raise([{"type": "message", "data": {"text": "partial"}}])
        )
    ]
    types = [p["type"] for p in parts]
    assert "error" in types
    assert types[-2:] == ["finish-step", "finish"]
    error = next(p for p in parts if p["type"] == "error")
    assert "unexpected adapter bug" in error["errorText"]
