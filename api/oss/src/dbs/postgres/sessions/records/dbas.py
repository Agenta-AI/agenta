import uuid_utils.compat as uuid

from sqlalchemy import Column, UUID, TIMESTAMP, String, Integer
from sqlalchemy.dialects.postgresql import JSONB


class RecordDBA:
    __abstract__ = True

    # DB-minted uuid7 — records have no upstream id (unlike span_id/event_id).
    # Time-ordered, so it doubles as the ordering key.
    record_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        default=uuid.uuid7,
    )

    session_id = Column(
        String,
        nullable=False,
    )

    # Producer-stamped per-session ordinal; not the ordering key (that is record_id),
    # kept as a stable human-readable sequence from the producer.
    record_index = Column(
        Integer,
        nullable=True,
    )

    # Producer (runner) event time, distinct from LifecycleDBA.created_at (ingest time).
    timestamp = Column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )

    # Top-level discriminators, mirroring span_type/span_kind and event_type.
    record_type = Column(
        String,
        nullable=True,
    )
    record_source = Column(
        String,
        nullable=True,
    )

    attributes = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
