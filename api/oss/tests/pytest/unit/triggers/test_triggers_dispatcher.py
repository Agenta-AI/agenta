"""Unit tests for the trigger dispatcher.

The inbound dual of ``test_webhooks_dispatcher.py``. Stubs the DAO and workflows
service (no DB, no Composio) and pins the dispatch branches: inactive entity,
dedup, missing workflow reference, and the happy path. The trigger_id lookup moved to
the worker, so unknown-trigger handling is no longer the dispatcher's concern.
"""

from types import SimpleNamespace
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

from oss.src.core.shared.dtos import Reference
from oss.src.core.triggers.dtos import (
    TriggerSubscription,
    TriggerSubscriptionData,
    TriggerSubscriptionFlags,
)
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher


def _make_subscription(
    *,
    is_active=True,
    is_valid=True,
    is_test=False,
    references=None,
    inputs_fields=None,
):
    return TriggerSubscription(
        id=uuid4(),
        created_by_id=uuid4(),
        connection_id=uuid4(),
        flags=TriggerSubscriptionFlags(
            is_active=is_active, is_valid=is_valid, is_test=is_test
        ),
        data=TriggerSubscriptionData(
            event_key="github.issue.opened",
            inputs_fields=inputs_fields,
            references=references,
            selector=None,
        ),
    )


def _make_dao(*, seen=False):
    dao = MagicMock()
    dao.dedup_seen = AsyncMock(return_value=seen)
    dao.write_delivery = AsyncMock()
    return dao


# Raw provider envelope (Composio webhook shape): the message lives under
# `payload`, the routing ids under `metadata` (`trigger_id` = the provider ti_*,
# `id` = the per-delivery event id). The dispatcher normalizes this into
# `event.{event_id,event_type,attributes}` before mapping.
_EVENT = {
    "metadata": {
        "trigger_id": "ti_1",
        "id": "evt_1",
        "trigger_slug": "github.issue.opened",
    },
    "payload": {"issue": {"number": 7}},
}


def test_build_context_normalizes_provider_envelope():
    project_id = uuid4()
    subscription = _make_subscription()
    dispatcher = TriggersDispatcher(
        triggers_dao=MagicMock(), workflows_service=MagicMock()
    )

    context = dispatcher._build_context(
        event=_EVENT,
        entity=subscription,
        project_id=project_id,
    )

    event = context["event"]
    assert event["event_id"] == "evt_1"
    assert event["event_type"] == "github.issue.opened"
    assert event["attributes"] == {"issue": {"number": 7}}
    assert event["timestamp"] == event["created_at"]
    # Raw provider keys never leak into the resolution context.
    assert "payload" not in event
    assert "metadata" not in event
    assert context["scope"] == {"project_id": str(project_id)}


def test_build_context_tolerates_missing_metadata_and_payload():
    dispatcher = TriggersDispatcher(
        triggers_dao=MagicMock(), workflows_service=MagicMock()
    )

    context = dispatcher._build_context(
        event={},
        entity=_make_subscription(),
        project_id=uuid4(),
    )

    event = context["event"]
    assert event["event_id"] is None
    assert event["event_type"] is None
    assert event["attributes"] is None


async def test_inactive_entity_is_skipped():
    project_id = uuid4()
    subscription = _make_subscription(is_active=False)
    dao = _make_dao()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=MagicMock())

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    dao.dedup_seen.assert_not_awaited()
    dao.write_delivery.assert_not_awaited()


async def test_invalid_subscription_is_not_silently_skipped():
    project_id = uuid4()
    subscription = _make_subscription(
        is_valid=False, references={"workflow": Reference(slug="wf-1")}
    )
    dao = _make_dao()
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock(
        return_value=SimpleNamespace(
            status=SimpleNamespace(code=200, message="success"),
            outputs={"ok": True},
            trace_id="tr-1",
            span_id="sp-1",
        )
    )
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    dao.dedup_seen.assert_awaited_once()
    # The workflow must NOT run for an invalid subscription, and a failed
    # delivery must be recorded so the user can see why.
    workflows.invoke_workflow.assert_not_awaited()
    dao.write_delivery.assert_awaited_once()
    delivery = dao.write_delivery.await_args.kwargs["delivery"]
    assert delivery.status.code == "409"
    assert "invalid" in delivery.data.error.lower()


