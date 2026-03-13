from uuid import UUID

from oss.src.core.shared.dtos import Status
from oss.src.core.webhooks.types import (
    WebhookDelivery,
    WebhookDeliveryCreate,
    WebhookDeliveryData,
    WebhookSubscription,
    WebhookSubscriptionCreate,
    WebhookSubscriptionData,
    WebhookSubscriptionEdit,
    WebhookSubscriptionFlags,
)

from oss.src.dbs.postgres.webhooks.dbes import (
    WebhookDeliveryDBE,
    WebhookSubscriptionDBE,
)


# --- Subscription ----------------------------------------------------------- #


def map_subscription_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    subscription: WebhookSubscriptionCreate,
    #
    secret_id: UUID,
) -> WebhookSubscriptionDBE:
    return WebhookSubscriptionDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        name=subscription.name,
        description=subscription.description,
        #
        flags=(subscription.flags or WebhookSubscriptionFlags()).model_dump(
            mode="json",
            exclude_none=True,
        ),
        tags=subscription.tags,
        meta=subscription.meta,
        #
        data=subscription.data.model_dump(
            mode="json",
            exclude_none=True,
        )
        if subscription.data
        else None,
        #
        secret_id=secret_id,
    )


def map_subscription_dbe_to_dto(
    *,
    subscription_dbe: WebhookSubscriptionDBE,
) -> WebhookSubscription:
    return WebhookSubscription(
        id=subscription_dbe.id,
        #
        created_at=subscription_dbe.created_at,
        updated_at=subscription_dbe.updated_at,
        deleted_at=subscription_dbe.deleted_at,
        created_by_id=subscription_dbe.created_by_id,
        updated_by_id=subscription_dbe.updated_by_id,
        deleted_by_id=subscription_dbe.deleted_by_id,
        #
        name=subscription_dbe.name,
        description=subscription_dbe.description,
        #
        flags=WebhookSubscriptionFlags.model_validate(subscription_dbe.flags)
        if subscription_dbe.flags
        else None,
        tags=subscription_dbe.tags,
        meta=subscription_dbe.meta,
        #
        data=WebhookSubscriptionData.model_validate(subscription_dbe.data)
        if subscription_dbe.data
        else None,
        #
        secret_id=subscription_dbe.secret_id,
    )


def map_subscription_dto_to_dbe_edit(
    *,
    subscription_dbe: WebhookSubscriptionDBE,
    #
    user_id: UUID,
    #
    subscription: WebhookSubscriptionEdit,
    #
    secret_id: UUID | None = None,
) -> None:
    subscription_dbe.updated_by_id = user_id

    subscription_dbe.name = subscription.name
    subscription_dbe.description = subscription.description

    # Preserve existing flags by default; user edits only overwrite provided values.
    existing_flags = dict(subscription_dbe.flags or {})
    incoming_flags = (
        subscription.flags.model_dump(mode="json", exclude_none=True)
        if subscription.flags
        else {}
    )
    merged_flags = {**existing_flags, **incoming_flags}

    if "is_valid" in existing_flags:
        merged_flags["is_valid"] = existing_flags["is_valid"]

    subscription_dbe.flags = merged_flags
    subscription_dbe.tags = subscription.tags
    subscription_dbe.meta = subscription.meta

    subscription_dbe.data = (
        subscription.data.model_dump(
            mode="json",
            exclude_none=True,
        )
        if subscription.data
        else None
    )

    if secret_id is not None:
        subscription_dbe.secret_id = secret_id


# --- Delivery --------------------------------------------------------------- #


def map_delivery_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID | None,
    #
    delivery: WebhookDeliveryCreate,
) -> WebhookDeliveryDBE:
    dbe_kwargs = dict(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        status=delivery.status.model_dump(
            mode="json",
            exclude_none=True,
        )
        if delivery.status
        else None,
        #
        data=delivery.data.model_dump(
            mode="json",
            exclude_none=True,
        )
        if delivery.data
        else None,
        #
        subscription_id=delivery.subscription_id,
        #
        event_id=delivery.event_id,
    )
    if delivery.id is not None:
        dbe_kwargs["id"] = delivery.id

    return WebhookDeliveryDBE(**dbe_kwargs)


def map_delivery_dbe_to_dto(
    *,
    delivery_dbe: WebhookDeliveryDBE,
) -> WebhookDelivery:
    return WebhookDelivery(
        id=delivery_dbe.id,
        #
        created_at=delivery_dbe.created_at,
        updated_at=delivery_dbe.updated_at,
        deleted_at=delivery_dbe.deleted_at,
        created_by_id=delivery_dbe.created_by_id,
        updated_by_id=delivery_dbe.updated_by_id,
        deleted_by_id=delivery_dbe.deleted_by_id,
        #
        status=Status.model_validate(delivery_dbe.status)
        if delivery_dbe.status
        else None,
        #
        data=WebhookDeliveryData.model_validate(delivery_dbe.data)
        if delivery_dbe.data
        else None,
        #
        subscription_id=delivery_dbe.subscription_id,
        #
        event_id=delivery_dbe.event_id,
    )
