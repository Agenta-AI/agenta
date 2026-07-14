"""
Level 4 (specs.md "Testing contract"): the negotiation cube re-run against the REAL
`agenta:builtin:agent:v0` and `agenta:builtin:llm:v0` handlers, mounted with the real
`route()` -- not the synthetic shapes `test_workflow_negotiation_cube_routing.py` uses.

agent_v0: mounted via `make_agent_handler(composition)` (the injectable seam in
`agenta/sdk/agents/handler.py`) over a fake `Backend`/`Session` pair that mirrors
`services/oss/tests/pytest/unit/agent/conftest.py`'s `_FakeSession` -- yields the live
agenta event wire (`{"kind": "event", ...}`) then a terminal `{"kind": "result", ...}`
record, exactly the shape `AgentStream.__aiter__` (agents/streaming.py) expects. Sweeps
stream x transcript x format.

llm_v0: mounted directly (real `engines/running/handlers.py::llm_v0`); the LLM call
boundary (`litellm.acompletion`, resolved lazily via `_load_litellm`) and
`SecretsManager.retrieve_secrets` are mocked -- the same boundary/pattern
`test_llm_v0_handler_flags_running.py` (Level 1) uses. llm_v0 is batch-only: json/absent
Accept OK, stream Accept -> 406 (symmetry, not a handler change).

Both handlers are mounted at `route("/", app=app)` (mirrors every sibling routing test
-- a non-root `route()` path mounts a sub-app with the REAL AuthMiddleware, which these
offline-tracing-only tests don't authenticate against), so the invoke path is `/invoke`.

Also covers tasks.md's 406 matrix for real handlers: `force` via header AND via body
flag on both `agent_v0` and `llm_v0`.
"""

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any, AsyncIterator, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.agents import AgentResult, HarnessType
from agenta.sdk.agents.dtos import Event
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.interfaces import Backend, Sandbox, Session
from agenta.sdk.agents.streaming import AgentStream
from agenta.sdk.agents.connections import ResolvedConnection
from agenta.sdk.decorators.routing import route
from agenta.sdk.engines.running import handlers as running_handlers


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


def _events_for(text: str) -> List[Event]:
    """A plain assistant turn as the live agenta event vocabulary (fold.py input)."""
    mid = "msg-1"
    raw = [
        {"type": "message_start", "data": {"id": mid}},
        {"type": "message_delta", "data": {"id": mid, "delta": text}},
        {"type": "message_end", "data": {"id": mid}},
        {"type": "done", "data": {"stopReason": "stop"}},
    ]
    return [Event(type=r["type"], data=r["data"]) for r in raw]


# Fake Backend/Session pair, self-contained (mirrors the services conftest fixtures).
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

    def __init__(self, *, events: List[Event], output: str = "") -> None:
        self._events = events
        self._output = output

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
        return _FakeSession(
            AgentResult(output=self._output, events=self._events, usage={"total": 5})
        )


def _agent_client(*, text: str = "hello world") -> TestClient:
    backend = _FakeBackend(events=_events_for(text), output=text)

    async def _no_connection(*, model, context) -> ResolvedConnection:
        return ResolvedConnection(
            provider="openai", model="m", credential_mode="runtime_provided", env={}
        )

    composition = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_no_connection,
    )
    handler = make_agent_handler(composition)
    handler.__name__ = "agent_v0_under_test"

    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    route("/", app=app)(handler)
    return TestClient(app)


def _post_agent(client, *, headers=None, flags=None):
    body: dict = {"data": {"inputs": {"messages": [{"role": "user", "content": "hi"}]}}}
    if flags is not None:
        body["flags"] = flags
    with _offline_tracing():
        return client.post("/invoke", json=body, headers=headers or {})


# =========================================================================== #
# agent_v0 cube: stream x transcript x format
# =========================================================================== #
@pytest.mark.parametrize(
    "accept,fmt",
    [
        (None, None),
        (None, "vercel"),
        ("application/json", None),
        ("application/json", "vercel"),
    ],
)
def test_agent_v0_batch_cube_shape(accept, fmt):
    headers = {}
    if accept is not None:
        headers["accept"] = accept
    if fmt is not None:
        headers["x-ag-messages-format"] = fmt
    resp = _post_agent(_agent_client(), headers=headers)
    assert resp.status_code == 200
    assert "application/json" in resp.headers["content-type"]
    messages = resp.json()["data"]["outputs"]["messages"]
    assert isinstance(messages, list) and messages
    if fmt == "vercel":
        assert resp.headers.get("x-ag-messages-format") == "vercel"
        assert any("parts" in m for m in messages)
    else:
        assert all("content" in m for m in messages)


@pytest.mark.parametrize("accept", ["text/event-stream", "application/x-ndjson"])
@pytest.mark.parametrize("fmt", [None, "vercel"])
def test_agent_v0_stream_cube_shape(accept, fmt):
    # vercel projection is SSE-only; fmt=vercel + ndjson Accept is agenta passthrough.
    headers = {"accept": accept}
    if fmt is not None:
        headers["x-ag-messages-format"] = fmt
    resp = _post_agent(_agent_client(), headers=headers)
    assert resp.status_code == 200
    assert accept in resp.headers["content-type"]
    if fmt == "vercel" and accept == "text/event-stream":
        assert resp.headers.get("x-ag-messages-format") == "vercel"
        assert "[DONE]" in resp.text
    else:
        assert "message_start" in resp.text or "message_delta" in resp.text


