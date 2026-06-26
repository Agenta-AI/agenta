"""Unit tests for the schedule cron fire-gate.

Pins ``TriggersService._validate_schedule`` (cron expression contract),
``_normalize_window`` (minute-floored UTC bounds), ``refresh_schedules`` (the
point-in-time ``croniter.match`` gate, the [start, end) active-window gate,
per-tick dedup, and the failure-aware return), and the past-``end_time``
re-activation guard in ``set_schedule_active``. Stubs the DAO and the dispatch
task; no DB, no Composio. Mirrors live-eval ``refresh_runs``.
"""

from datetime import datetime, timedelta, timezone
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


def _make_schedule(*, expr="* * * * *", is_active=True, start_time=None, end_time=None):
    return TriggerSchedule(
        id=uuid4(),
        created_by_id=uuid4(),
        flags=TriggerScheduleFlags(is_active=is_active),
        data=TriggerScheduleData(
            event_key="report.daily",
            schedule=expr,
            start_time=start_time,
            end_time=end_time,
        ),
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


class TestNormalizeWindow:
    def test_floors_to_minute_in_utc(self):
        data = TriggerScheduleData(
            event_key="k",
            schedule="* * * * *",
            start_time=datetime(2026, 6, 22, 10, 5, 37, 123, tzinfo=timezone.utc),
            end_time=datetime(2026, 6, 22, 11, 59, 59, tzinfo=timezone.utc),
        )
        TriggersService._normalize_window(data)
        assert data.start_time == datetime(2026, 6, 22, 10, 5, tzinfo=timezone.utc)
        assert data.end_time == datetime(2026, 6, 22, 11, 59, tzinfo=timezone.utc)

    def test_naive_input_is_assumed_utc(self):
        data = TriggerScheduleData(
            event_key="k",
            schedule="* * * * *",
            start_time=datetime(2026, 6, 22, 10, 5, 37),
        )
        TriggersService._normalize_window(data)
        assert data.start_time == datetime(2026, 6, 22, 10, 5, tzinfo=timezone.utc)

    def test_aware_non_utc_input_is_converted(self):
        tz = timezone(timedelta(hours=2))
        data = TriggerScheduleData(
            event_key="k",
            schedule="* * * * *",
            start_time=datetime(2026, 6, 22, 12, 5, tzinfo=tz),
        )
        TriggersService._normalize_window(data)
        assert data.start_time == datetime(2026, 6, 22, 10, 5, tzinfo=timezone.utc)

    def test_none_bounds_stay_none(self):
        data = TriggerScheduleData(event_key="k", schedule="* * * * *")
        TriggersService._normalize_window(data)
        assert data.start_time is None
        assert data.end_time is None

    def test_rejects_end_before_or_equal_start(self):
        data = TriggerScheduleData(
            event_key="k",
            schedule="* * * * *",
            start_time=datetime(2026, 6, 22, 11, 0, tzinfo=timezone.utc),
            end_time=datetime(2026, 6, 22, 11, 0, tzinfo=timezone.utc),
        )
        with pytest.raises(TriggerScheduleInvalid):
            TriggersService._normalize_window(data)


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


class TestRefreshWindowGate:
    async def test_before_start_is_skipped_but_left_active(self):
        sched = _make_schedule(
            expr="* * * * *",
            start_time=_TICK + timedelta(minutes=1),
        )
        service, _ = _service(schedules=[sched])
        service.set_schedule_active = AsyncMock()
        ok = await service.refresh_schedules(timestamp=_TICK, interval=1)
        assert ok is True
        service.schedule_dispatch_task.kiq.assert_not_awaited()
        service.set_schedule_active.assert_not_awaited()

    async def test_at_start_is_dispatched(self):
        sched = _make_schedule(expr="* * * * *", start_time=_TICK)
        service, _ = _service(schedules=[sched])
        service.set_schedule_active = AsyncMock()
        await service.refresh_schedules(timestamp=_TICK, interval=1)
        service.schedule_dispatch_task.kiq.assert_awaited_once()

    async def test_within_window_is_dispatched(self):
        sched = _make_schedule(
            expr="* * * * *",
            start_time=_TICK - timedelta(minutes=5),
            end_time=_TICK + timedelta(minutes=5),
        )
        service, _ = _service(schedules=[sched])
        service.set_schedule_active = AsyncMock()
        await service.refresh_schedules(timestamp=_TICK, interval=1)
        service.schedule_dispatch_task.kiq.assert_awaited_once()
        service.set_schedule_active.assert_not_awaited()

    async def test_at_end_auto_stops_and_does_not_dispatch(self):
        # end is exclusive: a tick exactly at end_time is outside the window.
        sched = _make_schedule(expr="* * * * *", end_time=_TICK)
        service, _ = _service(schedules=[sched])
        service.set_schedule_active = AsyncMock()
        ok = await service.refresh_schedules(timestamp=_TICK, interval=1)
        assert ok is True
        service.schedule_dispatch_task.kiq.assert_not_awaited()
        service.set_schedule_active.assert_awaited_once()
        assert service.set_schedule_active.await_args.kwargs["is_active"] is False
        assert service.set_schedule_active.await_args.kwargs["schedule_id"] == sched.id

    async def test_past_end_auto_stops(self):
        sched = _make_schedule(
            expr="* * * * *",
            end_time=_TICK - timedelta(minutes=10),
        )
        service, _ = _service(schedules=[sched])
        service.set_schedule_active = AsyncMock()
        await service.refresh_schedules(timestamp=_TICK, interval=1)
        service.set_schedule_active.assert_awaited_once()
        service.schedule_dispatch_task.kiq.assert_not_awaited()


class TestSetScheduleActiveWindowGuard:
    def _service_for(self, sched):
        dao = MagicMock()
        dao.fetch_schedule = AsyncMock(return_value=sched)
        dao.edit_schedule = AsyncMock(return_value=sched)
        service = TriggersService(
            adapter_registry=MagicMock(),
            catalog_service=MagicMock(),
            triggers_dao=dao,
            connections_service=MagicMock(),
            workflows_service=MagicMock(),
        )
        return service, dao

    async def test_activate_rejected_when_end_time_passed(self):
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        sched = _make_schedule(is_active=False, end_time=past)
        service, dao = self._service_for(sched)
        with pytest.raises(TriggerScheduleInvalid):
            await service.set_schedule_active(
                project_id=uuid4(),
                user_id=uuid4(),
                schedule_id=sched.id,
                is_active=True,
            )
        dao.edit_schedule.assert_not_awaited()

    async def test_activate_allowed_when_end_time_in_future(self):
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        sched = _make_schedule(is_active=False, end_time=future)
        service, dao = self._service_for(sched)
        await service.set_schedule_active(
            project_id=uuid4(),
            user_id=uuid4(),
            schedule_id=sched.id,
            is_active=True,
        )
        dao.edit_schedule.assert_awaited_once()

    async def test_deactivate_is_never_blocked_by_window(self):
        # The auto-stop path calls with is_active=False even past end_time.
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        sched = _make_schedule(is_active=True, end_time=past)
        service, dao = self._service_for(sched)
        await service.set_schedule_active(
            project_id=uuid4(),
            user_id=uuid4(),
            schedule_id=sched.id,
            is_active=False,
        )
        dao.edit_schedule.assert_awaited_once()
