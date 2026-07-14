"""Unit test: TriggersDAO.poll_delivery_after holds ONE session across every
poll tick instead of opening a new pooled connection per tick (the per-poll-
session bug class — see dbs/postgres/evaluations/dao.py::_get_run_flags for
the prior fix of the same shape).

No live DB: a fake engine counts session() checkouts so the fix is pinned
without needing Postgres.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from oss.src.dbs.postgres.triggers.dao import TriggersDAO


class _FakeResult:
    def __init__(self, dbe):
        self._dbe = dbe

    def scalars(self):
        return self

    def first(self):
        return self._dbe


class _FakeSession:
    def __init__(self, *, rows):
        self._rows = rows
        self._tick = 0

    async def execute(self, _stmt):
        row = self._rows[min(self._tick, len(self._rows) - 1)]
        self._tick += 1
        return _FakeResult(row)


class _FakeEngine:
    """Mimics TransactionsEngine.session(): counts checkouts."""

    def __init__(self, *, rows):
        self._rows = rows
        self.session_checkouts = 0

    @asynccontextmanager
    async def session(self):
        self.session_checkouts += 1
        yield _FakeSession(rows=self._rows)


class _FakeDeliveryDBE:
    def __init__(self, *, id):
        self.id = id
        self.created_at = datetime.now(timezone.utc)
        self.updated_at = None
        self.deleted_at = None
        self.created_by_id = None
        self.updated_by_id = None
        self.deleted_by_id = None
        self.status = None
        self.data = None
        self.subscription_id = uuid4()
        self.schedule_id = None
        self.event_id = "evt_1"


@pytest.mark.anyio
async def test_poll_delivery_after_reuses_one_session_across_ticks(anyio_backend):
    assert anyio_backend == "asyncio"

    baseline_id = uuid4()
    new_delivery = _FakeDeliveryDBE(id=uuid4())

    # First two ticks see the stale baseline row; the third sees the new delivery.
    baseline_row = _FakeDeliveryDBE(id=baseline_id)
    engine = _FakeEngine(rows=[baseline_row, baseline_row, new_delivery])

    dao = TriggersDAO(engine=engine)

    result = await dao.poll_delivery_after(
        project_id=uuid4(),
        subscription_id=uuid4(),
        baseline_id=baseline_id,
        timeout_seconds=10,
        interval_seconds=0,
    )

    assert result is not None
    assert result.id == new_delivery.id
    # Exactly one connection checkout for the whole wait, not one per tick.
    assert engine.session_checkouts == 1


@pytest.mark.anyio
async def test_poll_delivery_after_times_out_with_one_session(anyio_backend):
    assert anyio_backend == "asyncio"

    baseline_id = uuid4()
    baseline_row = _FakeDeliveryDBE(id=baseline_id)
    engine = _FakeEngine(rows=[baseline_row])

    dao = TriggersDAO(engine=engine)

    result = await dao.poll_delivery_after(
        project_id=uuid4(),
        subscription_id=uuid4(),
        baseline_id=baseline_id,
        timeout_seconds=0,
        interval_seconds=0,
    )

    assert result is None
    assert engine.session_checkouts == 1


@pytest.fixture
def anyio_backend():
    return "asyncio"
