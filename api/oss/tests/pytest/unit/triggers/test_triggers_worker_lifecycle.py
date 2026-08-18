from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from oss.src.core.triggers.dtos import (
    TriggerSchedule,
    TriggerScheduleData,
    TriggerScheduleFlags,
)
from oss.src.tasks.taskiq.triggers.worker import TriggersWorker


class _Broker:
    def task(self, **_kwargs):
        return lambda function: function


def _schedule(*, is_active=True):
    return TriggerSchedule(
        id=uuid4(),
        created_by_id=uuid4(),
        data=TriggerScheduleData(event_key="cron.tick", schedule="* * * * *"),
        flags=TriggerScheduleFlags(is_active=is_active),
    )


def _worker(*, resolved):
    dispatcher = MagicMock()
    dispatcher.dispatch_schedule = AsyncMock()
    dispatcher.dispatch_subscription = AsyncMock()
    dao = MagicMock()
    dao.fetch_schedule = AsyncMock(return_value=resolved)
    worker = TriggersWorker(
        broker=_Broker(),
        dispatcher=dispatcher,
        triggers_dao=dao,
    )
    return worker, dao, dispatcher


async def test_schedule_task_reresolves_new_id_payload_before_dispatch():
    current = _schedule()
    worker, dao, dispatcher = _worker(resolved=current)
    project_id = uuid4()

    await worker.dispatch_schedule(
        project_id=str(project_id),
        schedule_id=str(current.id),
        event_id="event-1",
        event={},
    )

    dao.fetch_schedule.assert_awaited_once_with(
        project_id=project_id,
        schedule_id=current.id,
    )
    assert dispatcher.dispatch_schedule.await_args.kwargs["schedule"] is current


async def test_schedule_task_supports_v0112_serialized_payload_but_uses_live_row():
    stale = _schedule()
    current = stale.model_copy(
        update={"data": TriggerScheduleData(event_key="current", schedule="0 * * * *")}
    )
    worker, _, dispatcher = _worker(resolved=current)

    await worker.dispatch_schedule(
        project_id=str(uuid4()),
        schedule=stale.model_dump(mode="json"),
        event_id="event-1",
        event={},
    )

    assert dispatcher.dispatch_schedule.await_args.kwargs["schedule"] is current


async def test_schedule_task_skips_deleted_or_missing_schedule():
    stale = _schedule()
    worker, _, dispatcher = _worker(resolved=None)

    await worker.dispatch_schedule(
        project_id=str(uuid4()),
        schedule=stale.model_dump(mode="json"),
        event_id="event-1",
        event={},
    )

    dispatcher.dispatch_schedule.assert_not_awaited()


async def test_schedule_task_skips_schedule_disabled_after_enqueue():
    disabled = _schedule(is_active=False)
    worker, _, dispatcher = _worker(resolved=disabled)

    await worker.dispatch_schedule(
        project_id=str(uuid4()),
        schedule_id=str(disabled.id),
        event_id="event-1",
        event={},
    )

    dispatcher.dispatch_schedule.assert_not_awaited()


async def test_subscription_task_skips_deleted_subscription_lookup():
    worker, dao, dispatcher = _worker(resolved=None)
    dao.get_project_and_subscription_by_trigger_id = AsyncMock(return_value=None)

    await worker.dispatch_trigger(
        trigger_id="ti_deleted",
        event_id="event-1",
        event={},
        context=SimpleNamespace(message=SimpleNamespace(labels={})),
    )

    dispatcher.dispatch_subscription.assert_not_awaited()
