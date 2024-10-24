from sqlalchemy import Column, UUID, TIMESTAMP, Enum as SQLEnum, String
from sqlalchemy.dialects.postgresql import HSTORE, JSONB

from agenta_backend.core.observability.dtos import TreeType, NodeType

from agenta_backend.dbs.postgres.shared.dbas import DisplayBase
from agenta_backend.dbs.postgres.shared.dbas import ProjectScopeDBA, LifecycleDBA


class RootDBA(DisplayBase):
    __abstract__ = True

    root_id = Column(UUID(as_uuid=True), nullable=False)


class TreeDBA(DisplayBase):
    __abstract__ = True

    tree_id = Column(UUID(as_uuid=True), nullable=False)
    tree_type = Column(SQLEnum(TreeType), nullable=True)


class NodeDBA(DisplayBase):
    __abstract__ = True

    node_id = Column(UUID(as_uuid=True), nullable=False)
    node_name = Column(String, nullable=False)
    node_type = Column(SQLEnum(NodeType), nullable=True)


class ParentDBA(DisplayBase):
    __abstract__ = True

    parent_id = Column(UUID(as_uuid=True), nullable=True)


class TimeDBA(DisplayBase):
    __abstract__ = True

    time_start = Column(TIMESTAMP, nullable=False)
    time_end = Column(TIMESTAMP, nullable=False)


class StatusDBA(DisplayBase):
    __abstract__ = True

    status = Column(JSONB, nullable=True)


class ExceptionDBA(DisplayBase):
    __abstract__ = True

    exception = Column(JSONB, nullable=True)


class AttributesDBA(DisplayBase):
    __abstract__ = True

    data = Column(String, nullable=True)  # STRING for full-text search
    metrics = Column(JSONB, nullable=True)
    meta = Column(JSONB, nullable=True)
    refs = Column(HSTORE, nullable=True)  # HSTORE for fast querying
    links = Column(HSTORE, nullable=True)  # HSTORE for fast querying


class OTelDBA(DisplayBase):
    __abstract__ = True

    otel = Column(JSONB, nullable=False)


class SpanDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    RootDBA,
    TreeDBA,
    NodeDBA,
    ParentDBA,
    TimeDBA,
    StatusDBA,
    ExceptionDBA,
    AttributesDBA,
    OTelDBA,
):
    __abstract__ = True
