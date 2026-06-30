import uuid_utils.compat as uuid

from sqlalchemy import Column, UUID, Integer, String
from sqlalchemy.dialects.postgresql import JSONB


class RecordDBA:
    __abstract__ = True

    # PK — uuid7 provides time-ordered, globally-unique identity + ordering key.
    id = Column(
        UUID(as_uuid=True),
        nullable=False,
        default=uuid.uuid7,
    )

    session_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )

    event_index = Column(
        Integer,
        nullable=True,
    )
    sender = Column(
        String,
        nullable=True,
    )
    session_update = Column(
        String,
        nullable=True,
    )

    # JSONB — deliberate; payload is an event body, mirrors spans/events.
    payload = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
