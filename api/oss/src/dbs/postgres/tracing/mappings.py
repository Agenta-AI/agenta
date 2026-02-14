from typing import Optional, List
from uuid import UUID
from datetime import datetime, timezone

from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.tracing.dbes import SpanDBE
from oss.src.core.tracing.dtos import (
    OTelLink,
    OTelHash,
    OTelReference,
    OTelFlatSpan,
    OTelSpan,
    OTelSpanKind,
    OTelStatusCode,
    TraceType,
    SpanType,
    #
    Bucket,
    Analytics,
)
from oss.src.core.tracing.utils import marshall, unmarshall


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
    existing_span_dbe.updated_at = datetime.now(timezone.utc)
    existing_span_dbe.updated_by_id = user_id

    return existing_span_dbe


def map_span_dbe_to_span_dto(
    span_dbe: SpanDBE,
) -> OTelSpan:
    _references = (
        [unmarshall(ref) for ref in span_dbe.references] if span_dbe.references else []
    )
    _links = [unmarshall(link) for link in span_dbe.links] if span_dbe.links else []
    _hashes = [unmarshall(hash) for hash in span_dbe.hashes] if span_dbe.hashes else []

    references: List[OTelReference] = [
        OTelReference(
            id=_reference.get("id"),
            slug=_reference.get("slug"),
            version=_reference.get("version"),
            attributes=_reference.get("attributes"),
        ).model_dump(mode="json", exclude_none=True)
        for _reference in _references
    ]

    links: List[OTelLink] = [
        OTelLink(
            trace_id=_link.get("trace_id"),
            span_id=_link.get("span_id"),
            attributes=_link.get("attributes"),
        ).model_dump(mode="json", exclude_none=True)
        for _link in _links
    ]

    hashes: List[OTelHash] = [
        OTelHash(
            id=_hash.get("id"),
            attributes=_hash.get("attributes"),
        ).model_dump(mode="json", exclude_none=True)
        for _hash in _hashes
    ]

    span_dto = OTelSpan(
        trace_id=str(span_dbe.trace_id),
        span_id=str(span_dbe.span_id),
        parent_id=str(span_dbe.parent_id) if span_dbe.parent_id else None,
        #
        trace_type=TraceType(span_dbe.trace_type),
        span_type=SpanType(span_dbe.span_type),
        #
        span_kind=OTelSpanKind(span_dbe.span_kind),
        span_name=span_dbe.span_name,
        #
        start_time=span_dbe.start_time,
        end_time=span_dbe.end_time,
        #
        status_code=OTelStatusCode(span_dbe.status_code),
        status_message=span_dbe.status_message,
        #
        attributes=span_dbe.attributes,
        #
        references=references if references else None,
        links=links if links else None,
        hashes=hashes if hashes else None,
        #
        events=span_dbe.events,
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
    project_id: UUID,
    span_dto: OTelFlatSpan,
    user_id: Optional[UUID] = None,
) -> SpanDBE:
    span_dbe = SpanDBE(
        project_id=project_id,
        #
        trace_id=UUID(span_dto.trace_id),
        span_id=UUID(span_dto.span_id),
        parent_id=UUID(span_dto.parent_id) if span_dto.parent_id else None,
        #
        trace_type=span_dto.trace_type,
        span_type=span_dto.span_type,
        #
        span_kind=span_dto.span_kind,
        span_name=span_dto.span_name,
        #
        start_time=span_dto.start_time,
        end_time=span_dto.end_time,
        #
        status_code=span_dto.status_code,
        status_message=span_dto.status_message,
        #
        attributes=span_dto.attributes,
        #
        references=(
            [
                marshall(ref.model_dump(mode="json", exclude_none=True))
                for ref in span_dto.references
            ]
            if span_dto.references
            else None
        ),
        links=(
            [
                marshall(link.model_dump(mode="json", exclude_none=True))
                for link in span_dto.links
            ]
            if span_dto.links
            else None
        ),
        hashes=(
            [
                marshall(hash.model_dump(mode="json", exclude_none=True))
                for hash in span_dto.hashes
            ]
            if span_dto.hashes
            else None
        ),
        #
        events=(
            [event.model_dump(mode="json") for event in span_dto.events]
            if span_dto.events
            else None
        ),
        # LIFECYCLE
        created_at=datetime.now(timezone.utc),
        created_by_id=user_id,
    )

    return span_dbe


def map_buckets(
    total_buckets: list,
    errors_buckets: list,
    interval: int,
    timestamps: Optional[List[datetime]] = None,
) -> List[Bucket]:
    total_metrics = {
        bucket.timestamp.isoformat(): Analytics(
            count=bucket.count,
            duration=bucket.duration,
            costs=bucket.costs,
            tokens=bucket.tokens,
        )
        for bucket in total_buckets
    }

    errors_metrics = {
        bucket.timestamp.isoformat(): Analytics(
            count=bucket.count,
            duration=bucket.duration,
            costs=bucket.costs,
            tokens=bucket.tokens,
        )
        for bucket in errors_buckets
    }

    total_timestamps = timestamps
    if not total_timestamps:
        total_timestamps = list(
            set(list(total_metrics.keys()) + list(errors_metrics.keys()))
        )
        total_timestamps.sort()

    # _total_timestamps = list(
    #     set(list(total_metrics.keys()) + list(errors_metrics.keys()))
    # )
    # _total_timestamps.sort()

    total_timestamps = [
        timestamp.isoformat() if isinstance(timestamp, datetime) else timestamp
        for timestamp in total_timestamps
    ]

    buckets = [
        Bucket(
            timestamp=timestamp,
            interval=interval,
            total=total_metrics.get(timestamp, Analytics()),
            errors=errors_metrics.get(timestamp, Analytics()),
        )
        for timestamp in total_timestamps
    ]

    return buckets
