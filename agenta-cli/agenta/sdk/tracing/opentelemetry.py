import json
import requests

from threading import Lock
from datetime import datetime
from typing import Optional, Dict, Any, List, Literal, Sequence
from contextlib import contextmanager, suppress
from importlib.metadata import version

from agenta.sdk.utils.logging import log
from agenta.client.backend.types.create_span import CreateSpan, LlmTokens

from opentelemetry.trace import set_tracer_provider
from opentelemetry.context import Context
from opentelemetry.sdk.trace import (
    Span,
    TracerProvider,
    ConcurrentMultiSpanProcessor,
    SynchronousMultiSpanProcessor,
    Status as FullStatus,
    StatusCode,
)
from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
    OTLPSpanExporter,
)
from opentelemetry.trace.propagation import get_current_span
from opentelemetry.sdk.trace.export import (
    SpanExportResult,
    SpanExporter,
    ReadableSpan,
    BatchSpanProcessor,
    _DEFAULT_EXPORT_TIMEOUT_MILLIS,
    _DEFAULT_MAX_QUEUE_SIZE,
)

_AGENTA_ROOT_SPAN_ID = "f" * 16

_AGENTA_PROJECT_ID_HEADER = "project-id"
_AGENTA_API_KEY_HEADER = "api-key"

_AGENTA_EXPERIMENT_ID_HEADER = "experiment-id"


log.setLevel("DEBUG")


class SingletonMeta(type):
    """
    Thread-safe implementation of Singleton.
    """

    _instances = {}  # type: ignore

    # We need the lock mechanism to synchronize threads \
    # during the initial access to the Singleton object.
    _lock: Lock = Lock()

    def __call__(cls, *args, **kwargs):
        """
        Ensures that changes to the `__init__` arguments do not affect the
        returned instance.

        Uses a lock to make this method thread-safe. If an instance of the class
        does not already exist, it creates one. Otherwise, it returns the
        existing instance.
        """

        with cls._lock:
            if cls not in cls._instances:
                instance = super().__call__(*args, **kwargs)
                cls._instances[cls] = instance
        return cls._instances[cls]


class TraceProcessor(BatchSpanProcessor):

    def __init__(
        self,
        span_exporter: SpanExporter,
        max_queue_size: int = None,
        schedule_delay_millis: float = None,
        max_export_batch_size: int = None,
        export_timeout_millis: float = None,
    ):
        super().__init__(
            span_exporter,
            _DEFAULT_MAX_QUEUE_SIZE,
            60 * 60 * 1000,  # 1 hour
            _DEFAULT_MAX_QUEUE_SIZE,
            _DEFAULT_EXPORT_TIMEOUT_MILLIS,
        )

        self.registry = dict()

    def on_start(self, span: Span, parent_context: Optional[Context] = None) -> None:
        super().on_start(span, parent_context=parent_context)

        log.info(f">  {span.context.span_id.to_bytes(8).hex()} {span.name}")

        if span.context.trace_id not in self.registry:
            self.registry[span.context.trace_id] = dict()

        self.registry[span.context.trace_id][span.context.span_id] = True

    def on_end(self, span: ReadableSpan):
        super().on_end(span)

        log.info(f" < {span.context.span_id.to_bytes(8).hex()} {span.name}")

        del self.registry[span.context.trace_id][span.context.span_id]

        if self.is_done():
            self.force_flush()

    def is_done(self):
        return all(
            not len(self.registry[trace_id]) for trace_id in self.registry.keys()
        )


class InlineTraceExporter(SpanExporter):

    def __init__(self, registry):
        self._shutdown = False
        self._registry = registry

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        if self._shutdown:
            return

        for span in spans:
            self._registry.update(**{span.context.span_id.to_bytes(8).hex(): span})

    def shutdown(self) -> None:
        self._shutdown = True

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True


Namespace = Literal[
    "data.inputs",
    "data.internals",
    "data.outputs",
    "metrics.scores",
    "metrics.costs",
    "metrics.tokens",
    "metadata.config",
    "metadata.version",
    "tags",
    "resource.project",
    "resource.experiment",
    "resource.application",
    "resource.configuration",
    "resource.service",
    "extra",
]

