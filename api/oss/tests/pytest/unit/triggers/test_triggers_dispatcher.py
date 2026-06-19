"""Unit tests for the trigger dispatcher.

The inbound dual of ``test_webhooks_dispatcher.py``. Stubs the DAO and workflows
service (no DB, no Composio) and pins the dispatch branches: unknown trigger,
disabled subscription, dedup, missing workflow reference, and the happy path.
"""

from types import SimpleNamespace
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

from oss.src.core.shared.dtos import Reference
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher


def _make_subscription(*, enabled=True, references=None, inputs_fields=None):
    data = SimpleNamespace(
        event_key="github.issue.opened",
        inputs_fields=inputs_fields,
        references=references,
        selector=None,
    )
    return SimpleNamespace(
        id=uuid4(),
        enabled=enabled,
        created_by_id=uuid4(),
        data=data,
        model_dump=lambda **_kwargs: {"id": "sub", "name": "watch"},
    )


def _make_dao(*, resolved, seen=False):
    dao = MagicMock()
    dao.get_project_and_subscription_by_trigger_id = AsyncMock(return_value=resolved)
    dao.dedup_seen = AsyncMock(return_value=seen)
    dao.write_delivery = AsyncMock()
    return dao


_EVENT = {"type": "github.issue.opened", "data": {"issue": {"number": 7}}}


async def test_unknown_trigger_id_is_skipped():
    dao = _make_dao(resolved=None)
    workflows = MagicMock()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch(trigger_id="ti_unknown", event_id="e1", event=_EVENT)

    dao.dedup_seen.assert_not_awaited()
    dao.write_delivery.assert_not_awaited()


async def test_disabled_subscription_is_skipped():
    project_id = uuid4()
    subscription = _make_subscription(enabled=False)
    dao = _make_dao(resolved=(project_id, subscription))
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=MagicMock())

    await dispatcher.dispatch(trigger_id="ti_1", event_id="e1", event=_EVENT)

    dao.dedup_seen.assert_not_awaited()
    dao.write_delivery.assert_not_awaited()


async def test_duplicate_event_is_skipped():
    project_id = uuid4()
    subscription = _make_subscription(references={"workflow": MagicMock()})
    dao = _make_dao(resolved=(project_id, subscription), seen=True)
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=MagicMock())

    await dispatcher.dispatch(trigger_id="ti_1", event_id="e1", event=_EVENT)

    dao.dedup_seen.assert_awaited_once()
    dao.write_delivery.assert_not_awaited()


async def test_missing_reference_writes_failed_delivery():
    project_id = uuid4()
    subscription = _make_subscription(references=None)
    dao = _make_dao(resolved=(project_id, subscription))
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock()
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch(trigger_id="ti_1", event_id="e1", event=_EVENT)

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
        inputs_fields={"number": "$.event.data.issue.number"},
    )
    dao = _make_dao(resolved=(project_id, subscription))

    response = SimpleNamespace(
        status=SimpleNamespace(code=200, message="success"),
        outputs={"ok": True},
        trace_id="tr-1",
        span_id="sp-1",
    )
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock(return_value=response)
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch(trigger_id="ti_1", event_id="e1", event=_EVENT)

    workflows.invoke_workflow.assert_awaited_once()
    invoke_kwargs = workflows.invoke_workflow.await_args.kwargs
    assert invoke_kwargs["project_id"] == project_id
    assert invoke_kwargs["user_id"] == subscription.created_by_id

    dao.write_delivery.assert_awaited_once()
    delivery = dao.write_delivery.await_args.kwargs["delivery"]
    assert delivery.status.code == "200"
    assert delivery.event_id == "e1"
    assert delivery.data.inputs == {"number": 7}


async def test_workflow_non_200_writes_failed_delivery():
    project_id = uuid4()
    reference = Reference(slug="wf-1")
    subscription = _make_subscription(references={"workflow": reference})
    dao = _make_dao(resolved=(project_id, subscription))

    response = SimpleNamespace(
        status=SimpleNamespace(code=500, message="boom"),
        outputs=None,
        trace_id="tr-1",
        span_id="sp-1",
    )
    workflows = MagicMock()
    workflows.invoke_workflow = AsyncMock(return_value=response)
    dispatcher = TriggersDispatcher(triggers_dao=dao, workflows_service=workflows)

    await dispatcher.dispatch(trigger_id="ti_1", event_id="e1", event=_EVENT)

    dao.write_delivery.assert_awaited_once()
    delivery = dao.write_delivery.await_args.kwargs["delivery"]
    assert delivery.status.code == "500"
