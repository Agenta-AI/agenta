"""Mappings between webhooks DTOs and DB entities."""

from uuid import UUID

from oss.src.dbs.postgres.webhooks.dbes import (
    WebhookSubscriptionDBE,
    WebhookEventDBE,
    WebhookDeliveryDBE,
)
from oss.src.core.webhooks.dtos import (
    CreateWebhookSubscriptionDTO,
    UpdateWebhookSubscriptionDTO,
    WebhookSubscriptionResponseDTO,
    WebhookEventResponseDTO,
    WebhookDeliveryResponseDTO,
)


# Subscription mappings
def map_subscription_dto_to_dbe(
    *,
    workspace_id: UUID,
    payload: CreateWebhookSubscriptionDTO,
    user_id: UUID | None,
    secret: str,
) -> WebhookSubscriptionDBE:
    """Map CreateWebhookSubscriptionDTO to DBE."""
    return WebhookSubscriptionDBE(
        workspace_id=workspace_id,
        name=payload.name,
        url=str(payload.url),
        events=payload.events,
        secret=secret,
        is_active=payload.is_active,
        meta=payload.meta,
        created_by_id=user_id,
    )


def map_subscription_dbe_to_dto(
    *, subscription_dbe: WebhookSubscriptionDBE
) -> WebhookSubscriptionResponseDTO:
    """Map WebhookSubscriptionDBE to response DTO."""
    return WebhookSubscriptionResponseDTO(
        id=subscription_dbe.id,
        workspace_id=subscription_dbe.workspace_id,
        name=subscription_dbe.name,
        url=subscription_dbe.url,
        events=subscription_dbe.events,
        secret=subscription_dbe.secret,
        is_active=subscription_dbe.is_active,
        meta=subscription_dbe.meta,
        created_at=subscription_dbe.created_at,
        updated_at=subscription_dbe.updated_at,
        created_by_id=subscription_dbe.created_by_id,
        archived_at=subscription_dbe.archived_at,
    )


def map_subscription_dto_to_dbe_update(
    subscription_dbe: WebhookSubscriptionDBE,
    update_dto: UpdateWebhookSubscriptionDTO,
) -> None:
    """Update DBE fields from UpdateWebhookSubscriptionDTO (in-place mutation)."""
    update_data = update_dto.model_dump(exclude_unset=True)

    # Handle URL conversion separately
    if "url" in update_data:
        subscription_dbe.url = str(update_data["url"])
        del update_data["url"]

    # Apply remaining updates
    for key, value in update_data.items():
        if hasattr(subscription_dbe, key):
            setattr(subscription_dbe, key, value)


# Event mappings
def map_event_dbe_to_dto(*, event_dbe: WebhookEventDBE) -> WebhookEventResponseDTO:
    """Map WebhookEventDBE to response DTO."""
    return WebhookEventResponseDTO(
        id=event_dbe.id,
        workspace_id=event_dbe.workspace_id,
        event_type=event_dbe.event_type,
        payload=event_dbe.payload,
        created_at=event_dbe.created_at,
        processed=event_dbe.processed,
        processed_at=event_dbe.processed_at,
    )


# Delivery mappings
def map_delivery_dbe_to_dto(
    *, delivery_dbe: WebhookDeliveryDBE
) -> WebhookDeliveryResponseDTO:
    """Map WebhookDeliveryDBE to response DTO."""
    return WebhookDeliveryResponseDTO(
        id=delivery_dbe.id,
        subscription_id=delivery_dbe.subscription_id,
        event_id=delivery_dbe.event_id,
        event_type=delivery_dbe.event_type,
        payload=delivery_dbe.payload,
        status=delivery_dbe.status,
        attempts=delivery_dbe.attempts,
        max_attempts=delivery_dbe.max_attempts,
        next_retry_at=delivery_dbe.next_retry_at,
        response_status_code=delivery_dbe.response_status_code,
        response_body=delivery_dbe.response_body,
        error_message=delivery_dbe.error_message,
        duration_ms=delivery_dbe.duration_ms,
        created_at=delivery_dbe.created_at,
        delivered_at=delivery_dbe.delivered_at,
        failed_at=delivery_dbe.failed_at,
    )
