from typing import Optional, Dict, List
from threading import Lock

from opentelemetry.baggage import get_all as get_baggage
from opentelemetry.context import Context
from opentelemetry.sdk.trace import Span, SpanProcessor
from opentelemetry.sdk.trace.export import (
    SpanExporter,
    ReadableSpan,
    BatchSpanProcessor,
    _DEFAULT_MAX_QUEUE_SIZE,
    _DEFAULT_SCHEDULE_DELAY_MILLIS,
    _DEFAULT_MAX_EXPORT_BATCH_SIZE,
    _DEFAULT_EXPORT_TIMEOUT_MILLIS,
)

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.tracing.conventions import Reference

log = get_module_logger(__name__)


class TraceProcessor(BatchSpanProcessor):
    def __init__(
        self,
        span_exporter: SpanExporter,
        references: Dict[str, str] = None,
        inline: bool = False,
        max_queue_size: int = None,
        schedule_delay_millis: float = None,
        max_export_batch_size: int = None,
        export_timeout_millis: float = None,
    ):
        super().__init__(
            span_exporter,
            _DEFAULT_MAX_QUEUE_SIZE,
            5 * 1000 if inline else _DEFAULT_SCHEDULE_DELAY_MILLIS,  # < 5 seconds
            _DEFAULT_MAX_EXPORT_BATCH_SIZE,
            500 if inline else _DEFAULT_EXPORT_TIMEOUT_MILLIS,  # < 1 second
        )

        self.references = references or dict()
        self.inline = inline is True

        # --- INLINE
        if self.inline:
            self._registry = dict()
            self._exporter = span_exporter
            self._spans: Dict[int, List[ReadableSpan]] = dict()
        # --- INLINE

    def on_start(
        self,
        span: Span,
        parent_context: Optional[Context] = None,
    ) -> None:
        for key in self.references.keys():
            span.set_attribute(f"ag.refs.{key}", self.references[key])

        baggage = get_baggage(parent_context)

        for key in baggage.keys():
            if key.startswith("ag.refs."):
                _key = key.replace("ag.refs.", "")
                if _key in [_.value for _ in Reference.__members__.values()]:
                    span.set_attribute(key, baggage[key])

        # --- INLINE
        if self.inline:
            if span.context.trace_id not in self._registry:
                self._registry[span.context.trace_id] = dict()

            self._registry[span.context.trace_id][span.context.span_id] = True
        # --- INLINE

    def on_end(
        self,
        span: ReadableSpan,
    ):
        # --- INLINE
        if self.inline:
            if self.done:
                return

            if span.context.trace_id not in self._spans:
                self._spans[span.context.trace_id] = list()

            self._spans[span.context.trace_id].append(span)

            del self._registry[span.context.trace_id][span.context.span_id]

            if len(self._registry[span.context.trace_id]) == 0:
                self.export(span.context.trace_id)
        # --- INLINE

        # --- DISTRIBUTED
        else:
            super().on_end(span)
        # --- DISTRIBUTED

    def export(
        self,
        trace_id: int,
    ):
        # --- INLINE
        if self.inline:
            spans = self._spans[trace_id]

            for span in spans:
                self.queue.appendleft(span)

            with self.condition:
                self.condition.notify()

            del self._spans[trace_id]
        # --- INLINE

    def force_flush(
        self,
        timeout_millis: int = None,
    ) -> bool:
        ret = super().force_flush(timeout_millis)

        if not ret:
            log.warning("Agenta - Skipping export due to timeout.")

    def is_ready(
        self,
        trace_id: Optional[int] = None,
    ) -> bool:
        is_ready = True

        # --- INLINE
        if self.inline:
            try:
                is_ready = self._exporter.is_ready(trace_id)
            except:  # pylint: disable=bare-except
                pass
        # --- INLINE

        return is_ready

    def fetch(
        self,
        trace_id: Optional[int] = None,
    ) -> Dict[str, ReadableSpan]:
        trace = None

        # --- INLINE
        if self.inline:
            try:
                trace = self._exporter.fetch(trace_id)  # type: ignore
            except:  # pylint: disable=bare-except
                pass
        # --- INLINE

        return trace


# Internal storage for the last ended span context
_last_ended_span_context = None
_lock = Lock()


def _set_last_ended(span_ctx) -> None:
    """Set the last ended span context"""
    with _lock:
        global _last_ended_span_context
        _last_ended_span_context = span_ctx


def _get_last_ended():
    """Get the last ended span context"""
    with _lock:
        return _last_ended_span_context


class EndedSpanRecorder(SpanProcessor):
    """Records the last ended span context for later reference.

    This allows accessing span information even after the span has been ended,
    which is useful for linking annotations to auto-instrumented spans.
    """

    def on_end(self, span):
        _set_last_ended(span.get_span_context())
