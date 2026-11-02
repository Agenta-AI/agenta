"""Default `query_agents` excludes archived bindings and bindings of archived
connections; `include_archived=True` opts back in.

GET /api/channels/agents/ was returning bindings whose `deleted_at` was set,
and bindings of connections whose `deleted_at` was set (e.g. a Slack
connection's binding kept showing up in the agent picker after disconnect).
Like `test_telegram_bind_dao.py`, this captures the compiled SQL rather than
standing up a real Postgres instance.
"""

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.channels.dtos import ChannelAgentQuery
from oss.src.dbs.postgres.channels.dao import ChannelsDAO

pytestmark = pytest.mark.asyncio


class _Result:
    def scalars(self):
        return self

    def all(self):
        return []


class _Session:
    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result()


class _Engine:
    def __init__(self):
        self.captured = _Session()

    @asynccontextmanager
    async def session(self):
        yield self.captured


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


async def test_default_query_excludes_archived_agents_and_archived_connections():
    engine = _Engine()
    dao = ChannelsDAO(engine=engine)

    await dao.query_agents(project_id=uuid4())

    sql = _sql(engine.captured.statements[0])
    assert "channel_agents.deleted_at IS NULL" in sql
    # excludes bindings whose connection is archived, via a NOT EXISTS
    # correlated against channel_connections.deleted_at
    assert "NOT (EXISTS" in sql
    assert "channel_connections" in sql
    assert "channel_connections.deleted_at IS NOT NULL" in sql


async def test_include_archived_true_skips_the_filter():
    engine = _Engine()
    dao = ChannelsDAO(engine=engine)

    await dao.query_agents(
        project_id=uuid4(),
        agent=ChannelAgentQuery(include_archived=True),
    )

    sql = _sql(engine.captured.statements[0])
    assert "channel_agents.deleted_at IS NULL" not in sql
    assert "NOT (EXISTS" not in sql


async def test_include_archived_false_still_filters_alongside_other_predicates():
    engine = _Engine()
    dao = ChannelsDAO(engine=engine)
    connection_id = uuid4()

    await dao.query_agents(
        project_id=uuid4(),
        agent=ChannelAgentQuery(connection_id=connection_id, include_archived=False),
    )

    sql = _sql(engine.captured.statements[0])
    assert "channel_agents.deleted_at IS NULL" in sql
    assert "channel_agents.connection_id" in sql
