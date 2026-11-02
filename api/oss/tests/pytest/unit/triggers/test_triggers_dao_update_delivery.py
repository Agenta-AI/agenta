from contextlib import asynccontextmanager
from uuid import uuid4

from sqlalchemy.dialects import postgresql

from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import TriggerDeliveryData
from oss.src.dbs.postgres.triggers.dao import TriggersDAO


class _Result:
    def scalar_one_or_none(self):
        return None


class _Session:
    def __init__(self):
        self.statement = None

    async def execute(self, statement):
        self.statement = statement
        statement.compile(dialect=postgresql.dialect())
        return _Result()

    async def commit(self):
        return None


class _Engine:
    def __init__(self):
        self.db_session = _Session()

    @asynccontextmanager
    async def session(self):
        yield self.db_session


async def test_update_delivery_merges_terminal_data_in_postgres():
    engine = _Engine()
    dao = TriggersDAO(engine=engine)

    result = await dao.update_delivery(
        project_id=uuid4(),
        delivery_id=uuid4(),
        status=Status(code="200", message="success"),
        data=TriggerDeliveryData(result={"ok": True}),
    )

    sql = str(engine.db_session.statement.compile(dialect=postgresql.dialect()))
    assert result is None
    assert "coalesce(CAST(trigger_deliveries.data AS JSONB)" in sql
    assert " || " in sql
    assert "CAST(" in sql
    assert " AS JSON)" in sql
