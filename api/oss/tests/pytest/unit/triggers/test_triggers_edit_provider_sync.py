"""Unit tests for how a subscription edit reaches the provider trigger instance.

An edited connection, event or trigger_config must reach the live ``ti_*``
(upsert, then the desired enabled state, then the local row). An is_active
change alone keeps toggling the instance; an edit that changes neither makes
no provider call.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.triggers.dtos import (
    TriggerSubscription,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
    TriggerSubscriptionFlags,
)
from oss.src.core.triggers.service import TriggersService
from oss.tests.pytest.utils.principals import any_principal

_EVENT = "GITHUB_COMMIT_EVENT"
_OLD_CONFIG = {"owner": "agenta-ai", "repo": "agenta"}
_NEW_CONFIG = {"owner": "agenta-ai", "repo": "agenta-docs"}


def _existing(*, is_active=True):
    return TriggerSubscription(
        id=uuid4(),
        created_by_id=uuid4(),
        connection_id=uuid4(),
        trigger_id="ti_existing",
        data=TriggerSubscriptionData(event_key=_EVENT, trigger_config=_OLD_CONFIG),
        flags=TriggerSubscriptionFlags(is_active=is_active),
    )


def _edit(existing, *, trigger_config, is_active=True, event_key=_EVENT):
    return TriggerSubscriptionEdit(
        id=existing.id,
        connection_id=existing.connection_id,
        name="renamed",
        data=TriggerSubscriptionData(
            event_key=event_key, trigger_config=trigger_config
        ),
        flags=TriggerSubscriptionFlags(is_active=is_active),
    )


def _service(existing, *, upserted_trigger_id=None):
    calls = []

    def _record(name, result=None):
        def _side_effect(**kwargs):
            calls.append((name, kwargs))
            return result

        return _side_effect

    adapter = MagicMock()
    adapter.create_subscription = AsyncMock(
        side_effect=_record("upsert", upserted_trigger_id or existing.trigger_id)
    )
    adapter.set_subscription_status = AsyncMock(side_effect=_record("status"))
    adapter.delete_subscription = AsyncMock(side_effect=_record("delete"))
    registry = MagicMock()
    registry.get = MagicMock(return_value=adapter)

    connection = MagicMock()
    connection.provider_key.value = "composio"
    connection.provider_connection_id = "ca_1"
    connections = MagicMock()
    connections.get_connection = AsyncMock(return_value=connection)

    dao = MagicMock()
    dao.fetch_subscription = AsyncMock(return_value=existing)
    dao.query_subscriptions = AsyncMock(return_value=[])

    def _persist_edit(**kwargs):
        calls.append(("dao", kwargs))
        return kwargs["subscription"]

    dao.edit_subscription = AsyncMock(side_effect=_persist_edit)

    service = TriggersService(
        adapter_registry=registry,
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=connections,
        workflows_service=MagicMock(),
    )
    service._require_connection = AsyncMock(return_value=connection)
    service._validate_references = AsyncMock()
    return service, calls


def _names(calls):
    return [name for name, _ in calls]


async def test_edit_with_changed_config_updates_provider_trigger():
    existing = _existing()
    service, calls = _service(existing)
    project_id = uuid4()

    await service.edit_subscription(
        project_id=project_id,
        user_id=uuid4(),
        subscription=_edit(existing, trigger_config=_NEW_CONFIG),
        principal=any_principal(),
    )

    assert _names(calls) == ["upsert", "status", "dao"]
    assert calls[0][1] == {
        "project_id": project_id,
        "event_key": _EVENT,
        "connected_account_id": "ca_1",
        "trigger_config": _NEW_CONFIG,
    }
    assert calls[1][1] == {"trigger_id": "ti_existing", "enabled": True}
    assert calls[2][1]["trigger_id"] == "ti_existing"


async def test_edit_with_changed_config_keeps_a_paused_trigger_disabled():
    existing = _existing(is_active=False)
    service, calls = _service(existing)

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(existing, trigger_config={}, is_active=False),
        principal=any_principal(),
    )

    # The upsert re-enables a disabled instance, so the disable must come after it.
    assert _names(calls) == ["upsert", "status", "dao"]
    assert calls[0][1]["trigger_config"] == {}
    assert calls[1][1] == {"trigger_id": "ti_existing", "enabled": False}


async def test_edit_that_mints_a_new_provider_trigger_stores_it_and_deletes_the_old():
    existing = _existing()
    service, calls = _service(existing, upserted_trigger_id="ti_new")

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(existing, trigger_config=_NEW_CONFIG),
        principal=any_principal(),
    )

    assert _names(calls) == ["upsert", "status", "dao", "delete"]
    assert calls[1][1] == {"trigger_id": "ti_new", "enabled": True}
    assert calls[2][1]["trigger_id"] == "ti_new"
    assert calls[3][1] == {"trigger_id": "ti_existing"}


async def test_edit_that_fails_to_persist_deletes_the_new_provider_trigger():
    existing = _existing()
    service, calls = _service(existing, upserted_trigger_id="ti_new")
    service.dao.edit_subscription = AsyncMock(side_effect=RuntimeError("db down"))

    with pytest.raises(RuntimeError):
        await service.edit_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=_edit(existing, trigger_config=_NEW_CONFIG),
            principal=any_principal(),
        )

    # The stored ti_existing stays live; only the unreferenced ti_new goes.
    assert _names(calls) == ["upsert", "status", "delete"]
    assert calls[2][1] == {"trigger_id": "ti_new"}


async def test_edit_that_fails_to_set_status_deletes_the_new_provider_trigger():
    existing = _existing()
    service, calls = _service(existing, upserted_trigger_id="ti_new")
    service.adapter_registry.get.return_value.set_subscription_status = AsyncMock(
        side_effect=RuntimeError("provider down")
    )

    with pytest.raises(RuntimeError):
        await service.edit_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=_edit(existing, trigger_config=_NEW_CONFIG),
            principal=any_principal(),
        )

    assert _names(calls) == ["upsert", "delete"]
    assert calls[1][1] == {"trigger_id": "ti_new"}


async def test_edit_with_changed_event_upserts_the_new_event():
    existing = _existing()
    service, calls = _service(existing, upserted_trigger_id="ti_new")

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(
            existing, trigger_config=_OLD_CONFIG, event_key="GITHUB_ISSUE_EVENT"
        ),
        principal=any_principal(),
    )

    assert _names(calls) == ["upsert", "status", "dao", "delete"]
    assert calls[0][1]["event_key"] == "GITHUB_ISSUE_EVENT"
    assert calls[3][1] == {"trigger_id": "ti_existing"}


async def test_edit_onto_another_subscriptions_event_conflicts_before_the_provider():
    existing = _existing()
    other = _existing()
    service, calls = _service(existing)
    service.dao.query_subscriptions = AsyncMock(return_value=[other])

    with pytest.raises(EntityCreationConflict):
        await service.edit_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=_edit(
                existing, trigger_config=_OLD_CONFIG, event_key="GITHUB_ISSUE_EVENT"
            ),
            principal=any_principal(),
        )

    assert calls == []


async def test_edit_with_only_is_active_changed_toggles_provider_trigger():
    existing = _existing(is_active=True)
    service, calls = _service(existing)

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(existing, trigger_config=dict(_OLD_CONFIG), is_active=False),
        principal=any_principal(),
    )

    assert _names(calls) == ["status", "dao"]
    assert calls[0][1] == {"trigger_id": "ti_existing", "enabled": False}
    assert "trigger_id" not in calls[1][1]


async def test_edit_with_no_provider_change_makes_no_provider_call():
    existing = _existing()
    service, calls = _service(existing)

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(existing, trigger_config=dict(_OLD_CONFIG)),
        principal=any_principal(),
    )

    assert _names(calls) == ["dao"]
