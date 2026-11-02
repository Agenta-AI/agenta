"""Unit test: TriggersDAO.poll_delivery_after checks a connection out of the
pool for each poll tick and returns it before sleeping.

A checkout reuses a pooled connection; it does not open a new one. Holding one
session across the sleeps instead kept a connection busy for the whole wait (up
to 300 s), and with a pool of 15 a handful of concurrent waits could take every
connection in an API worker.

No live DB: a fake engine counts session() checkouts and how many are open
while the poll sleeps.
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
    def __init__(self, *, engine):
        self._engine = engine

    async def execute(self, _stmt):
        engine = self._engine
        row = engine.rows[min(engine.tick, len(engine.rows) - 1)]
        engine.tick += 1
        return _FakeResult(row)


class _FakeEngine:
    """Mimics TransactionsEngine.session(): counts checkouts and open sessions."""

    def __init__(self, *, rows):
        self.rows = rows
        self.tick = 0
        self.session_checkouts = 0
        self.open_sessions = 0

    @asynccontextmanager
    async def session(self):
        self.session_checkouts += 1
        self.open_sessions += 1
        try:
            yield _FakeSession(engine=self)
        finally:
            self.open_sessions -= 1


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
async def test_poll_delivery_after_checks_out_per_tick(anyio_backend):
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
    # One short checkout per tick, each returned before the next.
    assert engine.session_checkouts == 3
    assert engine.open_sessions == 0


@pytest.mark.anyio
async def test_poll_delivery_after_times_out_without_holding_a_session(anyio_backend):
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
    assert engine.open_sessions == 0


@pytest.mark.anyio
async def test_poll_delivery_after_holds_no_session_while_sleeping(
    anyio_backend, monkeypatch
):
    assert anyio_backend == "asyncio"

    from oss.src.dbs.postgres.triggers import dao as triggers_dao_module

    baseline_id = uuid4()
    engine = _FakeEngine(rows=[_FakeDeliveryDBE(id=baseline_id)])
    open_while_sleeping = []
    real_sleep = triggers_dao_module.asyncio.sleep

    async def _sleep(_seconds):
        open_while_sleeping.append(engine.open_sessions)
        await real_sleep(0)

    monkeypatch.setattr(triggers_dao_module.asyncio, "sleep", _sleep)

    result = await TriggersDAO(engine=engine).poll_delivery_after(
        project_id=uuid4(),
        subscription_id=uuid4(),
        baseline_id=baseline_id,
        timeout_seconds=0.05,
        interval_seconds=0.01,
    )

    assert result is None
    assert open_while_sleeping
    assert all(n == 0 for n in open_while_sleeping)


@pytest.fixture
def anyio_backend():
    return "asyncio"
