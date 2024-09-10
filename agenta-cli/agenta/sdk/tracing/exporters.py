from typing import Sequence, Dict

from opentelemetry.sdk.trace.export import (
    SpanExportResult,
    SpanExporter,
    ReadableSpan,
)


class InlineTraceExporter(SpanExporter):

    def __init__(
        self,
        registry: Dict[str, ReadableSpan],
    ):
        self._shutdown = False
        self._registry = registry

    def export(
        self,
        spans: Sequence[ReadableSpan],
    ) -> SpanExportResult:
        if self._shutdown:
            return

        for span in spans:
            self._registry.update(
                **{span.context.span_id.to_bytes(8, "big").hex(): span}
            )

    def shutdown(
        self,
    ) -> None:
        self._shutdown = True

    def force_flush(
        self,
        timeout_millis: int = 30000,
    ) -> bool:
        return True
