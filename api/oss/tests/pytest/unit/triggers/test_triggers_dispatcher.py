"""Unit tests for the trigger dispatcher.

The inbound dual of ``test_webhooks_dispatcher.py``. Stubs the DAO and workflows
service (no DB, no Composio) and pins the dispatch branches: inactive entity,
dedup, missing workflow reference, and the happy path. The trigger_id lookup moved to
the worker, so unknown-trigger handling is no longer the dispatcher's concern.
"""

from types import SimpleNamespace
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

import pytest

from oss.src.core.shared.dtos import Reference
from oss.src.core.triggers.dtos import (
    TriggerDelivery,
    TriggerSchedule,
    TriggerScheduleData,
    TriggerScheduleFlags,
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


def _make_schedule(*, is_active=True, references=None, inputs_fields=None):
    return TriggerSchedule(
        id=uuid4(),
        created_by_id=uuid4(),
        flags=TriggerScheduleFlags(is_active=is_active),
        data=TriggerScheduleData(
            event_key="cron.tick",
            schedule="* * * * *",
            inputs_fields=inputs_fields,
            references=references,
            selector=None,
        ),
    )


def _make_dao(*, seen=False, claim_lost=False):
    """`claim_lost=True` simulates a concurrent caller having already won the
    atomic claim on `_run`'s delivery row (claim_delivery returns None) — the
    scenario the dedup pre-check alone cannot catch (P1-3)."""
    dao = MagicMock()
    dao.dedup_seen = AsyncMock(return_value=seen)
    dao.dedup_seen_schedule = AsyncMock(return_value=seen)
    dao.write_delivery = AsyncMock()

    def _claim(*, project_id, user_id, delivery):
        if claim_lost:
            return None
        return TriggerDelivery(
            id=delivery.id,
            subscription_id=delivery.subscription_id,
            schedule_id=delivery.schedule_id,
            event_id=delivery.event_id,
            status=delivery.status,
        )

    dao.claim_delivery = AsyncMock(side_effect=_claim)
    dao.update_delivery = AsyncMock()
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
    # _run claims the row FIRST (even though it will fail before ever invoking).
    dao.claim_delivery.assert_awaited_once()
    dao.update_delivery.assert_awaited_once()
    update_kwargs = dao.update_delivery.await_args.kwargs
    assert update_kwargs["status"].code == "400"
    assert "no bound workflow" in update_kwargs["data"].error.lower()
    dao.write_delivery.assert_not_awaited()


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

    # The claim happens BEFORE invoke, and the terminal write is an UPDATE of the
    # SAME claimed row (never a fresh write_delivery insert) — the P1-3 contract.
    dao.claim_delivery.assert_awaited_once()
    claimed = dao.claim_delivery.await_args.kwargs["delivery"]
    assert claimed.status.code == "102"
    assert claimed.subscription_id == subscription.id
    assert claimed.schedule_id is None
    assert claimed.event_id == "e1"

    dao.update_delivery.assert_awaited_once()
    update_kwargs = dao.update_delivery.await_args.kwargs
    assert update_kwargs["delivery_id"] == claimed.id
    assert update_kwargs["status"].code == "200"
    assert update_kwargs["data"].inputs == {"number": 7}
    dao.write_delivery.assert_not_awaited()


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

    dao.claim_delivery.assert_awaited_once()
    dao.update_delivery.assert_awaited_once()
    update_kwargs = dao.update_delivery.await_args.kwargs
    assert update_kwargs["status"].code == "500"
    dao.write_delivery.assert_not_awaited()


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

    dao.claim_delivery.assert_awaited_once()
    dao.update_delivery.assert_awaited_once()
    update_kwargs = dao.update_delivery.await_args.kwargs
    assert update_kwargs["status"].code == "202"
    assert update_kwargs["data"].result == {"run_id": run_id}
    dao.write_delivery.assert_not_awaited()


# --- SCHEDULES ---------------------------------------------------------------- #
# The schedule dispatch task is registered with retry_on_error, and _run writes a
# delivery keyed by (schedule_id, event_id) before re-raising. Without a dedup gate a
# retry would re-invoke the workflow and re-fire its side effects.

_SCHEDULE_EVENT = {
    "metadata": {"trigger_slug": "cron.tick", "id": "sched-1:2026-07-13T00:00:00"},
    "payload": {"timestamp": "2026-07-13T00:00:00"},
}


async def test_inactive_schedule_is_skipped():
    schedule = _make_schedule(is_active=False)
    dao = _make_dao()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=MagicMock())

    await dispatcher.dispatch_schedule(
        project_id=uuid4(),
        schedule=schedule,
        event_id="e1",
        event=_SCHEDULE_EVENT,
    )

    dao.dedup_seen_schedule.assert_not_awaited()
    dao.write_delivery.assert_not_awaited()


async def test_duplicate_schedule_event_is_skipped():
    """A retried cron tick must not re-invoke the workflow (re-firing side effects)."""
    project_id = uuid4()
    schedule = _make_schedule(references={"workflow": Reference(slug="wf-1")})
    dao = _make_dao(seen=True)
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch_schedule(
        project_id=project_id,
        schedule=schedule,
        event_id="e1",
        event=_SCHEDULE_EVENT,
    )

    dao.dedup_seen_schedule.assert_awaited_once()
    kwargs = dao.dedup_seen_schedule.await_args.kwargs
    assert kwargs["project_id"] == project_id
    assert kwargs["schedule_id"] == schedule.id
    assert kwargs["event_id"] == "e1"

    workflows.invoke_workflow.assert_not_awaited()
    dao.write_delivery.assert_not_awaited()


