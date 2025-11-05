from typing import Optional, Dict, List
from threading import Lock
from json import dumps
from uuid import UUID

from opentelemetry.baggage import get_all as get_baggage
from opentelemetry.context import Context
from opentelemetry.sdk.trace import Span, SpanProcessor
from opentelemetry.sdk.trace.export import (
    SpanExporter,
    ReadableSpan,
    BatchSpanProcessor,
)
from opentelemetry.trace import SpanContext

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.tracing.conventions import Reference

from agenta.sdk.contexts.tracing import TracingContext

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
                max_queue_size,
                schedule_delay_millis,
                max_export_batch_size,
                export_timeout_millis,
            )
        # --- DISTRIBUTED

    def on_start(
        self,
        span: Span,
        parent_context: Optional[Context] = None,
    ) -> None:
        trace_id = span.context.trace_id
        span_id = span.context.span_id

        # log.debug(
        #     "[SPAN] [START] ",
        #     trace_id=UUID(int=trace_id).hex,
        #     span_id=UUID(int=span_id).hex[-16:],
        # )

        for key in self.references.keys():
            span.set_attribute(f"ag.refs.{key}", self.references[key])

        baggage = get_baggage(parent_context)

        for key in baggage.keys():
            if key.startswith("ag.refs."):
                _key = key.replace("ag.refs.", "")
                if _key in [_.value for _ in Reference.__members__.values()]:
                    span.set_attribute(key, baggage[key])

        context = TracingContext.get()

        trace_type = span.attributes.get("trace_type") if span.attributes else None

        context.annotate = (
            context.annotate
            or (context.type == "annotation")
            or (trace_type == "annotation")
        )
        context.type = (
            (str(trace_type) if trace_type else None)
            or context.type
            or ("annotation" if context.annotate else "invocation")
        )

        span.set_attribute("ag.type.tree", context.type)

        if context.flags:
            for key in context.flags.keys():
                span.set_attribute(f"ag.flags.{key}", context.flags[key])
        # if context.tags:
        #     for key in context.tags.keys():
        #         span.set_attribute(f"ag.tags.{key}", context.tags[key])
        # if context.meta:
        #     span.set_attribute(f"ag.meta.", dumps(context.meta))

        # --- DISTRIBUTED
        if not self.inline:
            if context.links:
                for key, link in context.links.items():
                    try:
                        link = link.model_dump(mode="json", exclude_none=True)
                    except:  # pylint: disable=bare-except
                        pass
                    if not isinstance(link, dict):
                        continue
                    if not link.get("trace_id") or not link.get("span_id"):
                        continue

                    span.add_link(
                        context=SpanContext(
                            trace_id=int(str(link.get("trace_id")), 16),
                            span_id=int(str(link.get("span_id")), 16),
                            is_remote=True,
                        ),
                        attributes=dict(
                            key=str(key),
                        ),
                    )

        if context.references:
            for key, ref in context.references.items():
                try:
                    ref = ref.model_dump(mode="json", exclude_none=True)
                except:  # pylint: disable=bare-except
                    pass
                if not isinstance(ref, dict):
                    continue
                if not ref.get("id") and not ref.get("slug") and not ref.get("version"):
                    continue

                if ref.get("id"):
                    span.set_attribute(
                        f"ag.refs.{key}.id",
                        str(ref.get("id")),
                    )
                if ref.get("slug"):
                    span.set_attribute(
                        f"ag.refs.{key}.slug",
                        str(ref.get("slug")),
                    )
                if ref.get("version"):
                    span.set_attribute(
                        f"ag.refs.{key}.version",
                        str(ref.get("version")),
                    )

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

        # log.debug(
        #     "[SPAN] [END]   ",
        #     trace_id=UUID(int=trace_id).hex,
        #     span_id=UUID(int=span_id).hex[-16:],
        # )

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
