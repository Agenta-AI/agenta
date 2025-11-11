from typing import Sequence, Dict, List, Optional

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import (
    ConsoleSpanExporter,
    SpanExporter,
    SpanExportResult,
    ReadableSpan,
)

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.context.tracing import (
    tracing_exporter_context_manager,
    tracing_exporter_context,
    TracingExporterContext,
)


log = get_module_logger(__name__)


class InlineTraceExporter(SpanExporter):
    def __init__(
        self,
        registry: Dict[str, List[ReadableSpan]],
    ):
        self._shutdown = False
        self._registry = registry

    def export(
        self,
        spans: Sequence[ReadableSpan],
    ) -> SpanExportResult:
        if self._shutdown:
            return

        with suppress():
            for span in spans:
                trace_id = span.get_span_context().trace_id

                if trace_id not in self._registry:
                    self._registry[trace_id] = []

                self._registry[trace_id].append(span)

    def shutdown(self) -> None:
        self._shutdown = True

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True

    def is_ready(
        self,
        trace_id: int,
    ) -> bool:
        is_ready = trace_id in self._registry
        return is_ready

    def fetch(
        self,
        trace_id: int,
    ) -> List[ReadableSpan]:
        trace = self._registry.get(trace_id, [])

        if trace_id in self._registry:
            del self._registry[trace_id]

        return trace


class OTLPExporter(OTLPSpanExporter):
    _MAX_RETRY_TIMEOUT = 2

    def __init__(
        self,
        *args,
        credentials: Optional[TTLLRUCache] = None,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)

        self.credentials = credentials

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        grouped_spans: Dict[str, List[str]] = {}

        for span in spans:
            trace_id = span.get_span_context().trace_id

            credentials = None
            if self.credentials:
                credentials = self.credentials.get(trace_id)

            if credentials not in grouped_spans:
                grouped_spans[credentials] = []

            grouped_spans[credentials].append(span)

        serialized_spans = []

        for credentials, _spans in grouped_spans.items():
            with tracing_exporter_context_manager(
                context=TracingExporterContext(
                    credentials=credentials,
                )
            ):
                serialized_spans.append(super().export(_spans))

        if all(serialized_spans):
            return SpanExportResult.SUCCESS
        else:
            return SpanExportResult.FAILURE

    def _export(self, serialized_data: bytes, timeout_sec: Optional[float] = None):
        credentials = tracing_exporter_context.get().credentials

        if credentials:
            self._session.headers.update({"Authorization": credentials})

        with suppress():
            if timeout_sec is not None:
                return super()._export(serialized_data, timeout_sec)
            else:
                return super()._export(serialized_data)


ConsoleExporter = ConsoleSpanExporter
InlineExporter = InlineTraceExporter
