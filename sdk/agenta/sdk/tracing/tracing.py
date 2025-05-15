from typing import Optional, Any, Dict, Callable
from enum import Enum
from uuid import UUID

from pydantic import BaseModel
from httpx import get as check


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
from agenta.sdk.tracing.processors import (
    TraceProcessor,
    InvocationLinkHook,
    use_invocation_link,
)
from agenta.sdk.tracing.exporters import InlineExporter, OTLPExporter
from agenta.sdk.tracing.spans import CustomSpan
from agenta.sdk.tracing.inline import parse_inline_trace
from agenta.sdk.tracing.conventions import Reference, is_valid_attribute_key
from agenta.sdk.tracing.propagation import extract, inject
from agenta.sdk.utils.cache import TTLLRUCache

from agenta.sdk.context.tracing import tracing_context

log = get_module_logger(__name__)


_original_init = trace.TracerProvider.__init__


def patched_init(self, *args, **kwargs):
    _original_init(self, *args, **kwargs)
    self.add_span_processor(InvocationLinkHook())


trace.TracerProvider.__init__ = patched_init


class Link(BaseModel):
    trace_id: str
    span_id: str


class Tracing(metaclass=Singleton):
    VERSION = "0.1.0"

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
            # check(
            #     self.otlp_url,
            #     headers=self.headers,
            #     timeout=1,
            # )

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

    def get_invocation_link(self) -> Optional[Link]:
        with suppress():
            link = tracing_context.get().link

            trace_id = None
            span_id = None

            if link:
                trace_id = UUID(int=link.get("trace_id")).hex if link else None
                span_id = UUID(int=link.get("span_id")).hex[16:] if link else None

            if trace_id and span_id:
                return Link(
                    trace_id=trace_id,
                    span_id=span_id,
                )
                
            link = use_invocation_link()

            trace_id = None
            span_id = None

            if link:
                trace_id = UUID(int=link.get("trace_id")).hex if link else None
                span_id = UUID(int=link.get("span_id")).hex[16:] if link else None

                if trace_id and span_id:
                    return Link(
                        trace_id=trace_id,
                        span_id=span_id,
                    )

        return None


def get_tracer(
    tracing: Tracing,
) -> Tracer:
    if tracing is None or tracing.tracer is None or tracing.tracer_provider is None:
        return get_tracer_provider().get_tracer("default.tracer")

    return tracing.tracer
