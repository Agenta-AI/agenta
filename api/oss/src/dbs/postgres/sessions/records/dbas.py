import uuid_utils.compat as uuid

from sqlalchemy import Column, UUID, TIMESTAMP, String, Integer
from sqlalchemy.dialects.postgresql import JSONB


class RecordDBA:
    __abstract__ = True

    # Producer-supplied stable id (uuid5) where one exists, else a minted uuid4 fallback.
    # Not time-ordered — ordering rides on record_index (see get_records), not this id.
    record_id = Column(
        UUID(as_uuid=True),
        nullable=False,
        default=uuid.uuid4,
    )

    session_id = Column(
        String,
        nullable=False,
    )

    # Producer-stamped per-turn ordinal and the in-session ordering key (record_id is
    # no longer time-ordered). Restarts at 0 each cold turn, so reads tiebreak with
    # created_at (ingest time) ahead of it — see get_records.
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
