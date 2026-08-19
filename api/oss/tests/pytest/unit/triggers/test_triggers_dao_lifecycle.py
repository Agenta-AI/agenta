from contextlib import asynccontextmanager
from uuid import uuid4

from sqlalchemy.dialects import postgresql

from oss.src.core.triggers.dtos import (
    TriggerScheduleData,
    TriggerScheduleEdit,
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
)
from oss.src.dbs.postgres.triggers.dao import TriggersDAO
from oss.src.dbs.postgres.triggers.dbes import TriggerSubscriptionDBE


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows

    def scalar_one_or_none(self):
        return self.rows[0] if len(self.rows) == 1 else None


class _Session:
    def __init__(self, rows):
        self.rows = rows
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        return _Result(self.rows)


class _Engine:
    def __init__(self, rows):
        self.db_session = _Session(rows)

    @asynccontextmanager
    async def session(self):
        yield self.db_session


def _subscription_dbe(*, project_id, trigger_id):
    return TriggerSubscriptionDBE(
        id=uuid4(),
        project_id=project_id,
        connection_id=uuid4(),
        trigger_id=trigger_id,
        data={"event_key": "github.issue.opened"},
        flags={"is_active": True, "is_valid": True},
    )


async def test_cross_project_trigger_lookup_fails_closed_when_ambiguous():
    trigger_id = "ti_shared"
    engine = _Engine(
        [
            _subscription_dbe(project_id=uuid4(), trigger_id=trigger_id),
            _subscription_dbe(project_id=uuid4(), trigger_id=trigger_id),
        ]
    )

    result = await TriggersDAO(
        engine=engine
    ).get_project_and_subscription_by_trigger_id(trigger_id=trigger_id)

    assert result is None
    sql = str(engine.db_session.statement.compile(dialect=postgresql.dialect()))
    assert "LIMIT" in sql


async def test_subscription_edit_locks_live_row_before_mapping():
    engine = _Engine([])

    result = await TriggersDAO(engine=engine).edit_subscription(
        project_id=uuid4(),
        user_id=uuid4(),
        subscription=TriggerSubscriptionEdit(
            id=uuid4(),
            connection_id=uuid4(),
            data=TriggerSubscriptionData(event_key="github.issue.opened"),
        ),
    )

    assert result is None
    sql = str(engine.db_session.statement.compile(dialect=postgresql.dialect()))
    assert "deleted_at IS NULL" in sql
    assert "FOR UPDATE" in sql


async def test_schedule_edit_locks_live_row_before_mapping():
    engine = _Engine([])

    result = await TriggersDAO(engine=engine).edit_schedule(
        project_id=uuid4(),
        user_id=uuid4(),
        schedule=TriggerScheduleEdit(
            id=uuid4(),
            data=TriggerScheduleData(event_key="cron.tick", schedule="* * * * *"),
        ),
    )

    assert result is None
    sql = str(engine.db_session.statement.compile(dialect=postgresql.dialect()))
    assert "deleted_at IS NULL" in sql
    assert "FOR UPDATE" in sql
