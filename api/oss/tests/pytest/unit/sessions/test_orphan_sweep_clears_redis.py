"""RUN-28: the orphan sweep must clear the Redis locks the SEND gate reads.

Before the fix, the sweep only flipped Postgres flags; the Redis alive lock
(TTL 3600s) outlived the Postgres orphan-threshold (300s), so a crashed
session kept refusing SEND with SessionTurnInUse for up to ~55 more minutes.

No live Redis/Postgres: an in-memory fake stands in for both, mirroring the
fake-engine pattern in test_streams_dao_conflict.py.
"""

from contextlib import asynccontextmanager
from typing import Optional

from datetime import datetime, timezone, timedelta

import pytest

from oss.src.dbs.redis.sessions.locks import get_session_liveness, is_turn_superseded
from oss.src.core.sessions.streams.types import SessionTurnInUse
from oss.src.tasks.asyncio.sessions.orphan_sweep import run_orphan_sweep

_SESSION_ID = "sess-orphan-1"
_PROJECT_ID = "proj-orphan-1"


class _FakeRow:
    def __init__(
        self,
        *,
        session_id: str,
        updated_at: datetime,
        turn_id: Optional[str] = None,
    ):
        self.session_id = session_id
        self.project_id = _PROJECT_ID
        self.id = "stream-1"
        self.turn_id = turn_id
        self.deleted_at = None
        self.flags = {"is_alive": True, "is_running": True, "is_attached": False}
        self.updated_at = updated_at


class _FakeScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeResult:
    def __init__(self, rows, *, rowcount=0):
        self._rows = rows
        self.rowcount = rowcount

    def scalars(self):
        return _FakeScalars(self._rows)


class _FakePgSession:
    def __init__(self, rows, seen):
        self._rows = rows
        self._seen = seen

    async def execute(self, stmt):
        self._seen.append(stmt)
        text = str(stmt)
        if text.startswith("UPDATE") and "session_streams" in text:
            # Both session_streams writes are Core UPDATEs keyed by row id, never ORM
            # attribute writes (finding 7). The collapse binds `id IN (...)`, a list; the
            # lost-turn clear binds `id = ...`, a scalar. Apply either to the in-memory rows.
            params = stmt.compile().params
            flags_val = next(
                (v for v in params.values() if isinstance(v, dict) and "is_alive" in v),
                None,
            )
            ids = set()
            for value in params.values():
                if isinstance(value, (list, set, tuple)):
                    ids.update(x for x in value if isinstance(x, str))
                elif isinstance(value, str):
                    ids.add(value)
            if flags_val is not None:
                matched = 0
                for row in self._rows:
                    if row.id in ids:
                        row.flags = dict(flags_val)
                        matched += 1
                return _FakeResult([], rowcount=matched)
            return _FakeResult([])
        return _FakeResult(self._rows)

    async def commit(self):
        pass


class _FakeTransactionsEngine:
    """Mimics TransactionsEngine.session() yielding one stale orphan row."""

    def __init__(self, rows):
        self._rows = rows
        self.statements = []

    @asynccontextmanager
    async def session(self):
        yield _FakePgSession(self._rows, self.statements)


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

    async def eval(self, script, numkeys, *keys_and_args):
        def decode(value):
            return value.decode() if isinstance(value, bytes) else str(value)

        keys = [decode(value) for value in keys_and_args[:numkeys]]
        argv = [decode(value) for value in keys_and_args[numkeys:]]
        assert "AGENTA_WATCHDOG_RELEASE_TURN" in script
        alive, running, owner, superseded = keys
        expected_turn, expected_owner, _ttl = argv
        alive_value = decode(self._store[alive]) if alive in self._store else ""
        running_value = decode(self._store[running]) if running in self._store else ""
        owner_value = decode(self._store[owner]) if owner in self._store else ""
        released_alive = int(bool(expected_turn) and alive_value == expected_turn)
        released_running = int(bool(expected_turn) and running_value == expected_turn)
        if released_alive:
            self._store.pop(alive, None)
        if released_running:
            self._store.pop(running, None)
        foreign_turn = (alive_value and alive_value != expected_turn) or (
            running_value and running_value != expected_turn
        )
        released_owner = int(
            bool(expected_owner) and owner_value == expected_owner and not foreign_turn
        )
        if released_owner:
            self._store.pop(owner, None)
        if expected_turn:
            self._store[superseded] = b"1"
        return [released_alive, released_running, released_owner]


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
        turn_id="turn-1",
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


@pytest.mark.anyio
async def test_orphan_sweep_tombstones_the_turn_it_swept(anyio_backend):
    """A swept turn is declared dead. Without a tombstone its next beat would find the nest
    empty, re-acquire `alive` under its own id, and put the session straight back into the
    orphaned state the sweep just cleaned up.
    """
    assert anyio_backend == "asyncio"

    lock_engine = _FakeRedis()
    await lock_engine.set(
        f"alive:{_PROJECT_ID}:session:{_SESSION_ID}", b"turn-1", ex=3600
    )
    await lock_engine.set(
        f"running:{_PROJECT_ID}:session:{_SESSION_ID}", b"turn-1", ex=3600
    )
    stale_row = _FakeRow(
        session_id=_SESSION_ID,
        updated_at=datetime.now(timezone.utc) - timedelta(seconds=600),
        turn_id="turn-1",
    )

    await run_orphan_sweep(_FakeTransactionsEngine([stale_row]), lock_engine)

    assert (
        await is_turn_superseded(
            lock_engine,
            project_id=_PROJECT_ID,
            session_id=_SESSION_ID,
            turn_id="turn-1",
        )
    ) is True


@pytest.mark.anyio
async def test_orphan_sweep_selects_rows_never_updated_since_creation(anyio_backend):
    """A row whose heartbeat never wrote it has `updated_at` NULL, and `NULL < threshold`
    is NULL — so a bare `updated_at <` predicate can never reclaim it, however long it has
    claimed to be alive. The sweep must compare on coalesce(updated_at, created_at), and
    cap the pass so a large backlog drains over several passes.
    """
    assert anyio_backend == "asyncio"

    pg_engine = _FakeTransactionsEngine([])
    await run_orphan_sweep(pg_engine, _FakeRedis())

    assert pg_engine.statements, "the sweep must issue its select"
    sql = str(
        pg_engine.statements[0].compile(compile_kwargs={"literal_binds": False})
    ).lower()
    assert "coalesce" in sql, "a NULL updated_at must fall back to created_at"
    assert "session_streams.created_at" in sql
    assert "limit" in sql, "one pass must be bounded"
