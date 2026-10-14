"""Server request tracing (agenta.sdk.engines.tracing.server).

The main contract: turning server tracing on must not change a product trace. Each
isolation test runs the same workflow with server tracing off and on and compares the
product span trees.
"""

import sys

import pytest
from opentelemetry import propagate, trace
from opentelemetry.context import attach, detach, get_current
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.sdk.trace.sampling import Decision
from opentelemetry.trace import SpanKind

import agenta as ag
from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.engines.tracing import server
from agenta.sdk.engines.tracing.propagation import extract, inject
from agenta.sdk.engines.tracing.tracing import Tracing


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture
def product():
    """Point ag.tracer / ag.tracing at an in-memory product provider."""
    saved = getattr(ag, "tracer", None), getattr(ag, "tracing", None)

    exporter = InMemorySpanExporter()
    tracing = Tracing(url="http://in-memory.invalid/otlp/v1/traces")
    tracing.redact = None
    tracing.redact_on_error = True
    provider = TracerProvider(resource=Resource({"service.name": "agenta-sdk"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracing.tracer_provider = provider
    tracing.tracer = provider.get_tracer("agenta.tracer")
    ag.tracing, ag.tracer = tracing, tracing.tracer

    try:
        yield exporter
    finally:
        ag.tracer, ag.tracing = saved


class _Server:
    """A server provider as setup_server_tracing builds it, exporting to memory."""

    def __init__(self, ratio: float = 1.0):
        self.exporter = InMemorySpanExporter()
        inner = TracerProvider(
            resource=Resource({"service.name": "agenta-api"}),
            sampler=server.ServerSampler(ratio),
        )
        inner.add_span_processor(SimpleSpanProcessor(self.exporter))
        self.provider = server._ServerTracerProvider(inner)
        self.tracer = self.provider.get_tracer("test")

    def spans(self):
        return list(self.exporter.get_finished_spans())


@pytest.fixture
def no_global_propagation():
    saved = propagate.get_global_textmap()
    server._disable_global_propagation()
    try:
        yield
    finally:
        propagate.set_global_textmap(saved)


# --------------------------------------------------------------------------- #
# Workflow under test
# --------------------------------------------------------------------------- #


@ag.instrument(spankind="task")
async def _step(value: str) -> str:
    return value.upper()


@ag.instrument(spankind="workflow")
async def _workflow(value: str) -> dict:
    headers = inject({})
    step = await _step(value)
    return {"step": step, "traceparent": headers.get("traceparent")}


def _tree(spans):
    """Each product span as (name, parent name or None), and the trace ids used."""
    by_id = {span.context.span_id: span for span in spans}
    tree = sorted(
        (
            span.name,
            by_id[span.parent.span_id].name
            if span.parent and span.parent.span_id in by_id
            else (None if span.parent is None else "<remote>"),
        )
        for span in spans
    )
    return tree, {span.context.trace_id for span in spans}


def _ids(span_context):
    return f"{span_context.trace_id:032x}", f"{span_context.span_id:016x}"


# --------------------------------------------------------------------------- #
# Isolation
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_product_trace_is_the_same_inside_a_server_request(
    product, no_global_propagation
):
    off = await _workflow("x")
    off_tree, off_traces = _tree(product.get_finished_spans())
    product.clear()

    srv = _Server()
    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        on = await _workflow("x")
    on_tree, on_traces = _tree(product.get_finished_spans())

    assert on_tree == off_tree == [("_step", "_workflow"), ("_workflow", None)]
    assert len(on_traces) == 1 and len(off_traces) == 1

    (request,) = srv.spans()
    assert request.context.trace_id not in on_traces
    assert on["step"] == off["step"] == "X"


@pytest.mark.asyncio
async def test_injected_traceparent_is_the_product_span(product, no_global_propagation):
    srv = _Server()
    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        result = await _workflow("x")

    workflow = next(s for s in product.get_finished_spans() if s.name == "_workflow")
    trace_id, span_id = _ids(workflow.context)
    assert result["traceparent"].startswith(f"00-{trace_id}-{span_id}-")


def test_inject_outside_a_product_span_sends_no_traceparent(
    product, no_global_propagation
):
    assert "traceparent" not in inject({})

    srv = _Server()
    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        headers = inject({})

    assert "traceparent" not in headers


@pytest.mark.asyncio
async def test_an_incoming_product_parent_is_kept(product, no_global_propagation):
    remote = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    _, parent, _ = extract({"traceparent": remote})

    srv = _Server()
    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        with tracing_context_manager(context=TracingContext(traceparent=parent)):
            await _workflow("x")

    workflow = next(s for s in product.get_finished_spans() if s.name == "_workflow")
    assert f"{workflow.context.trace_id:032x}" == "0af7651916cd43dd8448eb211c80319c"
    assert f"{workflow.parent.span_id:016x}" == "b7ad6b7169203331"


def test_current_span_helpers_skip_server_spans(product):
    srv = _Server()
    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        assert not ag.tracing.get_current_span().is_recording()
        assert ag.tracing.get_current_span_context() is None


@pytest.mark.asyncio
async def test_server_spans_under_a_product_span_join_the_request(product):
    srv = _Server()
    seen = {}

    @ag.instrument(spankind="workflow")
    async def calls_out():
        with srv.tracer.start_as_current_span("GET", kind=SpanKind.CLIENT):
            seen["client"] = True

    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        await calls_out()

    spans = {span.name: span for span in srv.spans()}
    request, client = spans["POST /invoke"], spans["GET"]
    assert client.context.trace_id == request.context.trace_id
    assert client.parent.span_id == request.context.span_id
    assert all(s.name != "GET" for s in product.get_finished_spans())


def test_global_propagation_is_off(no_global_propagation):
    srv = _Server()
    carrier = {}
    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        propagate.inject(carrier)

    assert carrier == {}


def test_product_context_restores_the_displaced_product_span(product):
    srv = _Server()
    with ag.tracer.start_as_current_span("workflow") as workflow:
        with srv.tracer.start_as_current_span("GET", kind=SpanKind.CLIENT):
            assert server.current_product_span() is workflow

    token = attach(trace.set_span_in_context(trace.INVALID_SPAN))
    try:
        assert not server.current_product_span().get_span_context().is_valid
    finally:
        detach(token)


def test_product_parent_survives_a_plain_attach(product, no_global_propagation):
    # aiohttp starts its span with start_span and makes it current with a plain attach,
    # not through attach_server_span, so the product span is found on the span itself.
    srv = _Server()
    with ag.tracer.start_as_current_span("workflow") as workflow:
        client = srv.tracer.start_span("GET", kind=SpanKind.CLIENT)
        token = attach(trace.set_span_in_context(client))
        try:
            assert server.current_product_span() is workflow
            ids = f"{workflow.get_span_context().trace_id:032x}"
            assert inject({})["traceparent"].startswith(f"00-{ids}-")
        finally:
            detach(token)
            client.end()


def test_server_spans_do_not_replace_the_last_ended_product_span(product):
    from agenta.sdk.engines.tracing.processors import (
        EndedSpanRecorder,
        _get_last_ended,
    )

    recorder = EndedSpanRecorder()
    srv = _Server()
    srv.provider.provider.add_span_processor(recorder)
    product_provider = ag.tracing.tracer_provider
    product_provider.add_span_processor(recorder)

    with ag.tracer.start_as_current_span("workflow") as workflow:
        pass
    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        pass

    assert _get_last_ended() == workflow.get_span_context()


# --------------------------------------------------------------------------- #
# Sampling
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "value,ratio",
    [(None, 0.1), ("", 0.1), ("0.2", 0.2), ("1", 1.0), ("0", 0.0), (0.5, 0.5)],
)
def test_sample_ratio_parsing(value, ratio):
    assert server.parse_sample_ratio(value) == ratio


@pytest.mark.parametrize("value", ["abc", "1.5", "-0.1"])
def test_sample_ratio_rejects_bad_values(value):
    with pytest.raises(ValueError, match="AGENTA_SERVER_TRACING_SAMPLE_RATIO"):
        server.parse_sample_ratio(value)


def _sample(ratio, kind, parent=None):
    return server.ServerSampler(ratio).should_sample(parent, 1 << 64, "span", kind)


def test_sampler_follows_the_ratio_for_requests():
    assert _sample(1.0, SpanKind.SERVER).decision == Decision.RECORD_AND_SAMPLE
    assert _sample(1.0, SpanKind.CONSUMER).decision == Decision.RECORD_AND_SAMPLE
    assert _sample(0.0, SpanKind.SERVER).decision == Decision.DROP


def test_sampler_drops_background_roots():
    assert _sample(1.0, SpanKind.CLIENT).decision == Decision.DROP
    assert _sample(1.0, SpanKind.INTERNAL).decision == Decision.DROP


def test_sampler_follows_the_parent():
    srv = _Server(ratio=1.0)
    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER):
        child = server.ServerSampler(0.0).should_sample(
            get_current(), 1 << 64, "GET", SpanKind.CLIENT
        )
    assert child.decision == Decision.RECORD_AND_SAMPLE


def test_every_server_span_is_marked():
    for result in (_sample(1.0, SpanKind.SERVER), _sample(1.0, SpanKind.CLIENT)):
        assert result.trace_state.get(server.SERVER_TRACESTATE_KEY) == "1"

    srv = _Server(ratio=0.0)
    with srv.tracer.start_as_current_span("POST /invoke", kind=SpanKind.SERVER) as s:
        assert not s.is_recording()
        assert server.is_server_span(s)


# --------------------------------------------------------------------------- #
# Redaction
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "url,expected",
    [
        (
            "https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage",
            "https://api.telegram.org/botREDACTED/sendMessage",
        ),
        (
            "https://api.telegram.org/file/bot123456789:AAHdqTcvCH1vGWJxfSe/photos/a.jpg",
            "https://api.telegram.org/file/botREDACTED/photos/a.jpg",
        ),
        (
            "https://user:pass@example.com:8443/v1/chat?api_key=secret#frag",
            "https://example.com:8443/v1/chat",
        ),
        (
            "https://hooks.example.com/services/T000/B000/Xk3PqLm9ZrT2vWn8YbC4dHs1",
            "https://hooks.example.com/services/T000/B000/REDACTED",
        ),
        (
            "http://api:8000/workflows/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/invoke",
            "http://api:8000/workflows/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/invoke",
        ),
        ("/v1/messages?key=secret", "/v1/messages"),
    ],
)
def test_redact_url(url, expected):
    assert server.redact_url(url) == expected


