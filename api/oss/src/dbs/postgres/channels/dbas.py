from sqlalchemy import Column, Enum, String
from sqlalchemy.dialects.postgresql import UUID

from oss.src.core.channels.dtos import (
    ChannelDeliveryState,
    ChannelEventOrigin,
    ChannelGrantEffect,
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


class ChannelConnectionDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    SlugDBA,
    HeaderDBA,
    DataDBA,
    StatusDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    # the registry key ("slack", "bridge"); a plain String because a third
    # party cannot add a member to a Python enum
    channel = Column(String, nullable=False)
    external_key = Column(UUID(as_uuid=True), nullable=False)


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
    effect = Column(Enum(ChannelGrantEffect), nullable=False)
    # String, not the space's own kind enum: exactly one of kind/space_id is
    # set, enforced at the DTO and by the two partial unique indexes below —
    # never both null, which the old single not-null space_id used to rule
    # out for free.
    kind = Column(String, nullable=True)
    space_id = Column(UUID(as_uuid=True), nullable=True)


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
    # no origin (addressing is always PUSHED); no is_trigger (every row is
    # one); no DataDBA (the payload lives on the event, not here)


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
    # no attempts (TaskIQ owns retries); no idempotency_key (derived at send
    # time, never stored)
