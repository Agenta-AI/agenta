from typing import Optional

from sqlalchemy.future import select

from ee.src.core.subscriptions.types import SubscriptionDTO
from ee.src.core.subscriptions.interfaces import SubscriptionsDAOInterface

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE
from ee.src.dbs.postgres.subscriptions.mappings import (
    map_dbe_to_dto,
    map_dto_to_dbe,
)


class SubscriptionsDAO(SubscriptionsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def create(
        self,
        *,
        subscription: SubscriptionDTO,
    ) -> SubscriptionDTO:
        async with self.engine.session() as session:
            subscription_dbe = map_dto_to_dbe(subscription)

            session.add(subscription_dbe)

            await session.commit()

            subscription_dto = map_dbe_to_dto(subscription_dbe)

            return subscription_dto

    async def read(
        self,
        *,
        organization_id: str,
    ) -> Optional[SubscriptionDTO]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(SubscriptionDBE).where(
                    SubscriptionDBE.organization_id == organization_id,
                )
            )

            subscription_dbe = result.scalars().one_or_none()

            if not subscription_dbe:
                return None

            subscription_dto = map_dbe_to_dto(subscription_dbe)

            return subscription_dto

    async def update(
        self,
        *,
        subscription: SubscriptionDTO,
    ) -> Optional[SubscriptionDTO]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(SubscriptionDBE).where(
                    SubscriptionDBE.organization_id == subscription.organization_id,
                )
            )

            subscription_dbe = result.scalars().one_or_none()

            if not subscription_dbe:
                return None

            subscription_dbe.customer_id = subscription.customer_id
            subscription_dbe.subscription_id = subscription.subscription_id
            subscription_dbe.plan = subscription.plan
            subscription_dbe.active = subscription.active
            subscription_dbe.anchor = subscription.anchor

            await session.commit()

            subscription_dto = map_dbe_to_dto(subscription_dbe)

            return subscription_dto
