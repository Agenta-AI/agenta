from uuid import UUID

from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import (
    TriggerDelivery,
    TriggerDeliveryCreate,
    TriggerDeliveryData,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
)

from oss.src.dbs.postgres.triggers.dbes import (
    TriggerDeliveryDBE,
    TriggerSubscriptionDBE,
)


# --- Subscription ----------------------------------------------------------- #

_SUBSCRIPTION_FLAGS = ("enabled", "valid")


def _flags_to_dbe(*, enabled: bool, valid: bool) -> dict:
    return {"enabled": enabled, "valid": valid}


def map_subscription_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    subscription: TriggerSubscriptionCreate,
    #
    ti_id: str,
) -> TriggerSubscriptionDBE:
    data = subscription.data.model_copy(update={"ti_id": ti_id})

    return TriggerSubscriptionDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        connection_id=subscription.connection_id,
        #
        name=subscription.name,
        description=subscription.description,
        tags=subscription.tags,
        meta=subscription.meta,
        #
        flags=_flags_to_dbe(enabled=True, valid=True),
        #
        data=data.model_dump(mode="json", exclude_none=True),
    )


def map_subscription_dbe_to_dto(
    *,
    subscription_dbe: TriggerSubscriptionDBE,
) -> TriggerSubscription:
    flags = subscription_dbe.flags or {}

    return TriggerSubscription(
        id=subscription_dbe.id,
        #
        created_at=subscription_dbe.created_at,
        updated_at=subscription_dbe.updated_at,
        deleted_at=subscription_dbe.deleted_at,
        created_by_id=subscription_dbe.created_by_id,
        updated_by_id=subscription_dbe.updated_by_id,
        deleted_by_id=subscription_dbe.deleted_by_id,
        #
        connection_id=subscription_dbe.connection_id,
        #
        name=subscription_dbe.name,
        description=subscription_dbe.description,
        #
        tags=subscription_dbe.tags,
        meta=subscription_dbe.meta,
        #
        data=TriggerSubscriptionData.model_validate(subscription_dbe.data),
        #
        enabled=bool(flags.get("enabled", True)),
        valid=bool(flags.get("valid", True)),
    )


def map_subscription_dto_to_dbe_edit(
    *,
    subscription_dbe: TriggerSubscriptionDBE,
    #
    user_id: UUID,
    #
    subscription: TriggerSubscriptionEdit,
) -> None:
    subscription_dbe.updated_by_id = user_id

    subscription_dbe.connection_id = subscription.connection_id

    subscription_dbe.name = subscription.name
    subscription_dbe.description = subscription.description

    subscription_dbe.tags = subscription.tags
    subscription_dbe.meta = subscription.meta

    # Preserve the provider ti_id even if the client omitted it on the full-PUT.
    existing_ti_id = (subscription_dbe.data or {}).get("ti_id")
    data = subscription.data
    if data.ti_id is None and existing_ti_id is not None:
        data = data.model_copy(update={"ti_id": existing_ti_id})

    subscription_dbe.data = data.model_dump(mode="json", exclude_none=True)

    subscription_dbe.flags = _flags_to_dbe(
        enabled=subscription.enabled,
        valid=subscription.valid,
    )


# --- Delivery --------------------------------------------------------------- #


def map_delivery_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID | None,
    #
    delivery: TriggerDeliveryCreate,
) -> TriggerDeliveryDBE:
    dbe_kwargs = dict(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        status=delivery.status.model_dump(mode="json", exclude_none=True)
        if delivery.status
        else None,
        #
        data=delivery.data.model_dump(mode="json", exclude_none=True)
        if delivery.data
        else None,
        #
        subscription_id=delivery.subscription_id,
        #
        event_id=delivery.event_id,
    )
    if delivery.id is not None:
        dbe_kwargs["id"] = delivery.id

    return TriggerDeliveryDBE(**dbe_kwargs)


def map_delivery_dbe_to_dto(
    *,
    delivery_dbe: TriggerDeliveryDBE,
) -> TriggerDelivery:
    return TriggerDelivery(
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
        else Status(),
        #
        data=TriggerDeliveryData.model_validate(delivery_dbe.data)
        if delivery_dbe.data
        else None,
        #
        subscription_id=delivery_dbe.subscription_id,
        #
        event_id=delivery_dbe.event_id,
    )
