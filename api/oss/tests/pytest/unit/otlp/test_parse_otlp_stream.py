from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from oss.src.apis.fastapi.otlp.opentelemetry.otlp import parse_otlp_stream


def _build_otlp_batch_with_one_malformed_span() -> bytes:
    request = ExportTraceServiceRequest()
    resource_span = request.resource_spans.add()
    scope_span = resource_span.scope_spans.add()

    good_span = scope_span.spans.add()
    good_span.trace_id = b"\x01" * 16
    good_span.span_id = b"\x02" * 8
    good_span.name = "good-span"
    good_span.kind = 2
    good_span.start_time_unix_nano = 1_000
    good_span.end_time_unix_nano = 2_000

    bad_span = scope_span.spans.add()
    bad_span.trace_id = b"\x03" * 16
    bad_span.span_id = b"\x04" * 8
    bad_span.name = "bad-span"
    bad_span.kind = 999
    bad_span.start_time_unix_nano = 3_000
    bad_span.end_time_unix_nano = 4_000

    return request.SerializeToString()


def test_parse_otlp_stream_skips_malformed_span_and_returns_remaining():
    otlp_stream = _build_otlp_batch_with_one_malformed_span()

    spans = parse_otlp_stream(otlp_stream)

    assert len(spans) == 1
    assert spans[0].name == "good-span"
