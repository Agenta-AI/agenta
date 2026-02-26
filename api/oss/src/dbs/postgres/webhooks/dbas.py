from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    HeaderDBA,
    DataDBA,
    StatusDBA,
    FlagsDBA,
    MetaDBA,
    TagsDBA,
    LifecycleDBA,
    ProjectScopeDBA,
)


class WebhookSubscriptionDBA(
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

    secret_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )


class WebhookDeliveryDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    StatusDBA,
    DataDBA,
):
    __abstract__ = True

    subscription_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )

    event_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
