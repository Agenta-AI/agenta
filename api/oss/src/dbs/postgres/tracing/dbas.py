from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import Column, UUID, TIMESTAMP, Enum as ENUM, VARCHAR

from oss.src.core.tracing.dtos import TraceType, SpanType
from oss.src.core.tracing.dtos import OTelStatusCode as StatusCode
from oss.src.core.tracing.dtos import OTelSpanKind as SpanKind


class SpanDBA:
    __abstract__ = True

    trace_id = Column(
        UUID,
        nullable=False,
    )
    span_id = Column(
        UUID,
        nullable=False,
    )
    parent_id = Column(
        UUID,
        nullable=True,
    )

    trace_type = Column(
        ENUM(TraceType),
        nullable=True,
    )
    span_type = Column(
        ENUM(SpanType),
        nullable=True,
    )

    span_kind = Column(
        ENUM(SpanKind),
        nullable=False,
    )
    span_name = Column(
        VARCHAR,
        nullable=False,
    )

    start_time = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
    )
    end_time = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
    )

    status_code = Column(
        ENUM(StatusCode),
        nullable=False,
    )
    status_message = Column(
        VARCHAR,
        nullable=True,
    )

    # Promoted from ag.session/user/agent attributes at ingest_span_dtos. `session_id`
    # is set on every span that carries a session id, and on the spans of a trace whose
    # root carries one in the same batch (the trace read scope reads it). `user_id`
    # and `agent_id` are root-span-only.
    session_id = Column(
        VARCHAR,
        nullable=True,
    )
    user_id = Column(
        VARCHAR,
        nullable=True,
    )
    agent_id = Column(
        VARCHAR,
        nullable=True,
    )

    attributes = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )

    references = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
    links = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
    hashes = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )

    events = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