async def test_duplicate_event_is_skipped():
    project_id = uuid4()
    subscription = _make_subscription(references={"workflow": Reference(slug="wf-1")})
    dao = _make_dao(seen=True)
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=MagicMock())

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    dao.dedup_seen.assert_awaited_once()
    dao.write_delivery.assert_not_awaited()


async def test_missing_reference_writes_failed_delivery():
    project_id = uuid4()
    subscription = _make_subscription(references=None)
    dao = _make_dao()
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    workflows.invoke_workflow.assert_not_awaited()
    dao.write_delivery.assert_awaited_once()
    delivery = dao.write_delivery.await_args.kwargs["delivery"]
    assert delivery.status.code == "400"
    assert "no bound workflow" in delivery.data.error.lower()


async def test_happy_path_invokes_workflow_and_writes_success():
    project_id = uuid4()
    reference = Reference(slug="wf-1")
    subscription = _make_subscription(
        references={"workflow": reference},
        inputs_fields={"number": "$.event.attributes.issue.number"},
    )
    dao = _make_dao()

    response = SimpleNamespace(
        status=SimpleNamespace(code=200, message="success"),
        outputs={"ok": True},
        trace_id="tr-1",
        span_id="sp-1",
    )
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock(return_value=response)
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    workflows.invoke_workflow.assert_awaited_once()
    invoke_kwargs = workflows.invoke_workflow.await_args.kwargs
    assert invoke_kwargs["project_id"] == project_id
    assert invoke_kwargs["user_id"] == subscription.created_by_id

    dao.write_delivery.assert_awaited_once()
    delivery = dao.write_delivery.await_args.kwargs["delivery"]
    assert delivery.status.code == "200"
    assert delivery.event_id == "e1"
    assert delivery.subscription_id == subscription.id
    assert delivery.schedule_id is None
    assert delivery.data.inputs == {"number": 7}


async def test_test_subscription_captures_event_and_skips_workflow():
    project_id = uuid4()
    # No references, is_valid=False — a test sub captures regardless of both.
    subscription = _make_subscription(is_test=True, is_valid=False, references=None)
    dao = _make_dao()
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    dao.dedup_seen.assert_awaited_once()
    workflows.invoke_workflow.assert_not_awaited()
    dao.write_delivery.assert_awaited_once()
    delivery = dao.write_delivery.await_args.kwargs["delivery"]
    assert delivery.status.code == "200"
    assert delivery.data.is_test is True
    # Default inputs_fields ("$") captures the whole resolved event context.
    assert delivery.data.inputs["event"]["attributes"] == {"issue": {"number": 7}}
    assert delivery.data.error is None


async def test_test_subscription_dedups():
    project_id = uuid4()
    subscription = _make_subscription(is_test=True)
    dao = _make_dao(seen=True)
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    dao.write_delivery.assert_not_awaited()
    workflows.invoke_workflow.assert_not_awaited()


async def test_workflow_non_200_writes_failed_delivery():
    project_id = uuid4()
    reference = Reference(slug="wf-1")
    subscription = _make_subscription(references={"workflow": reference})
    dao = _make_dao()

    response = SimpleNamespace(
        status=SimpleNamespace(code=500, message="boom"),
        outputs=None,
        trace_id="tr-1",
        span_id="sp-1",
    )
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock(return_value=response)
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    dao.write_delivery.assert_awaited_once()
    delivery = dao.write_delivery.await_args.kwargs["delivery"]
    assert delivery.status.code == "500"


async def test_detached_dispatch_writes_dispatched_delivery():
    project_id = uuid4()
    reference = Reference(slug="wf-1")
    subscription = _make_subscription(
        references={"workflow": reference},
        inputs_fields={"number": "$.event.attributes.issue.number"},
    )
    dao = _make_dao()
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock()

    run_id = "run-abc-123"
    dispatch_fn = AsyncMock(return_value=run_id)
    dispatcher = TriggersDispatcher(
        triggers_dao=dao, workflows_service=workflows, dispatch_fn=dispatch_fn
    )

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    # dispatch_fn called instead of invoke_workflow
    dispatch_fn.assert_awaited_once()
    workflows.invoke_workflow.assert_not_awaited()

    dao.write_delivery.assert_awaited_once()
    delivery = dao.write_delivery.await_args.kwargs["delivery"]
    assert delivery.status.code == "202"
    assert delivery.data.result == {"run_id": run_id}
