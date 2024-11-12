from typing import List
from datetime import datetime

import agenta_backend.apis.fastapi.observability.opentelemetry.traces_proto as Trace_Proto

from google.protobuf.json_format import MessageToDict

from agenta_backend.core.observability.dtos import (
    OTelSpanDTO,
    OTelContextDTO,
    OTelEventDTO,
    OTelLinkDTO,
)


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


def _parse_attribute(attribute):
    raw_value = attribute.value
    value_type = list(MessageToDict(raw_value).keys())[0].replace("V", "_v")
    clean_value = getattr(raw_value, value_type)

    return (attribute.key, clean_value)


def _parse_timestamp(timestamp_ns: int) -> str:
    timestamp = timestamp_ns / 1_000_000_000

    return datetime.fromtimestamp(timestamp).isoformat(timespec="microseconds")


def parse_otlp_stream(otlp_stream: bytes) -> List[OTelSpanDTO]:
    proto = Trace_Proto.TracesData()
    proto.ParseFromString(otlp_stream)

    otel_span_dtos = []

    for resource_span in proto.resource_spans:
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
