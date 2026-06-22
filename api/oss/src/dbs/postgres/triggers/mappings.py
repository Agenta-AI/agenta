from uuid import UUID

from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import (
    TriggerDelivery,
    TriggerDeliveryCreate,
    TriggerDeliveryData,
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerScheduleEdit,
    TriggerScheduleFlags,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
    TriggerSubscriptionFlags,
)

from oss.src.dbs.postgres.triggers.dbes import (
    TriggerDeliveryDBE,
    TriggerScheduleDBE,
    TriggerSubscriptionDBE,
)


# --- Subscription ----------------------------------------------------------- #


def map_subscription_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    subscription: TriggerSubscriptionCreate,
    #
    trigger_id: str,
) -> TriggerSubscriptionDBE:
    return TriggerSubscriptionDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        connection_id=subscription.connection_id,
        trigger_id=trigger_id,
        #
        name=subscription.name,
        description=subscription.description,
        tags=subscription.tags,
        meta=subscription.meta,
        #
        flags=TriggerSubscriptionFlags().model_dump(),
        #
        data=subscription.data.model_dump(mode="json", exclude_none=True),
    )


def map_subscription_dbe_to_dto(
    *,
    subscription_dbe: TriggerSubscriptionDBE,
) -> TriggerSubscription:
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
        trigger_id=subscription_dbe.trigger_id,
        #
        name=subscription_dbe.name,
        description=subscription_dbe.description,
        #
        tags=subscription_dbe.tags,
        meta=subscription_dbe.meta,
        #
        data=TriggerSubscriptionData.model_validate(subscription_dbe.data),
        #
        flags=TriggerSubscriptionFlags(**(subscription_dbe.flags or {})),
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

    subscription_dbe.data = subscription.data.model_dump(mode="json", exclude_none=True)

    subscription_dbe.flags = subscription.flags.model_dump()


# --- Schedule --------------------------------------------------------------- #


def map_schedule_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    schedule: TriggerScheduleCreate,
) -> TriggerScheduleDBE:
    return TriggerScheduleDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        name=schedule.name,
        description=schedule.description,
        tags=schedule.tags,
        meta=schedule.meta,
        #
        flags=TriggerScheduleFlags().model_dump(),
        #
        data=schedule.data.model_dump(mode="json", exclude_none=True),
    )


def map_schedule_dbe_to_dto(
    *,
    schedule_dbe: TriggerScheduleDBE,
) -> TriggerSchedule:
    return TriggerSchedule(
        id=schedule_dbe.id,
        #
        created_at=schedule_dbe.created_at,
        updated_at=schedule_dbe.updated_at,
        deleted_at=schedule_dbe.deleted_at,
        created_by_id=schedule_dbe.created_by_id,
        updated_by_id=schedule_dbe.updated_by_id,
        deleted_by_id=schedule_dbe.deleted_by_id,
        #
        name=schedule_dbe.name,
        description=schedule_dbe.description,
        #
        tags=schedule_dbe.tags,
        meta=schedule_dbe.meta,
        #
        data=TriggerScheduleData.model_validate(schedule_dbe.data),
        #
        flags=TriggerScheduleFlags(**(schedule_dbe.flags or {})),
    )


def map_schedule_dto_to_dbe_edit(
    *,
    schedule_dbe: TriggerScheduleDBE,
    #
    user_id: UUID,
    #
    schedule: TriggerScheduleEdit,
) -> None:
    schedule_dbe.updated_by_id = user_id

    schedule_dbe.name = schedule.name
    schedule_dbe.description = schedule.description

    schedule_dbe.tags = schedule.tags
    schedule_dbe.meta = schedule.meta

    schedule_dbe.data = schedule.data.model_dump(mode="json", exclude_none=True)

    schedule_dbe.flags = schedule.flags.model_dump()


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
        schedule_id=delivery.schedule_id,
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
        schedule_id=delivery_dbe.schedule_id,
        #
        event_id=delivery_dbe.event_id,
    )
