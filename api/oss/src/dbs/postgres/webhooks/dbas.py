from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    HeaderDBA,
    DataDBA,
    FlagsDBA,
    MetaDBA,
    TagsDBA,
    LifecycleDBA,
    ProjectScopeDBA,
)


class WebhookSubscriptionDBA(
    IdentifierDBA,
    HeaderDBA,
    DataDBA,
    FlagsDBA,
    MetaDBA,
    TagsDBA,
    LifecycleDBA,
    ProjectScopeDBA,
):
    __abstract__ = True

    # Reference to a vault secret row used for webhook signing.
    secret_id = Column(UUID(as_uuid=True), nullable=True)


class WebhookDeliveryDBA(
    IdentifierDBA,
    DataDBA,
    LifecycleDBA,
):
    __abstract__ = True

    subscription_id = Column(UUID(as_uuid=True), nullable=False)
    event_id = Column(UUID(as_uuid=True), nullable=False)
    status = Column(String(20), nullable=False)
