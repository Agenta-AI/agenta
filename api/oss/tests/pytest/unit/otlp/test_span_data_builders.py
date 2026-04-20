from datetime import datetime, timezone

from oss.src.apis.fastapi.otlp.extractors.canonical_attributes import SpanFeatures
from oss.src.apis.fastapi.otlp.extractors.span_data_builders import (
    OTelFlatSpanBuilder,
)
from oss.src.core.otel.dtos import OTelContextDTO, OTelSpanDTO


def test_otel_flat_span_builder_uses_none_for_missing_links():
    span = OTelSpanDTO(
        context=OTelContextDTO(
            trace_id="0x31d6cfe04b9011ec800142010a8000b0",
            span_id="0x31d6cfe04b9011ec",
        ),
        name="root",
        start_time=datetime(2024, 1, 1, tzinfo=timezone.utc),
        end_time=datetime(2024, 1, 1, tzinfo=timezone.utc),
    )

    built = OTelFlatSpanBuilder().build(span, SpanFeatures())

    assert built is not None
    assert built.links is None
