from typing import List
from datetime import datetime
import gzip
import zlib


# Use official OpenTelemetry proto definitions
from opentelemetry.proto.trace.v1 import trace_pb2 as Trace_Proto
from opentelemetry.proto.collector.trace.v1 import (
    trace_service_pb2 as TraceService_Proto,
)

from oss.src.utils.logging import get_module_logger
from oss.src.core.otel.dtos import (
    OTelSpanDTO,
    OTelContextDTO,
    OTelEventDTO,
    OTelLinkDTO,
)

log = get_module_logger(__name__)

SPAN_KINDS = [
    "SPAN_KIND_UNSPECIFIED",
    "SPAN_KIND_INTERNAL",
    "SPAN_KIND_SERVER",
    "SPAN_KIND_CLIENT",
    "SPAN_KIND_PRODUCER",
    "SPAN_KIND_CONSUMER",
]

SPAN_STATUS_CODES = [
    "STATUS_CODE_UNSET",
    "STATUS_CODE_OK",
    "STATUS_CODE_ERROR",
]


def _is_gzip(data):
    return data[:2] == b"\x1f\x8b"


def _is_zlib(data):
    return data[:2] in [b"\x78\x01", b"\x78\x9c", b"\x78\xda"]


def _detect_compression(data):
    if _is_gzip(data):
        return "gzip"
    elif _is_zlib(data):
        return "zlib"
    else:
        return "unknown or uncompressed"


def _decompress_data(data: bytes) -> bytes:
    compression_type = _detect_compression(data)
    if compression_type == "gzip":
        return gzip.decompress(data)
    elif compression_type == "zlib":
        return zlib.decompress(data)
    else:
        return data


def _decode_value(any_value):
    """Decode an AnyValue protobuf object to its Python equivalent."""
    which = any_value.WhichOneof("value")

    if which == "string_value":
        return any_value.string_value
    elif which == "bool_value":
        return any_value.bool_value
    elif which == "int_value":
        return any_value.int_value
    elif which == "double_value":
        return any_value.double_value
    elif which == "array_value":
        return [_decode_value(value) for value in any_value.array_value.values]
    elif which == "kvlist_value":
        return {kv.key: _decode_value(kv.value) for kv in any_value.kvlist_value.values}
    elif which == "bytes_value":
        return any_value.bytes_value
    elif which is None:
        return None
    else:
        log.warn(f"Unknown value type at _decode_value: {which}")
        return str(any_value)


def _parse_attribute(attribute):
    """Parse an attribute key-value pair, properly handling all protobuf value types."""
    return (attribute.key, _decode_value(attribute.value))


def _parse_timestamp(timestamp_ns: int) -> str:
    timestamp = timestamp_ns / 1_000_000_000

    return datetime.fromtimestamp(timestamp).isoformat(timespec="microseconds")


def parse_otlp_stream(otlp_stream: bytes) -> List[OTelSpanDTO]:
    try:
        otlp_stream = _decompress_data(otlp_stream)
    except (OSError, zlib.error) as e:
        log.error("Decompression failed: {%s}", e)

    # According to OTLP spec, the HTTP payload is an ExportTraceServiceRequest.
    # We first try to parse using that message. If that fails (e.g. legacy
    # clients sending raw TracesData) we fall back to the older TracesData
    # message for backward-compatibility.

    export_request = TraceService_Proto.ExportTraceServiceRequest()

    try:
        export_request.ParseFromString(otlp_stream)
        resource_spans_iterable = export_request.resource_spans
    except Exception:
        # Fallback to legacy TracesData parser.
        legacy_proto = getattr(Trace_Proto, "TracesData", None)
        if legacy_proto is None:
            raise
        legacy_msg = legacy_proto()
        legacy_msg.ParseFromString(otlp_stream)
        resource_spans_iterable = legacy_msg.resource_spans

    otel_span_dtos = []

    for resource_span in resource_spans_iterable:
        for scope_span in resource_span.scope_spans:
            for span in scope_span.spans:
                # SPAN CONTEXT
                s_trace_id = "0x" + span.trace_id.hex()
                s_span_id = "0x" + span.span_id.hex()
                s_context = OTelContextDTO(trace_id=s_trace_id, span_id=s_span_id)

                # SPAN PARENT CONTEXT
                s_parent_id = span.parent_span_id.hex()
                s_parent_id = "0x" + s_parent_id if s_parent_id else None
                p_context = (
                    OTelContextDTO(trace_id=s_trace_id, span_id=s_parent_id)
                    if s_parent_id
                    else None
                )

                # SPAN NAME
                s_name = span.name

                # SPAN KIND
                s_kind = SPAN_KINDS[span.kind]

                # SPAN TIME
                s_start_time = _parse_timestamp(span.start_time_unix_nano)
                s_end_time = _parse_timestamp(span.end_time_unix_nano)

                # SPAN STATUS
                s_status_code = SPAN_STATUS_CODES[
                    span.status.code if span.status.code else 0
                ]
                s_status_message = (
                    span.status.message if span.status.message != "" else None
                )

                # SPAN ATTRIBUTES
                s_attributes = {
                    k: v
                    for k, v in [
                        _parse_attribute(attribute) for attribute in span.attributes
                    ]
                }

                # SPAN EVENTS
                s_events = [
                    OTelEventDTO(
                        name=event.name,
                        timestamp=_parse_timestamp(event.time_unix_nano),
                        attributes={
                            k: v
                            for k, v in [
                                _parse_attribute(attribute)
                                for attribute in event.attributes
                            ]
                        },
                    )
                    for event in span.events
                ]
                s_events = s_events if len(s_events) > 0 else None

                # SPAN LINKS
                s_links = [
                    OTelLinkDTO(
                        context=OTelContextDTO(
                            trace_id="0x" + link.trace_id.hex(),
                            span_id="0x" + link.span_id.hex(),
                        ),
                        attributes={
                            k: v
                            for k, v in [
                                _parse_attribute(attribute)
                                for attribute in link.attributes
                            ]
                        },
                    )
                    for link in span.links
                ]
                s_links = s_links if len(s_links) > 0 else None

                # PUTTING IT ALL TOGETHER
                otel_span_dto = OTelSpanDTO(
                    context=s_context,
                    name=s_name,
                    kind=s_kind,
                    start_time=s_start_time,
                    end_time=s_end_time,
                    status_code=s_status_code,
                    status_message=s_status_message,
                    attributes=s_attributes,
                    events=s_events,
                    parent=p_context,
                    links=s_links,
                )

                otel_span_dtos.append(otel_span_dto)

    return otel_span_dtos