def test_redact_text_finds_urls_and_tokens():
    text = (
        "Client error '401' for url "
        "'https://api.telegram.org/bot123:AAHdqTcvCH1vGWJ/getMe?x=1' (bot9:abcDEF)"
    )
    assert server.redact_text(text) == (
        "Client error '401' for url "
        "'https://api.telegram.org/botREDACTED/getMe' (botREDACTED)"
    )


def test_exported_spans_are_redacted():
    memory = InMemorySpanExporter()
    inner = TracerProvider(sampler=server.ServerSampler(1.0))
    inner.add_span_processor(SimpleSpanProcessor(server.RedactingSpanExporter(memory)))
    tracer = server._ServerTracerProvider(inner).get_tracer("test")

    url = "https://api.telegram.org/bot123:AAHdqTcvCH1vGWJxfSe/sendMessage?chat=1"
    with tracer.start_as_current_span(
        "POST",
        kind=SpanKind.SERVER,
        attributes={
            "http.url": url,
            "http.target": "/bot123:AAHdqTcvCH1vGWJxfSe/sendMessage?chat=1",
            "url.query": "token=secret",
            "http.status_code": 401,
            "urls": ["https://user:pass@example.com/v1?token=secret", url],
        },
    ) as span:
        span.add_event("retry", {"reason": f"failed for url {url}"})

    (exported,) = memory.get_finished_spans()
    assert exported.attributes["http.url"] == (
        "https://api.telegram.org/botREDACTED/sendMessage"
    )
    assert exported.attributes["http.target"] == "/botREDACTED/sendMessage"
    assert exported.attributes["url.query"] == server.REDACTED
    assert exported.attributes["http.status_code"] == 401
    assert exported.attributes["urls"] == (
        "https://example.com/v1",
        "https://api.telegram.org/botREDACTED/sendMessage",
    )
    assert exported.events[0].attributes["reason"] == (
        "failed for url https://api.telegram.org/botREDACTED/sendMessage"
    )


