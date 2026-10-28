"""Unit tests for how a subscription edit reaches the provider trigger instance.

An edited trigger_config must rewrite the live ``ti_*`` filters; an is_active
change keeps toggling the instance; an edit that changes neither makes no
provider call.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from oss.src.core.triggers.dtos import (
    TriggerSubscription,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
    TriggerSubscriptionFlags,
)
from oss.src.core.triggers.service import TriggersService

_EVENT = "GITHUB_COMMIT_EVENT"
_OLD_CONFIG = {"owner": "agenta-ai", "repo": "agenta"}


def _existing(*, is_active=True):
    return TriggerSubscription(
        id=uuid4(),
        created_by_id=uuid4(),
        connection_id=uuid4(),
        trigger_id="ti_existing",
        data=TriggerSubscriptionData(event_key=_EVENT, trigger_config=_OLD_CONFIG),
        flags=TriggerSubscriptionFlags(is_active=is_active),
    )


def _edit(existing, *, trigger_config, is_active=True):
    return TriggerSubscriptionEdit(
        id=existing.id,
        connection_id=existing.connection_id,
        name="renamed",
        data=TriggerSubscriptionData(event_key=_EVENT, trigger_config=trigger_config),
        flags=TriggerSubscriptionFlags(is_active=is_active),
    )


def _service(existing):
    adapter = MagicMock()
    adapter.create_subscription = AsyncMock(return_value=existing.trigger_id)
    adapter.set_subscription_status = AsyncMock()
    registry = MagicMock()
    registry.get = MagicMock(return_value=adapter)

    connection = MagicMock()
    connection.provider_key.value = "composio"
    connection.provider_connection_id = "ca_1"

    dao = MagicMock()
    dao.fetch_subscription = AsyncMock(return_value=existing)
    dao.edit_subscription = AsyncMock(side_effect=lambda **kw: kw["subscription"])

    service = TriggersService(
        adapter_registry=registry,
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=MagicMock(),
        workflows_service=MagicMock(),
    )
    service._require_connection = AsyncMock(return_value=connection)
    service._validate_references = AsyncMock()
    return service, adapter


async def test_edit_with_changed_config_updates_provider_trigger():
    existing = _existing()
    service, adapter = _service(existing)
    project_id = uuid4()
    new_config = {"owner": "agenta-ai", "repo": "agenta-docs"}

    await service.edit_subscription(
        project_id=project_id,
        user_id=uuid4(),
        subscription=_edit(existing, trigger_config=new_config),
    )

    adapter.create_subscription.assert_awaited_once_with(
        project_id=project_id,
        event_key=_EVENT,
        connected_account_id="ca_1",
        trigger_config=new_config,
    )
    # The upsert must not leave a paused or revoked trigger firing.
    adapter.set_subscription_status.assert_awaited_once_with(
        trigger_id="ti_existing",
        enabled=True,
    )
    service.dao.edit_subscription.assert_awaited_once()


async def test_edit_with_changed_config_keeps_a_paused_trigger_disabled():
    existing = _existing(is_active=False)
    service, adapter = _service(existing)

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(existing, trigger_config={}, is_active=False),
    )

    adapter.create_subscription.assert_awaited_once()
    assert adapter.create_subscription.await_args.kwargs["trigger_config"] == {}
    adapter.set_subscription_status.assert_awaited_once_with(
        trigger_id="ti_existing",
        enabled=False,
    )


async def test_edit_with_only_is_active_changed_toggles_provider_trigger():
    existing = _existing(is_active=True)
    service, adapter = _service(existing)

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(existing, trigger_config=dict(_OLD_CONFIG), is_active=False),
    )

    adapter.create_subscription.assert_not_awaited()
    adapter.set_subscription_status.assert_awaited_once_with(
        trigger_id="ti_existing",
        enabled=False,
    )


async def test_edit_with_no_provider_change_makes_no_provider_call():
    existing = _existing()
    service, adapter = _service(existing)

    await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(existing, trigger_config=dict(_OLD_CONFIG)),
    )

    adapter.create_subscription.assert_not_awaited()
    adapter.set_subscription_status.assert_not_awaited()
    service.dao.edit_subscription.assert_awaited_once()
