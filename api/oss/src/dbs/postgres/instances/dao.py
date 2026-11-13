from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional
from uuid import UUID

from sqlalchemy import func, select, text, update

from oss.src.dbs.postgres.instances.dbes import InstanceDBE
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


class InstancesDAO:
    async def fetch_instance_id(self) -> Optional[UUID]:
        async with get_transactions_engine().transaction() as connection:
            result = await connection.execute(select(InstanceDBE.id).limit(1))
            return result.scalar_one_or_none()

    @asynccontextmanager
    async def lock_unsent_install_ping(self) -> AsyncIterator[Optional[UUID]]:
        """Yield the instance id while its row is locked, when the install ping is due.

        Due means: not sent yet, and at least one organization exists. Another container
        skips the locked row and gets None. A normal exit marks the ping as sent and
        commits; an exception rolls the transaction back, so the ping stays due.
        """

        async with get_transactions_engine().transaction() as connection:
            result = await connection.execute(
                select(InstanceDBE.id)
                .where(InstanceDBE.installed_event_sent_at.is_(None))
                .where(text("EXISTS (SELECT 1 FROM organizations)"))
                .with_for_update(skip_locked=True)
            )
            instance_id = result.scalar_one_or_none()

            yield instance_id

            if instance_id is not None:
                await connection.execute(
                    update(InstanceDBE)
                    .where(InstanceDBE.id == instance_id)
                    .values(installed_event_sent_at=func.now())
                )
