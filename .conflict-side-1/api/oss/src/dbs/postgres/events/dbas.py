from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import Column, UUID, TIMESTAMP, String


class EventDBA:
    __abstract__ = True

    request_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    event_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )

    request_type = Column(
        String,
        nullable=False,
    )
    event_type = Column(
        String,
        nullable=False,
    )

    timestamp = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
    )

    status_code = Column(
        String,
        nullable=True,
    )
    status_message = Column(
        String,
        nullable=True,
    )

    attributes = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )
