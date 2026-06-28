"""
ROUTING. Negotiation 2 — message format (`x-ag-messages-format`: agenta | vercel)
on the REAL `/invoke` route. HTTP-only: in code messages are always agenta.

Two directions, reusing the vercel adapter machinery (so dropping `/messages`
loses no capability):
  - OUTPUT: x-ag-messages-format: vercel projects the response as Vercel parts and
    stamps the protocol headers; default/agenta keeps the canonical shape.
  - INPUT: x-ag-messages-format: vercel converts inbound UIMessage[] in
    `data.inputs.messages` to canonical agenta messages before the handler runs.

Driven through a Starlette TestClient on real `route()` wiring (bare app, no auth
middleware; offline tracing mock so wf.invoke runs without ag.init()).
"""

from contextlib import contextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.decorators.routing import route


def test_messages_format_header_constant_exists():
    from agenta.sdk.agents.adapters.vercel.routing import (
        VERCEL_MESSAGE_PROTOCOL_HEADERS,
    )

    assert "x-ag-messages-format" in VERCEL_MESSAGE_PROTOCOL_HEADERS
    assert VERCEL_MESSAGE_PROTOCOL_HEADERS["x-ag-messages-format"] == "vercel"


@contextmanager
def _offline_tracing():
    from unittest.mock import MagicMock, patch

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


# Unique handler names so registrations don't collide in the global registry.
_uid = 0


def _unique(fn):
    global _uid
    _uid += 1
    fn.__name__ = f"{fn.__name__}_{_uid}"
    return fn


def _streaming_client() -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    async def wf(value: str = "x"):
        # The agenta STREAMING wire is the event vocabulary (born in the runner): a streaming
        # handler yields agenta events `{type, data}`, NOT whole messages. Routing projects
        # these to vercel parts when `x-ag-messages-format: vercel`.
        yield {"type": "message", "data": {"text": f"a:{value}"}}
        yield {"type": "message", "data": {"text": f"b:{value}"}}

    route("/", app=app)(_unique(wf))
    return TestClient(app)


# --------------------------------------------------------------------------- #
# OUTPUT: vercel projection on /invoke
# --------------------------------------------------------------------------- #
def test_vercel_format_stream_projects_parts_and_headers():
    with _offline_tracing():
        resp = _streaming_client().post(
            "/invoke",
            json={"data": {"inputs": {"value": "x"}}},
            headers={
                "accept": "text/event-stream",
                "x-ag-messages-format": "vercel",
            },
        )

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    # the vercel protocol identity is stamped on the response
    assert resp.headers.get("x-ag-messages-format") == "vercel"
    # the agenta events were actually projected to vercel parts (not passed through raw):
    # a vercel UI message stream opens with `start` and frames text deltas, ending in [DONE].
    body = resp.text
    assert '"type": "start"' in body
    assert '"type": "text-delta"' in body
    assert "a:x" in body and "b:x" in body
    assert "[DONE]" in body
    # the raw agenta event type never leaks to the vercel wire
    assert '"type": "message"' not in body


def test_default_format_is_agenta_no_vercel_headers():
    with _offline_tracing():
        resp = _streaming_client().post(
            "/invoke",
            json={"data": {"inputs": {"value": "x"}}},
            headers={"accept": "text/event-stream"},
        )

    assert resp.status_code == 200
    assert resp.headers.get("x-ag-messages-format") != "vercel"


# --------------------------------------------------------------------------- #
# INPUT: vercel UIMessage[] converted to canonical before the handler
# --------------------------------------------------------------------------- #
def test_vercel_format_input_is_converted_to_canonical():
    app = FastAPI()
    seen = {}

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    async def wf(messages=None, inputs=None, value: str = "x"):
        # capture what the handler received as the conversation
        seen["messages"] = (
            messages if messages is not None else ((inputs or {}).get("messages"))
        )
        return {"role": "assistant", "content": "ok"}

    route("/", app=app)(_unique(wf))

    client = TestClient(app)
    with _offline_tracing():
        resp = client.post(
            "/invoke",
            json={
                "data": {
                    "inputs": {
                        "messages": [
                            {"role": "user", "parts": [{"type": "text", "text": "hi"}]}
                        ]
                    }
                }
            },
            headers={
                "accept": "application/json",
                "x-ag-messages-format": "vercel",
            },
        )

    assert resp.status_code == 200
    # the UIMessage (parts) was converted to a canonical message (role/content),
    # not passed through raw with `parts`.
    msgs = seen["messages"]
    assert msgs and isinstance(msgs, list)
    first = msgs[0]
    role = (
        first.get("role") if isinstance(first, dict) else getattr(first, "role", None)
    )
    assert role == "user"
    assert "parts" not in (first if isinstance(first, dict) else {})
