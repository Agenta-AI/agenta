"""Unit tests for trigger-subscription test mode (is_test) validation rules.

Stubs every external dependency (adapter registry, connections, workflows, DAO).
Pins the two service-layer invariants that test mode introduces:
  - create/edit with is_test=True bypasses the bound-workflow requirement and
    forces is_active=True;
  - turning is_test off (test -> prod) re-imposes the requirement: references
    must resolve, else TriggerReferenceInvalid propagates.
"""

from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

import pytest

from oss.src.core.shared.dtos import Status
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.triggers.dtos import (
    TriggerDelivery,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
    TriggerSubscriptionFlags,
)
from oss.src.core.triggers.exceptions import TriggerReferenceInvalid
from oss.src.core.triggers.service import TriggersService


def _make_service():
    adapter = MagicMock()
    adapter.create_subscription = AsyncMock(return_value="ti_test")
    adapter.set_subscription_status = AsyncMock()
    adapter.delete_subscription = AsyncMock()
    registry = MagicMock()
    registry.get = MagicMock(return_value=adapter)

    connection = MagicMock()
    connection.provider_key.value = "composio"
    connection.provider_connection_id = "ca_1"

    def _persist_create(**kw):
        sub = kw["subscription"]
        return TriggerSubscription(
            id=uuid4(),
            created_by_id=kw["user_id"],
            connection_id=sub.connection_id,
            trigger_id=kw["trigger_id"],
            name=sub.name,
            data=sub.data,
            flags=sub.flags,
        )

    dao = MagicMock()
    dao.create_subscription = AsyncMock(side_effect=_persist_create)
    dao.edit_subscription = AsyncMock(side_effect=lambda **kw: kw["subscription"])
    dao.delete_subscription = AsyncMock(return_value=True)
    dao.fetch_subscription = AsyncMock(
        return_value=TriggerSubscription(
            id=uuid4(),
            created_by_id=uuid4(),
            connection_id=uuid4(),
            trigger_id="ti_test",
            flags=TriggerSubscriptionFlags(is_test=True),
            data=TriggerSubscriptionData(event_key="github.issue.opened"),
        )
    )
    dao.query_deliveries = AsyncMock(return_value=[])
    dao.poll_delivery_after = AsyncMock(return_value=None)

    connections = MagicMock()
    connections.get_connection = AsyncMock(return_value=connection)

    service = TriggersService(
        adapter_registry=registry,
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=connections,
        workflows_service=MagicMock(),
    )
    service._require_connection = AsyncMock(return_value=connection)
    service._validate_references = AsyncMock()
    return service


def _create(*, is_test, references=None):
    return TriggerSubscriptionCreate(
        connection_id=uuid4(),
        data=TriggerSubscriptionData(
            event_key="github.issue.opened",
            references=references,
        ),
        flags=TriggerSubscriptionFlags(is_test=is_test),
    )


def _existing(*, is_test):
    return TriggerSubscription(
        id=uuid4(),
        created_by_id=uuid4(),
        connection_id=uuid4(),
        trigger_id="ti_existing",
        flags=TriggerSubscriptionFlags(is_test=is_test),
        data=TriggerSubscriptionData(event_key="github.issue.opened"),
    )


def _edit(existing, *, is_test, references=None):
    return TriggerSubscriptionEdit(
        id=existing.id,
        connection_id=existing.connection_id,
        data=TriggerSubscriptionData(
            event_key="github.issue.opened",
            references=references,
        ),
        flags=TriggerSubscriptionFlags(is_test=is_test),
    )


async def test_create_test_subscription_bypasses_reference_validation():
    service = _make_service()

    result = await service.create_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_create(is_test=True),
    )

    service._validate_references.assert_not_awaited()
    # Test subs are always "on".
    assert result.flags.is_active is True
    assert result.flags.is_test is True


async def test_create_non_test_subscription_validates_references():
    service = _make_service()

    await service.create_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_create(is_test=False),
    )

    service._validate_references.assert_awaited_once()


async def test_edit_to_test_bypasses_validation_and_forces_active():
    service = _make_service()
    existing = _existing(is_test=False)
    service.dao.fetch_subscription = AsyncMock(return_value=existing)

    result = await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(existing, is_test=True),
    )

    service._validate_references.assert_not_awaited()
    assert result.flags.is_active is True


