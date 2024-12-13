from typing import Sequence, Dict, List

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import (
    ConsoleSpanExporter,
    SpanExporter,
    SpanExportResult,
    ReadableSpan,
)

from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.context.exporting import (
    exporting_context_manager,
    exporting_context,
    ExportingContext,
)


class InlineTraceExporter(SpanExporter):
    def __init__(self, registry: Dict[str, List[ReadableSpan]]):
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

    def __init__(self, *args, credentials: Dict[int, str] = None, **kwargs):
        super().__init__(*args, **kwargs)

        self.credentials = credentials

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        credentials = None

        if self.credentials:
            trace_ids = set(span.get_span_context().trace_id for span in spans)

            if len(trace_ids) == 1:
                trace_id = trace_ids.pop()

                if trace_id in self.credentials:
                    credentials = self.credentials.pop(trace_id)

        with exporting_context_manager(
            context=ExportingContext(
                credentials=credentials,
            )
        ):
            return super().export(spans)

    def _export(self, serialized_data: bytes):
        credentials = exporting_context.get().credentials

        if credentials:
            self._session.headers.update({"Authorization": credentials})

        return super()._export(serialized_data)


ConsoleExporter = ConsoleSpanExporter
InlineExporter = InlineTraceExporter
