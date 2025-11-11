from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import Column, UUID, TIMESTAMP, Enum as ENUM, VARCHAR, func

from oss.src.core.tracing.dtos import OTelStatusCode as StatusCode
from oss.src.core.tracing.dtos import OTelSpanKind as SpanKind


class SpanDBA:
    __abstract__ = True

    trace_id = Column(UUID, nullable=False)
    span_id = Column(UUID, nullable=False)
    parent_id = Column(UUID, nullable=True)

    span_kind = Column(ENUM(SpanKind), nullable=False)
    span_name = Column(VARCHAR, nullable=False)

    start_time = Column(TIMESTAMP(timezone=True), nullable=False)
    end_time = Column(TIMESTAMP(timezone=True), nullable=False)

    status_code = Column(ENUM(StatusCode), nullable=False)
    status_message = Column(VARCHAR, nullable=True)

    attributes = Column(JSONB(none_as_null=True), nullable=True)
    events = Column(JSONB(none_as_null=True), nullable=True)
    links = Column(JSONB(none_as_null=True), nullable=True)
    references = Column(JSONB(none_as_null=True), nullable=True)


# class FullTextSearchDBA:
#     content = Column(
#         VARCHAR,
#         nullable=True,
#     )  # for full text search


class ProjectScopeDBA:
    project_id = Column(
        UUID,
        nullable=False,
    )  # for project scope


class LifecycleDBA:
    created_at = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        onupdate=func.now(),
        nullable=True,
    )
    deleted_at = Column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    created_by_id = Column(
        UUID,
        nullable=False,
    )
    updated_by_id = Column(
        UUID,
        nullable=True,
    )
    deleted_by_id = Column(
        UUID,
        nullable=True,
    )
