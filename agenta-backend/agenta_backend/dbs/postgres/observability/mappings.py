from uuid import UUID
from json import dumps, loads

from agenta_backend.core.shared.dtos import LifecycleDTO
from agenta_backend.core.observability.dtos import (
    RootDTO,
    TreeDTO,
    NodeDTO,
    ParentDTO,
    TimeDTO,
    StatusDTO,
    ExceptionDTO,
    LinkDTO,
    OTelExtraDTO,
    SpanDTO,
)

from agenta_backend.dbs.postgres.observability.dbes import InvocationSpanDBE


def map_span_dbe_to_dto(span: InvocationSpanDBE) -> SpanDTO:
    return SpanDTO(
        lifecycle=LifecycleDTO(
            created_at=span.created_at,
            updated_at=span.updated_at,
            updated_by_id=span.updated_by_id.hex if span.updated_by_id else None,
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
        # ATTRIBUTES
        data=loads(span.data),
        metrics=span.metrics,
        meta=span.meta,
        refs=span.refs,
        # ----------
        links=(
            [
                LinkDTO(
                    type=link.split(":")[0],
                    tree_id=link.split(":")[1] + UUID(id).hex[:16],
                    id=id,
                )
                for id, link in span.links.items()
            ]
            if span.links
            else None
        ),
        otel=OTelExtraDTO(**span.otel),
    )


def map_span_dto_to_dbe(
    project_id: str,
    span_dto: SpanDTO,
) -> InvocationSpanDBE:
    span_dbe = InvocationSpanDBE(
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
        # EXCEPTION
        exception=(span_dto.exception.to_json() if span_dto.exception else None),
        # ATTRIBUTES
        data=dumps(span_dto.data),
        metrics=span_dto.metrics,
        meta=span_dto.meta,
        refs=span_dto.refs,
        # LINKS
        links=(
            {
                str(link.id): f"{link.type}:{link.tree_id.hex[:16]}"
                for link in span_dto.links
            }
            if span_dto.links
            else None
        ),
        # OTEL
        otel=span_dto.otel.model_dump(exclude_none=True),
    )

    return span_dbe
