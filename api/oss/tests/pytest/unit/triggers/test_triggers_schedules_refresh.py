"""Unit tests for the schedule cron fire-gate.

Pins ``TriggersService._validate_schedule`` (cron expression contract) and
``refresh_schedules`` (the point-in-time ``croniter.match`` gate, per-tick dedup,
and the failure-aware return). Stubs the DAO and the dispatch task; no DB, no
Composio. Mirrors live-eval ``refresh_runs``.
"""

from datetime import datetime, timezone
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

import pytest

from oss.src.core.triggers.dtos import (
    TriggerSchedule,
    TriggerScheduleData,
    TriggerScheduleFlags,
)
from oss.src.core.triggers.exceptions import TriggerScheduleInvalid
from oss.src.core.triggers.service import TriggersService


# A tick that matches "* * * * *" and "0 * * * *" (top of the hour, UTC).
_TICK = datetime(2026, 6, 22, 10, 0, 0, tzinfo=timezone.utc)


def _make_schedule(*, expr="* * * * *", is_active=True):
    return TriggerSchedule(
        id=uuid4(),
        created_by_id=uuid4(),
        flags=TriggerScheduleFlags(is_active=is_active),
        data=TriggerScheduleData(event_key="report.daily", schedule=expr),
    )


def _service(*, schedules=None, seen=False, with_task=True):
    dao = MagicMock()
    dao.fetch_active_schedules_with_project = AsyncMock(
        return_value=[(uuid4(), s) for s in (schedules or [])]
    )
    dao.dedup_seen_schedule = AsyncMock(return_value=seen)
    service = TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=MagicMock(),
        workflows_service=MagicMock(),
    )
    if with_task:
        service.schedule_dispatch_task = MagicMock(kiq=AsyncMock())
    return service, dao


class TestValidateSchedule:
    def test_accepts_valid_five_field_cron(self):
        TriggersService._validate_schedule("*/5 * * * *")

    @pytest.mark.parametrize("expr", ["* * * *", "* * * * * *", "", "daily"])
    def test_rejects_wrong_field_count(self, expr):
        with pytest.raises(TriggerScheduleInvalid):
            TriggersService._validate_schedule(expr)

    def test_rejects_unparseable_cron(self):
        with pytest.raises(TriggerScheduleInvalid):
            TriggersService._validate_schedule("99 * * * *")

    def test_non_string_is_rejected_without_crashing(self):
        with pytest.raises(TriggerScheduleInvalid):
            TriggersService._validate_schedule(None)  # type: ignore[arg-type]


class TestRefreshSchedules:
    async def test_matching_schedule_is_dispatched(self):
        sched = _make_schedule(expr="0 * * * *")
        service, _ = _service(schedules=[sched])
        ok = await service.refresh_schedules(timestamp=_TICK, interval=1)
        assert ok is True
        service.schedule_dispatch_task.kiq.assert_awaited_once()

    async def test_non_matching_schedule_is_skipped(self):
        # Fires only at minute 30; the tick is at minute 0.
        sched = _make_schedule(expr="30 * * * *")
        service, _ = _service(schedules=[sched])
        ok = await service.refresh_schedules(timestamp=_TICK, interval=1)
        assert ok is True
        service.schedule_dispatch_task.kiq.assert_not_awaited()

    async def test_already_seen_tick_is_not_redispatched(self):
        sched = _make_schedule(expr="* * * * *")
        service, _ = _service(schedules=[sched], seen=True)
        ok = await service.refresh_schedules(timestamp=_TICK, interval=1)
        assert ok is True
        service.schedule_dispatch_task.kiq.assert_not_awaited()

    async def test_deterministic_event_id_per_tick(self):
        sched = _make_schedule(expr="* * * * *")
        service, dao = _service(schedules=[sched])
        await service.refresh_schedules(timestamp=_TICK, interval=1)
        _, kwargs = service.schedule_dispatch_task.kiq.await_args
        assert kwargs["event_id"] == f"{sched.id}:{_TICK.isoformat()}"
        # The dedup probe uses the same id.
        assert (
            dao.dedup_seen_schedule.await_args.kwargs["event_id"] == kwargs["event_id"]
        )

    async def test_dispatch_failure_returns_false(self):
        sched = _make_schedule(expr="* * * * *")
        service, _ = _service(schedules=[sched])
        service.schedule_dispatch_task.kiq = AsyncMock(side_effect=RuntimeError("boom"))
        ok = await service.refresh_schedules(timestamp=_TICK, interval=1)
        assert ok is False

    async def test_no_timestamp_returns_false(self):
        service, _ = _service(schedules=[_make_schedule()])
        ok = await service.refresh_schedules(timestamp=None, interval=1)
        assert ok is False

    async def test_unconfigured_task_returns_false(self):
        service, _ = _service(schedules=[_make_schedule()], with_task=False)
        service.schedule_dispatch_task = None
        ok = await service.refresh_schedules(timestamp=_TICK, interval=1)
        assert ok is False
