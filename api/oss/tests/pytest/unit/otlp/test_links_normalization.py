from datetime import datetime, timezone

from oss.src.apis.fastapi.otlp.extractors.normalizer import Normalizer
from oss.src.apis.fastapi.otlp.utils.processing import parse_from_otel_span_dto
from oss.src.core.otel.dtos import (
    OTelContextDTO,
    OTelSpanDTO,
    OTelSpanKind,
    OTelStatusCode,
)


TRACE_ID = "0x31d6cfe04b9011ec800142010a8000b0"
SPAN_ID = "0x31d6cfe04b9011ec"


def _span(*, links=None) -> OTelSpanDTO:
    return OTelSpanDTO(
        context=OTelContextDTO(trace_id=TRACE_ID, span_id=SPAN_ID),
        name="completion_v0",
        kind=OTelSpanKind.SPAN_KIND_SERVER,
        start_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_time=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
        status_code=OTelStatusCode.STATUS_CODE_UNSET,
        attributes={"ag.type.span": "workflow"},
        links=links,
    )


def test_normalizer_preserves_missing_links_as_none():
    attributes = Normalizer().normalize(_span(links=None))

    assert attributes.links is None


def test_normalizer_preserves_explicit_empty_links():
    attributes = Normalizer().normalize(_span(links=[]))

    assert attributes.links == []


def test_flat_span_builder_preserves_missing_links_as_none():
    flat_span = parse_from_otel_span_dto(_span(links=None))

    assert flat_span is not None
    assert flat_span.links is None


def test_flat_span_builder_preserves_explicit_empty_links():
    flat_span = parse_from_otel_span_dto(_span(links=[]))

    assert flat_span is not None
    assert flat_span.links == []
