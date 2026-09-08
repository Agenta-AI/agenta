from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
)


class ChannelIdentityLinkDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
):
    __abstract__ = True

    connection_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    external_user_key = Column(String, nullable=False)