@pytest.mark.parametrize("transcript", ["full", "last"])
def test_agent_v0_batch_transcript_axis(transcript):
    resp = _post_agent(
        _agent_client(text="alpha beta"),
        headers={"accept": "application/json", "x-ag-messages-transcript": transcript},
    )
    assert resp.status_code == 200
    messages = resp.json()["data"]["outputs"]["messages"]
    # Single plain-text turn: full and trimmed are both length 1, content identical.
    assert len(messages) == 1
    assert messages[0]["content"] == "alpha beta"


def test_agent_v0_body_trim_flag_wins_over_transcript_header():
    resp = _post_agent(
        _agent_client(text="hi"),
        headers={"accept": "application/json", "x-ag-messages-transcript": "full"},
        flags={"trim": True},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["outputs"]["messages"][0]["content"] == "hi"


# llm_v0: batch-only. json/absent Accept OK; stream Accept -> 406 (symmetry).
class _FakeMessage:
    def model_dump(self, exclude_none=True):
        return {"role": "assistant", "content": "hi there"}


@pytest.fixture
def _llm_client(monkeypatch):
    async def acompletion(**kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=_FakeMessage())],
            usage={"total_tokens": 3},
        )

    fake_litellm = SimpleNamespace(acompletion=acompletion)

    async def retrieve_secrets():
        return [], [], []

    monkeypatch.setattr(running_handlers, "_load_litellm", lambda: fake_litellm)
    monkeypatch.setattr(
        running_handlers.SecretsManager, "retrieve_secrets", retrieve_secrets
    )

    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    route("/", app=app)(running_handlers.llm_v0)
    return TestClient(app)


_LLM_PARAMETERS = {"llms": [{"model": "gpt-4o-mini"}]}


def _post_llm(client, *, headers=None, flags=None):
    body: dict = {
        "data": {
            "inputs": {"messages": [{"role": "user", "content": "hi"}]},
            "parameters": _LLM_PARAMETERS,
        }
    }
    if flags is not None:
        body["flags"] = flags
    with _offline_tracing():
        return client.post("/invoke", json=body, headers=headers or {})


@pytest.mark.parametrize("accept", [None, "application/json"])
def test_llm_v0_batch_accept_is_ok(_llm_client, accept):
    headers = {"accept": accept} if accept else {}
    resp = _post_llm(_llm_client, headers=headers)
    assert resp.status_code == 200
    body = resp.json()["data"]["outputs"]
    assert body["status"]["code"] == 200
    assert body["messages"][-1]["content"] == "hi there"


@pytest.mark.parametrize("accept", ["text/event-stream", "application/x-ndjson"])
def test_llm_v0_stream_accept_is_406(_llm_client, accept):
    resp = _post_llm(_llm_client, headers={"accept": accept})
    assert resp.status_code == 406


def test_llm_v0_stream_flag_true_still_406s_on_stream_accept(_llm_client):
    # llm_v0 ignores `stream`; routing 406s the mismatch by symmetry regardless.
    resp = _post_llm(
        _llm_client,
        headers={"accept": "text/event-stream"},
        flags={"stream": True},
    )
    assert resp.status_code == 406


def test_llm_v0_transcript_last_trims_messages(_llm_client):
    resp = _post_llm(
        _llm_client,
        headers={"accept": "application/json", "x-ag-messages-transcript": "last"},
    )
    assert resp.status_code == 200
    messages = resp.json()["data"]["outputs"]["messages"]
    assert messages == [{"role": "assistant", "content": "hi there"}]


def test_llm_v0_transcript_full_keeps_all_messages(_llm_client):
    resp = _post_llm(
        _llm_client,
        headers={"accept": "application/json", "x-ag-messages-transcript": "full"},
    )
    assert resp.status_code == 200
    messages = resp.json()["data"]["outputs"]["messages"]
    assert len(messages) == 2


# =========================================================================== #
# 406 matrix: `force` via header AND via body flag, on BOTH real handlers ->
# `ForceNotSupportedV0Error` (code=406), per specs.md "no take-over semantics yet".
# =========================================================================== #
def test_agent_v0_force_body_flag_is_406():
    resp = _post_agent(_agent_client(), flags={"force": True})
    assert resp.status_code == 406
    assert "force-not-supported" in resp.json()["status"]["type"]


def test_agent_v0_force_header_is_406():
    resp = _post_agent(_agent_client(), headers={"x-ag-session-control": "force"})
    assert resp.status_code == 406
    assert "force-not-supported" in resp.json()["status"]["type"]


def test_llm_v0_force_body_flag_is_406(_llm_client):
    resp = _post_llm(_llm_client, flags={"force": True})
    assert resp.status_code == 406
    assert "force-not-supported" in resp.json()["status"]["type"]


def test_llm_v0_force_header_is_406(_llm_client):
    resp = _post_llm(_llm_client, headers={"x-ag-session-control": "force"})
    assert resp.status_code == 406
    assert "force-not-supported" in resp.json()["status"]["type"]


def test_force_406_body_shape_consistent_across_real_handlers(_llm_client):
    # Sanity: 406 body/shape for the same failure is consistent across handlers.
    agent_resp = _post_agent(_agent_client(), flags={"force": True})
    llm_resp = _post_llm(_llm_client, flags={"force": True})
    assert agent_resp.status_code == llm_resp.status_code == 406
    agent_status = agent_resp.json()["status"]
    llm_status = llm_resp.json()["status"]
    assert agent_status["type"] == llm_status["type"]
    assert agent_status["code"] == llm_status["code"] == 406


if __name__ == "__main__":
    pytest.main([__file__, "-q"])
