"""A person's edit, start or delete resolves the automation's failure notification."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.triggers.dtos import (
    TriggerSchedule,
    TriggerScheduleData,
    TriggerScheduleEdit,
    TriggerScheduleFlags,
    TriggerSubscription,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
    TriggerSubscriptionFlags,
)
from oss.src.core.triggers.service import TriggersService
from oss.tests.pytest.utils.principals import any_principal

PROJECT_ID = uuid4()
USER_ID = uuid4()


def _schedule(*, is_active=True):
    return TriggerSchedule(
        id=uuid4(),
        created_by_id=USER_ID,
        principal=any_principal(),
        flags=TriggerScheduleFlags(is_active=is_active),
        data=TriggerScheduleData(event_key="cron.tick", schedule="0 * * * *"),
    )


def _subscription(*, is_active=True):
    return TriggerSubscription(
        id=uuid4(),
        created_by_id=USER_ID,
        principal=any_principal(),
        connection_id=uuid4(),
        flags=TriggerSubscriptionFlags(is_active=is_active, is_test=True),
        data=TriggerSubscriptionData(event_key="github.issue.opened"),
    )


def _service(*, resolve=None):
    dao = MagicMock()
    notifications = MagicMock()
    notifications.resolve = resolve or AsyncMock(return_value=1)
    service = TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=MagicMock(),
        workflows_service=MagicMock(),
        notifications_service=notifications,
    )
    service._validate_references = AsyncMock(return_value=None)
    service._check_needs_setup = AsyncMock()
    service._sync_provider_enabled = AsyncMock()
    service._delete_provider_subscription = AsyncMock()
    return service, dao, notifications


def _resolved_with(notifications, automation_id):
    notifications.resolve.assert_awaited_once_with(
        project_id=PROJECT_ID,
        dedup_key=f"automation:{automation_id}",
    )


def _schedule_edit(schedule):
    return TriggerScheduleEdit(id=schedule.id, data=schedule.data, flags=schedule.flags)


async def _edit_schedule(service, dao, schedule):
    dao.fetch_schedule = AsyncMock(return_value=schedule)
    dao.edit_schedule = AsyncMock(return_value=schedule)
    return await service.edit_schedule(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        schedule=_schedule_edit(schedule),
        principal=any_principal(),
    )


async def test_an_edit_that_leaves_a_schedule_active_resolves():
    service, dao, notifications = _service()
    schedule = _schedule()

    await _edit_schedule(service, dao, schedule)

    _resolved_with(notifications, schedule.id)


async def test_a_rename_of_a_paused_schedule_resolves_nothing():
    service, dao, notifications = _service()

    await _edit_schedule(service, dao, _schedule(is_active=False))

    notifications.resolve.assert_not_awaited()


async def _edit_subscription(service, dao, subscription):
    dao.fetch_subscription = AsyncMock(return_value=subscription)
    dao.edit_subscription = AsyncMock(return_value=subscription)
    return await service.edit_subscription(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        subscription=TriggerSubscriptionEdit(
            id=subscription.id,
            connection_id=subscription.connection_id,
            data=subscription.data,
            flags=subscription.flags,
        ),
        principal=any_principal(),
    )


async def test_an_edit_that_leaves_a_subscription_active_resolves():
    service, dao, notifications = _service()
    subscription = _subscription()

    await _edit_subscription(service, dao, subscription)

    _resolved_with(notifications, subscription.id)


async def test_deleting_a_schedule_resolves():
    service, dao, notifications = _service()
    schedule_id = uuid4()
    dao.delete_schedule = AsyncMock(return_value=True)

    await service.delete_schedule(
        project_id=PROJECT_ID, user_id=USER_ID, schedule_id=schedule_id
    )

    _resolved_with(notifications, schedule_id)


async def test_deleting_a_subscription_resolves():
    service, dao, notifications = _service()
    subscription = _subscription()
    dao.fetch_subscription = AsyncMock(return_value=subscription)
    dao.delete_subscription = AsyncMock(return_value=True)

    await service.delete_subscription(
        project_id=PROJECT_ID, user_id=USER_ID, subscription_id=subscription.id
    )

    _resolved_with(notifications, subscription.id)


@pytest.mark.parametrize(("is_active", "resolves"), [(True, True), (False, False)])
async def test_starting_a_schedule_resolves_and_stopping_does_not(is_active, resolves):
    service, dao, notifications = _service()
    schedule = _schedule(is_active=not is_active)
    dao.fetch_schedule = AsyncMock(return_value=schedule)
    dao.edit_schedule = AsyncMock(return_value=schedule)

    await service.set_schedule_active(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        schedule_id=schedule.id,
        is_active=is_active,
    )

    assert notifications.resolve.await_count == (1 if resolves else 0)


@pytest.mark.parametrize(("is_active", "resolves"), [(True, True), (False, False)])
async def test_starting_a_subscription_resolves_and_stopping_does_not(
    is_active, resolves
):
    service, dao, notifications = _service()
    subscription = _subscription(is_active=not is_active)
    dao.fetch_subscription = AsyncMock(return_value=subscription)
    dao.edit_subscription = AsyncMock(return_value=subscription)

    await service.set_subscription_active(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        subscription_id=subscription.id,
        is_active=is_active,
    )

    assert notifications.resolve.await_count == (1 if resolves else 0)


async def test_a_resolve_error_does_not_fail_the_edit():
    service, dao, _ = _service(resolve=AsyncMock(side_effect=RuntimeError("boom")))
    schedule = _schedule()

    edited = await _edit_schedule(service, dao, schedule)

    assert edited.id == schedule.id


async def test_no_notifications_service_is_a_no_op():
    service, dao, _ = _service()
    service.notifications_service = None

    schedule = _schedule()

    edited = await _edit_schedule(service, dao, schedule)

    assert edited.id == schedule.id
