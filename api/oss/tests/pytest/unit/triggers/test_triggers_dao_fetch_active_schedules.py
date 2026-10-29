"""Pins per-row error isolation in ``fetch_active_schedules_with_project``.

Regression coverage for a real incident: a schedule row with malformed
``data`` (missing the required ``event_key``/``schedule`` fields) raised a
pydantic ``ValidationError`` inside the DAO's row-mapping list comprehension,
which aborted the whole fetch and made the ``refresh_schedules`` cron skip
every project's schedules for that tick, every minute, until the row was
fixed. Stubs the engine/session; no DB.
"""

from contextlib import asynccontextmanager
from unittest.mock import MagicMock
from uuid import uuid4

from oss.src.dbs.postgres.triggers import dao as dao_module
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.src.dbs.postgres.triggers.dbes import TriggerScheduleDBE


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows


class _Session:
    def __init__(self, rows):
        self.rows = rows

    async def execute(self, statement):
        return _Result(self.rows)


class _Engine:
    def __init__(self, rows):
        self.db_session = _Session(rows)

    @asynccontextmanager
    async def session(self):
        yield self.db_session


def _schedule_dbe(*, project_id, data):
    return TriggerScheduleDBE(
        id=uuid4(),
        project_id=project_id,
        data=data,
        flags={"is_active": True},
    )


async def test_fetch_active_schedules_skips_malformed_row_instead_of_raising():
    good_project = uuid4()
    bad_project = uuid4()
    good = _schedule_dbe(
        project_id=good_project,
        data={"event_key": "cron.tick", "schedule": "* * * * *"},
    )
    # Missing the required event_key/schedule fields, as seeded/legacy rows can be.
    bad = _schedule_dbe(project_id=bad_project, data={"cron": "0 6 * * *"})
    engine = _Engine([bad, good])

    result = await TriggersDAO(engine=engine).fetch_active_schedules_with_project()

    assert [project_id for project_id, _ in result] == [good_project]
    assert result[0][1].id == good.id


async def test_fetch_active_schedules_returns_all_rows_when_none_are_malformed():
    project_id = uuid4()
    good = _schedule_dbe(
        project_id=project_id,
        data={"event_key": "cron.tick", "schedule": "* * * * *"},
    )
    engine = _Engine([good])

    result = await TriggersDAO(engine=engine).fetch_active_schedules_with_project()

    assert [project_id for project_id, _ in result] == [project_id]


async def test_malformed_row_log_never_includes_the_payload(monkeypatch):
    # Pydantic's ValidationError.__str__ embeds the offending input_value, so
    # the log call must never interpolate the exception itself into the
    # message; only schedule_id/project_id/error_type are safe to log.
    secret_marker = "USER_SECRET_ap9x2q"
    bad = _schedule_dbe(project_id=uuid4(), data={"cron": secret_marker})
    engine = _Engine([bad])

    mock_error = MagicMock()
    monkeypatch.setattr(dao_module.log, "error", mock_error)

    await TriggersDAO(engine=engine).fetch_active_schedules_with_project()

    mock_error.assert_called_once()
    call_text = " ".join(str(a) for a in mock_error.call_args.args) + " ".join(
        f"{k}={v}" for k, v in mock_error.call_args.kwargs.items()
    )
    assert secret_marker not in call_text
