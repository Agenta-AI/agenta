from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select

from oss.src.core.shared.dtos import Windowing
from oss.src.core.webhooks.dtos import (
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

    async def archive_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[WebhookSubscription]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.project_id == project_id,
                #
                WebhookSubscriptionDBE.id == subscription_id,
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            subscription_dbe.deleted_at = datetime.now(timezone.utc)
            subscription_dbe.deleted_by_id = user_id
            subscription_dbe.updated_by_id = user_id

            await session.commit()

            await session.refresh(subscription_dbe)

            return map_subscription_dbe_to_dto(
                subscription_dbe=subscription_dbe,
            )

    async def unarchive_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[WebhookSubscription]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.project_id == project_id,
                #
                WebhookSubscriptionDBE.id == subscription_id,
            )

            result = await session.execute(stmt)

            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            subscription_dbe.deleted_at = None
            subscription_dbe.deleted_by_id = None
            subscription_dbe.updated_by_id = user_id

            await session.commit()

            await session.refresh(subscription_dbe)

            return map_subscription_dbe_to_dto(
                subscription_dbe=subscription_dbe,
            )

    async def set_subscription_validity(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
        #
        is_valid: bool,
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

            subscription_dbe.flags = {
                **(subscription_dbe.flags or {}),
                "is_valid": is_valid,
            }

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
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookSubscription]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).filter(
                WebhookSubscriptionDBE.project_id == project_id,
            )

            if include_archived is not True:
                stmt = stmt.filter(
                    WebhookSubscriptionDBE.deleted_at.is_(None),
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
                    attribute="created_at",
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
            session.add(delivery_dbe)

            await session.commit()

            await session.refresh(delivery_dbe)

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
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookDelivery]:
        async with engine.core_session() as session:
            stmt = select(WebhookDeliveryDBE).filter(
                WebhookDeliveryDBE.project_id == project_id,
            )

            if include_archived is not True:
                stmt = stmt.filter(
                    WebhookDeliveryDBE.deleted_at.is_(None),
                )

            if delivery:
                if delivery.status is not None:
                    if delivery.status.code is not None:
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
