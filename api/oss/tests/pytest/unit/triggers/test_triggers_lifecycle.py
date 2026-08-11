from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.triggers.router import TriggersRouter
from oss.src.core.access.permissions.types import Permission
from oss.src.core.triggers.dtos import (
    TriggerSchedule,
    TriggerScheduleData,
    TriggerSubscription,
    TriggerSubscriptionData,
)
from oss.src.core.triggers.exceptions import (
    AdapterError,
    ScheduleNotFoundError,
    SubscriptionNotFoundError,
)
from oss.src.core.triggers.service import TriggersService


def _subscription():
    return TriggerSubscription(
        id=uuid4(),
        created_by_id=uuid4(),
        connection_id=uuid4(),
        trigger_id="ti_lifecycle",
        data=TriggerSubscriptionData(event_key="github.issue.opened"),
    )


def _schedule():
    return TriggerSchedule(
        id=uuid4(),
        created_by_id=uuid4(),
        data=TriggerScheduleData(event_key="cron.tick", schedule="* * * * *"),
    )


def _service(*, subscription=None):
    adapter = MagicMock()
    adapter.delete_subscription = AsyncMock()
    adapter.set_subscription_status = AsyncMock()
    registry = MagicMock()
    registry.get.return_value = adapter

    connection = MagicMock()
    connection.provider_key.value = "composio"
    connections = MagicMock()
    connections.get_connection = AsyncMock(return_value=connection)

    dao = MagicMock()
    dao.fetch_subscription = AsyncMock(return_value=subscription)
    dao.delete_subscription = AsyncMock(return_value=True)
    dao.purge_subscription = AsyncMock(return_value=True)
    dao.delete_schedule = AsyncMock(return_value=True)

    service = TriggersService(
        adapter_registry=registry,
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=connections,
        workflows_service=MagicMock(),
    )
    return service, dao, adapter


async def test_normal_subscription_delete_cleans_provider_before_soft_delete():
    subscription = _subscription()
    service, dao, adapter = _service(subscription=subscription)
    calls = []
    adapter.delete_subscription.side_effect = lambda **_: calls.append("provider")
    dao.delete_subscription.side_effect = lambda **_: calls.append("local") or True
    user_id = uuid4()

    deleted = await service.delete_subscription(
        project_id=uuid4(),
        user_id=user_id,
        subscription_id=subscription.id,
    )

    assert deleted is True
    assert calls == ["provider", "local"]
    assert dao.delete_subscription.await_args.kwargs["user_id"] == user_id
    dao.purge_subscription.assert_not_awaited()


async def test_normal_subscription_delete_stops_on_provider_failure():
    subscription = _subscription()
    service, dao, adapter = _service(subscription=subscription)
    adapter.delete_subscription.side_effect = AdapterError(
        provider_key="composio",
        operation="delete_subscription",
        detail="already gone",
    )

    with pytest.raises(AdapterError):
        await service.delete_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription_id=subscription.id,
        )
    dao.delete_subscription.assert_not_awaited()


async def test_test_cleanup_does_not_purge_after_provider_failure():
    subscription = _subscription()
    service, dao, adapter = _service(subscription=subscription)
    adapter.delete_subscription.side_effect = AdapterError(
        provider_key="composio",
        operation="delete_subscription",
        detail="timeout",
    )

    with pytest.raises(AdapterError):
        await service.cleanup_test_subscription(
            project_id=uuid4(),
            subscription_id=subscription.id,
        )
    dao.purge_subscription.assert_not_awaited()


async def test_test_cleanup_deletes_provider_before_physical_purge():
    subscription = _subscription()
    service, dao, adapter = _service(subscription=subscription)
    calls = []
    adapter.delete_subscription.side_effect = lambda **_: calls.append("provider")
    dao.purge_subscription.side_effect = lambda **_: calls.append("purge") or True

    purged = await service.cleanup_test_subscription(
        project_id=uuid4(),
        subscription_id=subscription.id,
    )

    assert purged is True
    assert calls == ["provider", "purge"]
    dao.delete_subscription.assert_not_awaited()


