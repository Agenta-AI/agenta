"""Pins that schedule reads leave out rows this version cannot read.

A later version writes hidden one-time schedule rows (`flags.is_hidden`, no
cron in `data`). After a rollback, those rows must not fail the schedule list,
and a get on one must behave like not found. Stubs the engine/session; no DB.
"""

from contextlib import asynccontextmanager
from uuid import uuid4

from sqlalchemy.dialects import postgresql

from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.src.dbs.postgres.triggers.dbes import TriggerScheduleDBE


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows

    def scalar_one_or_none(self):
        return self.rows[0] if self.rows else None


class _Session:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result(self.rows)


class _Engine:
    def __init__(self, rows):
        self.db_session = _Session(rows)

    @asynccontextmanager
    async def session(self):
        yield self.db_session


def _reads_is_hidden(statement) -> bool:
    compiled = statement.compile(dialect=postgresql.dialect())
    return "is_hidden" in compiled.params.values()


def _schedule_dbe(*, project_id, data, flags=None):
    return TriggerScheduleDBE(
        id=uuid4(),
        project_id=project_id,
        data=data,
        flags=flags or {"is_active": True},
    )


async def test_query_schedules_skips_a_row_without_cron_instead_of_raising():
    project_id = uuid4()
    good = _schedule_dbe(
        project_id=project_id,
        data={"event_key": "cron.tick", "schedule": "* * * * *"},
    )
    # The shape of a hidden one-time row: no cron value.
    hidden = _schedule_dbe(
        project_id=project_id,
        data={"event_key": "session.update", "run_at": "2026-11-21T10:00:00Z"},
        flags={"is_active": True, "is_hidden": True},
    )
    engine = _Engine([hidden, good])

    result = await TriggersDAO(engine=engine).query_schedules(project_id=project_id)

    assert [schedule.id for schedule in result] == [good.id]


async def test_every_schedule_read_filters_out_hidden_rows():
    project_id = uuid4()
    schedule_id = uuid4()
    engine = _Engine([])
    dao = TriggersDAO(engine=engine)

    await dao.query_schedules(project_id=project_id)
    await dao.fetch_schedule(project_id=project_id, schedule_id=schedule_id)
    await dao.fetch_schedule_including_deleted(
        project_id=project_id, schedule_id=schedule_id
    )
    await dao.fetch_active_schedules()
    await dao.fetch_active_schedules_with_project()

    statements = engine.db_session.statements
    assert len(statements) == 5
    for statement in statements:
        assert _reads_is_hidden(statement)
