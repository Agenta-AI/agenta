from sqlalchemy import Column, UUID, TIMESTAMP, Enum as SQLEnum, String
from sqlalchemy.dialects.postgresql import JSONB

from agenta_backend.core.observability.dtos import TreeType, NodeType

from agenta_backend.dbs.postgres.shared.dbas import ProjectScopeDBA, LifecycleDBA


class RootDBA:
    __abstract__ = True

    root_id = Column(UUID(as_uuid=True), nullable=False)


class TreeDBA:
    __abstract__ = True

    tree_id = Column(UUID(as_uuid=True), nullable=False)
    tree_type = Column(SQLEnum(TreeType), nullable=True)


class NodeDBA:
    __abstract__ = True

    node_id = Column(UUID(as_uuid=True), nullable=False)
    node_name = Column(String, nullable=False)
    node_type = Column(SQLEnum(NodeType), nullable=True)


class ParentDBA:
    __abstract__ = True

    parent_id = Column(UUID(as_uuid=True), nullable=True)


class TimeDBA:
    __abstract__ = True

    time_start = Column(TIMESTAMP, nullable=False)
    time_end = Column(TIMESTAMP, nullable=False)


class StatusDBA:
    __abstract__ = True

    status = Column(JSONB(none_as_null=True), nullable=True)


class AttributesDBA:
    __abstract__ = True

    data = Column(JSONB(none_as_null=True), nullable=True)
    metrics = Column(JSONB(none_as_null=True), nullable=True)
    meta = Column(JSONB(none_as_null=True), nullable=True)
    refs = Column(JSONB(none_as_null=True), nullable=True)


class EventsDBA:
    __abstract__ = True

    exception = Column(JSONB(none_as_null=True), nullable=True)


class LinksDBA:
    __abstract__ = True

    links = Column(JSONB(none_as_null=True), nullable=True)


class FullTextSearchDBA:
    __abstract__ = True

    content = Column(String, nullable=True)


class OTelDBA:
    __abstract__ = True

    otel = Column(JSONB(none_as_null=True), nullable=True)


class SpanDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    RootDBA,
    TreeDBA,
    NodeDBA,
    ParentDBA,
    TimeDBA,
    StatusDBA,
    AttributesDBA,
    EventsDBA,
    LinksDBA,
    FullTextSearchDBA,
    OTelDBA,
):
    __abstract__ = True
