import uuid_utils.compat as uuid
from sqlalchemy import Column, String, UUID

from oss.src.dbs.postgres.shared.dbas import LegacyLifecycleDBA


class UserIdentityDBA(LegacyLifecycleDBA):
    __abstract__ = True

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid7,
        unique=True,
        nullable=False,
    )
    user_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    method = Column(
        String,
        nullable=False,
    )
    subject = Column(
        String,
        nullable=False,
    )
    domain = Column(
        String,
        nullable=True,
    )
