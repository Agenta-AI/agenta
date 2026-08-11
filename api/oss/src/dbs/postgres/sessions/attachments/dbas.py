from sqlalchemy import BigInteger, Column, String, TIMESTAMP, UUID

from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
)


class SessionAttachmentDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
):
    __abstract__ = True

    session_id = Column(String, nullable=False)
    mount_id = Column(UUID(as_uuid=True), nullable=False)
    path = Column(String, nullable=False)
    filename = Column(String, nullable=False)
    media_type = Column(String, nullable=False)
    size = Column(BigInteger, nullable=False)
    kind = Column(String, nullable=False)
    state = Column(String, nullable=False)
    idempotency_key = Column(String, nullable=False)
    content_digest = Column(String, nullable=False)
    referenced_at = Column(TIMESTAMP(timezone=True), nullable=True)
