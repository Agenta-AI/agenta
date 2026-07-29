"""Unit test for TracingDAO.ingest persisting the promoted session/user/agent
identity columns.

No live DB: a fake AsyncSession captures the compiled upsert statement so the
DAO's ON CONFLICT DO UPDATE values can be asserted without Postgres. See
docs/designs/testing/testing.boundaries.specs.md, boundary 3.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from oss.src.core.tracing.dtos import OTelFlatSpan
from oss.src.dbs.postgres.tracing.dao import TracingDAO


class _FakeResult:
    pass


class _FakeSession:
    def __init__(self, executed: list):
        self._executed = executed

    async def execute(self, stmt):
        self._executed.append(stmt)
        return _FakeResult()

    async def commit(self):
        pass


class _FakeEngine:
    def __init__(self):
        self.executed: list = []

    @asynccontextmanager
    async def session(self):
        yield _FakeSession(self.executed)


def _flat_span(
    *, span_id: str, parent_id=None, session_id=None, user_id=None, agent_id=None
):
    now = datetime.now(timezone.utc)
    return OTelFlatSpan(
        trace_id=uuid4().hex,
        span_id=span_id,
        parent_id=parent_id,
        span_name="span",
        start_time=now,
        end_time=now,
        session_id=session_id,
        user_id=user_id,
        agent_id=agent_id,
    )


@pytest.mark.anyio
async def test_ingest_root_span_persists_identity_columns(anyio_backend):
    assert anyio_backend == "asyncio"
    engine = _FakeEngine()
    dao = TracingDAO(engine=engine)

    root = _flat_span(
        span_id=uuid4().hex,
        session_id="sess-1",
        user_id="user-1",
        agent_id="agent-1",
    )

    await dao.ingest(project_id=uuid4(), user_id=uuid4(), span_dtos=[root])

    assert len(engine.executed) == 1
    values = engine.executed[0].compile().params

    assert values["session_id"] == "sess-1"
    assert values["user_id"] == "user-1"
    assert values["agent_id"] == "agent-1"


@pytest.mark.anyio
async def test_ingest_child_span_leaves_identity_columns_null(anyio_backend):
    assert anyio_backend == "asyncio"
    engine = _FakeEngine()
    dao = TracingDAO(engine=engine)

    child = _flat_span(span_id=uuid4().hex, parent_id=uuid4().hex)

    await dao.ingest(project_id=uuid4(), user_id=uuid4(), span_dtos=[child])

    values = engine.executed[0].compile().params

    assert values["session_id"] is None
    assert values["user_id"] is None
    assert values["agent_id"] is None


@pytest.fixture
def anyio_backend():
    return "asyncio"
