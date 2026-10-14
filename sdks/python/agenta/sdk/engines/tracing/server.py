"""Server request tracing: spans that describe the Agenta servers, not the product.

`ag.init()` owns the global tracer provider and exports product traces to Agenta. Server
tracing runs beside it and never touches it:

- It has its own `TracerProvider`. Every instrumentor gets it through `tracer_provider=`,
  and `set_tracer_provider` is never called.
- Server spans and product spans share the one OpenTelemetry context, so each side looks
  past the other's spans. Server spans carry a tracestate marker. `product_context()`
  skips them when the SDK picks a parent, and server spans started under a product span
  attach to the last server span instead.
- The global propagator becomes a no-op, so instrumented clients do not send `traceparent`
  (the SDK sends the product one itself) and servers do not adopt an incoming one.

It is off unless an endpoint is given: nothing is created and no instrumentation is
imported.
"""

import os
import re
from contextlib import contextmanager
from importlib import import_module
from importlib.util import find_spec
from typing import Any, Iterator, Optional, Sequence
from urllib.parse import urlsplit, urlunsplit

from opentelemetry import trace
from opentelemetry.context import (
    Context,
    attach,
    create_key,
    detach,
    get_current,
    get_value,
    set_value,
)
from opentelemetry.propagate import set_global_textmap
from opentelemetry.propagators.textmap import TextMapPropagator
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import Event, ReadableSpan, SpanLimits, TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    SpanExporter,
    SpanExportResult,
)
from opentelemetry.sdk.trace.sampling import (
    Decision,
    ParentBased,
    Sampler,
    SamplingResult,
    TraceIdRatioBased,
)
from opentelemetry.trace import INVALID_SPAN, SpanKind, Status, TraceState

from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Marks a span as a server span, recording or not.
SERVER_TRACESTATE_KEY = "agenta-server"

DEFAULT_SAMPLE_RATIO = 0.1

MAX_ATTRIBUTE_LENGTH = 4096

_SERVER_SPAN = create_key("agenta-server-span")
_PRODUCT_SPAN = create_key("agenta-product-span")

_provider: Optional["_ServerTracerProvider"] = None


# --------------------------------------------------------------------------- #
# Isolation
# --------------------------------------------------------------------------- #


def is_server_span(span: Any) -> bool:
    try:
        state = span.get_span_context().trace_state
    except Exception:  # pylint: disable=broad-except
        return False
    return state is not None and SERVER_TRACESTATE_KEY in state


def product_context(context: Optional[Context] = None) -> Context:
    """The context with server spans hidden, for the SDK to parent and propagate from."""
    context = context if context is not None else get_current()
    span = trace.get_current_span(context)
    if not is_server_span(span):
        return context
    return trace.set_span_in_context(
        get_value(_PRODUCT_SPAN, context) or INVALID_SPAN, context
    )


def current_product_span(context: Optional[Context] = None) -> trace.Span:
    return trace.get_current_span(product_context(context))


def _server_context(context: Optional[Context] = None) -> Context:
    """The context with product spans hidden, for server spans to parent from."""
    context = context if context is not None else get_current()
    span = trace.get_current_span(context)
    if not span.get_span_context().is_valid or is_server_span(span):
        return context
    return trace.set_span_in_context(
        get_value(_SERVER_SPAN, context) or INVALID_SPAN, context
    )


def attach_server_span(span: trace.Span) -> object:
    """Make `span` current and the parent of later server spans. Pass the token to detach."""
    context = set_value(_SERVER_SPAN, span, trace.set_span_in_context(span))
    displaced = trace.get_current_span()
    if displaced.get_span_context().is_valid and not is_server_span(displaced):
        context = set_value(_PRODUCT_SPAN, displaced, context)
    return attach(context)


def detach_server_span(token: object) -> None:
    detach(token)


# --------------------------------------------------------------------------- #
# Sampling
# --------------------------------------------------------------------------- #