async def test_exact_retrieval_returns_deleted_configurations_with_lifecycle_fields():
    deleted_at = datetime.now(timezone.utc)
    deleted_by_id = uuid4()
    subscription = _subscription().model_copy(
        update={"deleted_at": deleted_at, "deleted_by_id": deleted_by_id}
    )
    schedule = _schedule().model_copy(
        update={"deleted_at": deleted_at, "deleted_by_id": deleted_by_id}
    )
    service, dao, _ = _service()
    dao.fetch_subscription_including_deleted = AsyncMock(return_value=subscription)
    dao.fetch_schedule_including_deleted = AsyncMock(return_value=schedule)
    project_id = uuid4()

    fetched_subscription = await service.fetch_subscription_including_deleted(
        project_id=project_id,
        subscription_id=subscription.id,
    )
    fetched_schedule = await service.fetch_schedule_including_deleted(
        project_id=project_id,
        schedule_id=schedule.id,
    )

    assert fetched_subscription is subscription
    assert fetched_subscription.deleted_at == deleted_at
    assert fetched_subscription.deleted_by_id == deleted_by_id
    assert fetched_schedule is schedule
    assert fetched_schedule.deleted_at == deleted_at
    assert fetched_schedule.deleted_by_id == deleted_by_id


async def test_exact_fetch_routes_use_historical_service_and_view_permission(
    monkeypatch,
):
    check_access = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "oss.src.apis.fastapi.triggers.router.check_action_access",
        check_access,
    )
    deleted_at = datetime.now(timezone.utc)
    deleted_by_id = uuid4()
    subscription = _subscription().model_copy(
        update={"deleted_at": deleted_at, "deleted_by_id": deleted_by_id}
    )
    schedule = _schedule().model_copy(
        update={"deleted_at": deleted_at, "deleted_by_id": deleted_by_id}
    )
    service = MagicMock()
    service.fetch_subscription = AsyncMock()
    service.fetch_schedule = AsyncMock()
    service.fetch_subscription_including_deleted = AsyncMock(return_value=subscription)
    service.fetch_schedule_including_deleted = AsyncMock(return_value=schedule)
    router = TriggersRouter(triggers_service=service)
    project_id = uuid4()
    user_id = uuid4()
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(project_id), user_id=str(user_id))
    )

    subscription_response = await router.fetch_subscription(
        request,
        subscription_id=subscription.id,
    )
    schedule_response = await router.fetch_schedule(
        request,
        schedule_id=schedule.id,
    )

    assert subscription_response.subscription is subscription
    assert schedule_response.schedule is schedule
    serialized_deleted_at = subscription_response.model_dump(mode="json")[
        "subscription"
    ]["deleted_at"]
    assert datetime.fromisoformat(serialized_deleted_at) == deleted_at
    assert schedule_response.model_dump(mode="json")["schedule"][
        "deleted_by_id"
    ] == str(deleted_by_id)
    service.fetch_subscription_including_deleted.assert_awaited_once_with(
        project_id=project_id,
        subscription_id=subscription.id,
    )
    service.fetch_schedule_including_deleted.assert_awaited_once_with(
        project_id=project_id,
        schedule_id=schedule.id,
    )
    service.fetch_subscription.assert_not_awaited()
    service.fetch_schedule.assert_not_awaited()
    check_access.assert_has_awaits(
        [
            call(
                user_uid=str(user_id),
                project_id=str(project_id),
                permission=Permission.VIEW_TRIGGERS,
            ),
            call(
                user_uid=str(user_id),
                project_id=str(project_id),
                permission=Permission.VIEW_TRIGGERS,
            ),
        ]
    )


