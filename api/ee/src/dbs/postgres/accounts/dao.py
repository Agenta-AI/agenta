from datetime import datetime
from typing import List, Optional

import uuid_utils.compat as uuid_utils
from sqlalchemy import func, select
from uuid import UUID

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)

from ee.src.core.accounts.types import (
    AccountTombstone,
    AccountTombstoneCreate,
    AccountTombstonesDAOInterface,
    WalletTotals,
)
from ee.src.dbs.postgres.accounts.dbes import AccountTombstoneDBE
from ee.src.dbs.postgres.accounts.mappings import map_tombstone_dbe_to_dto
from ee.src.dbs.postgres.wallets.dbes import WalletCreditDBE, WalletDebitDBE


class AccountTombstonesDAO(AccountTombstonesDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def read_wallet_totals(self, *, organization_ids: List[UUID]) -> WalletTotals:
        if not organization_ids:
            return WalletTotals()
        async with self.engine.session() as session:
            # Deleted and expired rows count too: the tombstone is an audit total.
            granted = (
                await session.execute(
                    select(
                        func.coalesce(func.sum(WalletCreditDBE.amount_musd), 0)
                    ).where(WalletCreditDBE.organization_id.in_(organization_ids))
                )
            ).scalar_one()
            spent = (
                await session.execute(
                    select(
                        func.coalesce(func.sum(WalletDebitDBE.amount_musd), 0)
                    ).where(WalletDebitDBE.organization_id.in_(organization_ids))
                )
            ).scalar_one()
        return WalletTotals(granted_musd=int(granted), spent_musd=int(spent))

    async def create(self, *, tombstone: AccountTombstoneCreate) -> AccountTombstone:
        dbe = AccountTombstoneDBE(
            id=uuid_utils.uuid7(),
            email_hash=tombstone.email_hash,
            deleted_at=tombstone.deleted_at,
            organization_ids=[str(oid) for oid in tombstone.organization_ids],
            credits_granted_musd=tombstone.credits_granted_musd,
            credits_spent_musd=tombstone.credits_spent_musd,
        )
        async with self.engine.session() as session:
            session.add(dbe)
            await session.flush()
            await session.refresh(dbe)
            return map_tombstone_dbe_to_dto(dbe)

    async def find_newest(
        self, *, email_hash: str, deleted_since: datetime
    ) -> Optional[AccountTombstone]:
        async with self.engine.session() as session:
            dbe = (
                await session.execute(
                    select(AccountTombstoneDBE)
                    .where(
                        AccountTombstoneDBE.email_hash == email_hash,
                        AccountTombstoneDBE.deleted_at >= deleted_since,
                    )
                    .order_by(AccountTombstoneDBE.deleted_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            return map_tombstone_dbe_to_dto(dbe) if dbe is not None else None
