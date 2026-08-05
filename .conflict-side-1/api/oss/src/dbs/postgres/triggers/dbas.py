from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import UUID

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
