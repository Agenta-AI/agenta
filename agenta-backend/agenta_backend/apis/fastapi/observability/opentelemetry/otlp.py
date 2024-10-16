from typing import List
from json import dumps
from uuid import UUID
from hashlib import shake_128
from datetime import datetime
from collections import OrderedDict

import agenta_backend.apis.fastapi.observability.opentelemetry.traces_proto as Trace_Proto

from google.protobuf.json_format import MessageToDict

from agenta_backend.core.observability.dtos import (
    OTelSpanDTO,
    OTelContextDTO,
    OTelEventDTO,
    OTelLinkDTO,
)


RESOURCE_ID_SIZE = 16  # 64-bit int
TRACE_ID_SIZE = 32  # 128-bit int
SPAN_ID_SIZE = 16  # 64-bit int

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


def _parse_attribute(
    attribute,
):
    key = attribute.key
    raw_value = attribute.value
    value_type = list(MessageToDict(raw_value).keys())[0].replace("V", "_v")
    clean_value = getattr(raw_value, value_type)

    return (key, clean_value)


def _parse_timestamp(
    timestamp_ns: int,
) -> str:
    return datetime.fromtimestamp(
        timestamp_ns / 1_000_000_000,
    ).isoformat(
        timespec="microseconds",
    )


LJUST = 20


def parse_otlp_stream(
    otlp_stream: bytes,
) -> List[OTelSpanDTO]:
    proto = Trace_Proto.TracesData()
    proto.ParseFromString(otlp_stream)

    resources = []
    otel_span_dtos = []

    for resource_span in proto.resource_spans:
        # print("---", "resource", "---")

        resource = {
            "attributes": {
                k: v
                for k, v in [
                    _parse_attribute(attribute)
                    for attribute in resource_span.resource.attributes
                ]
            }
        }

        keys = OrderedDict(
            {k: v for k, v in resource["attributes"].items() if not k.startswith("ag.")}
        )

        resource["resource_id"] = str(
            UUID(
                shake_128(bytearray(dumps(keys, sort_keys=True), "utf-8")).hexdigest(
                    RESOURCE_ID_SIZE
                )
            )
        )

        # print(resource)

        resources.append(resource)

        for scope_span in resource_span.scope_spans:
            # print("---", "scope", "---")

            # print({"name": scope_span.scope.name, "version": scope_span.scope.version})

            for span in scope_span.spans:
                # print("---", "span", "---")

                s_trace_id = "0x" + span.trace_id.hex()
                # print("s_trace_id".ljust(LJUST), s_trace_id)

                s_span_id = "0x" + span.span_id.hex()
                # print("s_span_id".ljust(LJUST), s_span_id)

                s_context = OTelContextDTO(
                    trace_id=s_trace_id,
                    span_id=s_span_id,
                )

                s_parent_id = span.parent_span_id.hex()
                s_parent_id = "0x" + s_parent_id if s_parent_id else None
                # print("s_parent_id".ljust(LJUST), s_parent_id)

                p_context = (
                    OTelContextDTO(
                        trace_id=s_trace_id,
                        span_id=s_parent_id,
                    )
                    if s_parent_id
                    else None
                )

                s_name = span.name
                # print("s_name".ljust(LJUST), s_name)

                s_kind = SPAN_KINDS[span.kind]
                # print("s_kind".ljust(LJUST), s_kind)

                s_start_time = _parse_timestamp(span.start_time_unix_nano)
                # print("s_start_time".ljust(LJUST), s_start_time)

                s_end_time = _parse_timestamp(span.end_time_unix_nano)
                # print("s_end_time".ljust(LJUST), s_end_time)

                s_status_code = SPAN_STATUS_CODES[
                    span.status.code if span.status.code else 0
                ]
                # print("s_status_code".ljust(LJUST), s_status_code)

                s_status_message = (
                    span.status.message if span.status.message != "" else None
                )
                # print("s_status_message")
                # (# print(s_status_message) if s_status_message else None)

                s_attributes = {
                    k: v
                    for k, v in [
                        _parse_attribute(attribute) for attribute in span.attributes
                    ]
                }
                s_attributes["ag.refs.resource_id"] = resource["resource_id"]
                # print("s_attributes")
                # print(list(s_attributes.keys()))

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
                # print("s_events".ljust(LJUST), s_events)

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
                # print("s_links".ljust(LJUST), s_links)

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
