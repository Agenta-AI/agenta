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


class TraceProcessor(SpanProcessor):
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
        self.references = references or dict()
        self.inline = inline is True

        self._registry = dict()
        self._exporter = span_exporter
        self._spans: Dict[int, List[ReadableSpan]] = dict()

        # --- DISTRIBUTED
        if not self.inline:
            self._delegate = BatchSpanProcessor(
                span_exporter,
                max_queue_size or _DEFAULT_MAX_QUEUE_SIZE,
                schedule_delay_millis or _DEFAULT_SCHEDULE_DELAY_MILLIS,
                max_export_batch_size or _DEFAULT_MAX_EXPORT_BATCH_SIZE,
                export_timeout_millis or _DEFAULT_EXPORT_TIMEOUT_MILLIS,
            )
        # --- DISTRIBUTED

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

        trace_id = span.context.trace_id
        span_id = span.context.span_id

        self._registry.setdefault(trace_id, {})
        self._registry[trace_id][span_id] = True

    def on_end(
        self,
        span: ReadableSpan,
    ):
        trace_id = span.context.trace_id
        span_id = span.context.span_id

        self._spans.setdefault(trace_id, []).append(span)
        self._registry.setdefault(trace_id, {})
        self._registry[trace_id].pop(span_id, None)

        if not self._registry[trace_id]:
            spans = self._spans.pop(trace_id, [])
            self._registry.pop(trace_id, None)

            # --- INLINE
            if self.inline:
                self._exporter.export(spans)
            # --- INLINE

            # --- DISTRIBUTED
            else:
                for span in spans:
                    self._delegate.on_end(span)

                self._delegate.force_flush()
            # --- DISTRIBUTED

    def force_flush(
        self,
        timeout_millis: int = None,
    ) -> bool:
        # --- INLINE
        if self.inline:
            try:
                ret = self._exporter.force_flush(timeout_millis)
            except:  # pylint: disable=bare-except
                ret = True
        # --- INLINE

        # --- DISTRIBUTED
        else:
            ret = self._delegate.force_flush(timeout_millis)
        # --- DISTRIBUTED

        if not ret:
            log.warning("Agenta - Skipping export due to timeout.")

        return ret

    def shutdown(self) -> None:
        # --- INLINE
        if self.inline:
            self._exporter.shutdown()
        # --- INLINE

        # --- DISTRIBUTED
        else:
            self._delegate.shutdown()
        # --- DISTRIBUTED

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