Status = Literal[
    "OK",
    "ERROR",
]


class Tracing:
    VERSION = "2.0"

    # @suppress(Exception)
    def __init__(
        self,
        url: str,
        project_id: Optional[str] = None,
        api_key: Optional[str] = None,
        experiment_id: Optional[str] = None,
    ) -> None:

        # ENDPOINT
        self.url = "http://localhost:4318/v1/traces"  # url
        # AUTHENTICATION
        self.project_id = project_id
        # AUTHORIZATION
        self.api_key = api_key
        # EXPERIMENT
        self.experiment_id = experiment_id

        # HEADERS
        self.headers = {}
        if self.project_id:
            self.headers.update(**{_AGENTA_PROJECT_ID_HEADER: self.project_id})
        if api_key:
            self.headers.update(**{_AGENTA_API_KEY_HEADER: self.api_key})
        if experiment_id:
            self.headers.update(**{_AGENTA_EXPERIMENT_ID_HEADER: self.experiment_id})

        # SPANS (INLINE TRACE)
        self.spans: Dict[str:ReadableSpan] = dict()

        # SPAN PROCESSOR
        # self.processor = SynchronousMultiSpanProcessor()
        self.processor = ConcurrentMultiSpanProcessor(num_threads=2)

        base_shutdown = self.processor.shutdown

        def safe_shutdown():
            with suppress(Exception):
                base_shutdown()

        self.processor.shutdown = safe_shutdown

        # TRACER PROVIDER
        self.tracer_provider = TracerProvider(active_span_processor=self.processor)

        # TRACE PROCESSORS
        self.inline_processor = TraceProcessor(InlineTraceExporter(registry=self.spans))
        self.tracer_provider.add_span_processor(self.inline_processor)

        try:
            requests.post(self.url)

            self.remote_processor = TraceProcessor(
                OTLPSpanExporter(endpoint=self.url, headers=self.headers)
            )
            self.tracer_provider.add_span_processor(self.remote_processor)
        except requests.exceptions.ConnectionError:
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
                namespace="metadata.version",
                attributes={"agenta": version("agenta"), "tracing": Tracing.VERSION},
            )
            self.set_attributes(
                namespace="extra",
                attributes={"kind": kind},
            )
            yield span

    def start_span(self, name: str, kind: str):
        span = self.tracer.start_span(name)

        self.set_attributes(
            namespace="metadata.version",
            attributes={"agenta": version("agenta"), "tracing": Tracing.VERSION},
            span=span,
        )
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
    ):
        if span is None:
            span = get_current_span()

        if status == "OK":
            if span.status.status_code != StatusCode.ERROR:
                span.set_status(
                    FullStatus(status_code=StatusCode.OK, description=message),
                )
        elif status == "ERROR":
            span.set_status(
                FullStatus(status_code=StatusCode.ERROR, description=message),
            )

    def add_event(
        self,
        name,
        attributes=None,
        timestamp=None,
        span: Optional[Span] = None,
    ):
        if span is None:
            span = get_current_span()

        span.add_event(
            name=name,
            attributes=attributes,
            timestamp=timestamp,
        )

    def record_exception(
        self, exception, attributes=None, timestamp=None, span: Optional[Span] = None
    ):
        if span is None:
            span = get_current_span()

        span.record_exception(
            exception=exception,
            attributes=attributes,
            timestamp=timestamp,
            escaped=None,
        )

    def _key(self, namespace, key=""):
        return f"ag.{namespace}.{key}"

    def _value(self, value: Any) -> str:
        if value is None:
            return "null"

        if not isinstance(value, (str, int, float, bool)):
            return json.dumps(value)

        return value

    def set_attributes(
        self,
        namespace: Namespace,
        attributes: Optional[Dict[str, Any]] = None,
        span: Optional[Span] = None,
    ) -> None:
        if attributes is None:
            return

        if span is None:
            span = get_current_span()

        for key, value in attributes.items():
            span.set_attribute(
                self._key(namespace, key),
                self._value(value),
            )

    def store_inputs(self, attributes: dict, span: Optional[Span] = None) -> None:
        self.set_attributes("data.inputs", attributes, span)

    def store_internals(self, attributes: dict, span: Optional[Span] = None) -> None:
        self.set_attributes("data.internals", attributes, span)

    def store_outputs(self, attributes: dict, span: Optional[Span] = None) -> None:
        self.set_attributes("data.outputs", attributes, span)

    def store_costs(self, attributes: dict, span: Optional[Span] = None) -> None:
        self.set_attributes("metrics.costs", attributes, span)

    def store_latencies(self, attributes: dict, span: Optional[Span] = None) -> None:
        self.set_attributes("metrics.latencies", attributes, span)

    def store_tokens(self, attributes: dict, span: Optional[Span] = None) -> None:
        self.set_attributes("metrics.tokens", attributes, span)

    def store_config(self, attributes: dict, span: Optional[Span] = None) -> None:
        self.set_attributes("metadata.config", attributes, span)

    def store_tags(self, attributes: dict, span: Optional[Span] = None) -> None:
        self.set_attributes("tags", attributes, span)

    def is_processing(self) -> bool:
        return not self.inline_processor.is_done()

    def get_inline_trace(self, trace_id_only: bool = False):
        spans_idx: Dict[str, List[ReadableSpan]] = dict()

        for span in self.spans.values():
            span: ReadableSpan

            trace_id = span.context.trace_id.to_bytes(16).hex()

            if trace_id not in spans_idx:
                spans_idx[trace_id] = list()

            if not trace_id_only:
                spans_idx[trace_id].append(self._parse_to_legacy_span(span))

        inline_traces = [
            {"trace_id": trace_id, "spans": spans}
            for trace_id, spans in spans_idx.items()
        ]

        if len(inline_traces) > 1:
            log.error("Unexpected error while parsing inline trace: too many traces.")

        return inline_traces[0]

    def _get_attributes(
        self,
        namespace: str,
        span: ReadableSpan,
    ):
        return {
            k.replace(self._key(namespace), ""): v
            for k, v in span.attributes.items()
            if k.startswith(self._key(namespace))
        }

    def _parse_to_legacy_span(
        self,
        span: ReadableSpan,
    ):

        attributes = dict(span.attributes)

        for event in span.events:
            if event.name == "exception":
                attributes.update(**event.attributes)

        legacy_span = CreateSpan(
            id=span.context.span_id.to_bytes(8).hex(),
            spankind=self._get_attributes("extra", span).get("kind", "UNKNOWN"),
            name=span.name,
            status=str(span.status.status_code.name),
            #
            start_time=datetime.fromtimestamp(
                span.start_time / 1_000_000_000,
            ).isoformat(),
            end_time=datetime.fromtimestamp(
                span.end_time / 1_000_000_000,
            ).isoformat(),
            #
            parent_span_id=(
                span.parent.span_id.to_bytes(8).hex() if span.parent else None
            ),
            #
            inputs=self._get_attributes("data.inputs", span),
            internals=self._get_attributes("data.internals", span),
            outputs=self._get_attributes("data.outputs", span),
            #
            config=self._get_attributes("metadata.config", span),
            #
            tokens=LlmTokens(
                prompt_tokens=self._get_attributes("metrics.tokens", span).get(
                    "prompt", None
                ),
                completion_tokens=self._get_attributes("metrics.tokens", span).get(
                    "completion", None
                ),
                total_tokens=self._get_attributes("metrics.tokens", span).get(
                    "total", None
                ),
            ),
            cost=self._get_attributes("metrics.costs", span).get("marginal", 0.0),
            #
            app_id="",
            variant_id=None,
            variant_name=None,
            environment=None,
            tags=None,
            token_consumption=None,
            attributes=attributes,
            user=None,
        )

        return json.loads(legacy_span.json())
