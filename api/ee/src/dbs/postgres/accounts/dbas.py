"""Column mixin for the account tombstone DBE.

No foreign keys and no scope or lifecycle mixin: every id a tombstone holds points at a
row that no longer exists, and `account_deleted_at` is the event it records, not a soft
delete of the tombstone itself. `email_hash` is the only trace of the address; see
`ee.src.core.accounts.types.email_hash`.
"""

from sqlalchemy import BigInteger, Column, String
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID


class AccountTombstoneDBA:
    __abstract__ = True

    id = Column(UUID(as_uuid=True), nullable=False)

    email_hash = Column(String(64), nullable=False)
    account_deleted_at = Column(TIMESTAMP(timezone=True), nullable=False)

    organization_ids = Column(JSONB(none_as_null=True), nullable=False)
    credits_granted_musd = Column(BigInteger, nullable=False)
    credits_spent_musd = Column(BigInteger, nullable=False)
