from sqlalchemy import Index, PrimaryKeyConstraint

from oss.src.dbs.postgres.shared.base import Base
from ee.src.dbs.postgres.accounts.dbas import AccountTombstoneDBA


class AccountTombstoneDBE(Base, AccountTombstoneDBA):
    __tablename__ = "account_tombstones"

    __table_args__ = (
        PrimaryKeyConstraint("id"),
        # The signup path reads the newest tombstone of a hash; see migration
        # `ee0000000006`.
        Index(
            "idx_account_tombstones_email_hash_deleted_at",
            "email_hash",
            "deleted_at",
        ),
    )
