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
    # otlp_stream = b"\n\x94$\n6\n\x18\n\x0cservice.name\x12\x08\n\x06agenta\n\x1a\n\x0fservice.version\x12\x07\n\x050.1.0\x12\x95\x1d\n1\n'opentelemetry.instrumentation.openai.v1\x12\x060.30.0\x12\xa3\x04\n\x10\xa6a\x98\x18A\x7fIj\x06D\xdaLp\xd0\xa2\xe0\x12\x08\xd9N#YhoL\n\"\x08\x1dh\x04X\xa0\xf4\xf8P*\x11openai.embeddings0\x039\x00\x90\xa2\tWP\xfa\x17A\x08\xb2  WP\xfa\x17J\x1f\n\x10llm.request.type\x12\x0b\n\tembeddingJ9\n\x0fag.extra.app_id\x12&\n$0191cb41-ecf9-7112-87fa-5e4a9ce72307J\x19\n\rgen_ai.system\x12\x08\n\x06OpenAIJ0\n\x14gen_ai.request.model\x12\x18\n\x16text-embedding-ada-002J\x15\n\x0bllm.headers\x12\x06\n\x04NoneJ\x16\n\x10llm.is_streaming\x12\x02\x10\x00JI\n\x17gen_ai.prompt.0.content\x12.\n,Movies about witches in the genre of comedy.J6\n\x16gen_ai.openai.api_base\x12\x1c\n\x1ahttps://api.openai.com/v1/J1\n\x15gen_ai.response.model\x12\x18\n\x16text-embedding-ada-002J\x1c\n\x16llm.usage.total_tokens\x12\x02\x18\tJ \n\x1agen_ai.usage.prompt_tokens\x12\x02\x18\tz\x00\x85\x01\x00\x01\x00\x00\x12\xb9\x18\n\x10\xa6a\x98\x18A\x7fIj\x06D\xdaLp\xd0\xa2\xe0\x12\x08\x1b\x05'\x8e\xb4\xaar\xda\"\x08\xac\t\x88\x86\x96\x87\xce\xb4*\x0bopenai.chat0\x039\x10h\x16&WP\xfa\x17A\x10{0qWP\xfa\x17J\x1a\n\x10llm.request.type\x12\x06\n\x04chatJ9\n\x0fag.extra.app_id\x12&\n$0191cb41-ecf9-7112-87fa-5e4a9ce72307J\x19\n\rgen_ai.system\x12\x08\n\x06OpenAIJ'\n\x14gen_ai.request.model\x12\x0f\n\rgpt-3.5-turboJ'\n\x1agen_ai.request.temperature\x12\t!\x9a\x99\x99\x99\x99\x99\xe9?J\x15\n\x0bllm.headers\x12\x06\n\x04NoneJ\x16\n\x10llm.is_streaming\x12\x02\x10\x00J6\n\x16gen_ai.openai.api_base\x12\x1c\n\x1ahttps://api.openai.com/v1/J \n\x14gen_ai.prompt.0.role\x12\x08\n\x06systemJ\x84\x11\n\x17gen_ai.prompt.0.content\x12\xe8\x10\n\xe5\x10Given the following list of suggested movies:\n\nThe Craft (1996) in ['Drama', 'Fantasy', 'Horror']: A newcomer to a Catholic prep high school falls in with a trio of outcast teenage girls who practice witchcraft and they all soon conjure up various spells and curses against those who even slightly anger them.\nWicked Stepmother (1989) in ['Comedy', 'Fantasy']: A mother/daughter pair of witches descend on a yuppie family's home and cause havoc, one at a time since they share one body & the other must live in a cat the rest of the time. Now it's up...\nOz the Great and Powerful (2013) in ['Adventure', 'Family', 'Fantasy']: A small-time magician is swept away to an enchanted land and is forced into a power struggle between three witches.\nInto the Woods (2014) in ['Adventure', 'Fantasy', 'Musical']: A witch tasks a childless baker and his wife with procuring magical items from classic fairy tales to reverse the curse put on their family tree.\nSnow White: A Tale of Terror (1997) in ['Fantasy', 'Horror']: In this dark take on the fairy tale, the growing hatred of a noblewoman, secretly a practitioner of the dark arts, for her stepdaughter, and the witch's horrifying attempts to kill her.\nBedknobs and Broomsticks (1971) in ['Adventure', 'Family', 'Fantasy']: An apprentice witch, three kids and a cynical conman search for the missing component to a magic spell useful to the defense of Britain.\nMy Neighbor Totoro (1988) in ['Animation', 'Family', 'Fantasy']: When two girls move to the country to be near their ailing mother, they have adventures with the wonderous forest spirits who live nearby.\nHocus Pocus (1993) in ['Comedy', 'Family', 'Fantasy']: After three centuries, three witch sisters are resurrected in Salem Massachusetts on Halloween night, and it is up to two teen-agers, a young girl, and an immortal cat to put an end to the witches' reign of terror once and for all.\nPractical Magic (1998) in ['Comedy', 'Fantasy', 'Romance']: The wry, comic romantic tale follows the Owens sisters, Sally and Gillian, as they struggle to use their hereditary gift for practical magic to overcome the obstacles in discovering true love.J\x1e\n\x14gen_ai.prompt.1.role\x12\x06\n\x04userJ]\n\x17gen_ai.prompt.1.content\x12B\n@Provide a list of 3 movies about witches in the genre of comedy.J-\n\x15gen_ai.response.model\x12\x14\n\x12gpt-3.5-turbo-0125J\x1d\n\x16llm.usage.total_tokens\x12\x03\x18\xc2\x04J$\n\x1egen_ai.usage.completion_tokens\x12\x02\x18*J!\n\x1agen_ai.usage.prompt_tokens\x12\x03\x18\x98\x04J+\n!gen_ai.completion.0.finish_reason\x12\x06\n\x04stopJ'\n\x18gen_ai.completion.0.role\x12\x0b\n\tassistantJ\xa7\x01\n\x1bgen_ai.completion.0.content\x12\x87\x01\n\x84\x01Here are 3 movies about witches in the genre of comedy:\n\n1. Wicked Stepmother (1989)\n2. Hocus Pocus (1993)\n3. Practical Magic (1998)z\x00\x85\x01\x00\x01\x00\x00\x12\xc1\x06\n\x0f\n\ragenta.tracer\x12\x86\x01\n\x10\xa6a\x98\x18A\x7fIj\x06D\xdaLp\xd0\xa2\xe0\x12\x08\x1dh\x04X\xa0\xf4\xf8P\"\x08\xac\xb2\x8e\xff\xb2\xe8\xea\x14*\x05embed0\x019@\xc1\x9f\tWP\xfa\x17A\xb0H- WP\xfa\x17J9\n\x0fag.extra.app_id\x12&\n$0191cb41-ecf9-7112-87fa-5e4a9ce72307z\x02\x18\x01\x85\x01\x00\x01\x00\x00\x12\x87\x01\n\x10\xa6a\x98\x18A\x7fIj\x06D\xdaLp\xd0\xa2\xe0\x12\x08\xcaD;\xdf \xbb\x13|\"\x08\xac\xb2\x8e\xff\xb2\xe8\xea\x14*\x06search0\x019`\xf0/ WP\xfa\x17A\xc0\x16\x03&WP\xfa\x17J9\n\x0fag.extra.app_id\x12&\n$0191cb41-ecf9-7112-87fa-5e4a9ce72307z\x02\x18\x01\x85\x01\x00\x01\x00\x00\x12\x8a\x01\n\x10\xa6a\x98\x18A\x7fIj\x06D\xdaLp\xd0\xa2\xe0\x12\x08\xac\xb2\x8e\xff\xb2\xe8\xea\x14\"\x08\x9f\xad5\xa6\\\xc9\xf9\xeb*\tretriever0\x019\xc8o\x9b\tWP\xfa\x17A\xd8w\x07&WP\xfa\x17J9\n\x0fag.extra.app_id\x12&\n$0191cb41-ecf9-7112-87fa-5e4a9ce72307z\x02\x18\x01\x85\x01\x00\x01\x00\x00\x12\x85\x01\n\x10\xa6a\x98\x18A\x7fIj\x06D\xdaLp\xd0\xa2\xe0\x12\x08\xac\t\x88\x86\x96\x87\xce\xb4\"\x08\xf8T\xa3\xe9\x07;\x90\x86*\x04chat0\x019\x08\xbd\x0f&WP\xfa\x17Ax\xfe:qWP\xfa\x17J9\n\x0fag.extra.app_id\x12&\n$0191cb41-ecf9-7112-87fa-5e4a9ce72307z\x02\x18\x01\x85\x01\x00\x01\x00\x00\x12\x89\x01\n\x10\xa6a\x98\x18A\x7fIj\x06D\xdaLp\xd0\xa2\xe0\x12\x08\xf8T\xa3\xe9\x07;\x90\x86\"\x08\x9f\xad5\xa6\\\xc9\xf9\xeb*\x08reporter0\x019\xb8\x17\n&WP\xfa\x17A0\x81<qWP\xfa\x17J9\n\x0fag.extra.app_id\x12&\n$0191cb41-ecf9-7112-87fa-5e4a9ce72307z\x02\x18\x01\x85\x01\x00\x01\x00\x00\x12z\n\x10\xa6a\x98\x18A\x7fIj\x06D\xdaLp\xd0\xa2\xe0\x12\x08\x9f\xad5\xa6\\\xc9\xf9\xeb*\x03rag0\x019(\x8a\x94\tWP\xfa\x17AX\x9e=qWP\xfa\x17J9\n\x0fag.extra.app_id\x12&\n$0191cb41-ecf9-7112-87fa-5e4a9ce72307z\x02\x18\x01\x85\x01\x00\x01\x00\x00"

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
