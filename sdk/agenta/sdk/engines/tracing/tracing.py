from typing import Optional, Any, Dict, Callable
from enum import Enum

from pydantic import BaseModel


from opentelemetry.trace import (
    get_current_span,
    set_tracer_provider,
    get_tracer_provider,
    Status,
    StatusCode,
)
from opentelemetry.sdk import trace
from opentelemetry.sdk.trace import Span, Tracer, TracerProvider
from opentelemetry.sdk.resources import Resource


from agenta.sdk.utils.singleton import Singleton
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.engines.tracing.processors import (
    TraceProcessor,
    EndedSpanRecorder,
    _get_last_ended,
)
from agenta.sdk.engines.tracing.exporters import InlineExporter, OTLPExporter
from agenta.sdk.engines.tracing.spans import CustomSpan
from agenta.sdk.engines.tracing.inline import parse_inline_trace
from agenta.sdk.engines.tracing.conventions import Reference, is_valid_attribute_key
from agenta.sdk.engines.tracing.propagation import extract, inject
from agenta.sdk.utils.cache import TTLLRUCache


log = get_module_logger(__name__)


_original_init = trace.TracerProvider.__init__


def patched_init(self, *args, **kwargs):
    _original_init(self, *args, **kwargs)
    self.add_span_processor(EndedSpanRecorder())


trace.TracerProvider.__init__ = patched_init


class Link(BaseModel):
    trace_id: str
    span_id: str


