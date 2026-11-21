"""Unit tests for the session and user list queries.

An annotation trace copies `ag.session.id` from the span it annotates. The
session list must group only invocation activity, so an annotation written today
on an old session does not bring that session into today's window or move it to
the top in realtime mode. Spans with no trace type keep counting.

No live DB: a fake session captures the statements and returns no rows.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.shared.dtos import Windowing
from oss.src.dbs.postgres.tracing.dao import TracingDAO


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _Result:
    def all(self):
        return []


class _Session:
    def __init__(self, engine):
        self._engine = engine

    async def execute(self, stmt):
        self._engine.executed.append(stmt)
        return _Result()


class _Engine:
    def __init__(self):
        self.executed = []

    @asynccontextmanager
    async def session(self):
        yield _Session(self)


def _sql(stmt) -> str:
    return str(
        stmt.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


@pytest.mark.anyio
@pytest.mark.parametrize("group", ["sessions", "users"])
@pytest.mark.parametrize("realtime", [True, False])
async def test_group_query_leaves_out_annotation_traces(group, realtime):
    engine = _Engine()
    now = datetime.now(timezone.utc)

    await getattr(TracingDAO(engine=engine), group)(
        project_id=uuid4(),
        realtime=realtime,
        windowing=Windowing(oldest=now - timedelta(days=1), newest=now, limit=10),
    )

    # The first statement sets the statement timeout; the second is the query.
    sql = _sql(engine.executed[-1])
    assert "spans.trace_type IS DISTINCT FROM 'ANNOTATION'" in sql
