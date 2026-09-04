"""The execution watchdog must give a lost turn a real ending, exactly once.

Before this, the sweep collapsed a dead session's flags and cleared its Redis nest, but wrote
nothing to the transcript: the turn simply stopped mid-sentence and the browser kept showing
it as running until the user reloaded. The invariant these tests hold is the RFC's — every
accepted execution reaches exactly ONE durable terminal outcome — so they check both halves:
an ending IS written for a turn that has none, and a SECOND ending is never written for a turn
that already has one.

The threshold predicate itself is covered by `test_orphan_sweep_thresholds.py`; the fake
session here models the execution filter, order, and batch limit so the durable candidate
window is also covered.
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
from oss.src.dbs.redis.sessions.contract import make_owner_value, owner_replica_id
from oss.src.dbs.redis.sessions.locks import claim_owner, is_turn_superseded
from oss.src.tasks.asyncio.sessions.orphan_sweep import (
    LOST_ERROR_CODE,
    LOST_ERROR_MESSAGE,
    ORPHAN_THRESHOLD_SECONDS,
    IDLE_THRESHOLD_SECONDS,
    SWEEP_BATCH_SIZE,
    _unsettled_turns,
    run_orphan_sweep,
)
from oss.src.utils.env import env

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
        ending_written_at: Optional[datetime] = None,
    ):
        self.project_id = _PROJECT_ID
        self.session_id = session_id
        self.execution_id = execution_id
        self.terminal_outcome = terminal_outcome
        self.settled_by = "runner"
        self.settled_at = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
        self.ending_written_at = ending_written_at


class _FakeResult:
    def __init__(self, rows, *, rowcount=0):
        self._rows = rows
        self.rowcount = rowcount

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakePgSession:
    def __init__(self, rows, executions, before_stream_update=None, on_commit=None):
        self._rows = rows
        self._executions = executions
        self._before_stream_update = before_stream_update
        self._on_commit = on_commit
        self.commits = 0

    async def execute(self, stmt):
        # Evaluate the sweep's two selections the way Postgres would, so a test can tell a
        # collapsed row from one that only owed an ending. The ending-only statement is the
        # one that filters on `turn_id IS NOT NULL`; the first statement carries the OR of
        # the running and idle branches.
        text = str(stmt)
        now = datetime.now(timezone.utc)

        if "session_executions" in text:
            if text.startswith("UPDATE"):
                params = stmt.compile().params
                keys = next(
                    value
                    for value in params.values()
                    if isinstance(value, (list, set, tuple))
                    and all(isinstance(key, tuple) and len(key) == 3 for key in value)
                )
                for execution in self._executions:
                    key = (
                        execution.project_id,
                        execution.session_id,
                        execution.execution_id,
                    )
                    if key in keys and execution.ending_written_at is None:
                        execution.ending_written_at = now
                return _FakeResult([])
            rows = [
                execution
                for execution in self._executions
                if execution.terminal_outcome in {"stopped", "lost"}
                and (now - execution.settled_at).total_seconds()
                > ORPHAN_THRESHOLD_SECONDS
            ]
            if "ending_written_at IS NULL" in text:
                rows = [row for row in rows if row.ending_written_at is None]
            return _FakeResult(
                sorted(
                    rows,
                    key=lambda row: row.settled_at,
                    reverse="DESC" in text,
                )[:SWEEP_BATCH_SIZE]
            )

        # Both session_streams writes are Core UPDATEs of flags/updated_at keyed by row id, and
        # never ORM attribute writes (finding 7). Apply them to the in-memory rows so a test
        # sees what Postgres would. The collapse binds `id IN (...)`, a list. The lost-turn
        # clear binds `id = ...`, a scalar. Row ids are strings here and are the only string
        # bind in either statement.
        if text.startswith("UPDATE") and "session_streams" in text:
            if self._before_stream_update is not None:
                self._before_stream_update()
                self._before_stream_update = None
                return _FakeResult([], rowcount=0)
            params = stmt.compile().params
            flags_val = next(
                (v for v in params.values() if isinstance(v, dict) and "is_alive" in v),
                None,
            )
            ids = set()
            for value in params.values():
                if isinstance(value, (list, set, tuple)):
                    ids.update(x for x in value if isinstance(x, (str, UUID)))
                elif isinstance(value, (str, UUID)):
                    ids.add(value)
            if flags_val is not None:
                matched = 0
                for r in self._rows:
                    if r.id in ids:
                        r.flags = dict(flags_val)
                        r.updated_at = now
                        matched += 1
                return _FakeResult([], rowcount=matched)
            return _FakeResult([])

        # The lost-turn is_running clear: a session_streams SELECT keyed by a list of
        # (project_id, session_id, turn_id) tuples. Return the rows those keys name that still
        # read is_running true, so the sweep can clear the flag on them.
        params = stmt.compile().params
        key_lists = [
            value
            for value in params.values()
            if isinstance(value, (list, set, tuple))
            and value
            and all(isinstance(key, tuple) and len(key) == 3 for key in value)
        ]
        if key_lists:
            keys = set(key_lists[0])
            return _FakeResult(
                [
                    r
                    for r in self._rows
                    if r.flags.get("is_running") is True
                    and (r.project_id, r.session_id, str(r.turn_id)) in keys
                ]
            )

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
        if self._on_commit is not None:
            self._on_commit()


class _FakeTransactionsEngine:
    def __init__(
        self,
        rows,
        executions=None,
        before_stream_update=None,
        after_commit=None,
    ):
        self._rows = rows
        self._executions = executions or []
        self._before_stream_update = before_stream_update
        self._after_commit = after_commit
        self.committed = False

    def _mark_committed(self):
        self.committed = True
        if self._after_commit is not None:
            self._after_commit()

    @asynccontextmanager
    async def session(self):
        yield _FakePgSession(
            self._rows,
            self._executions,
            self._before_stream_update,
            self._mark_committed,
        )


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

    async def eval(self, script, numkeys, *keys_and_args):
        def decode(value):
            return value.decode() if isinstance(value, bytes) else str(value)

        keys = [decode(value) for value in keys_and_args[:numkeys]]
        argv = [decode(value) for value in keys_and_args[numkeys:]]
        if "AGENTA_WATCHDOG_RELEASE_TURN" in script:
            alive, running, owner, superseded = keys
            expected_turn, expected_owner, _ttl = argv
            alive_value = decode(self._store[alive]) if alive in self._store else ""
            running_value = (
                decode(self._store[running]) if running in self._store else ""
            )
            owner_value = decode(self._store[owner]) if owner in self._store else ""
            released_alive = int(bool(expected_turn) and alive_value == expected_turn)
            released_running = int(
                bool(expected_turn) and running_value == expected_turn
            )
            if released_alive:
                self._store.pop(alive, None)
            if released_running:
                self._store.pop(running, None)
            foreign_turn = (alive_value and alive_value != expected_turn) or (
                running_value and running_value != expected_turn
            )
            released_owner = int(
                bool(expected_owner)
                and owner_value == expected_owner
                and not foreign_turn
            )
            if released_owner:
                self._store.pop(owner, None)
            if expected_turn:
                self._store[superseded] = b"1"
            return [released_alive, released_running, released_owner]

        k = keys[0]
        v = argv[0]
        current = self._store.get(k)
        if isinstance(current, bytes):
            current = current.decode()
        if len(argv) > 1:
            if current is None or owner_replica_id(current) == owner_replica_id(v):
                self._store[k] = v.encode()
                return v.encode()
            return current.encode()
        # The sweep's script is release-if-owner: delete only when the value matches.
        if current == v:
            self._store.pop(k, None)
            return 1
        return 0


class _CommitObservingRedis(_FakeRedis):
    def __init__(self, engine: _FakeTransactionsEngine):
        super().__init__()
        self._engine = engine

    async def eval(self, *args, **kwargs):
        assert self._engine.committed, (
            "Redis ownership was released before the DB commit"
        )
        return await super().eval(*args, **kwargs)


class _FakeRecordsService:
    """Stands in for the records plane. `settled` is what the tracing DB already holds."""

    def __init__(self, settled: Optional[Set[Tuple[str, str]]] = None):
        self.settled = settled or set()
        self.queries: List[Sequence[Tuple[str, str]]] = []

    async def settled_turns(self, *, project_id, keys):
        self.queries.append(list(keys))
        return {key for key in keys if key in self.settled}


@pytest.mark.anyio
async def test_terminal_record_checks_are_batched_once_per_project(anyio_backend):
    other_project = UUID("00000000-0000-4000-8000-000000000002")

    class _RecordingRecords:
        def __init__(self):
            self.queries = []

        async def settled_turns(self, *, project_id, keys):
            self.queries.append((project_id, list(keys)))
            return set()

    records = _RecordingRecords()
    first_project = [
        (_PROJECT_ID, f"session-{index}", f"turn-{index}") for index in range(100)
    ]
    second_project = [(other_project, "session-other", "turn-other")]

    unsettled, ended, deferred = await _unsettled_turns(
        records_service=records,
        candidates=[*first_project, *second_project],
    )

    assert ended == set()
    assert deferred == set()
    assert unsettled == set(first_project + second_project)
    assert [(project_id, len(keys)) for project_id, keys in records.queries] == [
        (_PROJECT_ID, 100),
        (other_project, 1),
    ]


class _FakeWatchPublisher:
    def __init__(self):
        self.lifecycles: List[Tuple[str, str, str]] = []
        self.changes: List[Tuple[str, str, str]] = []

    async def lifecycle(self, *, project_id, session_id, state):
        self.lifecycles.append((project_id, session_id, state))

    async def changed(self, *, project_id, entity, id):
        self.changes.append((project_id, entity, id))


class _Publisher:
    """Captures what the watchdog would put on the record ingest stream."""

    def __init__(self):
        self.published: List[SessionRecordEvent] = []

    async def __call__(self, *, project_id, record_event):
        self.published.append(record_event)
        return True


class _CommandsService:
    def __init__(self):
        self.execution_lost_calls = []

    async def settle_execution_lost(self, **kwargs):
        assert kwargs["transaction"] is not None
        self.execution_lost_calls.append(kwargs)
        return True

    async def settle_abandoned_commands(self, *, now):
        return 0

    async def repair_terminal_redis(self):
        return 0


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
async def test_cleanup_preserves_same_replica_owner_refresh_before_new_turn_locks(
    anyio_backend,
):
    stream = _stale_running_row(session_id="sess-cleanup-race", turn_id="turn-a")
    redis = _FakeRedis()
    project = str(stream.project_id)
    alive_key = f"alive:{project}:session:{stream.session_id}"
    running_key = f"running:{project}:session:{stream.session_id}"
    owner_key = f"owner:{project}:session:{stream.session_id}"
    redis._store[alive_key] = b"turn-a"
    redis._store[running_key] = b"turn-a"
    redis._store[owner_key] = make_owner_value(
        replica_id="replica-a", turn_id="turn-a"
    ).encode()

    def refresh_turn_b_owner():
        # Exact ABA gap: the same replica refreshed affinity for B, but has not installed B's
        # alive/running keys yet. Cleanup must compare the owner generation, not the replica.
        redis._store[owner_key] = make_owner_value(
            replica_id="replica-a", turn_id="turn-b"
        ).encode()

    await run_orphan_sweep(
        _FakeTransactionsEngine([stream], after_commit=refresh_turn_b_owner),
        redis,
        records_service=_FakeRecordsService(),
        publish=_Publisher(),
    )

    assert alive_key not in redis._store
    assert running_key not in redis._store
    assert (
        redis._store[owner_key]
        == make_owner_value(replica_id="replica-a", turn_id="turn-b").encode()
    )
    assert (
        redis._store[f"superseded:{project}:session:{stream.session_id}:turn:turn-a"]
        == b"1"
    )
    assert (
        f"superseded:{project}:session:{stream.session_id}:turn:turn-b"
        not in redis._store
    )


@pytest.mark.anyio
async def test_a_failed_lookup_never_invents_an_ending(anyio_backend):
    """If we cannot tell whether the turn already ended, say nothing rather than risk a
    second, contradictory ending. Preserve the row and Redis ownership so the next pass retries."""

    class _FlakyRecords(_FakeRecordsService):
        def __init__(self):
            super().__init__()
            self.calls = 0

        async def settled_turns(self, *, project_id, keys):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("tracing db unreachable")
            return set()

    row = _stale_running_row()
    publisher = _Publisher()
    records = _FlakyRecords()
    redis = _FakeRedis()
    project = str(row.project_id)
    alive_key = f"alive:{project}:session:{row.session_id}"
    running_key = f"running:{project}:session:{row.session_id}"
    redis._store[alive_key] = b"turn-1"
    redis._store[running_key] = b"turn-1"

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        redis,
        records_service=records,
        publish=publisher,
    )

    assert publisher.published == []
    assert not _collapsed(row)
    assert redis._store[alive_key] == b"turn-1"
    assert redis._store[running_key] == b"turn-1"

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        redis,
        records_service=records,
        publish=publisher,
    )

    assert _collapsed(row)
    assert alive_key not in redis._store
    assert running_key not in redis._store
    assert [event.record_type for event in publisher.published] == ["error", "done"]


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
    execution = _FakeExecutionRow(
        session_id=row.session_id,
        execution_id="turn-stopped",
    )
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
        _FakeTransactionsEngine([row], [execution]),
        redis,
        records_service=_FakeRecordsService(),
        publish=publisher,
    )

    assert [event.record_type for event in publisher.published] == ["done"], (
        "a stopped turn whose runner never wrote an ending must be given one"
    )
    assert publisher.published[0].attributes == {
        "type": "done",
        "stopReason": "cancelled",
        RECORD_SETTLED_BY_ATTRIBUTE: SETTLED_BY_WATCHDOG,
    }
    assert all(event.turn_id == "turn-stopped" for event in publisher.published)
    assert execution.ending_written_at is not None
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

    assert [event.record_type for event in publisher.published] == ["done"]
    assert publisher.published[0].attributes["stopReason"] == "cancelled"
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

    assert [event.record_type for event in publisher.published] == ["done"]
    assert publisher.published[0].attributes["stopReason"] == "cancelled"
    assert all(event.turn_id == "turn-stopped" for event in publisher.published)
    assert redis._store[alive_key] == b"turn-running"
    assert redis._store[running_key] == b"turn-running"


@pytest.mark.anyio
async def test_ended_execution_backlog_cannot_hide_a_recent_orphan(anyio_backend):
    ended_at = datetime.now(timezone.utc)
    ended = [
        _FakeExecutionRow(
            session_id=f"sess-ended-{index}",
            execution_id=f"turn-ended-{index}",
            age_seconds=ORPHAN_THRESHOLD_SECONDS + 1_000 + index,
            ending_written_at=ended_at,
        )
        for index in range(SWEEP_BATCH_SIZE + 1)
    ]
    orphan = _FakeExecutionRow(
        session_id="sess-recent-orphan",
        execution_id="turn-recent-orphan",
    )
    records = _FakeRecordsService()
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([], [*ended, orphan]),
        _FakeRedis(),
        records_service=records,
        publish=publisher,
    )

    assert records.queries == [[("sess-recent-orphan", "turn-recent-orphan")]]
    assert [event.record_type for event in publisher.published] == ["done"]
    assert publisher.published[0].turn_id == "turn-recent-orphan"
    assert orphan.ending_written_at is not None


@pytest.mark.anyio
async def test_records_plane_ending_marks_candidate_and_skips_publish(anyio_backend):
    execution = _FakeExecutionRow(
        session_id="sess-already-ended",
        execution_id="turn-already-ended",
        terminal_outcome="lost",
    )
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([], [execution]),
        _FakeRedis(),
        records_service=_FakeRecordsService(
            {("sess-already-ended", "turn-already-ended")}
        ),
        publish=publisher,
    )

    assert publisher.published == []
    assert execution.ending_written_at is not None


@pytest.mark.anyio
async def test_a_lost_execution_clears_is_running_on_a_row_that_still_names_it(
    anyio_backend,
):
    # The execution is settled lost, but the session's stream row still names that turn and
    # still reads is_running true, so the SEND gate would refuse the next message. The pass
    # that writes the lost ending must clear is_running (keeping is_alive so the session stays
    # resumable), clear the running lock, and update the mirror -- in the same pass. The row is
    # fresh here so the went-silent collapse never touches it; the fix must.
    stream = _FakeRow(
        session_id="sess-stuck-running",
        turn_id="turn-lost",
        is_running=True,
        age_seconds=0,
    )
    execution = _FakeExecutionRow(
        session_id=stream.session_id,
        execution_id="turn-lost",
        terminal_outcome="lost",
    )
    redis = _FakeRedis()
    alive_key = f"alive:{stream.project_id}:session:{stream.session_id}"
    running_key = f"running:{stream.project_id}:session:{stream.session_id}"
    redis._store[running_key] = b"turn-lost"
    redis._store[alive_key] = b"turn-lost"
    publisher = _Publisher()
    watch = _FakeWatchPublisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([stream], [execution]),
        redis,
        records_service=_FakeRecordsService(),
        watch_publisher=watch,
        publish=publisher,
    )

    # is_running is cleared on the row, is_alive is kept, and the row is NOT collapsed.
    assert stream.flags == {
        "is_alive": True,
        "is_running": False,
        "is_attached": False,
    }
    # The running lock the SEND gate reads is cleared too, guarded on the dead turn.
    assert running_key not in redis._store
    # The mirror update reaches open readers.
    assert (str(stream.project_id), "session", stream.session_id) in watch.changes


@pytest.mark.anyio
async def test_lost_turn_redis_release_follows_the_stream_commit(anyio_backend):
    stream = _FakeRow(
        session_id="sess-commit-before-release",
        turn_id="turn-lost",
        is_running=True,
        age_seconds=0,
    )
    execution = _FakeExecutionRow(
        session_id=stream.session_id,
        execution_id="turn-lost",
        terminal_outcome="lost",
    )
    engine = _FakeTransactionsEngine([stream], [execution])
    redis = _CommitObservingRedis(engine)
    for prefix in ("alive", "running"):
        redis._store[f"{prefix}:{stream.project_id}:session:{stream.session_id}"] = (
            b"turn-lost"
        )

    await run_orphan_sweep(
        engine,
        redis,
        records_service=_FakeRecordsService(),
        publish=_Publisher(),
    )

    assert engine.committed is True


@pytest.mark.anyio
async def test_lost_turn_clear_loses_to_a_concurrent_turn_advance(anyio_backend):
    stream = _FakeRow(
        session_id="sess-advance-during-lost-clear",
        turn_id="turn-old",
        is_running=True,
        age_seconds=0,
    )
    execution = _FakeExecutionRow(
        session_id=stream.session_id,
        execution_id="turn-old",
        terminal_outcome="lost",
    )
    redis = _FakeRedis()
    alive_key = f"alive:{stream.project_id}:session:{stream.session_id}"
    running_key = f"running:{stream.project_id}:session:{stream.session_id}"
    owner_key = f"owner:{stream.project_id}:session:{stream.session_id}"
    redis._store[alive_key] = b"turn-new"
    redis._store[running_key] = b"turn-new"
    redis._store[owner_key] = b"runner-new"

    def advance_stream():
        stream.turn_id = "turn-new"
        stream.updated_at = datetime.now(timezone.utc)

    await run_orphan_sweep(
        _FakeTransactionsEngine(
            [stream], [execution], before_stream_update=advance_stream
        ),
        redis,
        records_service=_FakeRecordsService(),
        publish=_Publisher(),
    )

    assert stream.turn_id == "turn-new"
    assert stream.flags["is_running"] is True
    assert redis._store[alive_key] == b"turn-new"
    assert redis._store[running_key] == b"turn-new"
    assert redis._store[owner_key] == b"runner-new"


@pytest.mark.anyio
async def test_heartbeat_before_orphan_cas_prevents_settlement_and_records(
    anyio_backend,
    monkeypatch,
):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    stream = _stale_running_row(
        session_id="sess-heartbeat-before-cas", turn_id="turn-current"
    )
    publisher = _Publisher()
    commands = _CommandsService()

    def heartbeat():
        stream.updated_at = datetime.now(timezone.utc)

    await run_orphan_sweep(
        _FakeTransactionsEngine([stream], before_stream_update=heartbeat),
        _FakeRedis(),
        records_service=_FakeRecordsService(),
        commands_service=commands,
        publish=publisher,
    )

    assert commands.execution_lost_calls == []
    assert publisher.published == []
    assert stream.flags["is_alive"] is True
    assert stream.flags["is_running"] is True


@pytest.mark.anyio
async def test_a_lost_execution_leaves_a_newer_running_turn_running(anyio_backend):
    # The row has advanced to a NEWER turn that is genuinely running. Settling the OLD turn
    # lost must not clear is_running on that row, nor its running lock.
    stream = _FakeRow(
        session_id="sess-advanced-newer",
        turn_id="turn-new",
        is_running=True,
        age_seconds=0,
    )
    execution = _FakeExecutionRow(
        session_id=stream.session_id,
        execution_id="turn-old",
        terminal_outcome="lost",
    )
    redis = _FakeRedis()
    running_key = f"running:{stream.project_id}:session:{stream.session_id}"
    redis._store[running_key] = b"turn-new"
    publisher = _Publisher()
    watch = _FakeWatchPublisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([stream], [execution]),
        redis,
        records_service=_FakeRecordsService(),
        watch_publisher=watch,
        publish=publisher,
    )

    # The newer running turn is untouched: its flag stands and its lock survives.
    assert stream.flags["is_running"] is True
    assert redis._store[running_key] == b"turn-new"


@pytest.mark.anyio
async def test_a_swept_turn_is_tombstoned_even_when_it_holds_no_redis_keys(
    anyio_backend,
):
    # A prior Stop settlement can clear the alive/running keys before the sweep runs, so the
    # collapse finds nothing to displace. The turn is still dead: tombstone it anyway, or a
    # returning runner's beat for that turn is admitted and re-sets is_running on the row the
    # sweep just collapsed (observed live: run 1e, a beat 3.5 s after the settle).
    stream = _stale_running_row(session_id="sess-returning-runner", turn_id="turn-gone")
    redis = _FakeRedis()  # deliberately empty: no alive/running keys to displace
    publisher = _Publisher()

    await run_orphan_sweep(
        _FakeTransactionsEngine([stream], []),
        redis,
        records_service=_FakeRecordsService(),
        publish=publisher,
    )

    assert _collapsed(stream)
    assert await is_turn_superseded(
        redis,
        project_id=str(stream.project_id),
        session_id=stream.session_id,
        turn_id="turn-gone",
    )
