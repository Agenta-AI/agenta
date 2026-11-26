from sqlalchemy import TIMESTAMP, Column, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from oss.src.dbs.postgres.shared.dbas import (
    DataDBA,
    FlagsDBA,
    HeaderDBA,
    IdentifierDBA,
    LifecycleDBA,
    MetaDBA,
    ProjectScopeDBA,
    StatusDBA,
    TagsDBA,
)


class TriggerSubscriptionDBA(
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

    connection_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )

    trigger_id = Column(
        String,
        nullable=True,
    )

    # The executing principal and the direct target agent (M2). artifact_id is NULL
    # for an environment-bound trigger and never cascades.
    principal_kind = Column(String, nullable=True)
    principal_id = Column(UUID(as_uuid=True), nullable=True)
    artifact_id = Column(UUID(as_uuid=True), nullable=True)


class TriggerScheduleDBA(
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

    # The executing principal and the direct target agent (M2). artifact_id is NULL
    # for an environment-bound trigger and never cascades.
    principal_kind = Column(String, nullable=True)
    principal_id = Column(UUID(as_uuid=True), nullable=True)
    artifact_id = Column(UUID(as_uuid=True), nullable=True)

    # A one-time schedule's fire time (`data.run_at`); NULL for a cron schedule. A
    # column, not a `data` key, so the one-time pass reads due rows by index.
    run_at = Column(TIMESTAMP(timezone=True), nullable=True)

    # The stored authority of a schedule that server code created
    # (`TriggersService.create_session_schedule`). Server-owned: no route reads or
    # writes it, and no response returns it.
    run_envelope = Column(JSONB(none_as_null=True), nullable=True)


class TriggerDeliveryDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    StatusDBA,
    DataDBA,
):
    __abstract__ = True

    subscription_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )

    schedule_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )

    # provider metadata.id — an arbitrary provider string, unique per parent
    event_id = Column(
        String,
        nullable=False,
    )
