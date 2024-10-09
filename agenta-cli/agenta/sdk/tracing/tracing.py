from typing import Optional, Any, Dict

from httpx import get as check

from opentelemetry.trace import (
    get_current_span,
    set_tracer_provider,
    get_tracer_provider,
    Status,
    StatusCode,
)
from opentelemetry.sdk.trace import Span, Tracer, TracerProvider
from opentelemetry.sdk.resources import Resource

from agenta.sdk.utils.singleton import Singleton
from agenta.sdk.utils.exceptions import suppress  # USE IT !
from agenta.sdk.utils.logging import log

from agenta.sdk.tracing.processors import TraceProcessor
from agenta.sdk.tracing.exporters import ConsoleExporter, InlineExporter, OTLPExporter
from agenta.sdk.tracing.spans import CustomSpan
from agenta.sdk.tracing.context import tracing_context
from agenta.sdk.tracing.inline import parse_inline_trace


class Tracing(metaclass=Singleton):
    VERSION = "0.1.0"

    Status = Status
    StatusCode = StatusCode

    def __init__(
        self,
        url: str,
    ) -> None:
        # ENDPOINT (OTLP)
        # self.otlp_url = url
        self.otlp_url = "http://127.0.0.1:8000/api/observability/v1/otlp/traces"
        # AUTHENTICATION (OTLP)
        self.project_id: Optional[str] = None
        # AUTHORIZATION (OTLP)
        self.api_key: Optional[str] = None
        # HEADERS (OTLP)
        self.headers: Dict[str, str] = dict()
        # REFERENCES
        self.references: Dict[str, str] = dict()

        # TRACER PROVIDER
        self.tracer_provider: Optional[TracerProvider] = None
        # TRACER
        self.tracer: Optional[Tracer] = None
        # INLINE SPANS for INLINE TRACES (INLINE PROCESSOR)
        self.inline_spans: Dict[str, Any] = dict()

    # PUBLIC

    def configure(
        self,
        project_id: Optional[str] = None,
        api_key: Optional[str] = None,
        #
        app_id: Optional[str] = None,
    ):
        # AUTHENTICATION (OTLP)
        # self.project_id = project_id
        self.project_id = "f7943e42-ec69-498e-bf58-8db034b9286e"
        # AUTHORIZATION (OTLP)
        self.api_key = api_key
        # HEADERS (OTLP)
        self.headers = {"AG-PROJECT-ID": self.project_id}
        if api_key:
            # self.headers.update(**{"Authorization": f"Api-Key {self.api_key}"})
            self.headers.update(**{"Authorization": self.api_key})
        # REFERENCES
        self.references = {"application.id": app_id}

        # TRACER PROVIDER
        self.tracer_provider = TracerProvider(
            resource=Resource(attributes={"service.name": "agenta-sdk"})
        )
        # TRACE PROCESSORS -- CONSOLE
        # _console = TraceProcessor(
        #    ConsoleExporter(),
        #    references=self.references,
        # )
        # self.tracer_provider.add_span_processor(_console)
        # TRACE PROCESSORS -- INLINE
        self.inline = TraceProcessor(
            InlineExporter(registry=self.inline_spans),
            references=self.references,
        )
        self.tracer_provider.add_span_processor(self.inline)
        # TRACE PROCESSORS -- OTLP
        try:
            log.info(f"Connecting to the remote trace receiver at {self.otlp_url}...")

            check(self.otlp_url, headers=self.headers)

            log.info(f"Connection established.")

            _otlp = TraceProcessor(
                OTLPExporter(endpoint=self.otlp_url, headers=self.headers),
                references=self.references,
            )

            self.tracer_provider.add_span_processor(_otlp)
        except:
            log.warning(f"Connection failed.")
            log.warning(
                f"Warning: Your traces will not be exported since {self.otlp_url} is unreachable."
            )
        # GLOBAL TRACER PROVIDER -- INSTRUMENTATION LIBRARIES
        set_tracer_provider(self.tracer_provider)
        # TRACER
        self.tracer: Tracer = self.tracer_provider.get_tracer("agenta.tracer")

    def get_current_span(
        self,
    ):
        _span = get_current_span()

        if _span.is_recording():
            return CustomSpan(_span)

        return _span

    def store_internals(
        self,
        attributes: Dict[str, Any],
        span: Optional[Span] = None,
    ):
        if span is None:
            span = self.get_current_span()

        span.set_attributes(attributes={"internals": attributes}, namespace="data")

    def is_inline_trace_ready(
        self,
        trace_id: int,
    ) -> bool:
        is_ready = self.inline.is_ready(trace_id)

        return is_ready

    def get_inline_trace(
        self,
        trace_id: int,
    ) -> Dict[str, Any]:
        if trace_id is None:
            return {}

        is_ready = self.inline.is_ready(trace_id)

        if is_ready is False:
            return {}

        otel_spans = self.inline.fetch(trace_id)

        if not otel_spans:
            return {}

        inline_trace = parse_inline_trace(self.project_id, otel_spans)

        return inline_trace


def get_tracer(tracing: Tracing) -> Tracer:
    if tracing is None or tracing.tracer is None or tracing.tracer_provider is None:
        return get_tracer_provider().get_tracer("default.tracer")

    return tracing.tracer
