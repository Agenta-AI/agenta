"""
Level 4 (specs.md "Testing contract"): header-semantics sweep per axis, over the real
`/invoke` route. Five axes: `Accept`, `x-ag-messages-transcript`, `x-ag-session-control`,
`x-ag-workflow-embeds`, `x-ag-messages-format`.

For each axis: absent -> default; each recognized value -> the mapped flag/behavior;
unrecognized value -> existing lenient behavior (treated as absent, per
`_parse_transcript_header`/`_parse_session_control_header`/`_parse_workflow_embeds_header`
docstrings in routing.py); an explicit body flag always wins over the header (routing.py
`apply_invoke_prelude`, body-wins precedence).

Driven through a request-capturing handler mounted with the real `route()` (mirrors the
sibling routing tests' offline-tracing pattern) so the ASSERTION is on what
`request.flags`/`request.session_id` actually resolved to post-prelude, not on response
shape (that's covered by the cube tests).
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agenta.sdk.decorators.routing import route, apply_invoke_prelude
from agenta.sdk.models.workflows import WorkflowServiceRequest, WorkflowInvokeRequest


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


# Capturing handler: records resolved `request.flags`/`session_id` into a side-channel
# (not the response body), branching stream-or-batch to avoid 406ing the sweep itself.
def _capturing_client():
    captured: dict = {}
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @route("/", app=app)
    def wf(request: WorkflowServiceRequest, value: str = "x"):
        captured["flags"] = dict(request.flags or {})
        captured["session_id"] = request.session_id
        if (request.flags or {}).get("stream"):

            def gen():
                yield {"type": "message", "data": {"text": f"reply:{value}"}}

            return gen()
        return {"messages": [{"role": "assistant", "content": f"reply:{value}"}]}

    return TestClient(app), captured


def _post(client, *, headers=None, flags=None, session_id=None):
    body: dict = {"data": {"inputs": {"value": "x"}}}
    if flags is not None:
        body["flags"] = flags
    if session_id is not None:
        body["session_id"] = session_id
    with _offline_tracing():
        return client.post("/invoke", json=body, headers=headers or {})


# =========================================================================== #
# Axis: Accept -> flags.stream
# =========================================================================== #
@pytest.mark.parametrize(
    "accept,expected_stream",
    [
        (None, False),
        ("application/json", False),
        ("text/event-stream", True),
        ("application/x-ndjson", True),
    ],
)
def test_accept_axis_maps_to_stream_flag(accept, expected_stream):
    headers = {"accept": accept} if accept is not None else {}
    client, captured = _capturing_client()
    resp = _post(client, headers=headers)
    assert resp.status_code == 200
    assert captured["flags"]["stream"] is expected_stream


def test_accept_body_stream_flag_wins():
    # Accept says batch; body says stream=True -> body wins.
    client, captured = _capturing_client()
    resp = _post(
        client,
        headers={"accept": "application/json"},
        flags={"stream": True},
    )
    assert resp.status_code == 406  # stream=True vs json Accept -> 406 (symmetry)
    assert captured["flags"]["stream"] is True


# =========================================================================== #
# Axis: x-ag-messages-transcript -> flags.trim
# =========================================================================== #
@pytest.mark.parametrize(
    "transcript,expect_trim_set,expected_trim",
    [
        (None, False, None),
        ("full", True, False),
        ("last", True, True),
        ("bogus", False, None),  # unrecognized -> lenient (treated as absent)
    ],
)
def test_transcript_header_axis_maps_to_trim_flag(
    transcript, expect_trim_set, expected_trim
):
    headers = {"x-ag-messages-transcript": transcript} if transcript else {}
    client, captured = _capturing_client()
    resp = _post(client, headers=headers)
    assert resp.status_code == 200
    flags = captured["flags"]
    if expect_trim_set:
        assert flags.get("trim") is expected_trim
    else:
        assert "trim" not in flags


def test_transcript_header_body_trim_flag_wins():
    # Header says trim=true; body says trim=False -> body wins.
    client, captured = _capturing_client()
    resp = _post(
        client,
        headers={"x-ag-messages-transcript": "last"},
        flags={"trim": False},
    )
    assert resp.status_code == 200
    assert captured["flags"]["trim"] is False


# =========================================================================== #
# Axis: x-ag-session-control -> flags.force
# =========================================================================== #
@pytest.mark.parametrize(
    "control,expect_force_set,expected_force",
    [
        (None, False, None),
        ("force", True, True),
        ("bogus", False, None),  # unrecognized -> lenient (treated as absent)
    ],
)
def test_session_control_header_axis_maps_to_force_flag(
    control, expect_force_set, expected_force
):
    headers = {"x-ag-session-control": control} if control else {}
    client, captured = _capturing_client()
    resp = _post(client, headers=headers)
    assert resp.status_code == 200
    flags = captured["flags"]
    if expect_force_set:
        assert flags.get("force") is expected_force
    else:
        assert "force" not in flags


def test_session_control_header_body_force_flag_wins():
    # Header says force; body says force=False -> body wins.
    client, captured = _capturing_client()
    resp = _post(
        client,
        headers={"x-ag-session-control": "force"},
        flags={"force": False},
    )
    assert resp.status_code == 200
    assert captured["flags"]["force"] is False


# =========================================================================== #
# Axis: x-ag-workflow-embeds -> flags.resolve
# `resolve` is stripped by ResolverMiddleware before any handler runs, so assert
# directly on `apply_invoke_prelude`'s output instead of via a handler round-trip.
# =========================================================================== #
def _prelude_request(*, headers=None, flags=None) -> WorkflowInvokeRequest:
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/invoke",
        "headers": [
            (k.lower().encode(), v.encode()) for k, v in (headers or {}).items()
        ],
        "query_string": b"",
    }
    req = Request(scope)
    request = WorkflowInvokeRequest(
        data={"inputs": {"value": "x"}}, flags=flags or None
    )
    apply_invoke_prelude(req, request)
    return request


@pytest.mark.parametrize(
    "embeds,expect_resolve_set,expected_resolve",
    [
        (None, False, None),  # absent -> unset here; ResolverMiddleware defaults True
        ("resolve", True, True),
        ("bogus", False, None),  # unrecognized -> lenient (treated as absent)
    ],
)
def test_workflow_embeds_header_axis_maps_to_resolve_flag(
    embeds, expect_resolve_set, expected_resolve
):
    headers = {"x-ag-workflow-embeds": embeds} if embeds else {}
    request = _prelude_request(headers=headers)
    flags = request.flags or {}
    if expect_resolve_set:
        assert flags.get("resolve") is expected_resolve
    else:
        assert "resolve" not in flags


def test_workflow_embeds_header_body_resolve_flag_wins():
    # Header says resolve=true; body says resolve=False -> body wins.
    request = _prelude_request(
        headers={"x-ag-workflow-embeds": "resolve"}, flags={"resolve": False}
    )
    assert request.flags["resolve"] is False


# =========================================================================== #
# Axis: x-ag-messages-format -> HTTP-only projection (no flag; asserted via response shape).
# =========================================================================== #
@pytest.mark.parametrize(
    "fmt,expect_vercel",
    [
        (None, False),
        ("agenta", False),
        ("vercel", True),
    ],
)
def test_messages_format_header_axis(fmt, expect_vercel):
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @route("/", app=app)
    def wf(value: str = "x"):
        return {"messages": [{"role": "assistant", "content": f"reply:{value}"}]}

    client = TestClient(app)
    headers = {"accept": "application/json"}
    if fmt is not None:
        headers["x-ag-messages-format"] = fmt
    resp = _post(client, headers=headers)
    assert resp.status_code == 200
    if expect_vercel:
        assert resp.headers.get("x-ag-messages-format") == "vercel"
        messages = resp.json()["data"]["outputs"]["messages"]
        assert any("parts" in m for m in messages)
    else:
        assert resp.headers.get("x-ag-messages-format") != "vercel"


def test_messages_format_unrecognized_value_is_treated_as_agenta():
    # Unrecognized value -> lenient/default (agenta passthrough).
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @route("/", app=app)
    def wf(value: str = "x"):
        return {"messages": [{"role": "assistant", "content": f"reply:{value}"}]}

    client = TestClient(app)
    resp = _post(
        client,
        headers={"accept": "application/json", "x-ag-messages-format": "bogus"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("x-ag-messages-format") != "vercel"


# =========================================================================== #
# session_id: body > x-ag-session-id header > baggage (apply_invoke_prelude).
# =========================================================================== #
def test_session_id_header_used_when_body_absent():
    client, captured = _capturing_client()
    resp = _post(client, headers={"x-ag-session-id": "sid-from-header"})
    assert resp.status_code == 200
    assert captured["session_id"] == "sid-from-header"


def test_session_id_body_wins_over_header():
    client, captured = _capturing_client()
    resp = _post(
        client,
        headers={"x-ag-session-id": "sid-from-header"},
        session_id="sid-from-body",
    )
    assert resp.status_code == 200
    assert captured["session_id"] == "sid-from-body"


if __name__ == "__main__":
    pytest.main([__file__, "-q"])
