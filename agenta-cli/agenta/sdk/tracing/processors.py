from typing import Optional, Dict, List

from opentelemetry.context import Context
from opentelemetry.sdk.trace import Span
from opentelemetry.sdk.trace.export import (
    SpanExporter,
    ReadableSpan,
    BatchSpanProcessor,
    _DEFAULT_MAX_QUEUE_SIZE,
    _DEFAULT_MAX_EXPORT_BATCH_SIZE,
)

from agenta.sdk.utils.logging import log

# LOAD CONTEXT, HERE !


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
            12 * 60 * 60 * 1000,  # 12 hours
            _DEFAULT_MAX_EXPORT_BATCH_SIZE,
            500,  # < 1 second (0.5 seconds)
        )

        self._registry = dict()
        self._exporter = span_exporter
        self.references = references or dict()
        self.spans: Dict[int, List[ReadableSpan]] = dict()

    def on_start(
        self,
        span: Span,
        parent_context: Optional[Context] = None,
    ) -> None:
        # ADD LINKS FROM CONTEXT, HERE

        for key in self.references.keys():
            span.set_attribute(f"ag.refs.{key}", self.references[key])

        if span.context.trace_id not in self._registry:
            self._registry[span.context.trace_id] = dict()

        self._registry[span.context.trace_id][span.context.span_id] = True

    def on_end(
        self,
        span: ReadableSpan,
    ):
        if self.done:
            return

        if span.context.trace_id not in self.spans:
            self.spans[span.context.trace_id] = list()

        self.spans[span.context.trace_id].append(span)

        del self._registry[span.context.trace_id][span.context.span_id]

        if len(self._registry[span.context.trace_id]) == 0:
            self.export(span.context.trace_id)

    def export(
        self,
        trace_id: int,
    ):
        spans = self.spans[trace_id]

        for span in spans:
            self.queue.appendleft(span)

        with self.condition:
            self.condition.notify()

        del self.spans[trace_id]

    def force_flush(
        self,
        timeout_millis: int = None,
    ) -> bool:
        ret = super().force_flush(timeout_millis)

        if not ret:
            log.error("--------------------------------------------")
            log.error("Agenta SDK - skipping export due to timeout.")
            log.error("--------------------------------------------")

    def is_ready(
        self,
        trace_id: Optional[int] = None,
    ) -> bool:
        is_ready = True

        try:
            is_ready = self._exporter.is_ready(trace_id)
        except:  # pylint: disable=bare-except
            pass

        return is_ready

    def fetch(
        self,
        trace_id: Optional[int] = None,
    ) -> Dict[str, ReadableSpan]:
        trace = self._exporter.fetch(trace_id)  # type: ignore

        return trace