async def test_edit_test_off_rejects_when_references_do_not_resolve():
    service = _make_service()
    existing = _existing(is_test=True)
    service.dao.fetch_subscription = AsyncMock(return_value=existing)
    service._validate_references = AsyncMock(side_effect=TriggerReferenceInvalid())

    with pytest.raises(TriggerReferenceInvalid):
        await service.edit_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=_edit(existing, is_test=False, references=None),
        )


async def test_edit_test_off_succeeds_when_references_resolve():
    service = _make_service()
    existing = _existing(is_test=True)
    service.dao.fetch_subscription = AsyncMock(return_value=existing)

    result = await service.edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_edit(existing, is_test=False, references={"workflow": {}}),
    )

    service._validate_references.assert_awaited_once()
    assert result.flags.is_test is False


# --- /test one-shot lifecycle ------------------------------------------------ #


def _delivery():
    return TriggerDelivery(
        id=uuid4(),
        status=Status(code="200", message="success"),
        subscription_id=uuid4(),
        event_id="evt_1",
    )


async def test_test_subscription_returns_captured_delivery_and_tears_down():
    service = _make_service()
    delivery = _delivery()
    service.dao.poll_delivery_after = AsyncMock(return_value=delivery)

    result = await service.test_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_create(is_test=False),  # forced to test inside the helper
    )

    assert result is delivery
    # The created subscription is always marked is_test...
    created = service.dao.create_subscription.await_args.kwargs["subscription"]
    assert created.flags.is_test is True
    # ...and always torn down.
    service.dao.delete_subscription.assert_awaited_once()


async def test_test_subscription_times_out_and_tears_down():
    service = _make_service()
    service.dao.poll_delivery_after = AsyncMock(
        return_value=None
    )  # nothing ever arrives

    result = await service.test_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_create(is_test=True),
    )

    assert result is None
    service.dao.delete_subscription.assert_awaited_once()


async def test_test_subscription_tears_down_on_error():
    service = _make_service()
    service.dao.poll_delivery_after = AsyncMock(side_effect=RuntimeError("boom"))

    with pytest.raises(RuntimeError):
        await service.test_subscription(
            project_id=uuid4(),
            user_id=uuid4(),
            subscription=_create(is_test=True),
        )

    service.dao.delete_subscription.assert_awaited_once()


async def test_test_subscription_reuses_existing_live_subscription_on_conflict():
    """When a live subscription already owns the provider trigger (the mint hits
    the partial-unique index and the DAO raises EntityCreationConflict), the test
    captures against the existing subscription and leaves it in place."""
    service = _make_service()

    existing = _existing(is_test=False)  # a live, non-test subscription
    service.dao.create_subscription = AsyncMock(
        side_effect=EntityCreationConflict(
            entity="Trigger subscription",
            conflict={"trigger_id": "ti_existing"},
        )
    )
    service.dao.fetch_subscription_by_trigger_id = AsyncMock(return_value=existing)

    old_delivery = _delivery()  # pre-existing baseline delivery
    new_delivery = _delivery()  # the newly captured one (different id)
    service.dao.query_deliveries = AsyncMock(return_value=[old_delivery])
    service.dao.poll_delivery_after = AsyncMock(return_value=new_delivery)

    result = await service.test_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=_create(is_test=False),
    )

    # The freshly arrived delivery is returned, not the stale baseline.
    assert result is new_delivery
    # The existing live subscription must NOT be torn down.
    service.dao.delete_subscription.assert_not_awaited()
    # Only the single failed mint attempt — no duplicate persisted.
    service.dao.create_subscription.assert_awaited_once()
    # Reuse resolved via the exact colliding trigger_id, not a connection+event query.
    service.dao.fetch_subscription_by_trigger_id.assert_awaited_once()
    # Baseline was taken against the existing subscription's id...
    assert (
        service.dao.query_deliveries.await_args.kwargs["delivery"].subscription_id
        == existing.id
    )
    # ...and the poll was seeded with that baseline id, against the same subscription.
    poll_kwargs = service.dao.poll_delivery_after.await_args.kwargs
    assert poll_kwargs["subscription_id"] == existing.id
    assert poll_kwargs["baseline_id"] == old_delivery.id
