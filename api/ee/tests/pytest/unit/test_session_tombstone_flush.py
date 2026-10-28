"""The retention flush deletes the tombstone of a deleted private session only when its
traces are gone: one day past the trace cutoff, and no stored span carries its id."""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from ee.src.core.tracing.service import TOMBSTONE_GRACE, TracingRetentionService
from ee.src.dbs.postgres.tracing.dao import TracingRetentionDAO

CUTOFF = datetime(2026, 10, 1, tzinfo=timezone.utc)


class _FlushDAO:
    def __init__(self):
        self.tombstone_cutoffs = []
        self.pages = [[uuid4()], []]

    async def fetch_projects_with_plan(self, **_):
        return self.pages.pop(0)

    async def delete_traces_before_cutoff(self, **_):
        return 4, 12

    async def delete_session_tombstones_before_cutoff(self, *, cutoff, project_ids):
        self.tombstone_cutoffs.append(cutoff)
        return 0


@pytest.mark.asyncio
async def test_the_flush_deletes_tombstones_a_day_past_the_trace_cutoff():
    dao = _FlushDAO()
    await TracingRetentionService(tracing_retention_dao=dao)._flush_spans_for_plan(
        plan="plan", cutoff=CUTOFF, max_projects_per_batch=500, max_traces_per_batch=10
    )
    assert dao.tombstone_cutoffs == [CUTOFF - TOMBSTONE_GRACE]
    assert TOMBSTONE_GRACE == timedelta(days=1)


class _Session:
    def __init__(self, engine):
        self.engine = engine

    async def execute(self, stmt):
        self.engine.statements.append(stmt)
        rows = self.engine.results.pop(0) if self.engine.results else []
        return SimpleNamespace(all=lambda: rows, rowcount=len(rows))

    async def commit(self):
        pass


class _Engine:
    def __init__(self, results):
        self.results = results
        self.statements = []

    @asynccontextmanager
    async def session(self):
        yield _Session(self)


@pytest.mark.asyncio
async def test_a_tombstone_whose_session_still_has_spans_is_kept():
    project_id = uuid4()
    candidates = [
        SimpleNamespace(project_id=project_id, session_id="s-left"),
        SimpleNamespace(project_id=project_id, session_id="s-gone"),
    ]
    core = _Engine([candidates, [object()]])
    tracing = _Engine([[SimpleNamespace(project_id=project_id, session_id="s-left")]])
    dao = TracingRetentionDAO(transactions_engine=core, analytics_engine=tracing)

    await dao.delete_session_tombstones_before_cutoff(
        cutoff=CUTOFF, project_ids=[project_id]
    )

    delete_stmt = core.statements[-1]
    params = delete_stmt.compile().params
    assert "s-gone" in str(params) and "s-left" not in str(params)