def test_exceptions_keep_the_type_and_frames_only():
    memory = InMemorySpanExporter()
    inner = TracerProvider(sampler=server.ServerSampler(1.0))
    inner.add_span_processor(SimpleSpanProcessor(server.RedactingSpanExporter(memory)))
    tracer = server._ServerTracerProvider(inner).get_tracer("test")

    email = "a" + "@b.c"  # not in the source lines the frames keep

    def query():
        raise ValueError(
            f"duplicate key\nDETAIL:  Key (email)=({email}) already exists.\n"
            f"[parameters: ('{email}', 'pw')]"
        )

    with pytest.raises(RuntimeError):
        with tracer.start_as_current_span("POST /users", kind=SpanKind.SERVER):
            try:
                query()
            except ValueError as error:
                raise RuntimeError(f"insert failed for {email}") from error

    (exported,) = memory.get_finished_spans()
    assert exported.status.description is None
    (event,) = exported.events
    assert event.attributes["exception.type"] == "RuntimeError"
    assert "exception.message" not in event.attributes
    stacktrace = event.attributes["exception.stacktrace"]
    assert "in query" in stacktrace
    assert "raise ValueError(" not in stacktrace  # source lines are dropped too
    for secret in (email, "'pw'", "DETAIL:", "[parameters:", "RuntimeError: "):
        assert secret not in stacktrace