async def test_first_schedule_event_invokes_workflow():
    """The dedup gate must not block the first (unseen) tick."""
    project_id = uuid4()
    schedule = _make_schedule(references={"workflow": Reference(slug="wf-1")})
    dao = _make_dao(seen=False)

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

    await dispatcher.dispatch_schedule(
        project_id=project_id,
        schedule=schedule,
        event_id="e1",
        event=_SCHEDULE_EVENT,
    )

    dao.dedup_seen_schedule.assert_awaited_once()
    workflows.invoke_workflow.assert_awaited_once()

    dao.claim_delivery.assert_awaited_once()
    claimed = dao.claim_delivery.await_args.kwargs["delivery"]
    assert claimed.schedule_id == schedule.id
    assert claimed.subscription_id is None
    assert claimed.event_id == "e1"

    dao.update_delivery.assert_awaited_once()
    update_kwargs = dao.update_delivery.await_args.kwargs
    assert update_kwargs["delivery_id"] == claimed.id
    assert update_kwargs["status"].code == "200"
    dao.write_delivery.assert_not_awaited()


async def test_failed_schedule_invoke_records_the_row_the_retry_dedups_on():
    """The retry gate only works because the failure path records the delivery
    (schedule_id + event_id) BEFORE re-raising to taskiq.
    """
    project_id = uuid4()
    schedule = _make_schedule(references={"workflow": Reference(slug="wf-1")})
    dao = _make_dao(seen=False)

    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock(side_effect=RuntimeError("boom"))
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    with pytest.raises(RuntimeError):
        await dispatcher.dispatch_schedule(
            project_id=project_id,
            schedule=schedule,
            event_id="e1",
            event=_SCHEDULE_EVENT,
        )

    # The row was claimed BEFORE invoke and completed to "500" via an UPDATE — a
    # retry's dedup_seen_schedule check will see it, and even if that read raced,
    # the retry's own claim_delivery would still lose against this claimed row.
    dao.claim_delivery.assert_awaited_once()
    dao.update_delivery.assert_awaited_once()
    update_kwargs = dao.update_delivery.await_args.kwargs
    assert update_kwargs["status"].code == "500"
    dao.write_delivery.assert_not_awaited()


async def test_claim_lost_skips_invoke_even_when_dedup_precheck_missed_it():
    """P1-3: the dedup pre-check is a fast path, not the authority. If a
    concurrent caller already won the atomic claim (claim_delivery -> None),
    _run must not invoke the workflow — even though dedup_seen reported unseen
    (the exact TOCTOU window between the pre-check read and the claim)."""
    project_id = uuid4()
    subscription = _make_subscription(references={"workflow": Reference(slug="wf-1")})
    dao = _make_dao(seen=False, claim_lost=True)
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    dao.claim_delivery.assert_awaited_once()
    workflows.invoke_workflow.assert_not_awaited()
    dao.update_delivery.assert_not_awaited()
    dao.write_delivery.assert_not_awaited()


async def test_claim_lost_skips_invoke_for_schedule_too():
    project_id = uuid4()
    schedule = _make_schedule(references={"workflow": Reference(slug="wf-1")})
    dao = _make_dao(seen=False, claim_lost=True)
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch_schedule(
        project_id=project_id,
        schedule=schedule,
        event_id="e1",
        event=_SCHEDULE_EVENT,
    )

    dao.claim_delivery.assert_awaited_once()
    workflows.invoke_workflow.assert_not_awaited()
    dao.update_delivery.assert_not_awaited()


async def test_post_invoke_write_failure_does_not_permit_a_reinvoke_on_retry():
    """P1-3's core scenario: the workflow succeeds, but the terminal delivery
    UPDATE fails (e.g. a transient DB error). Because the row was already
    claimed via an atomic INSERT before invoke, a retry's claim_delivery call
    on the same event finds the row already there and returns None — the retry
    must NOT re-invoke, regardless of whether the terminal write ever landed."""
    project_id = uuid4()
    subscription = _make_subscription(references={"workflow": Reference(slug="wf-1")})

    response = SimpleNamespace(
        status=SimpleNamespace(code=200, message="success"),
        outputs={"ok": True},
        trace_id="tr-1",
        span_id="sp-1",
    )
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock(return_value=response)

    # First attempt: claim succeeds, invoke succeeds, but the terminal UPDATE
    # write fails (simulating a transient DB error after a successful invoke).
    dao = _make_dao(seen=False)
    dao.update_delivery = AsyncMock(side_effect=RuntimeError("db write failed"))
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    with pytest.raises(RuntimeError, match="db write failed"):
        await dispatcher.dispatch_subscription(
            project_id=project_id,
            subscription=subscription,
            event_id="e1",
            event=_EVENT,
        )

    workflows.invoke_workflow.assert_awaited_once()
    dao.claim_delivery.assert_awaited_once()

    # Retry: the row _run claimed on attempt 1 is now a permanent (committed)
    # row in the DB regardless of the UPDATE failure — claim_delivery must lose
    # this time (simulated here via claim_lost), so the retry does NOT invoke.
    dao_retry = _make_dao(seen=False, claim_lost=True)
    dispatcher_retry = TriggersDispatcher(
        triggers_dao=dao_retry, workflows_service=workflows
    )
    workflows.invoke_workflow.reset_mock()

    await dispatcher_retry.dispatch_subscription(
        project_id=project_id, subscription=subscription, event_id="e1", event=_EVENT
    )

    workflows.invoke_workflow.assert_not_awaited()
    dao_retry.update_delivery.assert_not_awaited()
