"""RUN-28: the orphan sweep must clear the Redis locks the SEND gate reads.

Before the fix, the sweep only flipped Postgres flags; the Redis alive lock
(TTL 3600s) outlived the Postgres orphan-threshold (300s), so a crashed
session kept refusing SEND with SessionTurnInUse for up to ~55 more minutes.

No live Redis/Postgres: an in-memory fake stands in for both, mirroring the
fake-engine pattern in test_streams_dao_conflict.py.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

import pytest

from oss.src.dbs.redis.sessions.locks import get_session_liveness
from oss.src.core.sessions.streams.types import SessionTurnInUse
from oss.src.tasks.asyncio.sessions.orphan_sweep import run_orphan_sweep

_SESSION_ID = "sess-orphan-1"
_PROJECT_ID = "proj-orphan-1"


class _FakeRow:
    def __init__(self, *, session_id: str, updated_at: datetime):
        self.session_id = session_id
        self.project_id = _PROJECT_ID
        self.id = "stream-1"
        self.deleted_at = None
        self.flags = {"is_alive": True, "is_running": True, "is_attached": False}
        self.updated_at = updated_at


class _FakeScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _FakeScalars(self._rows)


class _FakePgSession:
    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _stmt):
        return _FakeResult(self._rows)

    async def commit(self):
        pass


class _FakeTransactionsEngine:
    """Mimics TransactionsEngine.session() yielding one stale orphan row."""

    def __init__(self, rows):
        self._rows = rows

    @asynccontextmanager
    async def session(self):
        yield _FakePgSession(self._rows)


class _FakeRedis:
    """Dict-backed stand-in for the redis.asyncio client LockEngine proxies to."""

    def __init__(self):
        self._store: dict[str, bytes] = {}

    async def get(self, key):
        return self._store.get(key)

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self._store:
            return None
        self._store[key] = value
        return True

    async def delete(self, key):
        self._store.pop(key, None)
        return 1

    async def expire(self, key, ttl):
        return True


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_orphan_sweep_clears_alive_lock_and_unblocks_send(anyio_backend):
    assert anyio_backend == "asyncio"

    lock_engine = _FakeRedis()

    # Seed the alive lock as a live runner would, past the Postgres orphan threshold.
    # Keys are plain str (locks.py never encodes the key, only the value).
    await lock_engine.set(
        f"alive:{_PROJECT_ID}:session:{_SESSION_ID}", b"turn-1", ex=3600
    )
    await lock_engine.set(
        f"running:{_PROJECT_ID}:session:{_SESSION_ID}", b"turn-1", ex=3600
    )

    stale_row = _FakeRow(
        session_id=_SESSION_ID,
        updated_at=datetime.now(timezone.utc) - timedelta(seconds=600),
    )
    pg_engine = _FakeTransactionsEngine([stale_row])

    # Before the sweep: SEND gate sees alive=True and must refuse.
    liveness_before = await get_session_liveness(
        lock_engine, project_id=_PROJECT_ID, session_id=_SESSION_ID
    )
    assert liveness_before["alive"] is True

    await run_orphan_sweep(pg_engine, lock_engine)

    # Postgres side: flags collapsed as before the fix.
    assert stale_row.flags == {
        "is_alive": False,
        "is_running": False,
        "is_attached": False,
    }

    # Redis side (the fix): the locks the SEND gate reads are gone too.
    liveness_after = await get_session_liveness(
        lock_engine, project_id=_PROJECT_ID, session_id=_SESSION_ID
    )
    assert liveness_after == {"alive": False, "running": False, "attached": False}

    # SEND gate logic (service.py:99-101): would raise if alive were still true.
    def _send_gate(liveness):
        if liveness["alive"]:
            raise SessionTurnInUse(session_id=_SESSION_ID, liveness=liveness)

    _send_gate(liveness_after)  # must not raise