class Tracing(metaclass=Singleton):
    Status = Status
    StatusCode = StatusCode

    def __init__(
        self,
        url: str,
        redact: Optional[Callable[..., Any]] = None,
        redact_on_error: Optional[bool] = True,
    ) -> None:
        # ENDPOINT (OTLP)
        self.otlp_url = url
        # HEADERS (OTLP)
        self.headers: Dict[str, str] = dict()
        # REFERENCES
        self.references: Dict[str, str] = dict()
        # CREDENTIALS
        self.credentials: TTLLRUCache = TTLLRUCache(ttl=(60 * 60))  # 1 hour x 512 keys

        # TRACER PROVIDER
        self.tracer_provider: Optional[TracerProvider] = None
        # TRACE PROCESSORS -- INLINE
        self.inline: Optional[TraceProcessor] = None
        # TRACER
        self.tracer: Optional[Tracer] = None
        # INLINE SPANS for INLINE TRACES (INLINE PROCESSOR)
        self.inline_spans: Dict[str, Any] = dict()

        # REDACT
        self.redact = redact
        self.redact_on_error = redact_on_error

    # PUBLIC

    def configure(
        self,
        api_key: Optional[str] = None,
        inline: Optional[bool] = True,
    ):
        # HEADERS (OTLP)
        if api_key:
            self.headers["Authorization"] = f"ApiKey {api_key}"

        # TRACER PROVIDER
        self.tracer_provider = TracerProvider(
            resource=Resource(attributes={"service.name": "agenta-sdk"})
        )

        # --- INLINE
        if inline:
            # TRACE PROCESSORS -- INLINE
            self.inline = TraceProcessor(
                InlineExporter(
                    registry=self.inline_spans,
                ),
                references=self.references,
                inline=inline,
            )
            self.tracer_provider.add_span_processor(self.inline)
        # --- INLINE

        # TRACE PROCESSORS -- OTLP
        try:
            log.info("Agenta - OLTP URL: %s", self.otlp_url)

            _otlp = TraceProcessor(
                OTLPExporter(
                    endpoint=self.otlp_url,
                    headers=self.headers,
                    credentials=self.credentials,
                ),
                references=self.references,
            )

            self.tracer_provider.add_span_processor(_otlp)
        except:  # pylint: disable=bare-except
            log.warning("Agenta - OLTP unreachable, skipping exports.")

        # GLOBAL TRACER PROVIDER -- INSTRUMENTATION LIBRARIES
        set_tracer_provider(self.tracer_provider)
        # TRACER
        self.tracer: Tracer = self.tracer_provider.get_tracer("agenta.tracer")

    def get_current_span(self):
        _span = None

        with suppress():
            _span = get_current_span()

            if _span.is_recording():
                return CustomSpan(_span)

        return _span

    def store_internals(
        self,
        attributes: Dict[str, Any],
        span: Optional[Span] = None,
    ):
        with suppress():
            if span is None:
                span = self.get_current_span()

            span.set_attributes(
                attributes={"internals": attributes},
                namespace="data",
            )

    def store_refs(
        self,
        refs: Dict[str, str],
        span: Optional[Span] = None,
    ):
        with suppress():
            if span is None:
                span = self.get_current_span()

            for key in refs.keys():
                if key in [_.value for _ in Reference.__members__.values()]:
                    # ADD REFERENCE TO THIS SPAN
                    span.set_attribute(
                        key.value if isinstance(key, Enum) else key,
                        refs[key],
                        namespace="refs",
                    )

                    # AND TO ALL SPANS CREATED AFTER THIS ONE
                    self.references[key] = refs[key]
                    # TODO: THIS SHOULD BE REPLACED BY A TRACE CONTEXT !!!

    def store_meta(
        self,
        meta: Dict[str, Any],
        span: Optional[Span] = None,
    ):
        with suppress():
            if span is None:
                span = self.get_current_span()

            for key in meta.keys():
                if is_valid_attribute_key(key):
                    span.set_attribute(
                        key,
                        meta[key],
                        namespace="meta",
                    )

    def store_metrics(
        self,
        metrics: Dict[str, Any],
        span: Optional[Span] = None,
    ):
        with suppress():
            if span is None:
                span = self.get_current_span()

            for key in metrics.keys():
                if is_valid_attribute_key(key):
                    span.set_attribute(
                        key,
                        metrics[key],
                        namespace="metrics",
                    )

    def is_inline_trace_ready(
        self,
        trace_id: Optional[int] = None,
    ) -> bool:
        is_ready = True

        with suppress():
            if self.inline and trace_id:
                is_ready = self.inline.is_ready(trace_id)

        return is_ready

    def get_inline_trace(
        self,
        trace_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        _inline_trace = {}

        with suppress():
            if self.inline and trace_id:
                is_ready = self.inline.is_ready(trace_id)

                if is_ready is True:
                    otel_spans = self.inline.fetch(trace_id)

                    if otel_spans:
                        _inline_trace = parse_inline_trace(otel_spans)

        return _inline_trace

    def extract(
        self,
        *args,
        **kwargs,
    ):
        return extract(*args, **kwargs)

    def inject(
        self,
        *args,
        **kwargs,
    ):
        return inject(*args, **kwargs)

    def get_current_span_context(self):
        """Get the current active span context if available.

        Returns:
            SpanContext or None if no active span
        """
        span = get_current_span()
        ctx = span.get_span_context()
        return ctx if ctx and ctx.is_valid else None

    def get_last_span_context(self):
        """Get the last closed span context if available.

        This is useful for accessing span information after a span has closed,
        particularly with auto-instrumentation libraries.

        Returns:
            SpanContext or None if no spans have been closed
        """
        return _get_last_ended()

    def get_span_context(self):
        """Get the most relevant span context.

        First tries to get the current active span context.
        If no active span exists, falls back to the last closed span.

        Returns:
            SpanContext or None if no relevant span context is available
        """
        return self.get_current_span_context() or self.get_last_span_context()

    def build_invocation_link(self, span_ctx=None) -> Optional[Link]:
        """
        Builds a Link object containing the hex-formatted trace_id and span_id
        from the current (or fallback last ended) span context.
        Useful to link annotations to spans.

        Args:
            span_ctx: Optional SpanContext to convert to a Link

        Returns:
            Link object with trace_id and span_id or None if no valid context
        """
        if span_ctx is None:
            span_ctx = self.get_span_context()

        if span_ctx and span_ctx.is_valid:
            return Link(
                trace_id=f"{span_ctx.trace_id:032x}",
                span_id=f"{span_ctx.span_id:016x}",
            )

        return None


def get_tracer(
    tracing: Tracing,
) -> Tracer:
    if tracing is None or tracing.tracer is None or tracing.tracer_provider is None:
        return get_tracer_provider().get_tracer("default.tracer")

    return tracing.tracer
