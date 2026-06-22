"""Tests for the agent ``/messages`` + ``/load-session`` endpoints.

Two layers:

- Direct unit tests of the two pure Vercel routing helpers (``resolve_session_id``,
  ``inject_stream_session_id``).
- HTTP tests over a Starlette ``TestClient`` driving the real ``route(flags={"is_agent":
  True})`` wiring with a fake agent handler (no harness/runner). Registering on a bare
  ``FastAPI`` app keeps the auth middleware out; a stand-in sets ``request.state.auth``. The
  offline tracing mock (mirroring ``test_negotiation_integration``) lets ``wf.invoke`` run
  without ``ag.init()``.
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.agents import Message
from agenta.sdk.agents.adapters.vercel.routing import (
    VERCEL_MESSAGE_PROTOCOL,
    VERCEL_MESSAGE_PROTOCOL_VERSION,
    inject_stream_session_id,
    make_load_session_endpoint,
    resolve_session_id,
)
from agenta.sdk.decorators.routing import route
from agenta.sdk.models.workflows import (
    LoadSessionRequest,
    WorkflowBatchResponse,
    WorkflowServiceStatus,
    WorkflowStreamingResponse,
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_resolve_session_id_mints_echoes_and_validates():
    assert resolve_session_id("sess_ok") == "sess_ok"
    assert resolve_session_id(None).startswith("sess_")
    assert resolve_session_id("bad id!") is None  # space + '!' are out of charset
    assert resolve_session_id("x" * 200) is None  # over the length bound


@pytest.mark.asyncio
async def test_inject_stream_session_id_stamps_first_start_part():
    async def base():
        yield {"type": "start", "messageId": "m1"}
        yield {"type": "text-delta", "id": "t1", "delta": "x"}

    resp = WorkflowStreamingResponse(generator=base)
    inject_stream_session_id(resp, "sess_z")

    parts = [p async for p in resp.iterator()]
    assert parts[0]["messageMetadata"]["sessionId"] == "sess_z"
    assert parts[1] == {"type": "text-delta", "id": "t1", "delta": "x"}


# ---------------------------------------------------------------------------
# HTTP wiring
# ---------------------------------------------------------------------------


_UI_MESSAGE = {"role": "user", "parts": [{"type": "text", "text": "hello"}]}


def _assert_vercel_message_protocol(response):
    assert response.headers["x-ag-messages-format"] == VERCEL_MESSAGE_PROTOCOL
    assert response.headers["x-ag-messages-version"] == VERCEL_MESSAGE_PROTOCOL_VERSION


def _build_client() -> TestClient:
    app = FastAPI()

    # Stand in for AuthMiddleware (omitted by using a bare app): the endpoints read
    # ``request.state.auth``. No credentials needed — the fake handler runs locally.
    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @route("/", app=app, flags={"is_agent": True})
    async def agent(
        messages=None,
        inputs=None,
        parameters=None,
        stream=None,
        session_id=None,
    ):
        if stream:

            async def gen():
                yield {"type": "start", "messageId": "m1"}
                yield {"type": "text-start", "id": "t1"}
                yield {"type": "text-delta", "id": "t1", "delta": "hi"}
                yield {"type": "text-end", "id": "t1"}
                yield {"type": "finish"}

            return gen()
        return {
            "role": "assistant",
            "content": "hi",
            "echoed": messages,
            "session_id": session_id,
        }

    return TestClient(app)


def _build_failing_client() -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @route("/", app=app, flags={"is_agent": True})
    async def failing_agent(messages=None, inputs=None, parameters=None, stream=None):
        return WorkflowBatchResponse(
            status=WorkflowServiceStatus(
                code=500,
                message="tool resolution failed before stream",
                type="https://agenta.ai/docs/errors#v1:sdk:tool-resolution-error",
            )
        )

    return TestClient(app)


@pytest.fixture()
def client():
    """A TestClient with the offline tracing mock active so ``wf.invoke`` runs without
    ``ag.init()`` (same approach as ``test_negotiation_integration``)."""
    with (
        patch("agenta.sdk.decorators.tracing.ag") as mock_ag,
        patch("agenta.sdk.decorators.running.ag") as mock_run_ag,
    ):
        mock_span = MagicMock()
        mock_span.is_recording.return_value = False
        mock_span.get_span_context.return_value = MagicMock(trace_id=0, span_id=0)
        mock_ag.tracing = MagicMock()
        mock_ag.tracing.get_current_span.return_value = mock_span
        mock_ag.tracing.redact = None
        mock_tracer = MagicMock()
        mock_tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=mock_span
        )
        mock_tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=None
        )
        mock_ag.tracer = mock_tracer
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE = MagicMock()
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key = None
        yield _build_client()


def test_messages_json_mints_session_and_folds_conversation(client):
    res = client.post("/messages", json={"data": {"messages": [_UI_MESSAGE]}})
    assert res.status_code == 200
    _assert_vercel_message_protocol(res)
    body = res.json()
    assert body["session_id"].startswith("sess_")
    assert body["data"]["outputs"]["content"] == "hi"
    assert body["data"]["outputs"]["session_id"] == body["session_id"]
    # The Vercel UIMessage was folded to a neutral {role, content} message for the handler.
    assert body["data"]["outputs"]["echoed"] == [{"role": "user", "content": "hello"}]


def test_messages_echoes_supplied_session_id(client):
    res = client.post(
        "/messages",
        json={"session_id": "sess_keep", "data": {"messages": [_UI_MESSAGE]}},
    )
    assert res.status_code == 200
    _assert_vercel_message_protocol(res)
    assert res.json()["session_id"] == "sess_keep"
    assert res.json()["data"]["outputs"]["session_id"] == "sess_keep"


def test_messages_sse_streams_with_done_and_session_in_start(client):
    res = client.post(
        "/messages",
        headers={"accept": "text/event-stream"},
        json={"session_id": "sess_abc", "data": {"messages": [_UI_MESSAGE]}},
    )
    assert res.status_code == 200
    _assert_vercel_message_protocol(res)
    assert res.headers["x-vercel-ai-ui-message-stream"] == "v1"
    text = res.text
    # Parse the SSE payloads so the check survives serializer formatting changes (whitespace,
    # key order) rather than matching a literal JSON substring.
    payloads = [
        json.loads(line.removeprefix("data: "))
        for line in text.splitlines()
        if line.startswith("data: ") and line != "data: [DONE]"
    ]
    start = next(p for p in payloads if p.get("type") == "start")
    assert (
        start["messageMetadata"]["sessionId"] == "sess_abc"
    )  # stamped onto the start part
    assert any(p.get("type") == "text-delta" for p in payloads)
    assert "data: [DONE]" in text


def test_messages_sse_preserves_json_error_before_stream():
    with (
        patch("agenta.sdk.decorators.tracing.ag") as mock_ag,
        patch("agenta.sdk.decorators.running.ag") as mock_run_ag,
    ):
        mock_span = MagicMock()
        mock_span.is_recording.return_value = False
        mock_span.get_span_context.return_value = MagicMock(trace_id=0, span_id=0)
        mock_ag.tracing = MagicMock()
        mock_ag.tracing.get_current_span.return_value = mock_span
        mock_ag.tracing.redact = None
        mock_tracer = MagicMock()
        mock_tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=mock_span
        )
        mock_tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=None
        )
        mock_ag.tracer = mock_tracer
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE = MagicMock()
        mock_run_ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key = None
        client = _build_failing_client()

        response = client.post(
            "/messages",
            headers={"accept": "text/event-stream"},
            json={
                "session_id": "sess_error",
                "data": {"messages": [_UI_MESSAGE]},
            },
        )

    assert response.status_code == 500
    _assert_vercel_message_protocol(response)
    assert response.headers["content-type"].startswith("application/json")
    assert "x-vercel-ai-ui-message-stream" not in response.headers
    body = response.json()
    assert body["status"]["code"] == 500
    assert "tool resolution failed before stream" in body["status"]["message"]
    assert body["session_id"] == "sess_error"
    assert "[DONE]" not in response.text


def test_messages_rejects_invalid_session_id(client):
    res = client.post(
        "/messages", json={"session_id": "bad id!", "data": {"messages": []}}
    )
    assert res.status_code == 400
    _assert_vercel_message_protocol(res)


def test_load_session_returns_stub_history(client):
    res = client.post("/load-session", json={"session_id": "sess_abc"})
    assert res.status_code == 200
    _assert_vercel_message_protocol(res)
    assert res.json() == {"session_id": "sess_abc", "messages": []}


@pytest.mark.asyncio
async def test_load_session_uses_session_store_port():
    class _Store:
        async def load(self, session_id):
            assert session_id == "sess_abc"
            return [Message(role="user", content="hello")]

        async def save_turn(self, session_id, *, messages, result=None):
            raise AssertionError("load-session should only load")

    endpoint = make_load_session_endpoint(session_store=_Store())
    response = await endpoint(None, LoadSessionRequest(session_id="sess_abc"))

    assert response.status_code == 200
    assert response.headers["x-ag-messages-format"] == VERCEL_MESSAGE_PROTOCOL
    assert response.headers["x-ag-messages-version"] == VERCEL_MESSAGE_PROTOCOL_VERSION
    assert json.loads(response.body) == {
        "session_id": "sess_abc",
        "messages": [
            {
                "id": "msg-1",
                "role": "user",
                "parts": [{"type": "text", "text": "hello"}],
            }
        ],
    }
