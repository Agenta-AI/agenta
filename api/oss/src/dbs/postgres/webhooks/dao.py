"""Data access object for webhooks."""

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, func

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.webhooks.dbes import (
    WebhookSubscriptionDBE,
    WebhookDeliveryDBE,
)
from oss.src.dbs.postgres.webhooks.mappings import (
    map_subscription_dto_to_dbe,
    map_subscription_dbe_to_dto,
    map_subscription_dto_to_dbe_update,
    map_delivery_dbe_to_dto,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.core.webhooks.dtos import (
    CreateWebhookSubscriptionDTO,
    UpdateWebhookSubscriptionDTO,
    WebhookSubscriptionResponseDTO,
    WebhookSubscriptionQueryDTO,
    WebhookDeliveryResponseDTO,
)
from oss.src.core.webhooks.config import WEBHOOK_MAX_RETRIES


class WebhooksDAO(WebhooksDAOInterface):
    """Webhooks data access object implementing the interface."""

    def __init__(self):
        pass

    async def create_subscription(
        self,
        project_id: UUID,
        payload: CreateWebhookSubscriptionDTO,
        user_id: Optional[UUID] = None,
        secret: str = "",
    ) -> WebhookSubscriptionResponseDTO:
        subscription_dbe = map_subscription_dto_to_dbe(
            project_id=project_id,
            payload=payload,
            user_id=user_id,
            secret=secret,
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
            stmt = select(WebhookSubscriptionDBE).filter_by(
                id=subscription_id, project_id=project_id, archived_at=None
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
            stmt = select(WebhookSubscriptionDBE).filter_by(
                id=subscription_id, archived_at=None
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
            # Build shared WHERE conditions
            conditions = [
                WebhookSubscriptionDBE.project_id == project_id,
                WebhookSubscriptionDBE.archived_at.is_(None),
            ]

            if filters:
                if filters.is_active is not None:
                    conditions.append(
                        WebhookSubscriptionDBE.is_active == filters.is_active
                    )
                if filters.events:
                    conditions.append(
                        WebhookSubscriptionDBE.events.overlap(filters.events)
                    )
                if filters.created_after is not None:
                    conditions.append(
                        WebhookSubscriptionDBE.created_at >= filters.created_after
                    )
                if filters.created_before is not None:
                    conditions.append(
                        WebhookSubscriptionDBE.created_at <= filters.created_before
                    )

            # Efficient direct count
            count_stmt = select(func.count(WebhookSubscriptionDBE.id)).where(
                *conditions
            )
            total = (await session.execute(count_stmt)).scalar() or 0

            # Dynamic sort
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

            # Data query with sort + pagination
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
            stmt = select(WebhookSubscriptionDBE).filter_by(
                id=subscription_id, project_id=project_id, archived_at=None
            )
            result = await session.execute(stmt)
            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            map_subscription_dto_to_dbe_update(
                subscription_dbe=subscription_dbe, update_dto=payload
            )

            await session.commit()
            await session.refresh(subscription_dbe)

            return map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe)

    async def archive_subscription(
        self, project_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionResponseDTO]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).filter_by(
                id=subscription_id, project_id=project_id, archived_at=None
            )
            result = await session.execute(stmt)
            subscription_dbe = result.scalar_one_or_none()

            if not subscription_dbe:
                return None

            subscription_dbe.archived_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(subscription_dbe)

            return map_subscription_dbe_to_dto(subscription_dbe=subscription_dbe)

    async def get_active_subscriptions_for_event(
        self, project_id: UUID, event_type: str
    ) -> List[WebhookSubscriptionResponseDTO]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDBE).filter_by(
                project_id=project_id, is_active=True, archived_at=None
            )
            stmt = stmt.filter(WebhookSubscriptionDBE.events.contains([event_type]))
            result = await session.execute(stmt)
            subscription_dbes = result.scalars().all()

            return [
                map_subscription_dbe_to_dto(subscription_dbe=dbe)
                for dbe in subscription_dbes
            ]

    async def create_delivery(
        self,
        subscription_id: UUID,
        event_type: str,
        payload: dict,
    ) -> WebhookDeliveryResponseDTO:
        delivery_dbe = WebhookDeliveryDBE(
            subscription_id=subscription_id,
            event_type=event_type,
            payload=payload,
            status="pending",
            attempts=0,
            max_attempts=WEBHOOK_MAX_RETRIES,
        )

        async with engine.core_session() as session:
            session.add(delivery_dbe)
            await session.commit()
            await session.refresh(delivery_dbe)

        return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)

    async def get_delivery(
        self, delivery_id: UUID
    ) -> Optional[WebhookDeliveryResponseDTO]:
        async with engine.core_session() as session:
            stmt = select(WebhookDeliveryDBE).filter_by(id=delivery_id)
            result = await session.execute(stmt)
            delivery_dbe = result.scalar_one_or_none()

            if not delivery_dbe:
                return None

            return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)

    async def update_delivery_status(
        self,
        delivery_id: UUID,
        status: str,
        response_status_code: Optional[int] = None,
        response_body: Optional[str] = None,
        duration_ms: Optional[int] = None,
        error_message: Optional[str] = None,
        next_retry_at: Optional[datetime] = None,
    ) -> Optional[WebhookDeliveryResponseDTO]:
        async with engine.core_session() as session:
            stmt = select(WebhookDeliveryDBE).filter_by(id=delivery_id)
            result = await session.execute(stmt)
            delivery_dbe = result.scalar_one_or_none()

            if not delivery_dbe:
                return None

            delivery_dbe.status = status
            if response_status_code is not None:
                delivery_dbe.response_status_code = response_status_code
            if response_body is not None:
                delivery_dbe.response_body = response_body
            if duration_ms is not None:
                delivery_dbe.duration_ms = duration_ms
            if error_message is not None:
                delivery_dbe.error_message = error_message
            if next_retry_at is not None:
                delivery_dbe.next_retry_at = next_retry_at

            if status == "success":
                delivery_dbe.delivered_at = datetime.now(timezone.utc)
            elif status == "failed":
                delivery_dbe.failed_at = datetime.now(timezone.utc)

            if status in ["success", "failed", "retrying"]:
                delivery_dbe.attempts += 1

            await session.commit()
            await session.refresh(delivery_dbe)

            return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)
