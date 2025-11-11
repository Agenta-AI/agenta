from typing import Optional, List
from json import dumps
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.tracing.dbes import SpanDBE
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelSpan,
    OTelSpanKind,
    OTelStatusCode,
    Link,
)
from oss.src.core.tracing.utils import marshall, unmarshall, parse_ref_id_to_uuid
from oss.src.core.shared.dtos import Reference


log = get_module_logger(__name__)


def map_span_dbe_to_link_dto(
    span_dbe: SpanDBE,
) -> OTelLink:
    link = OTelLink(
        trace_id=UUID(str(span_dbe.trace_id)).hex,
        span_id=UUID(str(span_dbe.span_id)).hex[16:],
    )

    return link


def map_span_dbe_to_span_dbe(
    existing_span_dbe: SpanDBE,
    new_span_dbe: SpanDBE,
    user_id: Optional[UUID] = None,
) -> SpanDBE:
    # existing_span_dbe.trace_id = new_span_dbe.trace_id
    # existing_span_dbe.span_id = new_span_dbe.span_id
    existing_span_dbe.parent_id = new_span_dbe.parent_id
    existing_span_dbe.span_kind = new_span_dbe.span_kind
    existing_span_dbe.span_name = new_span_dbe.span_name
    existing_span_dbe.start_time = new_span_dbe.start_time
    existing_span_dbe.end_time = new_span_dbe.end_time
    existing_span_dbe.status_code = new_span_dbe.status_code
    existing_span_dbe.status_message = new_span_dbe.status_message
    existing_span_dbe.attributes = new_span_dbe.attributes
    existing_span_dbe.events = new_span_dbe.events
    existing_span_dbe.links = new_span_dbe.links
    # LIFECYCLE
    existing_span_dbe.updated_by_id = user_id
    # FULL TEXT SEARCH
    # existing_span_dbe.content = dumps(
    #     map_span_dbe_to_span_dto(new_span_dbe).model_dump()
    # )

    return existing_span_dbe


def map_span_dbe_to_span_dto(
    span_dbe: SpanDBE,
) -> OTelSpan:
    span_dto = OTelSpan(
        trace_id=str(span_dbe.trace_id),
        span_id=str(span_dbe.span_id),
        parent_id=str(span_dbe.parent_id) if span_dbe.parent_id else None,
        span_kind=OTelSpanKind(span_dbe.span_kind),
        span_name=span_dbe.span_name,
        start_time=span_dbe.start_time,
        end_time=span_dbe.end_time,
        status_code=OTelStatusCode(span_dbe.status_code),
        status_message=span_dbe.status_message,
        attributes=span_dbe.attributes,
        events=span_dbe.events,
        # links=span_dbe.links.values() if span_dbe.links else None,
        links=(
            [Link(**unmarshall(link)) for link in span_dbe.links]
            if span_dbe.links
            else None
        ),
        # LIFECYCLE
        created_at=span_dbe.created_at,
        updated_at=span_dbe.updated_at,
        deleted_at=span_dbe.deleted_at,
        created_by_id=span_dbe.created_by_id,
        updated_by_id=span_dbe.updated_by_id,
        deleted_by_id=span_dbe.deleted_by_id,
    )

    return span_dto


def map_span_dto_to_span_dbe(
    project_id: str,
    span_dto: OTelSpan,
    user_id: Optional[UUID] = None,
) -> SpanDBE:
    references: Optional[List[Reference]] = span_dto.attributes.get("agenta", {}).get(
        "references", None
    )

    if references:
        for reference in references:
            try:
                if reference["id"]:
                    reference["id"] = parse_ref_id_to_uuid(reference["id"])
            except Exception as e:  # pylint: disable=broad-exception-caught
                log.warning(f"Failed to parse reference id {reference} to UUID: {e}")

    span_dbe = SpanDBE(
        project_id=project_id,
        trace_id=UUID(span_dto.trace_id),
        span_id=UUID(span_dto.span_id),
        parent_id=UUID(span_dto.parent_id) if span_dto.parent_id else None,
        span_kind=span_dto.span_kind,
        span_name=span_dto.span_name,
        start_time=span_dto.start_time,
        end_time=span_dto.end_time,
        status_code=span_dto.status_code,
        status_message=span_dto.status_message,
        attributes=span_dto.attributes,
        events=(
            [event.model_dump() for event in span_dto.events]
            if span_dto.events
            else None
        ),
        links=(
            [marshall(link.model_dump()) for link in span_dto.links]
            if span_dto.links
            else None
        ),
        references=(
            [marshall(reference) for reference in references] if references else None
        ),
        # LIFECYCLE
        created_by_id=user_id,
        # FULL TEXT SEARCH
        # content=dumps(span_dto.model_dump()),
    )

    return span_dbe