@pytest.mark.parametrize(
    ("route_name", "service_name", "identifier_name"),
    [
        (
            "fetch_subscription",
            "fetch_subscription_including_deleted",
            "subscription_id",
        ),
        ("fetch_schedule", "fetch_schedule_including_deleted", "schedule_id"),
    ],
)
async def test_exact_fetch_route_returns_not_found_for_wrong_project(
    monkeypatch,
    route_name,
    service_name,
    identifier_name,
):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.triggers.router.check_action_access",
        AsyncMock(return_value=True),
    )
    wrong_project_id = uuid4()
    configuration_id = uuid4()
    service = MagicMock()
    historical_fetch = AsyncMock(return_value=None)
    setattr(service, service_name, historical_fetch)
    router = TriggersRouter(triggers_service=service)
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(wrong_project_id), user_id=str(uuid4()))
    )

    with pytest.raises(HTTPException) as exc_info:
        await getattr(router, route_name)(
            request,
            **{identifier_name: configuration_id},
        )

    assert exc_info.value.status_code == 404
    historical_fetch.assert_awaited_once_with(
        project_id=wrong_project_id,
        **{identifier_name: configuration_id},
    )


async def test_deleted_configurations_are_rejected_by_edit_and_activation_paths():
    service, dao, _ = _service(subscription=None)
    dao.fetch_schedule = AsyncMock(return_value=None)

    assert (
        await service.edit_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=MagicMock(id=uuid4()),
        )
        is None
    )
    with pytest.raises(SubscriptionNotFoundError):
        await service.set_subscription_active(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription_id=uuid4(),
            is_active=True,
        )
    assert (
        await service.edit_schedule(
            project_id=uuid4(),
            user_id=uuid4(),
            schedule=MagicMock(id=uuid4()),
        )
        is None
    )
    with pytest.raises(ScheduleNotFoundError):
        await service.set_schedule_active(
            project_id=uuid4(),
            user_id=uuid4(),
            schedule_id=uuid4(),
            is_active=True,
        )


async def test_schedule_delete_passes_lifecycle_owner_to_dao():
    service, dao, _ = _service()
    user_id = uuid4()

    assert await service.delete_schedule(
        project_id=uuid4(),
        user_id=user_id,
        schedule_id=uuid4(),
    )
    assert dao.delete_schedule.await_args.kwargs["user_id"] == user_id


async def test_subscription_activation_losing_to_delete_raises_not_found():
    subscription = _subscription()
    service, dao, _ = _service(subscription=subscription)
    dao.edit_subscription = AsyncMock(return_value=None)

    with pytest.raises(SubscriptionNotFoundError):
        await service.set_subscription_active(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription_id=subscription.id,
            is_active=False,
        )


async def test_subscription_validity_update_losing_to_delete_raises_not_found():
    subscription = _subscription()
    service, dao, _ = _service(subscription=subscription)
    dao.edit_subscription = AsyncMock(return_value=None)

    with pytest.raises(SubscriptionNotFoundError):
        await service.refresh_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription_id=subscription.id,
        )


async def test_schedule_activation_losing_to_delete_raises_not_found():
    schedule = _schedule()
    service, dao, _ = _service()
    dao.fetch_schedule = AsyncMock(return_value=schedule)
    dao.edit_schedule = AsyncMock(return_value=None)

    with pytest.raises(ScheduleNotFoundError):
        await service.set_schedule_active(
            project_id=uuid4(),
            user_id=uuid4(),
            schedule_id=schedule.id,
            is_active=False,
        )


@pytest.mark.parametrize(
    ("method_name", "identifier_name"),
    [
        ("delete_subscription", "subscription_id"),
        ("delete_schedule", "schedule_id"),
    ],
)
async def test_delete_router_passes_user_to_service(
    monkeypatch,
    method_name,
    identifier_name,
):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.triggers.router.check_action_access",
        AsyncMock(return_value=True),
    )
    project_id = uuid4()
    user_id = uuid4()
    configuration_id = uuid4()
    service = MagicMock()
    delete_method = AsyncMock(return_value=True)
    setattr(service, method_name, delete_method)
    router = TriggersRouter(triggers_service=service)
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(project_id), user_id=str(user_id))
    )

    await getattr(router, method_name)(
        request,
        **{identifier_name: configuration_id},
    )

    delete_method.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        **{identifier_name: configuration_id},
    )