# --------------------------------------------------------------------------- #
# Setup
# --------------------------------------------------------------------------- #


@pytest.fixture
def reset_server(monkeypatch):
    monkeypatch.setattr(server, "_provider", None)
    saved = propagate.get_global_textmap()
    try:
        yield
    finally:
        propagate.set_global_textmap(saved)


@pytest.mark.parametrize("endpoint", [None, ""])
def test_setup_is_off_without_an_endpoint(reset_server, endpoint):
    textmap = propagate.get_global_textmap()
    modules = set(sys.modules)

    assert not server.setup_server_tracing(service_name="agenta-api", endpoint=endpoint)

    assert server._provider is None
    assert server.get_server_tracer("x") is None
    assert propagate.get_global_textmap() is textmap
    assert set(sys.modules) == modules


def test_setup_with_an_endpoint(reset_server, monkeypatch):
    instrumented = []
    monkeypatch.setattr(server, "_instrument_libraries", instrumented.append)
    global_provider = trace.get_tracer_provider()

    assert server.setup_server_tracing(
        service_name="agenta-api",
        endpoint="http://collector:4318/",
        sample_ratio="0.2",
    )

    provider = server._provider.provider
    assert provider.resource.attributes["service.name"] == "agenta-api"
    assert provider.sampler.get_description() == "AgentaServerSampler{0.2}"
    assert instrumented == [server._provider]
    # never the global provider: that one belongs to product tracing
    assert trace.get_tracer_provider() is global_provider
    assert server.get_server_tracer("x") is not None

    carrier = {}
    propagate.inject(carrier)
    assert carrier == {}

    provider.shutdown()


def test_setup_rejects_a_bad_ratio(reset_server, monkeypatch):
    monkeypatch.setattr(server, "_instrument_libraries", lambda provider: None)

    with pytest.raises(ValueError):
        server.setup_server_tracing(
            service_name="agenta-api", endpoint="http://c:4318", sample_ratio="2"
        )


@pytest.mark.parametrize(
    "endpoint,url",
    [
        ("http://collector:4318", "http://collector:4318/v1/traces"),
        ("http://collector:4318/", "http://collector:4318/v1/traces"),
        ("http://collector:4318/v1/traces", "http://collector:4318/v1/traces"),
    ],
)
def test_traces_url(endpoint, url):
    assert server._traces_url(endpoint) == url


