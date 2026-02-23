"""Mappings between webhooks DTOs and DB entities."""

from uuid import UUID

from oss.src.core.webhooks.dtos import (
    CreateWebhookSubscriptionDTO,
    UpdateWebhookSubscriptionDTO,
    WebhookDeliveryResponseDTO,
    WebhookSubscriptionResponseDTO,
)
from oss.src.dbs.postgres.webhooks.dbes import WebhookSubscriptionDBE
from oss.src.dbs.postgres.webhooks.delivery_dbes import WebhookDeliveryDBE


# Subscription mappings


def map_subscription_dto_to_dbe(
    *,
    project_id: UUID,
    payload: CreateWebhookSubscriptionDTO,
    user_id: UUID,
    secret_id: UUID | None,
) -> WebhookSubscriptionDBE:
    """Map CreateWebhookSubscriptionDTO to DBE."""
    return WebhookSubscriptionDBE(
        project_id=project_id,
        name=payload.name,
        data={
            "url": str(payload.url),
            "events": payload.events,
            "headers": payload.headers or {},
        },
        flags={"is_active": payload.is_active},
        meta=payload.meta,
        tags=payload.tags,
        created_by_id=user_id,
        secret_id=secret_id,
    )


def map_subscription_dbe_to_dto(
    *, subscription_dbe: WebhookSubscriptionDBE
) -> WebhookSubscriptionResponseDTO:
    """Map WebhookSubscriptionDBE to response DTO."""
    data = subscription_dbe.data or {}
    flags = subscription_dbe.flags or {}

    return WebhookSubscriptionResponseDTO(
        id=subscription_dbe.id,
        project_id=subscription_dbe.project_id,
        name=subscription_dbe.name or "",
        url=str(data.get("url") or ""),
        events=list(data.get("events") or []),
        headers=data.get("headers") or {},
        secret_id=subscription_dbe.secret_id,
        is_active=bool(flags.get("is_active", True)),
        flags=subscription_dbe.flags,
        meta=subscription_dbe.meta,
        tags=subscription_dbe.tags,
        created_at=subscription_dbe.created_at,
        updated_at=subscription_dbe.updated_at,
        created_by_id=subscription_dbe.created_by_id,
        updated_by_id=subscription_dbe.updated_by_id,
        deleted_by_id=subscription_dbe.deleted_by_id,
        archived_at=subscription_dbe.deleted_at,
    )


def map_subscription_dto_to_dbe_update(
    subscription_dbe: WebhookSubscriptionDBE,
    update_dto: UpdateWebhookSubscriptionDTO,
) -> None:
    """Update DBE fields from UpdateWebhookSubscriptionDTO (in-place mutation)."""
    update_data = update_dto.model_dump(exclude_unset=True)

    if "name" in update_data:
        subscription_dbe.name = update_data["name"]

    if any(key in update_data for key in ("url", "events", "headers")):
        current_data = dict(subscription_dbe.data or {})
        if "url" in update_data:
            current_data["url"] = str(update_data["url"])
        if "events" in update_data:
            current_data["events"] = update_data["events"]
        if "headers" in update_data:
            current_data["headers"] = update_data["headers"] or {}
        subscription_dbe.data = current_data

    if "is_active" in update_data:
        current_flags = dict(subscription_dbe.flags or {})
        current_flags["is_active"] = update_data["is_active"]
        subscription_dbe.flags = current_flags

    if "meta" in update_data:
        subscription_dbe.meta = update_data["meta"]

    if "tags" in update_data:
        subscription_dbe.tags = update_data["tags"]


# Delivery mappings


def map_delivery_dbe_to_dto(
    *, delivery_dbe: WebhookDeliveryDBE
) -> WebhookDeliveryResponseDTO:
    """Map WebhookDeliveryDBE to response DTO."""
    return WebhookDeliveryResponseDTO(
        id=delivery_dbe.id,
        subscription_id=delivery_dbe.subscription_id,
        event_id=delivery_dbe.event_id,
        status=delivery_dbe.status,
        data=delivery_dbe.data,
        created_at=delivery_dbe.created_at,
        updated_at=delivery_dbe.updated_at,
        archived_at=delivery_dbe.deleted_at,
        created_by_id=delivery_dbe.created_by_id,
        updated_by_id=delivery_dbe.updated_by_id,
        deleted_by_id=delivery_dbe.deleted_by_id,
    )
