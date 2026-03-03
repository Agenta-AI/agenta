from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.shared.dtos import Windowing
from oss.src.core.webhooks.types import (
    WebhookSubscription,
    WebhookSubscriptionCreate,
    WebhookSubscriptionEdit,
    WebhookSubscriptionQuery,
    WebhookDelivery,
    WebhookDeliveryCreate,
    WebhookDeliveryQuery,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.dbs.postgres.webhooks.dbes import (
    WebhookSubscriptionDBE,
    WebhookDeliveryDBE,
)
from oss.src.dbs.postgres.webhooks.mappings import (
    map_subscription_dbe_to_dto,
    map_subscription_dto_to_dbe_create,
    map_subscription_dto_to_dbe_edit,
    map_delivery_dbe_to_dto,
    map_delivery_dto_to_dbe_create,
)


class WebhooksDAO(WebhooksDAOInterface):
    def __init__(self):
        pass

    # --- SUBSCRIPTIONS ------------------------------------------------------ #

    async def create_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: WebhookSubscriptionCreate,
        #
        secret_id: UUID,
    ) -> WebhookSubscription:
        subscription_dbe = map_subscription_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            subscription=subscription,
            #
            secret_id=secret_id,
        )

        async with engine.core_session() as session:
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
    ) -> Optional[WebhookSubscription]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.project_id == project_id,
                WebhookSubscriptionDBE.id == subscription_id,
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
        subscription: WebhookSubscriptionEdit,
    ) -> Optional[WebhookSubscription]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.id == subscription.id,
                WebhookSubscriptionDBE.project_id == project_id,
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
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.project_id == project_id,
                WebhookSubscriptionDBE.id == subscription_id,
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return False

            await session.delete(subscription_dbe)

            await session.commit()

            return True

    async def enable_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[WebhookSubscription]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.project_id == project_id,
                WebhookSubscriptionDBE.id == subscription_id,
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            flags = dict(subscription_dbe.flags or {})
            flags["is_valid"] = True
            subscription_dbe.flags = flags

            await session.commit()

            await session.refresh(subscription_dbe)

            return map_subscription_dbe_to_dto(
                subscription_dbe=subscription_dbe,
            )

    async def query_subscriptions(
        self,
        *,
        project_id: UUID,
        #
        subscription: Optional[WebhookSubscriptionQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookSubscription]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).filter(
                WebhookSubscriptionDBE.project_id == project_id,
            )

            if subscription:
                if subscription.name is not None:
                    stmt = stmt.filter(
                        WebhookSubscriptionDBE.name.ilike(f"%{subscription.name}%"),
                    )

                if subscription.description is not None:
                    stmt = stmt.filter(
                        WebhookSubscriptionDBE.description.ilike(
                            f"%{subscription.description}%"
                        ),
                    )

                if subscription.flags is not None:
                    subscription_flags = subscription.flags.model_dump(
                        mode="json",
                        exclude_none=True,
                    )

                    if subscription_flags:
                        stmt = stmt.filter(
                            WebhookSubscriptionDBE.flags.contains(subscription_flags),
                        )

                if subscription.tags is not None:
                    stmt = stmt.filter(
                        WebhookSubscriptionDBE.tags.contains(subscription.tags),
                    )

                # meta is JSON (not JSONB) — containment (@>) is not supported
                # if subscription.meta is not None:
                #     stmt = stmt.filter(
                #         WebhookSubscriptionDBE.meta.contains(subscription.meta),
                #     )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=WebhookSubscriptionDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            dtos = [
                map_subscription_dbe_to_dto(
                    subscription_dbe=dbe,
                )
                for dbe in result.scalars().all()
            ]

            return dtos

    # --- DELIVERIES --------------------------------------------------------- #

    async def create_delivery(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        delivery: WebhookDeliveryCreate,
    ) -> WebhookDelivery:
        delivery_dbe = map_delivery_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            delivery=delivery,
        )

        async with engine.core_session() as session:
            values = {
                c.name: getattr(delivery_dbe, c.name)
                for c in WebhookDeliveryDBE.__table__.columns
            }

            stmt = insert(WebhookDeliveryDBE).values(**values)
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

            refreshed_stmt = select(WebhookDeliveryDBE).where(
                WebhookDeliveryDBE.project_id == project_id,
                WebhookDeliveryDBE.subscription_id == delivery.subscription_id,
                WebhookDeliveryDBE.event_id == delivery.event_id,
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
    ) -> Optional[WebhookDelivery]:
        async with engine.core_session() as session:
            stmt = select(WebhookDeliveryDBE).where(
                WebhookDeliveryDBE.project_id == project_id,
                WebhookDeliveryDBE.id == delivery_id,
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
        delivery: Optional[WebhookDeliveryQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookDelivery]:
        async with engine.core_session() as session:
            stmt = select(WebhookDeliveryDBE).filter(
                WebhookDeliveryDBE.project_id == project_id,
            )

            if delivery:
                if delivery.status is not None and delivery.status.code is not None:
                    stmt = stmt.filter(
                        WebhookDeliveryDBE.status["code"].astext
                        == str(delivery.status.code),
                    )

                if delivery.subscription_id is not None:
                    stmt = stmt.filter(
                        WebhookDeliveryDBE.subscription_id == delivery.subscription_id,
                    )

                if delivery.event_id is not None:
                    stmt = stmt.filter(
                        WebhookDeliveryDBE.event_id == delivery.event_id,
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=WebhookDeliveryDBE,
                    attribute="created_at",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            dtos = [
                map_delivery_dbe_to_dto(
                    delivery_dbe=dbe,
                )
                for dbe in result.scalars().all()
            ]

            return dtos
