from typing import Any, Dict
from contextlib import suppress

from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider, ConcurrentMultiSpanProcessor
from opentelemetry.sdk.trace.export import ReadableSpan
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

from agenta.sdk.tracing.processors import TraceProcessor
from agenta.sdk.tracing.exporters import InlineTraceExporter


class ConcurrentTracerProvider(TracerProvider):
    def __init__(
        self,
        name: str,
        version: str,
    ) -> None:
        self.name = name
        self.version = version

        processor = ConcurrentMultiSpanProcessor(num_threads=2)

        base_shutdown = processor.shutdown

        def safe_shutdown():
            with suppress(Exception):
                base_shutdown()

        processor.shutdown = safe_shutdown

        super().__init__(
            active_span_processor=processor,
            resource=Resource(
                attributes={"service.name": name, "service.version": version}
            ),
        )

    def add_inline_processor(
        self,
        registry: Dict[str, ReadableSpan],
        scope: Dict[str, Any],
    ) -> TraceProcessor:
        processor = TraceProcessor(
            InlineTraceExporter(registry=registry),
            scope,
        )

        self.add_span_processor(processor)

        return processor

    def add_otlp_processor(
        self,
        endpoint: str,
        headers: Dict[str, str],
        scope: Dict[str, Any],
    ):
        processor = TraceProcessor(
            OTLPSpanExporter(endpoint=endpoint, headers=headers),
            scope,
        )

        self.add_span_processor(processor)

        return processor
