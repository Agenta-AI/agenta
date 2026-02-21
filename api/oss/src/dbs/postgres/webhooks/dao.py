"""Data access object for webhooks."""

from typing import List, Optional
from uuid import UUID

import uuid_utils.compat as uuid
from sqlalchemy import select, func, desc

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.webhooks.dbes import WebhookSubscriptionDBE
from oss.src.dbs.postgres.tracing.webhook_dbes import WebhookDeliveryDBE
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

    # ---- Subscription operations (core database) ----

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
            from datetime import datetime, timezone

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

    # ---- Delivery operations (tracing database, append-only) ----

    async def create_delivery(
        self,
        delivery_id: UUID,
        subscription_id: UUID,
        event_type: str,
        payload: dict,
        url: str,
    ) -> WebhookDeliveryResponseDTO:
        """Create first delivery record (attempt_number=1, status=pending)."""
        delivery_dbe = WebhookDeliveryDBE(
            delivery_id=delivery_id,
            subscription_id=subscription_id,
            event_type=event_type,
            payload=payload,
            attempt_number=1,
            max_attempts=WEBHOOK_MAX_RETRIES,
            status="pending",
            url=url,
        )

        async with engine.tracing_session() as session:
            session.add(delivery_dbe)
            await session.commit()
            await session.refresh(delivery_dbe)

        return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)

    async def create_retry(
        self,
        delivery_id: UUID,
        subscription_id: UUID,
        event_type: str,
        payload: dict,
        url: str,
        attempt_number: int,
        status: str,
        status_code: Optional[int] = None,
        response_body: Optional[str] = None,
        error_message: Optional[str] = None,
        duration_ms: Optional[int] = None,
    ) -> WebhookDeliveryResponseDTO:
        """Create an immutable delivery attempt record. Never updates existing records."""
        delivery_dbe = WebhookDeliveryDBE(
            delivery_id=delivery_id,
            subscription_id=subscription_id,
            event_type=event_type,
            payload=payload,
            attempt_number=attempt_number,
            max_attempts=WEBHOOK_MAX_RETRIES,
            status=status,
            status_code=status_code,
            response_body=response_body,
            error_message=error_message,
            duration_ms=duration_ms,
            url=url,
        )

        async with engine.tracing_session() as session:
            session.add(delivery_dbe)
            await session.commit()
            await session.refresh(delivery_dbe)

        return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)

    async def get_latest_delivery(
        self, delivery_id: UUID
    ) -> Optional[WebhookDeliveryResponseDTO]:
        """Get the most recent attempt for a delivery_id."""
        async with engine.tracing_session() as session:
            stmt = (
                select(WebhookDeliveryDBE)
                .filter_by(delivery_id=delivery_id)
                .order_by(desc(WebhookDeliveryDBE.attempt_number))
                .limit(1)
            )
            result = await session.execute(stmt)
            delivery_dbe = result.scalar_one_or_none()

            if not delivery_dbe:
                return None

            return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)

    async def get_delivery_history(
        self, delivery_id: UUID
    ) -> List[WebhookDeliveryResponseDTO]:
        """Get all attempts for a delivery_id, ordered by attempt_number."""
        async with engine.tracing_session() as session:
            stmt = (
                select(WebhookDeliveryDBE)
                .filter_by(delivery_id=delivery_id)
                .order_by(WebhookDeliveryDBE.attempt_number)
            )
            result = await session.execute(stmt)
            delivery_dbes = result.scalars().all()

            return [map_delivery_dbe_to_dto(delivery_dbe=dbe) for dbe in delivery_dbes]

    async def record_test_delivery(
        self,
        subscription_id: UUID,
        event_type: str,
        payload: dict,
        url: str,
        status: str,
        status_code: Optional[int] = None,
        response_body: Optional[str] = None,
        error_message: Optional[str] = None,
        duration_ms: Optional[int] = None,
    ) -> WebhookDeliveryResponseDTO:
        """Create a single delivery record for a test event (synchronous result)."""
        # Generate a new delivery ID for this test
        delivery_id = uuid.uuid4()

        delivery_dbe = WebhookDeliveryDBE(
            delivery_id=delivery_id,
            subscription_id=subscription_id,
            event_type=event_type,
            payload=payload,
            attempt_number=1,
            max_attempts=1,  # Test is single attempt
            status=status,
            status_code=status_code,
            response_body=response_body,
            error_message=error_message,
            duration_ms=duration_ms,
            url=url,
        )

        async with engine.tracing_session() as session:
            session.add(delivery_dbe)
            await session.commit()
            await session.refresh(delivery_dbe)

        return map_delivery_dbe_to_dto(delivery_dbe=delivery_dbe)