def parse_sample_ratio(value: Optional[Any]) -> float:
    if value is None or (isinstance(value, str) and not value.strip()):
        return DEFAULT_SAMPLE_RATIO
    try:
        ratio = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(
            f"AGENTA_SERVER_TRACING_SAMPLE_RATIO must be a number from 0 to 1, got {value!r}"
        ) from error
    if not 0.0 <= ratio <= 1.0:
        raise ValueError(
            f"AGENTA_SERVER_TRACING_SAMPLE_RATIO must be from 0 to 1, got {ratio}"
        )
    return ratio


class ServerSampler(Sampler):
    """Parent-based ratio sampling, where only a request or a task run starts a trace.

    A root span of another kind (a Redis poll in a worker loop, a call made at startup)
    is dropped, so background traffic does not fill the trace backend.
    """

    _ENTRY_KINDS = (SpanKind.SERVER, SpanKind.CONSUMER)

    def __init__(self, ratio: float):
        self._ratio = ratio
        self._sampler = ParentBased(TraceIdRatioBased(ratio))

    def should_sample(
        self,
        parent_context: Optional[Context],
        trace_id: int,
        name: str,
        kind: Optional[SpanKind] = None,
        attributes: Any = None,
        links: Optional[Sequence[trace.Link]] = None,
        trace_state: Optional[TraceState] = None,
    ) -> SamplingResult:
        parent = trace.get_current_span(parent_context).get_span_context()
        if not parent.is_valid and kind not in self._ENTRY_KINDS:
            result = SamplingResult(Decision.DROP)
        else:
            result = self._sampler.should_sample(
                parent_context, trace_id, name, kind, attributes, links, trace_state
            )

        state = result.trace_state or TraceState()
        if SERVER_TRACESTATE_KEY not in state:
            state = state.add(SERVER_TRACESTATE_KEY, "1")
        return SamplingResult(result.decision, result.attributes, state)

    def get_description(self) -> str:
        return f"AgentaServerSampler{{{self._ratio}}}"


# --------------------------------------------------------------------------- #
# Tracer
# --------------------------------------------------------------------------- #


class _ServerTracer(trace.Tracer):
    """Parents every span on the last server span, never on a product span."""

    def __init__(self, tracer: trace.Tracer):
        self._tracer = tracer

    def start_span(self, name, context=None, *args, **kwargs) -> trace.Span:
        return self._tracer.start_span(name, _server_context(context), *args, **kwargs)

    @contextmanager
    def start_as_current_span(
        self,
        name,
        context=None,
        kind=SpanKind.INTERNAL,
        attributes=None,
        links=None,
        start_time=None,
        record_exception=True,
        set_status_on_exception=True,
        end_on_exit=True,
    ) -> Iterator[trace.Span]:
        span = self.start_span(
            name,
            context,
            kind,
            attributes,
            links,
            start_time,
            record_exception,
            set_status_on_exception,
        )
        token = attach_server_span(span)
        try:
            with trace.use_span(
                span,
                end_on_exit=end_on_exit,
                record_exception=record_exception,
                set_status_on_exception=set_status_on_exception,
            ) as current:
                yield current
        finally:
            detach_server_span(token)


class _ServerTracerProvider(trace.TracerProvider):
    def __init__(self, provider: TracerProvider):
        self.provider = provider

    def get_tracer(self, *args, **kwargs) -> trace.Tracer:
        return _ServerTracer(self.provider.get_tracer(*args, **kwargs))

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return self.provider.force_flush(timeout_millis)

    def shutdown(self) -> None:
        self.provider.shutdown()


# --------------------------------------------------------------------------- #
# Redaction
# --------------------------------------------------------------------------- #

REDACTED = "REDACTED"

# Telegram puts the bot token in the path: /bot<id>:<secret>/<method>
_TELEGRAM_TOKEN = re.compile(r"bot\d+:[A-Za-z0-9_-]+")
_URL = re.compile(r"https?://[^\s'\"<>]+")
_URL_KEYS = ("http.url", "url.full", "http.target", "url.path")
_QUERY_KEYS = ("url.query",)


def _secret_segment(segment: str) -> bool:
    # long mixed-case tokens (webhook secrets, keys); ids and model names are lowercase
    return (
        len(segment) >= 20
        and any(c.isupper() for c in segment)
        and any(c.islower() for c in segment)
        and any(c.isdigit() for c in segment)
    )


