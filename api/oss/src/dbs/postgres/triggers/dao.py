from datetime import datetime, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.shared.dtos import Windowing
from oss.src.core.triggers.dtos import (
    TriggerDelivery,
    TriggerDeliveryCreate,
    TriggerDeliveryQuery,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionEdit,
    TriggerSubscriptionQuery,
)
from oss.src.core.triggers.interfaces import TriggersDAOInterface

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.dbs.postgres.triggers.dbes import (
    TriggerDeliveryDBE,
    TriggerSubscriptionDBE,
)
from oss.src.dbs.postgres.triggers.mappings import (
    map_delivery_dbe_to_dto,
    map_delivery_dto_to_dbe_create,
    map_subscription_dbe_to_dto,
    map_subscription_dto_to_dbe_create,
    map_subscription_dto_to_dbe_edit,
)


class TriggersDAO(TriggersDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    # --- SUBSCRIPTIONS ------------------------------------------------------ #

    async def create_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionCreate,
        #
        ti_id: str,
    ) -> TriggerSubscription:
        subscription_dbe = map_subscription_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            subscription=subscription,
            #
            ti_id=ti_id,
        )

        async with self.engine.session() as session:
            session.add(subscription_dbe)

            await session.commit()

            await session.refresh(subscription_dbe)

        return map_subscription_dbe_to_dto(
            subscription_dbe=subscription_dbe,
        )

    async def fetch_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[TriggerSubscription]:
        async with self.engine.session() as session:
            stmt = select(TriggerSubscriptionDBE).where(
                TriggerSubscriptionDBE.project_id == project_id,
                TriggerSubscriptionDBE.id == subscription_id,
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            return map_subscription_dbe_to_dto(
                subscription_dbe=subscription_dbe,
            )

    async def edit_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionEdit,
    ) -> Optional[TriggerSubscription]:
        async with self.engine.session() as session:
            stmt = select(TriggerSubscriptionDBE).where(
                TriggerSubscriptionDBE.id == subscription.id,
                TriggerSubscriptionDBE.project_id == project_id,
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            map_subscription_dto_to_dbe_edit(
                subscription_dbe=subscription_dbe,
                #
                user_id=user_id,
                #
                subscription=subscription,
            )

            await session.commit()

            await session.refresh(subscription_dbe)

            return map_subscription_dbe_to_dto(
                subscription_dbe=subscription_dbe,
            )

    async def delete_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = select(TriggerSubscriptionDBE).where(
                TriggerSubscriptionDBE.project_id == project_id,
                TriggerSubscriptionDBE.id == subscription_id,
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return False

            await session.delete(subscription_dbe)

            await session.commit()

            return True

    async def query_subscriptions(
        self,
        *,
        project_id: UUID,
        #
        subscription: Optional[TriggerSubscriptionQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerSubscription]:
        async with self.engine.session() as session:
            stmt = select(TriggerSubscriptionDBE).filter(
                TriggerSubscriptionDBE.project_id == project_id,
            )

            if subscription:
                if subscription.name is not None:
                    stmt = stmt.filter(
                        TriggerSubscriptionDBE.name.ilike(f"%{subscription.name}%"),
                    )

                if subscription.connection_id is not None:
                    stmt = stmt.filter(
                        TriggerSubscriptionDBE.connection_id
                        == subscription.connection_id,
                    )

                if subscription.event_key is not None:
                    stmt = stmt.filter(
                        TriggerSubscriptionDBE.data["event_key"].astext
                        == subscription.event_key,
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=TriggerSubscriptionDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_subscription_dbe_to_dto(subscription_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    async def get_subscription_by_trigger_id(
        self,
        *,
        trigger_id: str,
    ) -> Optional[TriggerSubscription]:
        async with self.engine.session() as session:
            stmt = (
                select(TriggerSubscriptionDBE)
                .filter(
                    TriggerSubscriptionDBE.data["ti_id"].astext == trigger_id,
                    TriggerSubscriptionDBE.deleted_at.is_(None),
                )
                .limit(1)
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalars().first()

            if not subscription_dbe:
                return None

            return map_subscription_dbe_to_dto(
                subscription_dbe=subscription_dbe,
            )

    async def get_project_and_subscription_by_trigger_id(
        self,
        *,
        trigger_id: str,
    ) -> Optional[Tuple[UUID, TriggerSubscription]]:
        async with self.engine.session() as session:
            stmt = (
                select(TriggerSubscriptionDBE)
                .filter(
                    TriggerSubscriptionDBE.data["ti_id"].astext == trigger_id,
                    TriggerSubscriptionDBE.deleted_at.is_(None),
                )
                .limit(1)
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalars().first()

            if not subscription_dbe:
                return None

            return (
                subscription_dbe.project_id,
                map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe),
            )

    # --- DELIVERIES --------------------------------------------------------- #

    async def write_delivery(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        delivery: TriggerDeliveryCreate,
    ) -> TriggerDelivery:
        delivery_dbe = map_delivery_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            delivery=delivery,
        )

        async with self.engine.session() as session:
            values = {
                c.name: getattr(delivery_dbe, c.name)
                for c in TriggerDeliveryDBE.__table__.columns
                if not (
                    c.name in ("id", "created_at", "updated_at", "deleted_at")
                    and getattr(delivery_dbe, c.name) is None
                )
            }

            stmt = insert(TriggerDeliveryDBE).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=["project_id", "subscription_id", "event_id"],
                set_={
                    "status": stmt.excluded.status,
                    "data": stmt.excluded.data,
                    "updated_at": datetime.now(timezone.utc),
                    "updated_by_id": stmt.excluded.created_by_id,
                },
            )
            await session.execute(stmt)
            await session.commit()

            refreshed_stmt = select(TriggerDeliveryDBE).where(
                TriggerDeliveryDBE.project_id == project_id,
                TriggerDeliveryDBE.subscription_id == delivery.subscription_id,
                TriggerDeliveryDBE.event_id == delivery.event_id,
            )
            delivery_dbe = (await session.execute(refreshed_stmt)).scalar_one()

        return map_delivery_dbe_to_dto(
            delivery_dbe=delivery_dbe,
        )

    async def fetch_delivery(
        self,
        *,
        project_id: UUID,
        #
        delivery_id: UUID,
    ) -> Optional[TriggerDelivery]:
        async with self.engine.session() as session:
            stmt = select(TriggerDeliveryDBE).where(
                TriggerDeliveryDBE.project_id == project_id,
                TriggerDeliveryDBE.id == delivery_id,
            )

            result = await session.execute(stmt)

            delivery_dbe = result.scalar_one_or_none()

            if not delivery_dbe:
                return None

            return map_delivery_dbe_to_dto(
                delivery_dbe=delivery_dbe,
            )

    async def query_deliveries(
        self,
        *,
        project_id: UUID,
        #
        delivery: Optional[TriggerDeliveryQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerDelivery]:
        async with self.engine.session() as session:
            stmt = select(TriggerDeliveryDBE).filter(
                TriggerDeliveryDBE.project_id == project_id,
            )

            if delivery:
                if delivery.status is not None and delivery.status.code is not None:
                    stmt = stmt.filter(
                        TriggerDeliveryDBE.status["code"].astext
                        == str(delivery.status.code),
                    )

                if delivery.subscription_id is not None:
                    stmt = stmt.filter(
                        TriggerDeliveryDBE.subscription_id == delivery.subscription_id,
                    )

                if delivery.event_id is not None:
                    stmt = stmt.filter(
                        TriggerDeliveryDBE.event_id == delivery.event_id,
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=TriggerDeliveryDBE,
                    attribute="created_at",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_delivery_dbe_to_dto(delivery_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    async def dedup_seen(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
        event_id: str,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = (
                select(TriggerDeliveryDBE.id)
                .where(
                    TriggerDeliveryDBE.project_id == project_id,
                    TriggerDeliveryDBE.subscription_id == subscription_id,
                    TriggerDeliveryDBE.event_id == event_id,
                )
                .limit(1)
            )

            result = await session.execute(stmt)

            return result.scalar_one_or_none() is not None