def test_service_name_can_be_overridden(monkeypatch):
    monkeypatch.setenv("OTEL_SERVICE_NAME", "custom")
    srv = server.build_tracer_provider(
        service_name="agenta-api", sample_ratio=1.0, exporter=InMemorySpanExporter()
    )
    assert srv.provider.resource.attributes["service.name"] == "custom"
    srv.shutdown()


def test_long_attributes_are_capped():
    memory = InMemorySpanExporter()
    srv = server.build_tracer_provider(
        service_name="agenta-api", sample_ratio=1.0, exporter=memory
    )
    statement = "INSERT INTO spans VALUES " + ", ".join(["($1, $2)"] * 2000)
    with srv.get_tracer("test").start_as_current_span(
        "POST /otlp", kind=SpanKind.SERVER, attributes={"db.statement": statement}
    ):
        pass
    srv.force_flush()
    (span,) = memory.get_finished_spans()
    assert len(span.attributes["db.statement"]) == server.MAX_ATTRIBUTE_LENGTH
    srv.shutdown()


def test_a_traceback_shaped_message_does_not_pass_the_filter():
    forged = (
        "Traceback (most recent call last):\n"
        '  File "/app/x.py", line 1, in run\n'
        "    query()\n"
        "ValueError: boom\n"
        '  File "/app/x.py", line 2, in run\n'
        "    secret-token-1234\n"
        "  [parameters: ('a@b.c',)]\n"
    )
    kept = server.redact_stacktrace(forged)
    assert kept.splitlines() == [
        '  File "/app/x.py", line 1, in run',
        '  File "/app/x.py", line 2, in run',
    ]


def test_captured_headers_are_dropped():
    memory = InMemorySpanExporter()
    inner = TracerProvider(sampler=server.ServerSampler(1.0))
    inner.add_span_processor(SimpleSpanProcessor(server.RedactingSpanExporter(memory)))
    tracer = server._ServerTracerProvider(inner).get_tracer("test")
    with tracer.start_as_current_span(
        "GET",
        kind=SpanKind.SERVER,
        attributes={
            "http.request.header.authorization": ("ApiKey secret",),
            "http.response.header.set_cookie": ("session=secret",),
            "http.method": "GET",
        },
    ):
        pass
    (span,) = memory.get_finished_spans()
    assert dict(span.attributes) == {"http.method": "GET"}


# --------------------------------------------------------------------------- #
# Span names for mounted sub-apps
# --------------------------------------------------------------------------- #


def _mounted_app(provider):
    pytest.importorskip("opentelemetry.instrumentation.fastapi")
    from fastapi import FastAPI

    from agenta.sdk.engines.tracing.server import RouteSpanNameMiddleware

    sub = FastAPI()
    sub.add_middleware(RouteSpanNameMiddleware)

    @sub.post("/invoke")
    async def invoke():
        return {}

    @sub.get("/items/{item_id}")
    async def item(item_id: str):
        return {}

    app = FastAPI()
    app.mount("/chat/v0", sub)
    app.mount("/orgs/{org_id}", sub)
    app.mount("/", sub)

    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(
        app, tracer_provider=provider, exclude_spans=["receive", "send"]
    )
    return app


def test_mounted_sub_app_span_is_named_by_route_template(no_global_propagation):
    from starlette.testclient import TestClient

    srv = _Server()
    client = TestClient(_mounted_app(srv.provider))

    client.post("/invoke")
    client.post("/chat/v0/invoke")
    client.get("/items/6f1c2f1e-secret-id")
    client.post("/orgs/42/invoke")
    client.post("/chat/v0/unknown")

    names = sorted(span.name for span in srv.spans())
    assert names == [
        "GET /items/{item_id}",
        "POST /chat/v0",
        "POST /chat/v0/invoke",
        "POST /invoke",
        "POST /orgs/{org_id}/invoke",
    ]
