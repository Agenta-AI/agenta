from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, update, delete
from sqlalchemy.orm import selectinload

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.models.db_models import (
    WebhookSubscriptionDB,
    WebhookDeliveryDB,
    WebhookEventDB,
)
from oss.src.apis.fastapi.webhooks.schemas import (
    CreateWebhookSubscription,
    UpdateWebhookSubscription,
)


class WebhooksDAO:
    async def create_subscription(
        self,
        workspace_id: UUID,
        payload: CreateWebhookSubscription,
        user_id: Optional[UUID] = None,
        secret: str = "",
    ) -> WebhookSubscriptionDB:
        async with engine.core_session() as session:
            db_subscription = WebhookSubscriptionDB(
                workspace_id=workspace_id,
                name=payload.name,
                url=str(payload.url),
                events=payload.events,
                secret=secret,
                is_active=payload.is_active,
                meta=payload.meta,
                created_by_id=user_id,
            )
            session.add(db_subscription)
            await session.commit()
            await session.refresh(db_subscription)
            return db_subscription

    async def get_subscription(
        self, workspace_id: UUID, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionDB]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDB).filter_by(
                id=subscription_id, workspace_id=workspace_id, archived_at=None
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def fetch_subscription_by_id(
        self, subscription_id: UUID
    ) -> Optional[WebhookSubscriptionDB]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDB).filter_by(
                id=subscription_id, archived_at=None
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def list_subscriptions(
        self, workspace_id: UUID
    ) -> List[WebhookSubscriptionDB]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDB).filter_by(
                workspace_id=workspace_id, archived_at=None
            )
            result = await session.execute(stmt)
            return list(result.scalars().all())

    async def update_subscription(
        self,
        workspace_id: UUID,
        subscription_id: UUID,
        payload: UpdateWebhookSubscription,
    ) -> Optional[WebhookSubscriptionDB]:
        async with engine.core_session() as session:
            # First check existence and ownership
            stmt = select(WebhookSubscriptionDB).filter_by(
                id=subscription_id, workspace_id=workspace_id, archived_at=None
            )
            result = await session.execute(stmt)
            subscription = result.scalar_one_or_none()

            if not subscription:
                return None

            update_data = payload.model_dump(exclude_unset=True)
            if "url" in update_data:
                update_data["url"] = str(update_data["url"])

            if not update_data:
                return subscription

            stmt = (
                update(WebhookSubscriptionDB)
                .where(WebhookSubscriptionDB.id == subscription_id)
                .values(**update_data)
                .execution_options(synchronize_session="fetch")
            )
            await session.execute(stmt)
            await session.commit()
            await session.refresh(subscription)
            return subscription

    async def delete_subscription(
        self, workspace_id: UUID, subscription_id: UUID
    ) -> bool:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDB).filter_by(
                id=subscription_id, workspace_id=workspace_id, archived_at=None
            )
            result = await session.execute(stmt)
            subscription = result.scalar_one_or_none()

            if not subscription:
                return False

            subscription.archived_at = datetime.now(timezone.utc)
            await session.commit()
            return True

    async def create_event(
        self,
        workspace_id: UUID,
        event_type: str,
        payload: dict,
    ) -> WebhookEventDB:
        async with engine.core_session() as session:
            db_event = WebhookEventDB(
                workspace_id=workspace_id,
                event_type=event_type,
                payload=payload,
            )
            session.add(db_event)
            await session.commit()
            await session.refresh(db_event)
            return db_event

    async def get_active_subscriptions_for_event(
        self, workspace_id: UUID, event_type: str
    ) -> List[WebhookSubscriptionDB]:
        async with engine.core_session() as session:
            stmt = select(WebhookSubscriptionDB).filter_by(
                workspace_id=workspace_id, is_active=True, archived_at=None
            )
            # Filter by event_type in array using SQLAlchemy's contains operator
            stmt = stmt.filter(WebhookSubscriptionDB.events.contains([event_type]))
            result = await session.execute(stmt)
            return list(result.scalars().all())

    async def create_delivery(
        self,
        subscription_id: UUID,
        event_type: str,
        payload: dict,
        event_id: Optional[UUID] = None,
    ) -> WebhookDeliveryDB:
        async with engine.core_session() as session:
            db_delivery = WebhookDeliveryDB(
                subscription_id=subscription_id,
                event_id=event_id,
                event_type=event_type,
                payload=payload,
                status="pending",
                attempts=0,
            )
            session.add(db_delivery)
            await session.commit()
            await session.refresh(db_delivery)
            return db_delivery

    async def get_delivery(self, delivery_id: UUID) -> Optional[WebhookDeliveryDB]:
        async with engine.core_session() as session:
            stmt = select(WebhookDeliveryDB).filter_by(id=delivery_id)
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def update_delivery_status(
        self,
        delivery_id: UUID,
        status: str,
        response_status_code: Optional[int] = None,
        response_body: Optional[str] = None,
        duration_ms: Optional[int] = None,
        error_message: Optional[str] = None,
        next_retry_at: Optional[datetime] = None,
    ) -> Optional[WebhookDeliveryDB]:
        async with engine.core_session() as session:
            stmt = select(WebhookDeliveryDB).filter_by(id=delivery_id)
            result = await session.execute(stmt)
            delivery = result.scalar_one_or_none()

            if not delivery:
                return None

            delivery.status = status
            if response_status_code is not None:
                delivery.response_status_code = response_status_code
            if response_body is not None:
                delivery.response_body = response_body
            if duration_ms is not None:
                delivery.duration_ms = duration_ms
            if error_message is not None:
                delivery.error_message = error_message
            if next_retry_at is not None:
                delivery.next_retry_at = next_retry_at

            if status == "success":
                delivery.delivered_at = datetime.now(timezone.utc)
            elif status == "failed":
                delivery.failed_at = datetime.now(timezone.utc)

            if status in ["success", "failed", "retrying"]:
                delivery.attempts += 1

            await session.commit()
            await session.refresh(delivery)
            return delivery
