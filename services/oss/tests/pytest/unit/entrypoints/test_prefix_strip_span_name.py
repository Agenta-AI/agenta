"""The request span must be named by the route when the `/services` prefix is still on.

A managed ingress (GKE) forwards `/services/...` verbatim. The FastAPI instrumentation
names the request span from the path it sees, and it wraps the whole middleware stack, so
a strip added with `add_middleware` runs too late: the span matched no route and was named
by the method alone ("POST").
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

pytest.importorskip("opentelemetry.instrumentation.fastapi")

from opentelemetry import propagate  # noqa: E402
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # noqa: E402
from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # noqa: E402
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (  # noqa: E402
    InMemorySpanExporter,
)

from agenta.sdk.engines.tracing import server  # noqa: E402
from agenta.sdk.engines.tracing.server import RouteSpanNameMiddleware  # noqa: E402
from entrypoints.prefix import strip_prefix_outermost  # noqa: E402


@pytest.fixture(autouse=True)
def _no_prefix_env(monkeypatch):
    monkeypatch.delenv("AGENTA_SERVICES_PATH_PREFIX", raising=False)


@pytest.fixture(autouse=True)
def _no_global_propagation():
    saved = propagate.get_global_textmap()
    server._disable_global_propagation()
    try:
        yield
    finally:
        propagate.set_global_textmap(saved)


def _client(memory: InMemorySpanExporter) -> TestClient:
    # the shape of entrypoints/main.py: sub-apps mounted per service, then the dispatch app
    agent = FastAPI()
    agent.add_middleware(RouteSpanNameMiddleware)

    @agent.post("/runtime/status")
    async def status():
        return {}

    app = FastAPI()
    app.mount("/agent/v0", agent)

    # a server provider as setup_server_tracing builds it, so the span counts as a server span
    inner = TracerProvider(sampler=server.ServerSampler(1.0))
    inner.add_span_processor(SimpleSpanProcessor(memory))
    provider = server._ServerTracerProvider(inner)
    FastAPIInstrumentor.instrument_app(
        app, tracer_provider=provider, exclude_spans=["receive", "send"]
    )
    strip_prefix_outermost(app)
    return TestClient(app)


@pytest.mark.parametrize(
    "path",
    ["/agent/v0/runtime/status", "/services/agent/v0/runtime/status"],
)
def test_span_is_named_by_route_with_and_without_prefix(path):
    memory = InMemorySpanExporter()
    response = _client(memory).post(path)

    assert response.status_code == 200
    names = [span.name for span in memory.get_finished_spans()]
    assert names == ["POST /agent/v0/runtime/status"]


def test_unmatched_route_under_prefix_keeps_the_mount_name():
    memory = InMemorySpanExporter()
    response = _client(memory).post("/services/agent/v0/unknown")

    assert response.status_code == 404
    names = [span.name for span in memory.get_finished_spans()]
    assert names == ["POST /agent/v0"]
