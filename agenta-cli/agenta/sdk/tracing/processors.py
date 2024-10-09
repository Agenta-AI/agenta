from typing import Optional, Any, Dict

from opentelemetry.context import Context
from opentelemetry.sdk.trace import Span
from opentelemetry.sdk.trace.export import (
    SpanExporter,
    ReadableSpan,
    BatchSpanProcessor,
    _DEFAULT_EXPORT_TIMEOUT_MILLIS,
    _DEFAULT_MAX_QUEUE_SIZE,
)

# LOAD CONTEXT, HERE


class TraceProcessor(BatchSpanProcessor):
    def __init__(
        self,
        span_exporter: SpanExporter,
        references: Dict[str, str] = None,
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

        self._registry = dict()
        self._exporter = span_exporter
        self.references = references or dict()

    def on_start(self, span: Span, parent_context: Optional[Context] = None) -> None:
        # ADD LINKS FROM CONTEXT, HERE

        for key in self.references.keys():
            span.set_attribute(f"ag.refs.{key}", self.references[key])

        if span.context.trace_id not in self._registry:
            self._registry[span.context.trace_id] = dict()

        self._registry[span.context.trace_id][span.context.span_id] = True

    def on_end(self, span: ReadableSpan):
        super().on_end(span)

        del self._registry[span.context.trace_id][span.context.span_id]

        if self.is_ready(span.get_span_context().trace_id):
            self.force_flush()

    def is_ready(self, trace_id: Optional[int] = None) -> bool:
        is_ready = not len(self._registry.get(trace_id, {}))

        return is_ready

    def fetch(self, trace_id: Optional[int] = None) -> Dict[str, ReadableSpan]:
        trace = self._exporter.fetch(trace_id)  # type: ignore

        return trace
