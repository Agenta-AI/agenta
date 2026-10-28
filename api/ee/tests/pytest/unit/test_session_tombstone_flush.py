"""The retention flush deletes the tombstones of deleted private sessions only after
their traces are gone: one day past the trace cutoff, and only when the batch drained
every expired trace of its projects."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from ee.src.core.tracing.service import TOMBSTONE_GRACE, TracingRetentionService


class _DAO:
    def __init__(self, deleted_traces):
        self.deleted_traces = deleted_traces
        self.tombstone_cutoffs = []
        self.pages = [[uuid4()], []]

    async def fetch_projects_with_plan(self, **_):
        return self.pages.pop(0)

    async def delete_traces_before_cutoff(self, **_):
        return self.deleted_traces, self.deleted_traces * 3

    async def delete_session_tombstones_before_cutoff(self, *, cutoff, project_ids):
        self.tombstone_cutoffs.append(cutoff)
        return 0


CUTOFF = datetime(2026, 10, 1, tzinfo=timezone.utc)


async def _flush(dao, max_traces=10):
    await TracingRetentionService(tracing_retention_dao=dao)._flush_spans_for_plan(
        plan="plan",
        cutoff=CUTOFF,
        max_projects_per_batch=500,
        max_traces_per_batch=max_traces,
    )


@pytest.mark.asyncio
async def test_a_drained_batch_deletes_tombstones_a_day_past_the_cutoff():
    dao = _DAO(deleted_traces=4)
    await _flush(dao)
    assert dao.tombstone_cutoffs == [CUTOFF - TOMBSTONE_GRACE]
    assert TOMBSTONE_GRACE == timedelta(days=1)


@pytest.mark.asyncio
async def test_a_batch_cut_at_the_limit_keeps_its_tombstones():
    dao = _DAO(deleted_traces=10)
    await _flush(dao, max_traces=10)
    assert dao.tombstone_cutoffs == []
