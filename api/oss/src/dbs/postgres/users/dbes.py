from sqlalchemy import (
    ForeignKeyConstraint,
    UniqueConstraint,
    Index,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.users.dbas import UserIdentityDBA


class UserIdentityDBE(Base, UserIdentityDBA):
    __tablename__ = "user_identities"

    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "method",
            "subject",
            name="uq_user_identities_method_subject",
        ),
        Index(
            "ix_user_identities_user_method",
            "user_id",
            "method",
        ),
        Index(
            "ix_user_identities_domain",
            "domain",
        ),
    )
