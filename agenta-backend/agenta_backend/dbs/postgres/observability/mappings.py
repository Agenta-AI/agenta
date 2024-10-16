from uuid import UUID

from agenta_backend.dbs.postgres.observability.dbes import InvocationSpanDBE

from agenta_backend.core.shared.dtos import ProjectScopeDTO, LifecycleDTO
from agenta_backend.core.observability.dtos import SpanDTO, SpanCreateDTO
from agenta_backend.core.observability.dtos import (
    RootDTO,
    TreeDTO,
    NodeDTO,
    ParentDTO,
    TimeDTO,
    StatusDTO,
    LinkDTO,
    OTelExtraDTO,
)


def map_span_dbe_to_dto(span: InvocationSpanDBE) -> SpanDTO:
    return SpanDTO(
        scope=ProjectScopeDTO(
            project_id=span.project_id.hex,
        ),
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
            span=span.time_span,
        ),
        status=StatusDTO(
            code=span.status_code,
            message=span.status_message,
        ),
        # ATTRIBUTES
        data=span.data,
        metrics=span.metrics,
        meta=span.meta,
        tags=span.tags,
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


def map_span_create_dto_to_dbe(
    span_create_dto: SpanCreateDTO,
) -> InvocationSpanDBE:
    span_dbe = InvocationSpanDBE(
        # SCOPE
        project_id=span_create_dto.scope.project_id,
        # LIFECYCLE
        # ---------
        # ROOT
        root_id=span_create_dto.root.id,
        # TREE
        tree_id=span_create_dto.tree.id,
        tree_type=(span_create_dto.tree.type),
        # NODE
        node_id=span_create_dto.node.id,
        node_type=(span_create_dto.node.type),
        node_name=span_create_dto.node.name,
        # PARENT
        parent_id=span_create_dto.parent.id if span_create_dto.parent else None,
        # TIME
        time_start=span_create_dto.time.start,
        time_end=span_create_dto.time.end,
        time_span=span_create_dto.time.span,
        # STATUS
        status_code=span_create_dto.status.code,
        status_message=span_create_dto.status.message,
        # ATTRIBUTES
        data=span_create_dto.data,
        metrics=span_create_dto.metrics,
        meta=span_create_dto.meta,
        tags=span_create_dto.tags,
        refs=span_create_dto.refs,
        # LINKS
        links=(
            {
                str(link.id): f"{link.type}:{link.tree_id.hex[:16]}"
                for link in span_create_dto.links
            }
            if span_create_dto.links
            else None
        ),
        # OTEL
        otel=span_create_dto.otel.model_dump(exclude_none=True),
    )

    return span_dbe


def map_span_dto_to_dbe(
    span_dto: SpanDTO,
) -> InvocationSpanDBE:
    span_dbe = InvocationSpanDBE(
        # SCOPE
        project_id=span_dto.scope.project_id,
        # LIFECYCLE
        created_at=span_dto.lifecycle.created_at,
        updated_at=span_dto.lifecycle.updated_at,
        updated_by_id=span_dto.lifecycle.updated_by_id,
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
        parent_id=span_dto.parent.id if span_dto.parent.span_id else None,
        # TIME
        time_start=span_dto.time.start,
        time_end=span_dto.time.end,
        time_span=span_dto.time.span,
        # STATUS
        status_code=span_dto.status.code,
        status_message=span_dto.status.message,
        # ATTRIBUTES
        data=span_dto.data,
        metrics=span_dto.metrics,
        meta=span_dto.meta,
        tags=span_dto.tags,
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


def map_span_dbe_to_dict(dbe: InvocationSpanDBE) -> dict:
    return {c.name: getattr(dbe, c.name) for c in dbe.__table__.columns}
