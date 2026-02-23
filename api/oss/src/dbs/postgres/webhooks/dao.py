"""Data access object for webhooks."""

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID
import uuid as py_uuid

from sqlalchemy import func, or_, select

from oss.src.core.webhooks.dtos import (
    CreateWebhookSubscriptionDTO,
    UpdateWebhookSubscriptionDTO,
    WebhookDeliveryResponseDTO,
    WebhookSubscriptionQueryDTO,
    WebhookSubscriptionResponseDTO,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.webhooks.dbes import WebhookSubscriptionDBE
from oss.src.dbs.postgres.webhooks.delivery_dbes import WebhookDeliveryDBE
from oss.src.dbs.postgres.webhooks.mappings import (
    map_delivery_dbe_to_dto,
    map_subscription_dbe_to_dto,
    map_subscription_dto_to_dbe,
    map_subscription_dto_to_dbe_update,
)


class WebhooksDAO(WebhooksDAOInterface):
    """Webhooks data access object implementing the interface."""

    def __init__(self):
        pass

    # ---- Subscription operations (core database) ----

    async def create_subscription(
        self,
        project_id: UUID,
        payload: CreateWebhookSubscriptionDTO,
        user_id: UUID,
        secret_id: Optional[UUID] = None,
    ) -> WebhookSubscriptionResponseDTO:
        subscription_dbe = map_subscription_dto_to_dbe(
            project_id=project_id,
            payload=payload,
            user_id=user_id,
            secret_id=secret_id,
        )

        async with engine.core_session() as session:
            session.add(subscription_dbe)
            await session.commit()
            await session.refresh(subscription_dbe)

        return map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe)

    async def get_subscription(
        self, project_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.id == subscription_id,
                WebhookSubscriptionDBE.project_id == project_id,
                WebhookSubscriptionDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            return map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe)

    async def fetch_subscription_by_id(
        self, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.id == subscription_id,
                WebhookSubscriptionDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            return map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe)

    async def query_subscriptions(
        self,
        project_id: UUID,
        filters: Optional[WebhookSubscriptionQueryDTO] = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[List[WebhookSubscriptionResponseDTO], int]:
        async with engine.core_session() as session:
            conditions = [
                WebhookSubscriptionDBE.project_id == project_id,
                WebhookSubscriptionDBE.deleted_at.is_(None),
            ]

            if filters:
                if filters.is_active is not None:
                    conditions.append(
                        WebhookSubscriptionDBE.flags["is_active"].astext
                        == str(filters.is_active).lower()
                    )
                if filters.events:
                    conditions.append(
                        or_(
                            *[
                                WebhookSubscriptionDBE.data["events"].contains([event])
                                for event in filters.events
                            ]
                        )
                    )
                if filters.created_after is not None:
                    conditions.append(
                        WebhookSubscriptionDBE.created_at >= filters.created_after
                    )
                if filters.created_before is not None:
                    conditions.append(
                        WebhookSubscriptionDBE.created_at <= filters.created_before
                    )

            count_stmt = select(func.count(WebhookSubscriptionDBE.id)).where(
                *conditions
            )
            total = (await session.execute(count_stmt)).scalar() or 0

            sort_column = getattr(
                WebhookSubscriptionDBE,
                filters.sort_by if filters else "created_at",
                WebhookSubscriptionDBE.created_at,
            )
            order = (
                sort_column.desc()
                if (not filters or filters.sort_order == "desc")
                else sort_column.asc()
            )

            data_stmt = (
                select(WebhookSubscriptionDBE)
                .where(*conditions)
                .order_by(order)
                .offset(offset)
                .limit(limit)
            )
            result = await session.execute(data_stmt)
            dtos = [
                map_subscription_dbe_to_dto(subscription_dbe=dbe)
                for dbe in result.scalars().all()
            ]

            return dtos, total

    async def update_subscription(
        self,
        project_id: UUID,
        subscription_id: UUID,
        payload: UpdateWebhookSubscriptionDTO,
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.id == subscription_id,
                WebhookSubscriptionDBE.project_id == project_id,
                WebhookSubscriptionDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            map_subscription_dto_to_dbe_update(
                subscription_dbe=subscription_dbe,
                update_dto=payload,
            )

            await session.commit()
            await session.refresh(subscription_dbe)

            return map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe)

    async def archive_subscription(
        self, project_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).where(
                WebhookSubscriptionDBE.id == subscription_id,
                WebhookSubscriptionDBE.project_id == project_id,
                WebhookSubscriptionDBE.deleted_at.is_(None),
            )
            result = await session.execute(stmt)
            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            subscription_dbe.deleted_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(subscription_dbe)

            return map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe)

    async def get_active_subscriptions_for_event(
        self, project_id: UUID, event_type: str
    ) -> List[WebhookSubscriptionResponseDTO]:
        async with engine.core_session() as session:
            stmt = (
                select(WebhookSubscriptionDBE)
                .where(
                    WebhookSubscriptionDBE.project_id == project_id,
                    WebhookSubscriptionDBE.deleted_at.is_(None),
                    WebhookSubscriptionDBE.flags["is_active"].astext == "true",
                )
                .where(WebhookSubscriptionDBE.data["events"].contains([event_type]))
            )
            result = await session.execute(stmt)
            subscription_dbes = result.scalars().all()

            return [
                map_subscription_dbe_to_dto(subscription_dbe=dbe)
                for dbe in subscription_dbes
            ]

    # ---- Delivery operations (tracing database) ----

    async def create_delivery(
        self,
        subscription_id: UUID,
        event_id: UUID,
        status: str,
        created_by_id: Optional[UUID],
        data: Optional[dict] = None,
    ) -> WebhookDeliveryResponseDTO:
        delivery_dbe = WebhookDeliveryDBE(
            subscription_id=subscription_id,
            event_id=event_id,
            status=status,
            data=data,
            created_by_id=created_by_id or py_uuid.UUID(int=0),
        )

        async with engine.tracing_session() as session:
            session.add(delivery_dbe)
            await session.commit()
            await session.refresh(delivery_dbe)

        return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)

    async def update_delivery_status(
        self,
        delivery_id: UUID,
        status: str,
        data: Optional[dict] = None,
        updated_by_id: Optional[UUID] = None,
    ) -> WebhookDeliveryResponseDTO:
        async with engine.tracing_session() as session:
            stmt = select(WebhookDeliveryDBE).where(
                WebhookDeliveryDBE.id == delivery_id
            )
            result = await session.execute(stmt)
            delivery_dbe = result.scalar_one()

            delivery_dbe.status = status
            if data is not None:
                delivery_dbe.data = data
            delivery_dbe.updated_by_id = updated_by_id

            await session.commit()
            await session.refresh(delivery_dbe)

            return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)

    async def get_delivery(
        self, delivery_id: UUID
    ) -> Optional[WebhookDeliveryResponseDTO]:
        async with engine.tracing_session() as session:
            stmt = select(WebhookDeliveryDBE).where(
                WebhookDeliveryDBE.id == delivery_id
            )
            result = await session.execute(stmt)
            delivery_dbe = result.scalar_one_or_none()

            if not delivery_dbe:
                return None

            return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)

    async def record_test_delivery(
        self,
        subscription_id: UUID,
        event_id: UUID,
        status: str,
        created_by_id: Optional[UUID],
        data: Optional[dict] = None,
    ) -> WebhookDeliveryResponseDTO:
        delivery_dbe = WebhookDeliveryDBE(
            subscription_id=subscription_id,
            event_id=event_id,
            status=status,
            data=data,
            created_by_id=created_by_id or py_uuid.UUID(int=0),
        )

        async with engine.tracing_session() as session:
            session.add(delivery_dbe)
            await session.commit()
            await session.refresh(delivery_dbe)

        return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)
