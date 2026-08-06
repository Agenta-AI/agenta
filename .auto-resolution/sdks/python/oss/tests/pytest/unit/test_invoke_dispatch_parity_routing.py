"""
Dispatch-surface parity (specs.md "Both invoke surfaces comply", tasks.md §4b):
the route mount (`route()`-generated `/invoke`) and the generic root dispatch
(mirrors `services/entrypoints/main.py::services_invoke`) share ONE endpoint
prelude (`apply_invoke_prelude`) and must negotiate identically for the same
request + headers.

The dispatch app here is a minimal stand-in for `services_invoke` (same two
lines: `apply_invoke_prelude` then `invoke_workflow`) rather than the full
services app, which pulls in `services.oss.src.*` service-registration modules
not needed to pin the routing/negotiation contract. It resolves the handler
by URI (`user:custom:<module>.<name>:latest`, `register_handler`'s default),
the same registry a `route()` mount populates — so both surfaces invoke the
SAME registered handler.
"""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from agenta.sdk.decorators.routing import (
    route,
    apply_invoke_prelude,
    handle_invoke_success,
    handle_invoke_failure,
)
from agenta.sdk.decorators.running import invoke_workflow
from agenta.sdk.models.workflows import WorkflowInvokeRequest


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


def _dispatch_app() -> FastAPI:
    """Stand-in for services_invoke: same prelude + invoke_workflow call.

    Bare FastAPI() (not create_app()) — mirrors the sibling routing tests'
    bare route apps, so neither surface runs the real AuthMiddleware here.
    """
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @app.post("/invoke")
    async def dispatch_invoke(req: Request, request: WorkflowInvokeRequest):
        credentials = req.state.auth.get("credentials")
        apply_invoke_prelude(req, request)
        try:
            response = await invoke_workflow(request=request, credentials=credentials)
            return await handle_invoke_success(req, response)
        except Exception as exception:
            return await handle_invoke_failure(exception)

    return app


def _route_app(handler) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def _fake_auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    route("/", app=app)(handler)
    return app


def _post(client: TestClient, *, body: dict, headers: dict):
    return client.post("/invoke", json=body, headers=headers)


def _batch_handler(value: str = "x"):
    return {"messages": [{"role": "assistant", "content": f"reply:{value}"}]}


def _stream_handler(value: str = "x"):
    yield f"a:{value}"
    yield f"b:{value}"


def _uri_for(handler) -> str:
    return f"user:custom:{handler.__module__}.{handler.__name__}:latest"


def _body(uri: str, *, flags=None) -> dict:
    body = {
        "data": {
            "inputs": {"value": "x"},
            "revision": {"data": {"uri": uri}},
        }
    }
    if flags is not None:
        body["flags"] = flags
    return body


# Batch case: no Accept -> both surfaces return the same batch JSON.
def test_batch_case_route_and_dispatch_agree():
    uri = _uri_for(_batch_handler)
    route_client = TestClient(_route_app(_batch_handler))
    dispatch_client = TestClient(_dispatch_app())

    headers = {"accept": "application/json"}
    body = _body(uri)

    with _offline_tracing():
        route_resp = _post(route_client, body=body, headers=headers)
        dispatch_resp = _post(dispatch_client, body=body, headers=headers)

    assert route_resp.status_code == dispatch_resp.status_code == 200
    assert route_resp.headers["content-type"] == dispatch_resp.headers["content-type"]
    assert route_resp.json()["data"] == dispatch_resp.json()["data"]


# Stream case: no Accept on a stream-only handler -> both surfaces serve ndjson
# (F-NEG-1: dispatch used to skip this negotiation and diverge from the route mount).
def test_stream_case_no_accept_route_and_dispatch_agree():
    uri = _uri_for(_stream_handler)
    route_client = TestClient(_route_app(_stream_handler))
    dispatch_client = TestClient(_dispatch_app())

    body = _body(uri)

    with _offline_tracing():
        route_resp = _post(route_client, body=body, headers={})
        dispatch_resp = _post(dispatch_client, body=body, headers={})

    assert route_resp.status_code == dispatch_resp.status_code == 200
    assert route_resp.headers["content-type"] == dispatch_resp.headers["content-type"]
    assert "application/x-ndjson" in route_resp.headers["content-type"]
    assert route_resp.text == dispatch_resp.text


# Stream case: explicit SSE Accept -> both surfaces stream SSE identically.
def test_stream_case_sse_accept_route_and_dispatch_agree():
    uri = _uri_for(_stream_handler)
    route_client = TestClient(_route_app(_stream_handler))
    dispatch_client = TestClient(_dispatch_app())

    headers = {"accept": "text/event-stream"}
    body = _body(uri)

    with _offline_tracing():
        route_resp = _post(route_client, body=body, headers=headers)
        dispatch_resp = _post(dispatch_client, body=body, headers=headers)

    assert route_resp.status_code == dispatch_resp.status_code == 200
    assert route_resp.headers["content-type"] == dispatch_resp.headers["content-type"]
    assert route_resp.text == dispatch_resp.text


# 406 symmetry must also hold on both surfaces: batch Accept over a stream-only handler.
def test_batch_accept_on_stream_only_handler_406s_on_both_surfaces():
    uri = _uri_for(_stream_handler)
    route_client = TestClient(_route_app(_stream_handler))
    dispatch_client = TestClient(_dispatch_app())

    headers = {"accept": "application/json"}
    body = _body(uri)

    with _offline_tracing():
        route_resp = _post(route_client, body=body, headers=headers)
        dispatch_resp = _post(dispatch_client, body=body, headers=headers)

    assert route_resp.status_code == dispatch_resp.status_code == 406


# Header->flag negotiation (x-ag-messages-transcript) must reach both surfaces identically.
def test_transcript_header_route_and_dispatch_agree():
    uri = _uri_for(_batch_handler)
    route_client = TestClient(_route_app(_batch_handler))
    dispatch_client = TestClient(_dispatch_app())

    headers = {"accept": "application/json", "x-ag-messages-transcript": "last"}
    body = _body(uri)

    with _offline_tracing():
        route_resp = _post(route_client, body=body, headers=headers)
        dispatch_resp = _post(dispatch_client, body=body, headers=headers)

    assert route_resp.status_code == dispatch_resp.status_code == 200
    assert route_resp.json()["data"] == dispatch_resp.json()["data"]


# force-406 parity: `x-ag-session-control: force` must 406 identically on both surfaces.
def _force_handler(request, value: str = "x"):
    from agenta.sdk.models.workflows import WorkflowInvokeRequestFlags
    from agenta.sdk.engines.running.errors import ForceNotSupportedV0Error

    if WorkflowInvokeRequestFlags(**(request.flags or {})).force:
        raise ForceNotSupportedV0Error()
    return {"messages": [{"role": "assistant", "content": f"reply:{value}"}]}


def test_force_header_406_route_and_dispatch_agree():
    uri = _uri_for(_force_handler)
    route_client = TestClient(_route_app(_force_handler))
    dispatch_client = TestClient(_dispatch_app())

    headers = {"accept": "application/json", "x-ag-session-control": "force"}
    body = _body(uri)

    with _offline_tracing():
        route_resp = _post(route_client, body=body, headers=headers)
        dispatch_resp = _post(dispatch_client, body=body, headers=headers)

    assert route_resp.status_code == dispatch_resp.status_code == 406
    assert route_resp.json()["status"]["type"] == dispatch_resp.json()["status"]["type"]


if __name__ == "__main__":
    pytest.main([__file__, "-q"])