def redact_path(path: str) -> str:
    path = _TELEGRAM_TOKEN.sub(f"bot{REDACTED}", path)
    return "/".join(
        REDACTED if _secret_segment(segment) else segment for segment in path.split("/")
    )


def redact_url(url: str) -> str:
    """Drop credentials, the query and the fragment, and hide secret path segments."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return REDACTED
    netloc = parts.hostname or ""
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    return urlunsplit((parts.scheme, netloc, redact_path(parts.path), "", ""))


def redact_text(text: str) -> str:
    text = _URL.sub(lambda match: redact_url(match.group(0)), text)
    return _TELEGRAM_TOKEN.sub(f"bot{REDACTED}", text)


def _redact_value(key: str, value: str) -> str:
    return redact_url(value) if key in _URL_KEYS else redact_text(value)


def _redact_attributes(attributes: Any) -> dict:
    redacted = {}
    for key, value in (attributes or {}).items():
        if key in _QUERY_KEYS:
            value = REDACTED
        elif isinstance(value, str):
            value = _redact_value(key, value)
        elif isinstance(value, (list, tuple)):
            value = tuple(
                _redact_value(key, item) if isinstance(item, str) else item
                for item in value
            )
        redacted[key] = value
    return redacted


# A traceback line that names a frame. The lines after it are the source of that frame.
_FRAME = re.compile(r'^\s*File "')


def redact_stacktrace(stacktrace: str) -> str:
    """Keep the frames of a traceback and drop its exception messages.

    An exception message can carry data, e.g. SQLAlchemy puts the statement parameters in
    it. The frames and their source lines carry code only.
    """
    kept = []
    in_frame = False
    for line in stacktrace.splitlines():
        if line.startswith("Traceback") or _FRAME.match(line):
            kept.append(line)
            in_frame = _FRAME.match(line) is not None
        elif in_frame and line.startswith("    "):
            kept.append(line)
        else:
            in_frame = False
    return "\n".join(kept)


def _redact_event(event: Event) -> Event:
    attributes = _redact_attributes(event.attributes)
    if event.name == "exception":
        # the type only: the message can carry data (SQL parameters, request values)
        attributes.pop("exception.message", None)
        stacktrace = attributes.get("exception.stacktrace")
        if isinstance(stacktrace, str):
            attributes["exception.stacktrace"] = redact_stacktrace(stacktrace)
    return Event(event.name, attributes, event.timestamp)


def redact_span(span: ReadableSpan) -> ReadableSpan:
    status = span.status
    if status.description:
        # instrumentations put the exception message here, so drop it like above
        status = Status(status.status_code)
    return ReadableSpan(
        name=span.name,
        context=span.context,
        parent=span.parent,
        resource=span.resource,
        attributes=_redact_attributes(span.attributes),
        events=[_redact_event(event) for event in span.events],
        links=span.links,
        kind=span.kind,
        status=status,
        start_time=span.start_time,
        end_time=span.end_time,
        instrumentation_scope=span.instrumentation_scope,
    )


class RedactingSpanExporter(SpanExporter):
    """Redacts every span before it leaves the process, whatever produced it."""

    def __init__(self, exporter: SpanExporter):
        self._exporter = exporter

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        return self._exporter.export([redact_span(span) for span in spans])

    def shutdown(self) -> None:
        self._exporter.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return self._exporter.force_flush(timeout_millis)


# --------------------------------------------------------------------------- #
# Setup
# --------------------------------------------------------------------------- #


def _traces_url(endpoint: str) -> str:
    endpoint = endpoint.rstrip("/")
    if endpoint.endswith("/v1/traces"):
        return endpoint
    return f"{endpoint}/v1/traces"


def build_tracer_provider(
    *,
    service_name: str,
    sample_ratio: float,
    exporter: SpanExporter,
) -> _ServerTracerProvider:
    # The standard OTEL_SERVICE_NAME may rename the process. The SDK builds its own
    # Resource without reading it, so product spans keep their name.
    provider = TracerProvider(
        resource=Resource.create(
            {"service.name": os.environ.get("OTEL_SERVICE_NAME") or service_name}
        ),
        sampler=ServerSampler(sample_ratio),
        # a bulk insert's statement lists every row's placeholders, so cap its size
        span_limits=SpanLimits(max_span_attribute_length=MAX_ATTRIBUTE_LENGTH),
    )
    provider.add_span_processor(BatchSpanProcessor(RedactingSpanExporter(exporter)))
    return _ServerTracerProvider(provider)


class _NoPropagation(TextMapPropagator):
    """Reads and writes no headers. Extract still returns a Context, never None."""

    def extract(self, carrier, context=None, getter=None) -> Context:
        return context if context is not None else Context()

    def inject(self, carrier, context=None, setter=None) -> None:
        return None

    @property
    def fields(self) -> set:
        return set()


def _disable_global_propagation() -> None:
    set_global_textmap(_NoPropagation())


def _instrument_libraries(provider: _ServerTracerProvider) -> None:
    instrumentors = (
        ("httpx", "opentelemetry.instrumentation.httpx", "HTTPXClientInstrumentor"),
        (
            "aiohttp",
            "opentelemetry.instrumentation.aiohttp_client",
            "AioHttpClientInstrumentor",
        ),
        ("redis", "opentelemetry.instrumentation.redis", "RedisInstrumentor"),
    )
    for library, module_name, class_name in instrumentors:
        if find_spec(library) is None or find_spec(module_name) is None:
            continue  # not installed in this image
        instrumentor = getattr(import_module(module_name), class_name)
        instrumentor().instrument(tracer_provider=provider)


def setup_server_tracing(
    *,
    service_name: str,
    endpoint: Optional[str],
    sample_ratio: Optional[Any] = None,
) -> bool:
    """Start server tracing for this process. Returns whether it is on."""
    global _provider  # pylint: disable=global-statement

    if _provider is not None:
        return True
    if not endpoint:
        return False

    from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
        OTLPSpanExporter,
    )

    _provider = build_tracer_provider(
        service_name=service_name,
        sample_ratio=parse_sample_ratio(sample_ratio),
        exporter=OTLPSpanExporter(endpoint=_traces_url(endpoint)),
    )
    _disable_global_propagation()
    _instrument_libraries(_provider)

    log.info(
        "Server tracing is on",
        service_name=service_name,
        endpoint=_traces_url(endpoint),
    )
    return True


def get_server_tracer(name: str) -> Optional[trace.Tracer]:
    return _provider.get_tracer(name) if _provider is not None else None


class _RequestSpanMiddleware:
    """Makes the request span the parent of the request's later server spans.

    The FastAPI instrumentation makes its request span current with `use_span`, not through
    the server tracer. Without this, a call made while a product span is current finds no
    server parent, and the sampler drops it as a background root.
    """

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        span = trace.get_current_span()
        if not is_server_span(span):
            await self.app(scope, receive, send)
            return
        token = attach(set_value(_SERVER_SPAN, span))
        try:
            await self.app(scope, receive, send)
        finally:
            detach(token)


def instrument_fastapi(app: Any) -> None:
    if _provider is None:
        return
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    # runs inside the instrumentation's middleware, so the request span is current
    app.add_middleware(_RequestSpanMiddleware)
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=_provider,
        excluded_urls=r"/health/?$",
        exclude_spans=["receive", "send"],
    )


def instrument_sqlalchemy(engine: Any) -> None:
    """Trace the statements of one SQLAlchemy engine (sync or async)."""
    if _provider is None:
        return
    from opentelemetry.instrumentation.sqlalchemy.engine import EngineTracer
    from opentelemetry.metrics import NoOpMeterProvider

    scope = "opentelemetry.instrumentation.sqlalchemy"
    usage = (
        NoOpMeterProvider()
        .get_meter(scope)
        .create_up_down_counter("db.client.connections.usage")
    )
    EngineTracer(
        _provider.get_tracer(scope),
        getattr(engine, "sync_engine", engine),
        usage,
    )
