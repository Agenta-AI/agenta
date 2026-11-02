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
