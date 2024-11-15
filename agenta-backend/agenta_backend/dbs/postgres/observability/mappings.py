from typing import List, Tuple, Optional
from json import dumps, loads
from datetime import datetime

from agenta_backend.core.shared.dtos import LifecycleDTO
from agenta_backend.core.observability.dtos import (
    RootDTO,
    TreeDTO,
    NodeDTO,
    ParentDTO,
    TimeDTO,
    StatusDTO,
    ExceptionDTO,
    OTelExtraDTO,
    SpanDTO,
    MetricsDTO,
    BucketDTO,
)

from agenta_backend.dbs.postgres.observability.dbes import NodesDBE


def map_span_dbe_to_dto(span: NodesDBE) -> SpanDTO:
    return SpanDTO(
        lifecycle=LifecycleDTO(
            created_at=span.created_at,
            updated_at=span.updated_at,
            updated_by_id=str(span.updated_by_id) if span.updated_by_id else None,
        ),
        root=RootDTO(
            id=span.root_id,
        ),
        tree=TreeDTO(
            id=span.tree_id,
            type=span.tree_type,
        ),
        node=NodeDTO(
            id=span.node_id,
            type=span.node_type,
            name=span.node_name,
        ),
        parent=(
            ParentDTO(
                id=span.parent_id,
            )
            if span.parent_id
            else None
        ),
        time=TimeDTO(
            start=span.time_start,
            end=span.time_end,
        ),
        status=StatusDTO(
            code=span.status.get("code"),
            message=span.status.get("message"),
        ),
        # ATTRIBUTES
        data=span.data,
        metrics=span.metrics,
        meta=span.meta,
        refs=span.refs,
        # EVENTS
        exception=(
            ExceptionDTO(
                timestamp=span.exception.get("timestamp"),
                type=span.exception.get("type"),
                message=span.exception.get("message"),
                stacktrace=span.exception.get("stacktrace"),
                attributes=span.exception.get("attributes"),
            )
            if span.exception
            else None
        ),
        # LINKS
        links=span.links,
        # OTEL
        otel=OTelExtraDTO(**span.otel) if span.otel else None,
    )


def map_span_dto_to_dbe(
    project_id: str,
    span_dto: SpanDTO,
) -> NodesDBE:
    span_dbe = NodesDBE(
        # SCOPE
        project_id=project_id,
        # LIFECYCLE
        created_at=span_dto.lifecycle.created_at if span_dto.lifecycle else None,
        updated_at=span_dto.lifecycle.updated_at if span_dto.lifecycle else None,
        updated_by_id=span_dto.lifecycle.updated_by_id if span_dto.lifecycle else None,
        # ROOT
        root_id=span_dto.root.id,
        # TREE
        tree_id=span_dto.tree.id,
        tree_type=span_dto.tree.type,
        # NODE
        node_id=span_dto.node.id,
        node_type=span_dto.node.type,
        node_name=span_dto.node.name,
        # PARENT
        parent_id=span_dto.parent.id if span_dto.parent else None,
        # TIME
        time_start=span_dto.time.start,
        time_end=span_dto.time.end,
        # STATUS
        status=(
            span_dto.status.model_dump(exclude_none=True) if span_dto.status else None
        ),
        # ATTRIBUTES
        data=span_dto.encode(span_dto.data),
        metrics=span_dto.encode(span_dto.metrics),
        meta=span_dto.encode(span_dto.meta),
        refs=span_dto.encode(span_dto.refs),
        # EVENTS
        exception=(
            loads(span_dto.exception.model_dump_json()) if span_dto.exception else None
        ),
        # LINKS
        links=(
            [loads(link.model_dump_json()) for link in span_dto.links]
            if span_dto.links
            else None
        ),
        # FULL TEXT SEARCH
        content=dumps(span_dto.data),
        # OTEL
        otel=loads(span_dto.otel.model_dump_json()) if span_dto.otel else None,
    )

    return span_dbe


def map_bucket_dbes_to_dtos(
    total_bucket_dbes: List[NodesDBE],
    error_bucket_dbes: List[NodesDBE],
    window: int,
    timestamps: Optional[List[datetime]] = None,
) -> Tuple[List[BucketDTO], int]:
    total_metrics = {
        bucket.timestamp: MetricsDTO(
            count=bucket.count,
            duration=bucket.duration,
            cost=bucket.cost,
            tokens=bucket.tokens,
        )
        for bucket in total_bucket_dbes
    }

    error_metrics = {
        bucket.timestamp: MetricsDTO(
            count=bucket.count,
            duration=bucket.duration,
            cost=bucket.cost,
            tokens=bucket.tokens,
        )
        for bucket in error_bucket_dbes
    }

    total_timestamps = timestamps
    if not total_timestamps:
        total_timestamps = list(
            set(list(total_metrics.keys()) + list(error_metrics.keys()))
        )
        total_timestamps.sort()

    _total_timestamps = list(
        set(list(total_metrics.keys()) + list(error_metrics.keys()))
    )
    _total_timestamps.sort()

    bucket_dtos = [
        BucketDTO(
            timestamp=timestamp,
            window=window,
            total=total_metrics.get(timestamp, MetricsDTO()),
            error=error_metrics.get(timestamp, MetricsDTO()),
        )
        for timestamp in total_timestamps
    ]

    count = len(bucket_dtos)

    return bucket_dtos, count
