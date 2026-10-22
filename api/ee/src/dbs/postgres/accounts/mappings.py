from uuid import UUID

from ee.src.core.accounts.types import AccountTombstone
from ee.src.dbs.postgres.accounts.dbes import AccountTombstoneDBE


def map_tombstone_dbe_to_dto(dbe: AccountTombstoneDBE) -> AccountTombstone:
    return AccountTombstone(
        id=dbe.id,
        email_hash=dbe.email_hash,
        account_deleted_at=dbe.account_deleted_at,
        organization_ids=[UUID(str(oid)) for oid in (dbe.organization_ids or [])],
        credits_granted_musd=dbe.credits_granted_musd,
        credits_spent_musd=dbe.credits_spent_musd,
    )
