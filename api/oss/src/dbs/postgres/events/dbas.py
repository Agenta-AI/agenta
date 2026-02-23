from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import Column, UUID, TIMESTAMP, Enum as ENUM, VARCHAR, String

from oss.src.core.events.types import FlowType
from oss.src.core.tracing.dtos import OTelStatusCode as StatusCode
#


class EventDBA:
    __abstract__ = True

    flow_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    event_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    #
    #
    #
    #

    flow_type = Column(
        ENUM(FlowType),
        nullable=False,
    )
    event_type = Column(
        String,
        nullable=False,
    )

    #
    #
    #
    #
    event_name = Column(
        VARCHAR,
        nullable=False,
    )

    timestamp = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
    )
    #
    #
    #
    #

    status_code = Column(
        ENUM(StatusCode),
        nullable=True,
    )
    status_message = Column(
        VARCHAR,
        nullable=True,
    )

    attributes = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )

    #
    #
    #
    #
    #
    #
    #
    #
    #
    #
    #
    #

    #
    #
    #
    #
