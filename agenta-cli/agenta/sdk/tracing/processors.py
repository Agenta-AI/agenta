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


class TraceProcessor(BatchSpanProcessor):
    def __init__(
        self,
        span_exporter: SpanExporter,
        scope: Dict[str, Any] = None,
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
        self.scope = scope

    def on_start(
        self,
        span: Span,
        parent_context: Optional[Context] = None,
    ) -> None:
        super().on_start(span, parent_context=parent_context)

        span.set_attributes(
            attributes={f"ag.extra.{k}": v for k, v in self.scope.items()}
        )

        if span.context.trace_id not in self.registry:
            self.registry[span.context.trace_id] = dict()

        self.registry[span.context.trace_id][span.context.span_id] = True

    def on_end(
        self,
        span: ReadableSpan,
    ):
        super().on_end(span)

        del self.registry[span.context.trace_id][span.context.span_id]

        if self.is_done():
            self.force_flush()

    def is_done(
        self,
    ):
        return all(
            not len(self.registry[trace_id]) for trace_id in self.registry.keys()
        )
