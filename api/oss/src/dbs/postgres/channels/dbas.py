from sqlalchemy import Column, Enum, String
from sqlalchemy.dialects.postgresql import UUID

from oss.src.core.channels.dtos import (
    ChannelDeliveryState,
    ChannelEventOrigin,
    ChannelTriggerState,
)
from oss.src.dbs.postgres.shared.dbas import (
    DataDBA,
    FlagsDBA,
    HeaderDBA,
    IdentifierDBA,
    LifecycleDBA,
    MetaDBA,
    ProjectScopeDBA,
    SlugDBA,
    StatusDBA,
    TagsDBA,
)


class ChannelAgentDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    SlugDBA,
    HeaderDBA,
    DataDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    connection_id = Column(UUID(as_uuid=True), nullable=False)


class ChannelSpaceDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    HeaderDBA,
    DataDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    connection_id = Column(UUID(as_uuid=True), nullable=False)
    # String, not Enum: a new platform brings new space kinds (forums, teams),
    # and widening a DB enum needs a migration. Pydantic still validates.
    kind = Column(String, nullable=False)
    external_key = Column(UUID(as_uuid=True), nullable=False)


class ChannelGrantDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    HeaderDBA,
    DataDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    agent_id = Column(UUID(as_uuid=True), nullable=False)
    space_id = Column(UUID(as_uuid=True), nullable=False)


class ChannelThreadDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    DataDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    space_id = Column(UUID(as_uuid=True), nullable=False)
    agent_id = Column(UUID(as_uuid=True), nullable=False)
    external_key = Column(UUID(as_uuid=True), nullable=True)
    session_id = Column(String, nullable=False)


class ChannelInboxEventDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    DataDBA,
    StatusDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    connection_id = Column(UUID(as_uuid=True), nullable=False)
    external_id = Column(String, nullable=False)
    # String: platforms keep inventing addressing kinds. `origin` stays an Enum
    # — query_events_since orders by it, and only declaration order is a
    # guarantee; String's alphabetical order merely happens to agree today.
    kind = Column(String, nullable=False)
    origin = Column(Enum(ChannelEventOrigin), nullable=False)
    space_id = Column(UUID(as_uuid=True), nullable=True)


class ChannelInboxTriggerDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    StatusDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    thread_id = Column(UUID(as_uuid=True), nullable=False)
    event_id = Column(UUID(as_uuid=True), nullable=False)
    turn_id = Column(String, nullable=False)
    state = Column(Enum(ChannelTriggerState), nullable=False)
    # no origin (addressing is always PUSHED, §2.4); no is_trigger (every row
    # is one, §2.1); no DataDBA (the payload lives on the event, not here)


class ChannelOutboxEventDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    DataDBA,
    StatusDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    connection_id = Column(UUID(as_uuid=True), nullable=False)
    thread_id = Column(UUID(as_uuid=True), nullable=False)
    turn_id = Column(String, nullable=False)
    key = Column(UUID(as_uuid=True), nullable=False)
    state = Column(Enum(ChannelDeliveryState), nullable=False)
    # no attempts (TaskIQ owns retries, §2.7); no idempotency_key (derived at
    # send time, never stored, §2.6)
