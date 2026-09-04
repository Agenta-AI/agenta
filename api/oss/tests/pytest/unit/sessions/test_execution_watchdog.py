"""The execution watchdog must give a lost turn a real ending, exactly once.

Before this, the sweep collapsed a dead session's flags and cleared its Redis nest, but wrote
nothing to the transcript: the turn simply stopped mid-sentence and the browser kept showing
it as running until the user reloaded. The invariant these tests hold is the RFC's — every
accepted execution reaches exactly ONE durable terminal outcome — so they check both halves:
an ending IS written for a turn that has none, and a SECOND ending is never written for a turn
that already has one.

The threshold predicate itself is covered by `test_orphan_sweep_thresholds.py`; the fake
session here returns whatever rows the test hands it, so these tests are about what the
watchdog DOES with a candidate, not which rows it picks.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Sequence, Set, Tuple
from uuid import UUID

import pytest

from oss.src.core.sessions.records.dtos import (
    RECORD_SETTLED_BY_ATTRIBUTE,
    SETTLED_BY_WATCHDOG,
    SessionRecordEvent,
)
from oss.src.dbs.redis.sessions.locks import claim_owner
from oss.src.tasks.asyncio.sessions.orphan_sweep import (
    LOST_ERROR_CODE,
    LOST_ERROR_MESSAGE,
    ORPHAN_THRESHOLD_SECONDS,
    IDLE_THRESHOLD_SECONDS,
    run_orphan_sweep,
)

_PROJECT_ID = UUID("00000000-0000-4000-8000-000000000001")


# --------------------------------------------------------------------------- #
# Fakes
# --------------------------------------------------------------------------- #


class _FakeRow:
    def __init__(
        self,
        *,
        session_id: str,
        turn_id: Optional[str],
        is_running: bool,
        age_seconds: int,
    ):
        self.session_id = session_id
        self.project_id = _PROJECT_ID
        self.id = f"stream-{session_id}"
        self.turn_id = turn_id
        self.deleted_at = None
        self.flags = {
            "is_alive": True,
            "is_running": is_running,
            "is_attached": False,
        }
        self.created_at = datetime.now(timezone.utc) - timedelta(days=1)
        self.updated_at = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)


class _FakeExecutionRow:
    def __init__(
        self,
        *,
        session_id: str,
        execution_id: str,
        terminal_outcome: str = "stopped",
        age_seconds: int = ORPHAN_THRESHOLD_SECONDS + 30,
    ):
        self.project_id = _PROJECT_ID
        self.session_id = session_id
        self.execution_id = execution_id
        self.terminal_outcome = terminal_outcome
        self.settled_by = "runner"
        self.settled_at = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakePgSession:
    def __init__(self, rows, executions):
        self._rows = rows
        self._executions = executions
        self.commits = 0

    async def execute(self, stmt):
        # Evaluate the sweep's two selections the way Postgres would, so a test can tell a
        # collapsed row from one that only owed an ending. The ending-only statement is the
        # one that filters on `turn_id IS NOT NULL`; the first statement carries the OR of
        # the running and idle branches.
        text = str(stmt)
        now = datetime.now(timezone.utc)

        if "session_executions" in text:
            rows = [
                execution
                for execution in self._executions
                if execution.terminal_outcome in {"stopped", "lost"}
                and (now - execution.settled_at).total_seconds()
                > ORPHAN_THRESHOLD_SECONDS
            ]
            return _FakeResult(sorted(rows, key=lambda row: row.settled_at))

        def age(row):
            return (now - (row.updated_at or row.created_at)).total_seconds()

        if "IS NOT NULL" in text:
            rows = [
                r
                for r in self._rows
                if r.flags.get("is_alive") is True
                and r.flags.get("is_running") is not True
                and r.turn_id is not None
                and age(r) > ORPHAN_THRESHOLD_SECONDS
            ]
        else:
            rows = [
                r
                for r in self._rows
                if r.flags.get("is_alive") is True
                and (
                    (
                        r.flags.get("is_running") is True
                        and age(r) > ORPHAN_THRESHOLD_SECONDS
                    )
                    or (
                        r.flags.get("is_running") is not True
                        and age(r) > IDLE_THRESHOLD_SECONDS
                    )
                )
            ]
        return _FakeResult(rows)

    async def commit(self):
        self.commits += 1


class _FakeTransactionsEngine:
    def __init__(self, rows, executions=None):
        self._rows = rows
        self._executions = executions or []

    @asynccontextmanager
    async def session(self):
        yield _FakePgSession(self._rows, self._executions)


class _FakeRedis:
    def __init__(self):
        self._store: dict = {}

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

    async def eval(self, script, numkeys, key, value, *args):
        k = key.decode() if isinstance(key, bytes) else key
        v = value.decode() if isinstance(value, bytes) else value
        current = self._store.get(k)
        if isinstance(current, bytes):
            current = current.decode()
        if args:
            if current is None or current == v:
                self._store[k] = v.encode()
                return v.encode()
            return current.encode()
        # The sweep's script is release-if-owner: delete only when the value matches.
        if current == v:
            self._store.pop(k, None)
            return 1
        return 0


class _FakeRecordsService:
    """Stands in for the records plane. `settled` is what the tracing DB already holds."""

    def __init__(self, settled: Optional[Set[Tuple[str, str]]] = None):
        self.settled = settled or set()
        self.queries: List[Sequence[Tuple[str, str]]] = []

    async def settled_turns(self, *, project_id, keys):
        self.queries.append(list(keys))
        return {key for key in keys if key in self.settled}


class _FakeWatchPublisher:
    def __init__(self):
        self.lifecycles: List[Tuple[str, str, str]] = []

    async def lifecycle(self, *, project_id, session_id, state):
        self.lifecycles.append((project_id, session_id, state))


class _Publisher:
    """Captures what the watchdog would put on the record ingest stream."""

    def __init__(self):
        self.published: List[SessionRecordEvent] = []

    async def __call__(self, *, project_id, record_event):
        self.published.append(record_event)
        return True


def _stale_running_row(session_id="sess-lost", turn_id="turn-1") -> _FakeRow:
    return _FakeRow(
        session_id=session_id,
        turn_id=turn_id,
        is_running=True,
        age_seconds=ORPHAN_THRESHOLD_SECONDS + 60,
    )


def _collapsed(row: _FakeRow) -> bool:
    return row.flags == {"is_alive": False, "is_running": False, "is_attached": False}


@pytest.fixture
def anyio_backend():
    return "asyncio"


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_a_lost_turn_gets_an_error_then_a_done(anyio_backend):
    """The shape a runner writes when a turn ends badly, written on its behalf.

    A lone `done` would render as a clean finish, which is the opposite of what happened, so
    the error must come first and must carry the class a client can act on.
    """
    row = _stale_running_row()
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_FakeRecordsService(),
        publish=publisher,
    )

    assert [event.record_type for event in publisher.published] == ["error", "done"]

    error_event, done_event = publisher.published
    # Both carry the writer marker. It is the ONLY thing separating this ending from a
    # runner's — the wording and the `done` shape are copied deliberately — and the ingest
    # guard reads it to tell a thawed runner's tail apart from ordinary history. See
    # `RecordsService.append_many`.
    assert error_event.attributes == {
        "type": "error",
        "message": LOST_ERROR_MESSAGE,
        "code": LOST_ERROR_CODE,
        RECORD_SETTLED_BY_ATTRIBUTE: SETTLED_BY_WATCHDOG,
    }
    assert done_event.attributes == {
        "type": "done",
        RECORD_SETTLED_BY_ATTRIBUTE: SETTLED_BY_WATCHDOG,
    }
    assert error_event.turn_id == "turn-1"
    assert done_event.turn_id == "turn-1"
    assert error_event.session_id == "sess-lost"
    assert _collapsed(row), "the row must still be marked ended"


@pytest.mark.anyio
async def test_a_second_pass_writes_no_second_ending(anyio_backend):
    """Idempotency, the guarantee the RFC asks for: exactly one terminal outcome.

    Two passes can see the same turn — a crash between the record write and the flag
    collapse, or two API replicas sweeping at once. The second pass reads the record the
    first one wrote and must stay silent.
    """
    records = _FakeRecordsService()
    first_publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([_stale_running_row()]),
        _FakeRedis(),
        records_service=records,
        publish=first_publisher,
    )
    assert len(first_publisher.published) == 2

    # The records worker has now landed those rows in the tracing DB.
    records.settled.add(("sess-lost", "turn-1"))

    second_publisher = _Publisher()
    row = _stale_running_row()
    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=records,
        publish=second_publisher,
    )

    assert second_publisher.published == [], (
        "a turn that already carries a terminal record must never be given a second one"
    )
    assert _collapsed(row), "the row is still settled even when no record is owed"


@pytest.mark.anyio
async def test_record_ids_are_stable_across_passes(anyio_backend):
    """The second guard, for the window before the worker has landed the first write.

    Ingest upserts on (project_id, record_id), so two publishes of the same id write the
    same row rather than appending a duplicate.
    """
    first, second = _Publisher(), _Publisher()

    for publisher in (first, second):
        await run_orphan_sweep(
            _FakeTransactionsEngine([_stale_running_row()]),
            _FakeRedis(),
            records_service=_FakeRecordsService(),
            publish=publisher,
        )

    assert [event.record_id for event in first.published] == [
        event.record_id for event in second.published
    ]
    assert len({event.record_id for event in first.published}) == 2, (
        "the error and the done must not collide on one id"
    )


@pytest.mark.anyio
async def test_an_idle_row_owes_no_ending(anyio_backend):
    """A row that was alive between turns has no running turn to end.

    Its last turn already reached its own terminal record. Writing an error here would
    invent a failure that never happened.

    The records fake says so, because that record is now what decides. The `is_running` flag
    used to decide instead, and a durable Stop broke it: settlement clears the flag before the
    runner has written its ending.
    """
    row = _FakeRow(
        session_id="sess-idle",
        turn_id="turn-old",
        is_running=False,
        age_seconds=99_999,
    )
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_FakeRecordsService({("sess-idle", "turn-old")}),
        publish=publisher,
    )

    assert publisher.published == []
    assert _collapsed(row)


@pytest.mark.anyio
async def test_a_parked_approval_is_never_settled(anyio_backend):
    """The hazard the heartbeat-age rule creates, pinned.

    A turn that parks for a human sends one final beat with `is_running: false` and then stops
    beating on purpose. Its heartbeat therefore goes stale immediately, and it is exactly the
    state we most need to keep: the sandbox is warm, the user is about to answer, and the turn
    is resumable.

    What protects it is its own terminal record: a turn that parks writes `done` with
    `stopReason: paused` at the moment it parks, and any terminal record makes `settled_turns`
    answer yes. Verified on the integration stack, session f0018938: `done`/`paused` landed in
    the same second as the `interaction_request`. The `is_running` flag protected it before,
    and stopped being able to when a durable Stop began clearing that flag early.
    """
    row = _FakeRow(
        session_id="sess-parked",
        turn_id="turn-parked",
        is_running=False,
        age_seconds=ORPHAN_THRESHOLD_SECONDS * 5,
    )
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_FakeRecordsService({("sess-parked", "turn-parked")}),
        publish=publisher,
    )

    assert publisher.published == [], (
        "a parked approval must never be given a terminal record: the user is still going to "
        "answer it"
    )


@pytest.mark.anyio
async def test_a_running_row_without_a_turn_id_is_settled_silently(anyio_backend):
    """Nothing to attribute an ending to, so the row is collapsed and no record is written."""
    row = _FakeRow(
        session_id="sess-no-turn",
        turn_id=None,
        is_running=True,
        age_seconds=ORPHAN_THRESHOLD_SECONDS + 60,
    )
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_FakeRecordsService(),
        publish=publisher,
    )

    assert publisher.published == []
    assert _collapsed(row)


@pytest.mark.anyio
async def test_open_readers_are_told_the_session_ended(anyio_backend):
    """Without this a browser keeps rendering the dead turn as running until a reload."""
    row = _stale_running_row(session_id="sess-watch")
    watch = _FakeWatchPublisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_FakeRecordsService(),
        watch_publisher=watch,
        publish=_Publisher(),
    )

    assert watch.lifecycles == [(str(_PROJECT_ID), "sess-watch", "ended")]


@pytest.mark.anyio
async def test_the_redis_nest_follows_the_settled_row(anyio_backend):
    """The SEND gate reads Redis, not the row: a session left nested keeps refusing a
    new message long after the watchdog declared its turn lost."""
    redis = _FakeRedis()
    project = str(_PROJECT_ID)
    await redis.set(f"alive:{project}:session:sess-lost", b"turn-1", ex=3600)
    await redis.set(f"running:{project}:session:sess-lost", b"turn-1", ex=3600)
    await redis.set(f"owner:{project}:session:sess-lost", b"replica-1", ex=3600)

    await run_orphan_sweep(
        _FakeTransactionsEngine([_stale_running_row()]),
        redis,
        records_service=_FakeRecordsService(),
        publish=_Publisher(),
    )

    assert await redis.get(f"alive:{project}:session:sess-lost") is None
    assert await redis.get(f"running:{project}:session:sess-lost") is None
    assert await redis.get(f"owner:{project}:session:sess-lost") is None
    assert (
        await redis.get(f"superseded:{project}:session:sess-lost:turn:turn-1")
        is not None
    ), "a late beat from the lost turn must not re-nest the session"


@pytest.mark.anyio
async def test_a_failed_lookup_never_invents_an_ending(anyio_backend):
    """If we cannot tell whether the turn already ended, say nothing rather than risk a
    second, contradictory ending. The row is still settled."""

    class _BrokenRecords(_FakeRecordsService):
        async def settled_turns(self, *, project_id, keys):
            raise RuntimeError("tracing db unreachable")

    row = _stale_running_row()
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_BrokenRecords(),
        publish=publisher,
    )

    assert publisher.published == []
    assert _collapsed(row)


@pytest.mark.anyio
async def test_a_stopped_turn_whose_runner_died_still_gets_an_ending(anyio_backend):
    """The seam between the durable Stop and the watchdog, found by running the cells.

    Settlement writes `is_running: false` onto the row the moment it releases the Redis key,
    so the tab that pressed Stop is not left spinning. The runner still owes its own terminal
    record. If it dies in that window the row is already not-running, and the old rule — only
    a row that CLAIMS running owes an ending — skipped it for ever: the 30-minute idle branch
    collapses such a row and writes nothing.

    Observed live on the integration stack. Command 01a06763-5807 settled `applied`/`stopped`
    at 13:09:19, the runner was killed a moment later, and turn 295351c3 still carried nothing
    but the user's own `message` five minutes and five sweep passes later.

    This row is deliberately NOT collapsed here: it is younger than the idle grace, and a
    parked approval of the same age must survive. Only the ending is owed.
    """
    row = _FakeRow(
        session_id="sess-stopped",
        turn_id="turn-stopped",
        is_running=False,
        age_seconds=ORPHAN_THRESHOLD_SECONDS + 30,
    )
    publisher = _Publisher()
    redis = _FakeRedis()
    # Settlement leaves `alive` to its TTL, so the dead turn still holds the session's
    # alive lock when the sweep runs; the SEND gate reads that lock.
    alive_key = f"alive:{row.project_id}:session:{row.session_id}"
    redis._store[alive_key] = b"turn-stopped"
    assert (
        await claim_owner(
            redis,
            project_id=str(row.project_id),
            session_id=row.session_id,
            replica_id="replica-dead",
        )
        == "replica-dead"
    )

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        redis,
        records_service=_FakeRecordsService(),
        publish=publisher,
    )

    assert [event.record_type for event in publisher.published] == ["error", "done"], (
        "a stopped turn whose runner never wrote an ending must be given one"
    )
    assert all(event.turn_id == "turn-stopped" for event in publisher.published)
    assert alive_key not in redis._store, (
        "the dead turn's alive lock must be released, or the next Send is refused for an hour"
    )
    assert (
        await claim_owner(
            redis,
            project_id=str(row.project_id),
            session_id=row.session_id,
            replica_id="replica-new",
        )
        == "replica-new"
    ), "the next runner must claim affinity without waiting for the dead owner's TTL"
    assert row.flags["is_alive"] is True, "the stopped row itself is not collapsed"


async def test_a_stopped_turn_owned_by_a_newer_turn_keeps_that_lock(anyio_backend):
    """Release is owner-checked: if a newer turn already holds `alive`, leave it alone."""
    row = _FakeRow(
        session_id="sess-stopped",
        turn_id="turn-stopped",
        is_running=False,
        age_seconds=ORPHAN_THRESHOLD_SECONDS + 30,
    )
    redis = _FakeRedis()
    alive_key = f"alive:{row.project_id}:session:{row.session_id}"
    redis._store[alive_key] = b"turn-newer"
    await claim_owner(
        redis,
        project_id=str(row.project_id),
        session_id=row.session_id,
        replica_id="replica-newer",
    )

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        redis,
        records_service=_FakeRecordsService(),
        publish=_Publisher(),
    )

    assert redis._store.get(alive_key) == b"turn-newer"
    assert (
        await claim_owner(
            redis,
            project_id=str(row.project_id),
            session_id=row.session_id,
            replica_id="replica-other",
        )
        == "replica-newer"
    ), "settling an older turn must not clear a newer turn's affinity"


@pytest.mark.anyio
async def test_a_stopped_execution_gets_an_ending_after_stream_advances(
    anyio_backend,
):
    stream = _FakeRow(
        session_id="sess-advanced",
        turn_id="turn-later",
        is_running=False,
        age_seconds=0,
    )
    execution = _FakeExecutionRow(
        session_id=stream.session_id,
        execution_id="turn-stopped",
    )
    redis = _FakeRedis()
    alive_key = f"alive:{stream.project_id}:session:{stream.session_id}"
    running_key = f"running:{stream.project_id}:session:{stream.session_id}"
    redis._store[alive_key] = b"turn-later"
    redis._store[running_key] = b"turn-later"
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([stream], [execution]),
        redis,
        records_service=_FakeRecordsService({("sess-advanced", "turn-later")}),
        publish=publisher,
    )

    assert [event.record_type for event in publisher.published] == ["error", "done"]
    assert all(event.turn_id == "turn-stopped" for event in publisher.published)
    assert redis._store[alive_key] == b"turn-later"
    assert redis._store[running_key] == b"turn-later"


@pytest.mark.anyio
async def test_a_stopped_execution_does_not_touch_a_newer_running_turn(
    anyio_backend,
):
    stream = _FakeRow(
        session_id="sess-advanced-running",
        turn_id="turn-running",
        is_running=True,
        age_seconds=0,
    )
    execution = _FakeExecutionRow(
        session_id=stream.session_id,
        execution_id="turn-stopped",
    )
    redis = _FakeRedis()
    alive_key = f"alive:{stream.project_id}:session:{stream.session_id}"
    running_key = f"running:{stream.project_id}:session:{stream.session_id}"
    redis._store[alive_key] = b"turn-running"
    redis._store[running_key] = b"turn-running"
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([stream], [execution]),
        redis,
        records_service=_FakeRecordsService(),
        publish=publisher,
    )

    assert [event.record_type for event in publisher.published] == ["error", "done"]
    assert all(event.turn_id == "turn-stopped" for event in publisher.published)
    assert redis._store[alive_key] == b"turn-running"
    assert redis._store[running_key] == b"turn-running"
