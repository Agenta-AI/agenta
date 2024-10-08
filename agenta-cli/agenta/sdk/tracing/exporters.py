from typing import Sequence, Dict, List

from opentelemetry.sdk.trace.export import (
    ConsoleSpanExporter,
    SpanExporter,
    SpanExportResult,
    ReadableSpan,
)
from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
    OTLPSpanExporter,
)

from agenta.sdk.utils.exceptions import suppress


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

    def fetch(self, trace_id: int) -> List[ReadableSpan]:
        trace = self._registry.get(trace_id, [])

        del self._registry[trace_id]

        return trace


ConsoleExporter = ConsoleSpanExporter
InlineExporter = InlineTraceExporter
OTLPExporter = OTLPSpanExporter
