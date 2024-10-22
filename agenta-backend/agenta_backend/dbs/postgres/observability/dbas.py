from sqlalchemy import Column, UUID, TIMESTAMP, Enum as SQLEnum, String, BigInteger
from sqlalchemy.dialects.postgresql import HSTORE, JSON, JSONB

from agenta_backend.core.observability.dtos import StatusCode, TreeType, NodeType

from agenta_backend.dbs.postgres.shared.dbas import DisplayBase
from agenta_backend.dbs.postgres.shared.dbas import ProjectScopeDBA, LifecycleDBA


## --- TIME (DBA) --- ##


class TimeDBA(DisplayBase):  # TBD
    __abstract__ = True

    time_start = Column(TIMESTAMP, nullable=False)
    time_end = Column(TIMESTAMP, nullable=False)
    time_span = Column(BigInteger, nullable=True)


## --- STATUS (DBA) --- ##


class StatusDBA(DisplayBase):
    __abstract__ = True

    status_code = Column(SQLEnum(StatusCode), nullable=False)
    status_message = Column(String, nullable=True)


## --- EXCEPTIONS (DBA) --- ##


class ExceptionDBA(DisplayBase):
    __abstract__ = True

    exception = Column(JSON, nullable=True)


## --- ATTRIBUTES (DBA) --- ##


class AttributesDBA(DisplayBase):
    __abstract__ = True

    # inputs, internals, outputs, etc.
    data = Column(String, nullable=True)
    # scores, costs, tokens, durations, etc.
    metrics = Column(JSON, nullable=True)
    # configs, resources, etc.
    meta = Column(JSON, nullable=True)
    # tags, etc.
    tags = Column(HSTORE, nullable=True)
    # references, etc.
    refs = Column(HSTORE, nullable=True)


## --- HIERARCHICAL STRUCTURE --- ##


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


class LinksDBA(DisplayBase):
    __abstract__ = True

    links = Column(HSTORE, nullable=True)


class ParentDBA(DisplayBase):
    __abstract__ = True

    parent_id = Column(UUID(as_uuid=True), nullable=True)


## --- TABLES --- ##


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
    LinksDBA,
    OTelDBA,
):
    __abstract__ = True
