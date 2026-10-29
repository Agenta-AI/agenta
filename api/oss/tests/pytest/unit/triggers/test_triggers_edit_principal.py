"""A save through an edit route makes the editor the executing principal.

Spec section 3.8, rules 1 and 2: every save through `PUT /triggers/schedules/{id}` or
`PUT /triggers/subscriptions/{id}` writes the editor as the principal, in the same write
as the configuration. Pause, resume, delete and worker writes pass no principal and keep
the stored one.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.triggers.models import (
    TriggerScheduleEditRequest,
    TriggerSubscriptionEditRequest,
)
from oss.src.apis.fastapi.triggers.router import TriggersRouter
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
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


_OWNER = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
_EDITOR = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())


def _schedule():
    return TriggerSchedule(
        id=uuid4(),
        name="nightly",
        created_by_id=_OWNER.id,
        principal=_OWNER,
        flags=TriggerScheduleFlags(is_active=True),
        data=TriggerScheduleData(
            event_key="cron.tick",
            schedule="0 * * * *",
            references={"workflow": {"slug": "agent"}},
        ),
    )


def _subscription():
    return TriggerSubscription(
        id=uuid4(),
        name="issues",
        created_by_id=_OWNER.id,
        principal=_OWNER,
        connection_id=uuid4(),
        trigger_id="ti_1",
        flags=TriggerSubscriptionFlags(is_active=True),
        data=TriggerSubscriptionData(
            event_key="GITHUB_ISSUE_EVENT",
            trigger_config={"repo": "agenta"},
            references={"workflow": {"slug": "agent"}},
        ),
    )


def _service(*, schedule=None, subscription=None):
    adapter = MagicMock()
    adapter.create_subscription = AsyncMock(return_value="ti_2")
    adapter.set_subscription_status = AsyncMock()
    adapter.delete_subscription = AsyncMock()
    registry = MagicMock()
    registry.get = MagicMock(return_value=adapter)

    connection = MagicMock()
    connection.provider_key.value = "composio"
    connection.provider_connection_id = "ca_1"
    connections = MagicMock()
    connections.get_connection = AsyncMock(return_value=connection)

    dao = MagicMock()
    dao.fetch_schedule = AsyncMock(return_value=schedule)
    dao.edit_schedule = AsyncMock(side_effect=lambda **kw: kw["schedule"])
    dao.fetch_subscription = AsyncMock(return_value=subscription)
    dao.query_subscriptions = AsyncMock(return_value=[])
    dao.edit_subscription = AsyncMock(side_effect=lambda **kw: kw["subscription"])

    service = TriggersService(
        adapter_registry=registry,
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=connections,
        workflows_service=MagicMock(),
    )
    service._validate_references = AsyncMock(return_value=uuid4())
    service._require_connection = AsyncMock(return_value=connection)
    return service, dao


def _schedule_edit(schedule, *, name=None):
    return TriggerScheduleEdit(
        id=schedule.id,
        name=name or schedule.name,
        flags=schedule.flags,
        data=schedule.data,
    )


def _subscription_edit(subscription, *, trigger_config=None, name=None):
    return TriggerSubscriptionEdit(
        id=subscription.id,
        connection_id=subscription.connection_id,
        name=name or subscription.name,
        flags=subscription.flags,
        data=subscription.data.model_copy(
            update={
                "trigger_config": trigger_config or subscription.data.trigger_config
            }
        ),
    )


# -- the edit routes write the editor ----------------------------------------------


async def test_schedule_save_that_changes_only_the_name_writes_the_editor():
    schedule = _schedule()
    service, dao = _service(schedule=schedule)

    await service.edit_schedule(
        project_id=uuid4(),
        user_id=_EDITOR.id,
        schedule=_schedule_edit(schedule, name="renamed"),
        principal=_EDITOR,
    )

    assert dao.edit_schedule.await_args.kwargs["principal"] == _EDITOR


async def test_subscription_save_without_a_provider_change_writes_the_editor():
    subscription = _subscription()
    service, dao = _service(subscription=subscription)

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=_EDITOR.id,
        subscription=_subscription_edit(subscription, name="renamed"),
        principal=_EDITOR,
    )

    assert dao.edit_subscription.await_args.kwargs["principal"] == _EDITOR


async def test_subscription_save_with_a_provider_change_writes_the_editor():
    subscription = _subscription()
    service, dao = _service(subscription=subscription)

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=_EDITOR.id,
        subscription=_subscription_edit(subscription, trigger_config={"repo": "docs"}),
        principal=_EDITOR,
    )

    kwargs = dao.edit_subscription.await_args.kwargs
    assert kwargs["trigger_id"] == "ti_2"
    assert kwargs["principal"] == _EDITOR


# -- lifecycle actions keep the stored principal -----------------------------------


@pytest.mark.parametrize("is_active", [True, False])
async def test_schedule_pause_and_resume_keep_the_principal(is_active):
    schedule = _schedule()
    service, dao = _service(schedule=schedule)

    await service.set_schedule_active(
        project_id=uuid4(),
        user_id=_EDITOR.id,
        schedule_id=schedule.id,
        is_active=is_active,
    )

    assert dao.edit_schedule.await_args.kwargs.get("principal") is None


@pytest.mark.parametrize("is_active", [True, False])
async def test_subscription_pause_and_resume_keep_the_principal(is_active):
    subscription = _subscription()
    service, dao = _service(subscription=subscription)

    await service.set_subscription_active(
        project_id=uuid4(),
        user_id=_EDITOR.id,
        subscription_id=subscription.id,
        is_active=is_active,
    )

    assert dao.edit_subscription.await_args.kwargs.get("principal") is None


# -- the routes take the editor from the request, never the body -------------------


def _request(principal):
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(uuid4()), user_id=str(uuid4()), principal=principal
        )
    )


@pytest.mark.parametrize(
    "editor",
    [_EDITOR, PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())],
    ids=["human", "api_key"],
)
async def test_edit_routes_pass_the_request_principal(editor):
    schedule = _schedule()
    subscription = _subscription()
    service = MagicMock()
    service.edit_schedule = AsyncMock(return_value=schedule)
    service.edit_subscription = AsyncMock(return_value=subscription)
    router = TriggersRouter(triggers_service=service)
    router._check = AsyncMock()

    await router.edit_schedule(
        _request(editor),
        schedule_id=schedule.id,
        body=TriggerScheduleEditRequest(schedule=_schedule_edit(schedule)),
    )
    await router.edit_subscription(
        _request(editor),
        subscription_id=subscription.id,
        body=TriggerSubscriptionEditRequest(
            subscription=_subscription_edit(subscription)
        ),
    )

    assert service.edit_schedule.await_args.kwargs["principal"] == editor
    assert service.edit_subscription.await_args.kwargs["principal"] == editor


def test_edit_bodies_cannot_carry_a_principal():
    body = TriggerScheduleEditRequest.model_validate(
        {
            "schedule": {
                "id": str(uuid4()),
                "principal": {"kind": "human", "id": str(uuid4())},
                "data": {"event_key": "cron.tick", "schedule": "0 * * * *"},
            }
        }
    )

    assert "principal" not in body.schedule.model_dump()
