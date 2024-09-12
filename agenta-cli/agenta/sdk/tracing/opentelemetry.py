import httpx

from typing import Optional, Union, Any, Dict
from contextlib import contextmanager

from opentelemetry.trace import set_tracer_provider
from opentelemetry.trace.propagation import get_current_span
from opentelemetry.sdk.trace import Span
from opentelemetry.sdk.trace.export import ReadableSpan

from agenta.sdk.utils.logging import log

from agenta.sdk.tracing.conventions import Namespace, Status
from agenta.sdk.tracing.tracers import ConcurrentTracerProvider
from agenta.sdk.tracing.spans import (
    set_status as otel_set_status,
    add_event as otel_add_event,
    record_exception as otel_record_exception,
    set_attributes as otel_set_attributes,
    get_attributes as otel_get_attributes,
)
from agenta.sdk.tracing.inline_trace import (
    get_trace as inline_get_trace,
    get_trace_id as inline_get_trace_id,
)

_AGENTA_API_KEY_HEADER = "Authorization"

log.setLevel("DEBUG")


class Tracing:
    VERSION = "0.1.0"

    # @suppress(Exception)
    def __init__(
        self,
        url: str,
        app_id: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> None:
        # ENDPOINT
        self.url = url  # "http://localhost:4318/v1/traces"
        # AUTHENTICATION
        self.app_id = app_id
        # AUTHORIZATION
        self.api_key = api_key

        # HEADERS
        self.headers = {}
        if api_key:
            self.headers.update(**{_AGENTA_API_KEY_HEADER: self.api_key})

        # SPANS (INLINE TRACE)
        self.spans: Dict[str, ReadableSpan] = dict()

        # TRACER PROVIDER
        self.tracer_provider = ConcurrentTracerProvider("agenta", Tracing.VERSION)

        # TRACE PROCESSORS
        self.inline_processor = self.tracer_provider.add_inline_processor(
            registry=self.spans,
            scope={"app_id": self.app_id},
        )

        try:
            log.info(f"Connecting to the remote trace receiver at {self.url}...")

            httpx.get(self.url, headers=self.headers)

            log.info(f"Connection established.")

            self.otlp_processor = self.tracer_provider.add_otlp_processor(
                endpoint=self.url,
                headers=self.headers,
                scope={"app_id": self.app_id},
            )
        except:
            log.warning(f"Connection failed.")
            log.error(
                f"Warning: Your traces will not be exported since {self.url} is unreachable."
            )

        # GLOBAL TRACER PROVIDER
        set_tracer_provider(self.tracer_provider)

        # TRACER
        self.tracer = self.tracer_provider.get_tracer("agenta.tracer")

    @contextmanager
    def start_as_current_span(self, name: str, kind: str):
        with self.tracer.start_as_current_span(name) as span:
            self.set_attributes(
                namespace="extra",
                attributes={"kind": kind},
                span=span,
            )

            yield span

    def start_span(self, name: str, kind: str) -> Span:
        span = self.tracer.start_span(name)

        self.set_attributes(
            namespace="extra",
            attributes={"kind": kind},
            span=span,
        )

        return span

    def set_status(
        self,
        status: Status,
        message: Optional[str] = None,
        span: Optional[Span] = None,
    ) -> None:
        if span is None:
            span = get_current_span()

        otel_set_status(span, status, message)

    def add_event(
        self,
        name,
        attributes=None,
        timestamp=None,
        span: Optional[Span] = None,
    ) -> None:
        if span is None:
            span = get_current_span()

        otel_add_event(span, name, attributes, timestamp)

    def record_exception(
        self,
        exception,
        attributes=None,
        timestamp=None,
        span: Optional[Span] = None,
    ) -> None:
        if span is None:
            span = get_current_span()

        otel_record_exception(span, exception, attributes, timestamp)

    def set_attributes(
        self,
        namespace: Namespace,
        attributes: Dict[str, Any],
        span: Optional[Span] = None,
    ) -> None:
        if span is None:
            span = get_current_span()

        otel_set_attributes(span, namespace, attributes)

    def get_attributes(
        self,
        namespace: Namespace,
        span: Optional[Union[ReadableSpan, Span]] = None,
    ) -> Dict[str, Any]:
        if span is None:
            span = get_current_span()

        return otel_get_attributes(span, namespace)

    def store_internals(
        self,
        attributes: Dict[str, Any],
        span: Optional[Span] = None,
    ) -> None:
        self.set_attributes(
            namespace="data.internals",
            attributes=attributes,
            span=span,
        )

    def is_processing(self) -> bool:
        return not self.inline_processor.is_done()

    def get_inline_trace(self) -> Dict[str, Any]:
        return inline_get_trace(self.spans)

    def get_trace_id_only(self) -> Dict[str, Any]:
        return inline_get_trace_id(self.spans)
