"""Server tracing on a routed workflow app must leave the product trace unchanged.

The app is built like the services app: the SDK's OTel middleware, a routed workflow,
and the real FastAPI and httpx instrumentations wired to a server provider. Each request
runs with server tracing off and on, and the product span trees must be equal.
"""

from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry import propagate
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import SpanKind

import agenta as ag
from agenta.sdk.decorators.routing import route
from agenta.sdk.engines.tracing import server
from agenta.sdk.engines.tracing.propagation import inject
from agenta.sdk.engines.tracing.tracing import Tracing
from agenta.sdk.middlewares.routing.otel import OTelMiddleware


REMOTE_TRACE = "0af7651916cd43dd8448eb211c80319c"
REMOTE_SPAN = "b7ad6b7169203331"


@pytest.fixture
def product(monkeypatch):
    exporter = InMemorySpanExporter()
    tracing = Tracing(url="http://in-memory.invalid/otlp/v1/traces")
    tracing.redact = None
    tracing.redact_on_error = True
    provider = TracerProvider(resource=Resource({"service.name": "agenta-sdk"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracing.tracer_provider = provider
    tracing.tracer = provider.get_tracer("agenta.tracer")
    monkeypatch.setattr(ag, "tracing", tracing, raising=False)
    monkeypatch.setattr(ag, "tracer", tracing.tracer, raising=False)
    return exporter


@pytest.fixture
def server_provider(monkeypatch):
    exporter = InMemorySpanExporter()
    inner = TracerProvider(
        resource=Resource({"service.name": "agenta-services"}),
        sampler=server.ServerSampler(1.0),
    )
    inner.add_span_processor(SimpleSpanProcessor(exporter))
    provider = server._ServerTracerProvider(inner)
    monkeypatch.setattr(server, "_provider", provider)

    saved = propagate.get_global_textmap()
    server._disable_global_propagation()
    try:
        yield exporter
    finally:
        propagate.set_global_textmap(saved)


def _app(*, traced: bool) -> TestClient:
    app = FastAPI()
    app.add_middleware(OTelMiddleware)

    @app.middleware("http")
    async def _auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    @ag.instrument(spankind="task")
    async def step(value: str) -> str:
        return value.upper()

    async def workflow(value: str = "x"):
        return await step(value)

    # a unique name: the route registry is global
    workflow.__name__ = f"wf_{uuid4().hex[:8]}"
    route("/", app=app)(workflow)

    if traced:
        server.instrument_fastapi(app)
    return TestClient(app)


def _invoke(client, **headers):
    response = client.post(
        "/invoke",
        json={"data": {"inputs": {"value": "x"}}},
        headers={"accept": "application/json", **headers},
    )
    assert response.status_code == 200, response.text


def _tree(spans):
    by_id = {span.context.span_id: span for span in spans}
    tree = []
    for span in spans:
        if span.parent is None:
            parent = None
        elif span.parent.span_id in by_id:
            parent = by_id[span.parent.span_id].name.split("_")[0]
        else:
            parent = f"remote:{span.parent.span_id:016x}"
        tree.append((span.name.split("_")[0], parent))
    return sorted(tree), {f"{span.context.trace_id:032x}" for span in spans}


@pytest.mark.parametrize("with_parent", [False, True])
def test_routed_product_trace_is_unchanged(product, server_provider, with_parent):
    headers = (
        {"traceparent": f"00-{REMOTE_TRACE}-{REMOTE_SPAN}-01"} if with_parent else {}
    )

    _invoke(_app(traced=False), **headers)
    off_tree, off_traces = _tree(product.get_finished_spans())
    product.clear()
    assert server_provider.get_finished_spans() == ()

    _invoke(_app(traced=True), **headers)
    on_tree, on_traces = _tree(product.get_finished_spans())

    assert on_tree == off_tree
    assert len(on_traces) == len(off_traces) == 1
    if with_parent:
        assert on_traces == {REMOTE_TRACE}
        assert ("wf", f"remote:{REMOTE_SPAN}") in on_tree

    (request,) = [
        span
        for span in server_provider.get_finished_spans()
        if span.kind == SpanKind.SERVER
    ]
    # the server span neither adopts the incoming product parent nor shares a trace
    assert request.parent is None
    assert f"{request.context.trace_id:032x}" not in on_traces
    assert server.is_server_span(request)


def test_health_is_not_traced(server_provider):
    app = FastAPI()

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    server.instrument_fastapi(app)
    assert TestClient(app).get("/health").status_code == 200
    assert server_provider.get_finished_spans() == ()


@pytest.mark.asyncio
async def test_httpx_carries_the_product_traceparent_only(product, server_provider):
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.update(request.headers)
        return httpx.Response(200)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    HTTPXClientInstrumentor.instrument_client(client, tracer_provider=server._provider)

    @ag.instrument(spankind="workflow")
    async def calls_services():
        await client.post("http://services/invoke", headers=inject({}))

    tracer = server.get_server_tracer("test")
    with tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        await calls_services()
    await client.aclose()

    (workflow,) = product.get_finished_spans()
    ids = f"{workflow.context.trace_id:032x}-{workflow.context.span_id:016x}"
    assert sent["traceparent"].startswith(f"00-{ids}-")

    spans = {span.kind: span for span in server_provider.get_finished_spans()}
    # the outgoing call is a server span under the request, not under the product span
    assert (
        spans[SpanKind.CLIENT].parent.span_id == spans[SpanKind.SERVER].context.span_id
    )


def test_fastapi_instrumentor_never_touches_the_global_provider(server_provider):
    from opentelemetry import trace

    before = trace.get_tracer_provider()
    app = FastAPI()
    server.instrument_fastapi(app)
    assert trace.get_tracer_provider() is before
    FastAPIInstrumentor.uninstrument_app(app)


def test_calls_inside_a_routed_workflow_join_the_request(product, server_provider):
    # The FastAPI instrumentation makes its request span current with use_span, not
    # through the server tracer. A call made inside the product workflow must still
    # parent on that request span, or the sampler drops it as a background root.
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.update(request.headers)
        return httpx.Response(200)

    app = FastAPI()
    app.add_middleware(OTelMiddleware)

    @app.middleware("http")
    async def _auth(request, call_next):
        request.state.auth = {}
        return await call_next(request)

    async def workflow(value: str = "x"):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        HTTPXClientInstrumentor.instrument_client(
            client, tracer_provider=server._provider
        )
        async with client:
            await client.post("http://llm/v1/chat", headers=inject({}))
        return value

    workflow.__name__ = f"wf_{uuid4().hex[:8]}"
    route("/", app=app)(workflow)
    server.instrument_fastapi(app)

    _invoke(TestClient(app))

    spans = server_provider.get_finished_spans()
    (request,) = [span for span in spans if span.kind == SpanKind.SERVER]
    (call,) = [span for span in spans if span.kind == SpanKind.CLIENT]
    assert call.parent is not None
    assert call.parent.span_id == request.context.span_id
    assert call.context.trace_id == request.context.trace_id

    (wf,) = product.get_finished_spans()
    ids = f"{wf.context.trace_id:032x}-{wf.context.span_id:016x}"
    assert sent["traceparent"].startswith(f"00-{ids}-")
