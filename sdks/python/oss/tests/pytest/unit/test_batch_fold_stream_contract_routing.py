"""
CONTRACT (now HARD — specs.md "The fold") — batch = fold(stream), over the real
`/invoke` route, against the REAL `agenta:builtin:agent:v0` handler.

Pins the fold contract from docs/designs/invoke-negotiations/specs.md: the SAME
request against `/invoke` (mounting the real `agent_v0`, via `make_agent_handler` +
a fake `Backend`/`Session` pair over a multi-message turn -- assistant text, a
tool_call/tool_result pair, then more assistant text), driven once with a stream
Accept and once with a batch Accept, must agree — `fold(streamed events)` must
deep-equal the batch response's `outputs`.

This is the Wave-2 flip: `agent_v0`'s batch branch (`agent_batch` in
`agenta/sdk/agents/handler.py`) now drains the SAME stream and applies `fold` +
`trim_to_trailing_unit`, so the synthetic single-message envelope this test used
to pin against (`test_workflow_negotiation_cube_routing.py`'s sibling module) is
gone — batch and fold(stream) are the same code path by construction. No xfail.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, AsyncIterator, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.agents import AgentResult, HarnessType
from agenta.sdk.agents.dtos import Event
from agenta.sdk.agents.fold import fold
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.interfaces import Backend, Sandbox, Session
from agenta.sdk.agents.streaming import AgentStream
from agenta.sdk.agents.connections import ResolvedConnection
from agenta.sdk.decorators.routing import route


@contextmanager
def _offline_tracing():
    with (
        patch("agenta.sdk.decorators.tracing.ag") as mock_ag,
        patch("agenta.sdk.decorators.running.ag") as mock_run_ag,
    ):
        span = MagicMock()
        span.is_recording.return_value = False
        span.get_span_context.return_value = MagicMock(trace_id=0, span_id=0)
        mock_ag.tracing = MagicMock()
        mock_ag.tracing.get_current_span.return_value = span
        mock_ag.tracing.redact = None
        tracer = MagicMock()
        tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=span
        )
        tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=None
        )
        mock_ag.tracer = tracer
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE = MagicMock()
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key = None
        yield


# Multi-message turn: assistant text -> tool_call -> tool_result -> assistant text.
def _multi_message_events() -> List[Event]:
    raw = [
        {"type": "message_start", "data": {"id": "msg-1"}},
        {"type": "message_delta", "data": {"id": "msg-1", "delta": "let me check"}},
        {"type": "message_end", "data": {"id": "msg-1"}},
        {
            "type": "tool_call",
            "data": {"id": "tool-1", "name": "search", "input": {"q": "x"}},
        },
        {"type": "tool_result", "data": {"id": "tool-1", "output": "found it"}},
        {"type": "message_start", "data": {"id": "msg-2"}},
        {"type": "message_delta", "data": {"id": "msg-2", "delta": "here you go"}},
        {"type": "message_end", "data": {"id": "msg-2"}},
        {"type": "done", "data": {"stopReason": "stop"}},
    ]
    return [Event(type=r["type"], data=r["data"]) for r in raw]


class _FakeSandbox(Sandbox):
    async def add_files(self, files) -> None:
        return None

    async def destroy(self) -> None:
        return None


class _FakeSession(Session):
    def __init__(self, result: AgentResult) -> None:
        self._result = result

    @property
    def id(self) -> Optional[str]:
        return self._result.session_id

    async def prompt(self, messages, *, on_event=None) -> AgentResult:
        return self._result

    def stream(self, messages) -> AgentStream:
        result = self._result

        async def _records() -> AsyncIterator[Dict[str, Any]]:
            for event in result.events:
                yield {"kind": "event", "event": {"type": event.type, **event.data}}
            yield {
                "kind": "result",
                "result": {
                    "ok": True,
                    "output": result.output,
                    "usage": result.usage,
                    "sessionId": result.session_id,
                },
            }

        return AgentStream(_records())

    async def destroy(self) -> None:
        return None


class _FakeBackend(Backend):
    supported_harnesses = frozenset(
        {HarnessType.PI, HarnessType.CLAUDE, HarnessType.AGENTA}
    )

    def __init__(self, *, events: List[Event]) -> None:
        self._events = events

    async def create_sandbox(self) -> _FakeSandbox:
        return _FakeSandbox()

    async def create_session(
        self,
        sandbox,
        config,
        *,
        harness,
        secrets=None,
        trace=None,
        run_context=None,
        session_id=None,
    ) -> _FakeSession:
        # Fresh session per call: stream and batch requests each get their own iterator.
        return _FakeSession(AgentResult(output="here you go", events=self._events))


def _build_app() -> FastAPI:
    backend = _FakeBackend(events=_multi_message_events())

    async def _no_connection(*, model, context) -> ResolvedConnection:
        return ResolvedConnection(
            provider="openai", model="m", credential_mode="runtime_provided", env={}
        )

    composition = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_no_connection,
    )
    handler = make_agent_handler(composition)
    handler.__name__ = "agent_v0_contract_under_test"

    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    route("/", app=app)(handler)
    return app


def _post(client: TestClient, *, accept: str, flags: Optional[dict] = None):
    body: dict = {"data": {"inputs": {"messages": [{"role": "user", "content": "hi"}]}}}
    if flags is not None:
        body["flags"] = flags
    return client.post("/invoke", json=body, headers={"accept": accept})


def test_batch_equals_fold_of_stream_over_agent_invoke_route():
    client = TestClient(_build_app())

    with _offline_tracing():
        stream_resp = _post(client, accept="application/x-ndjson")
        batch_resp = _post(client, accept="application/json")

    assert stream_resp.status_code == 200
    assert batch_resp.status_code == 200

    # Each ndjson line is the raw `{type, data}` event fold() consumes.
    events = [
        __import__("json").loads(line)
        for line in stream_resp.text.strip().splitlines()
        if line.strip()
    ]

    folded = fold(events)
    batch_outputs = batch_resp.json()["data"]["outputs"]

    # THE PIN: fold(streamed events) deep-equals the batch outputs.
    assert folded["messages"] == batch_outputs["messages"]
    assert folded.get("stop_reason") == batch_outputs.get("stop_reason")
    assert folded.get("pending_interaction") == batch_outputs.get("pending_interaction")
    # Sanity: multi-message turn reconstructed in order, not a synthetic envelope.
    assert [m["role"] for m in batch_outputs["messages"]] == [
        "assistant",
        "tool",
        "tool",
        "assistant",
    ]


def test_trim_variant_trailing_unit_equality_on_both_surfaces():
    """`x-ag-messages-transcript: last` on both surfaces trims to the SAME
    trailing unit: fold(stream) then trim_to_trailing_unit == the batch's
    trim=true output (specs.md trim contract, over the real handler)."""
    from agenta.sdk.agents.fold import trim_to_trailing_unit

    client = TestClient(_build_app())

    with _offline_tracing():
        stream_resp = _post(client, accept="application/x-ndjson")
        batch_resp = _post(client, accept="application/json", flags={"trim": True})

    assert stream_resp.status_code == 200
    assert batch_resp.status_code == 200

    events = [
        __import__("json").loads(line)
        for line in stream_resp.text.strip().splitlines()
        if line.strip()
    ]
    folded_trimmed = trim_to_trailing_unit(fold(events)["messages"])
    batch_outputs = batch_resp.json()["data"]["outputs"]

    assert folded_trimmed == batch_outputs["messages"]
    # the trailing unit of this turn is a single assistant message.
    assert batch_outputs["messages"] == [
        {"role": "assistant", "content": "here you go"}
    ]


if __name__ == "__main__":
    pytest.main([__file__, "-q"])
