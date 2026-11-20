"""Unit tests for one-time schedules (`data.run_at`).

Pins the shape rule (exactly one of `schedule` and `run_at`, no window with
`run_at`), the rounding of `run_at` up to the whole minute, the one-time pass of
`refresh_schedules` (fire on time, late after missed ticks, never early for a tick
in the future, the limit per tick, the same event id for two refresh calls), the
column mapping, the DAO filters, and the refusal on the public create and edit
routes. Stubs the DAO and the dispatch task; no DB.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from oss.tests.pytest.utils.principals import any_principal

from oss.src.apis.fastapi.triggers.models import (
    TriggerScheduleCreateRequest,
    TriggerScheduleEditRequest,
)
from oss.src.apis.fastapi.triggers.router import TriggersRouter
from oss.src.core.triggers.dtos import (
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleData,
    TriggerScheduleEdit,
    TriggerScheduleFlags,
)
from oss.src.core.triggers.service import TriggersService, _one_time_run_at_text
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.src.dbs.postgres.triggers.dbes import TriggerScheduleDBE
from oss.src.dbs.postgres.triggers.mappings import (
    map_schedule_dbe_to_dto,
    map_schedule_dto_to_dbe_create,
    map_schedule_dto_to_dbe_edit,
)
from oss.src.utils.env import env


_RUN_AT = datetime(2026, 6, 22, 10, 30, tzinfo=timezone.utc)


def _one_time(*, run_at=_RUN_AT, is_active=True):
    return TriggerSchedule(
        id=uuid4(),
        created_by_id=uuid4(),
        principal=any_principal(),
        flags=TriggerScheduleFlags(is_active=is_active),
        data=TriggerScheduleData(event_key="timer.fire", run_at=run_at),
    )


def _service(*, recurring=None, due=None):
    dao = MagicMock()
    dao.fetch_active_recurring_schedules_with_project = AsyncMock(
        return_value=[(uuid4(), s) for s in (recurring or [])]
    )
    dao.dedup_seen_schedule = AsyncMock(return_value=False)
    dao.fetch_due_one_time_schedules = AsyncMock(
        return_value=[(uuid4(), s) for s in (due or [])]
    )
    service = TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=MagicMock(),
        triggers_dao=dao,
        connections_service=MagicMock(),
        workflows_service=MagicMock(),
    )
    service.schedule_dispatch_task = MagicMock(kiq=AsyncMock())
    return service, dao


# -- shape ---------------------------------------------------------------------------


class TestShape:
    def test_run_at_alone_is_valid(self):
        data = TriggerScheduleData(event_key="timer.fire", run_at=_RUN_AT)
        assert data.schedule is None

    def test_both_schedule_and_run_at_are_refused(self):
        with pytest.raises(ValidationError):
            TriggerScheduleData(
                event_key="timer.fire", schedule="0 * * * *", run_at=_RUN_AT
            )

    def test_neither_schedule_nor_run_at_is_refused(self):
        with pytest.raises(ValidationError):
            TriggerScheduleData(event_key="timer.fire")

    @pytest.mark.parametrize("bound", ["start_time", "end_time"])
    def test_a_window_with_run_at_is_refused(self, bound):
        with pytest.raises(ValidationError):
            TriggerScheduleData(
                event_key="timer.fire",
                run_at=_RUN_AT,
                **{bound: _RUN_AT + timedelta(hours=1)},
            )


class TestNormalizeRunAt:
    def test_seconds_round_up_to_the_next_minute(self):
        data = TriggerScheduleData(
            event_key="timer.fire", run_at=_RUN_AT + timedelta(seconds=1)
        )
        TriggersService._normalize_timing(data)
        assert data.run_at == _RUN_AT + timedelta(minutes=1)

    def test_a_whole_minute_stays(self):
        data = TriggerScheduleData(event_key="timer.fire", run_at=_RUN_AT)
        TriggersService._normalize_timing(data)
        assert data.run_at == _RUN_AT

    def test_naive_is_utc_and_other_zones_convert(self):
        naive = TriggerScheduleData(
            event_key="timer.fire", run_at=datetime(2026, 6, 22, 10, 30)
        )
        plus_two = TriggerScheduleData(
            event_key="timer.fire",
            run_at=datetime(2026, 6, 22, 12, 30, tzinfo=timezone(timedelta(hours=2))),
        )
        TriggersService._normalize_timing(naive)
        TriggersService._normalize_timing(plus_two)
        assert naive.run_at == _RUN_AT and naive.run_at.tzinfo == timezone.utc
        assert plus_two.run_at == _RUN_AT
        assert plus_two.run_at.isoformat() == "2026-06-22T10:30:00+00:00"

    def test_the_event_id_time_is_iso_utc_to_the_second(self):
        # The due query renders run_at in SQL as YYYY-MM-DD"T"HH24:MI:SS"+00:00";
        # this pins the Python side of the same text.
        plus_two = datetime(
            2026, 6, 22, 12, 30, 5, 123, tzinfo=timezone(timedelta(hours=2))
        )
        assert _one_time_run_at_text(plus_two) == "2026-06-22T10:30:05+00:00"
        assert _one_time_run_at_text(_RUN_AT) == _RUN_AT.isoformat()

    def test_a_cron_schedule_is_still_validated(self):
        from oss.src.core.triggers.exceptions import TriggerScheduleInvalid

        data = TriggerScheduleData(event_key="report.daily", schedule="daily")
        with pytest.raises(TriggerScheduleInvalid):
            TriggersService._normalize_timing(data)


# -- the one-time pass ---------------------------------------------------------------


class TestOneTimePass:
    async def test_fires_on_time_with_the_run_at_event_id(self):
        sched = _one_time()
        service, dao = _service(due=[sched])

        assert await service.refresh_schedules(timestamp=_RUN_AT, interval=1)

        assert dao.fetch_due_one_time_schedules.await_args.kwargs["due_by"] == _RUN_AT
        kwargs = service.schedule_dispatch_task.kiq.await_args.kwargs
        assert kwargs["event_id"] == f"{sched.id}:2026-06-22T10:30:00+00:00"
        assert kwargs["event"]["metadata"]["id"] == kwargs["event_id"]
        assert kwargs["schedule_id"] == str(sched.id)

    async def test_fires_late_after_missed_ticks_with_the_same_event_id(self):
        # The cron was down from 10:00 to 12:00; the first tick after is 12:01.
        sched = _one_time()
        service, dao = _service(due=[sched])
        late_tick = datetime(2026, 6, 22, 12, 1, tzinfo=timezone.utc)

        assert await service.refresh_schedules(timestamp=late_tick, interval=1)

        assert dao.fetch_due_one_time_schedules.await_args.kwargs["due_by"] == late_tick
        kwargs = service.schedule_dispatch_task.kiq.await_args.kwargs
        assert kwargs["event_id"] == f"{sched.id}:{_RUN_AT.isoformat()}"

    async def test_a_tick_in_the_future_uses_the_server_time(self):
        service, dao = _service()
        before = datetime.now(timezone.utc).replace(second=0, microsecond=0)

        await service.refresh_schedules(
            timestamp=datetime.now(timezone.utc) + timedelta(days=1), interval=1
        )

        after = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        due_by = dao.fetch_due_one_time_schedules.await_args.kwargs["due_by"]
        assert before <= due_by <= after

    async def test_the_limit_per_tick_comes_from_env(self, monkeypatch):
        monkeypatch.setattr(env.triggers, "one_time_schedules_max_per_tick", 7)
        service, dao = _service()

        await service.refresh_schedules(timestamp=_RUN_AT, interval=1)

        assert dao.fetch_due_one_time_schedules.await_args.kwargs["limit"] == 7

    async def test_two_refresh_calls_queue_the_same_event_id(self):
        # The dispatcher's delivery claim on (project, schedule, event id) lets one
        # of the two fire; both calls must therefore name the same event.
        sched = _one_time()
        service, _ = _service(due=[sched])

        await service.refresh_schedules(timestamp=_RUN_AT, interval=1)
        await service.refresh_schedules(
            timestamp=_RUN_AT + timedelta(minutes=1), interval=1
        )

        first, second = (
            c.kwargs["event_id"]
            for c in service.schedule_dispatch_task.kiq.await_args_list
        )
        assert first == second

    async def test_recurring_schedules_behave_as_today(self):
        recurring = TriggerSchedule(
            id=uuid4(),
            created_by_id=uuid4(),
            principal=any_principal(),
            data=TriggerScheduleData(event_key="report.daily", schedule="0 * * * *"),
        )
        tick = datetime(2026, 6, 22, 10, 0, tzinfo=timezone.utc)
        service, _ = _service(recurring=[recurring])

        assert await service.refresh_schedules(timestamp=tick, interval=1)

        kwargs = service.schedule_dispatch_task.kiq.await_args.kwargs
        assert kwargs["event_id"] == f"{recurring.id}:{tick.isoformat()}"

    async def test_a_fetch_failure_reports_failure(self):
        service, dao = _service()
        dao.fetch_due_one_time_schedules = AsyncMock(side_effect=RuntimeError("db"))

        assert not await service.refresh_schedules(timestamp=_RUN_AT, interval=1)

    async def test_a_dispatch_failure_reports_failure_and_keeps_going(self):
        first, second = _one_time(), _one_time()
        service, _ = _service(due=[first, second])
        service.schedule_dispatch_task.kiq = AsyncMock(
            side_effect=[RuntimeError("queue"), None]
        )

        assert not await service.refresh_schedules(timestamp=_RUN_AT, interval=1)
        assert service.schedule_dispatch_task.kiq.await_count == 2


# -- the column mapping --------------------------------------------------------------


class TestMapping:
    def test_run_at_is_a_column_not_a_data_key(self):
        dbe = map_schedule_dto_to_dbe_create(
            project_id=uuid4(),
            user_id=uuid4(),
            schedule=TriggerScheduleCreate(
                data=TriggerScheduleData(event_key="timer.fire", run_at=_RUN_AT)
            ),
        )
        assert dbe.run_at == _RUN_AT
        assert "run_at" not in dbe.data

    def test_edit_writes_the_column(self):
        dbe = TriggerScheduleDBE(id=uuid4(), project_id=uuid4(), data={})
        map_schedule_dto_to_dbe_edit(
            schedule_dbe=dbe,
            user_id=uuid4(),
            schedule=TriggerScheduleEdit(
                id=dbe.id,
                data=TriggerScheduleData(event_key="timer.fire", run_at=_RUN_AT),
            ),
        )
        assert dbe.run_at == _RUN_AT
        assert "run_at" not in dbe.data

    def test_read_maps_the_column_into_data(self):
        dbe = TriggerScheduleDBE(
            id=uuid4(),
            project_id=uuid4(),
            data={"event_key": "timer.fire"},
            flags={"is_active": True},
            run_at=_RUN_AT,
        )
        assert map_schedule_dbe_to_dto(schedule_dbe=dbe).data.run_at == _RUN_AT


# -- the DAO filters -----------------------------------------------------------------


class _Capture:
    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))


def _engine(capture):
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def session():
        yield capture

    return SimpleNamespace(session=session)


def _compiled(statement):
    return statement.compile(dialect=postgresql.dialect())


class TestDaoFilters:
    async def test_the_recurring_scan_leaves_out_one_time_schedules(self):
        capture = _Capture()
        await TriggersDAO(
            engine=_engine(capture)
        ).fetch_active_recurring_schedules_with_project()
        assert "trigger_schedules.run_at IS NULL" in str(
            _compiled(capture.statements[0])
        )

    async def test_the_due_query_reads_due_unfired_rows_earliest_first(self):
        capture = _Capture()
        await TriggersDAO(engine=_engine(capture)).fetch_due_one_time_schedules(
            due_by=_RUN_AT, limit=2000
        )
        compiled = _compiled(capture.statements[0])
        sql = str(compiled)
        assert "trigger_schedules.run_at IS NOT NULL" in sql
        assert "trigger_schedules.run_at <= %(run_at_1)s" in sql
        assert compiled.params["run_at_1"] == _RUN_AT
        assert "trigger_schedules.deleted_at IS NULL" in sql
        assert "NOT (EXISTS (SELECT trigger_deliveries.id" in sql
        assert 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"' in compiled.params.values()
        # A retryable delivery does not count as fired.
        assert "coalesce((trigger_deliveries.status ->> %(status_1)s)" in sql
        assert "500" in compiled.params.values()
        assert "ORDER BY trigger_schedules.run_at" in sql
        assert compiled.params["param_1"] == 2000


# -- the public routes ---------------------------------------------------------------


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(uuid4()), user_id=str(uuid4()), principal=any_principal()
        )
    )


class TestPublicRoutesRefuseRunAt:
    async def test_create_with_run_at_is_refused(self):
        service = MagicMock(create_schedule=AsyncMock())
        router = TriggersRouter(triggers_service=service)
        router._check = AsyncMock()

        with pytest.raises(HTTPException) as refusal:
            await router.create_schedule(
                _request(),
                body=TriggerScheduleCreateRequest(
                    schedule=TriggerScheduleCreate(
                        data=TriggerScheduleData(event_key="timer.fire", run_at=_RUN_AT)
                    )
                ),
            )

        assert refusal.value.status_code == 422
        service.create_schedule.assert_not_awaited()

    async def test_edit_with_run_at_is_refused(self):
        service = MagicMock(edit_schedule=AsyncMock())
        router = TriggersRouter(triggers_service=service)
        router._check = AsyncMock()
        schedule_id = uuid4()

        with pytest.raises(HTTPException) as refusal:
            await router.edit_schedule(
                _request(),
                schedule_id=schedule_id,
                body=TriggerScheduleEditRequest(
                    schedule=TriggerScheduleEdit(
                        id=schedule_id,
                        data=TriggerScheduleData(
                            event_key="timer.fire", run_at=_RUN_AT
                        ),
                    )
                ),
            )

        assert refusal.value.status_code == 422
        service.edit_schedule.assert_not_awaited()
