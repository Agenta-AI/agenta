from typing import Optional
from uuid import UUID

from sqlalchemy import delete, select, text

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)

from ee.src.core.licenses.interfaces import LicensesDAOInterface
from ee.src.core.licenses.types import StoredLicense
from ee.src.dbs.postgres.licenses.dbes import LicenseDBE


def _to_stored(dbe: LicenseDBE) -> StoredLicense:
    return StoredLicense(
        key_id=dbe.id,
        key=dbe.key,
        created_at=dbe.created_at,
        created_by_id=dbe.created_by_id,
    )


class LicensesDAO(LicensesDAOInterface):
    def __init__(self, engine: Optional[TransactionsEngine] = None):
        self.engine = engine or get_transactions_engine()

    async def read(self) -> Optional[StoredLicense]:
        async with self.engine.session() as session:
            dbe = (
                await session.execute(
                    select(LicenseDBE).order_by(LicenseDBE.created_at.desc()).limit(1)
                )
            ).scalar_one_or_none()
            return _to_stored(dbe) if dbe else None

    async def replace(
        self,
        *,
        key_id: UUID,
        key: str,
        created_by_id: UUID,
    ) -> StoredLicense:
        async with self.engine.session() as session:
            # Two concurrent replaces would each delete only the rows they saw and
            # both insert; the table lock keeps it at one row.
            await session.execute(text("LOCK TABLE licenses IN EXCLUSIVE MODE"))
            await session.execute(delete(LicenseDBE))
            dbe = LicenseDBE(id=key_id, key=key, created_by_id=created_by_id)
            session.add(dbe)
            await session.commit()
            await session.refresh(dbe)
            return _to_stored(dbe)
