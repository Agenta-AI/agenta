"""The orphan sweep needs TWO staleness thresholds, not one.

A live turn beats every 30s, so 5 minutes of silence from a RUNNING row means the owning
runner died. An alive-but-idle row is a different animal: between turns, and while a turn is
parked awaiting approval, the runner stops beating entirely but keeps the sandbox warm for the
30-minute approval TTL. Sweeping those at 5 minutes collapsed the flags and force-cancelled
the Redis nest of a session the user was about to approve and resume.

No Postgres here (this is the unit suite; the sibling `test_orphan_sweep_clears_redis.py`
stands in for both stores with in-memory fakes). Rather than assert on the compiled SQL
string, `_FakePgSession` below EVALUATES the sweep's real `WHERE` expression tree against
in-memory rows using SQL three-valued logic, so these tests exercise the predicate the sweep
actually builds — including `@>` containment semantics on absent keys and NULL `flags`.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional

import pytest
from sqlalchemy.sql import operators
from sqlalchemy.sql.elements import (
    AsBoolean,
    BinaryExpression,
    BindParameter,
    BooleanClauseList,
    ColumnClause,
    Grouping,
    Null,
    UnaryExpression,
)
from sqlalchemy.sql.functions import Function
from sqlalchemy.sql.dml import Update

from oss.src.tasks.asyncio.sessions.orphan_sweep import (
    IDLE_THRESHOLD_SECONDS,
    ORPHAN_THRESHOLD_SECONDS,
    run_orphan_sweep,
)
from oss.src.utils.env import env

_PROJECT_ID = "proj-sweep-1"


# --------------------------------------------------------------------------- #
# Minimal SQL evaluator for the predicate shapes the sweep uses
# --------------------------------------------------------------------------- #


def _sql_and(values):
    if any(v is False for v in values):
        return False
    return None if any(v is None for v in values) else True


def _sql_or(values):
    if any(v is True for v in values):
        return True
    return None if any(v is None for v in values) else False


def _contains(left, right) -> Optional[bool]:
    """Postgres `jsonb @> jsonb`: NULL propagates; a missing key is FALSE, not NULL."""
    if left is None:
        return None
    return all(key in left and left[key] == value for key, value in right.items())


def _evaluate(node, row) -> Optional[bool]:
    if isinstance(node, Grouping):
        return _evaluate(node.element, row)
    if isinstance(node, BooleanClauseList):
        parts = [_evaluate(clause, row) for clause in node.clauses]
        return (_sql_and if node.operator is operators.and_ else _sql_or)(parts)
    if isinstance(node, AsBoolean) and node.operator is operators.is_false:
        inner = _evaluate(node.element, row)  # `not_(...)` on a boolean expression
        return None if inner is None else not inner
    if isinstance(node, UnaryExpression) and node.operator is operators.inv:
        inner = _evaluate(node.element, row)
        return None if inner is None else not inner
    if isinstance(node, BinaryExpression):
        left, right = _value(node.left, row), _value(node.right, row)
        if node.operator is operators.is_:
            return left is right
        if node.operator is operators.is_not:
            # `turn_id IS NOT NULL`, from the ending-only selection. Postgres `IS NOT` is a
            # total predicate: it never returns NULL, so neither does this.
            return left is not right
        if node.operator is operators.lt:
            return None if left is None or right is None else left < right
        if node.operator is operators.eq:
            return None if left is None or right is None else left == right
        if node.operator is operators.in_op:
            return None if left is None else left in right
        if getattr(node.operator, "opstring", None) == "@>":
            return _contains(left, right)
    raise AssertionError(
        f"the sweep grew a predicate this evaluator cannot read: {node!r}"
    )


def _value(node, row):
    if isinstance(node, Grouping):
        return _value(node.element, row)
    if isinstance(node, BindParameter):
        return node.value
    if isinstance(node, Null):
        return None
    if isinstance(node, Function) and node.name == "coalesce":
        for clause in node.clauses:
            candidate = _value(clause, row)
            if candidate is not None:
                return candidate
        return None
    if isinstance(node, ColumnClause):
        return getattr(row, node.key)
    raise AssertionError(f"unreadable operand: {node!r}")


# --------------------------------------------------------------------------- #
# Fakes (same shape as test_orphan_sweep_clears_redis.py, plus real filtering)
# --------------------------------------------------------------------------- #


class _FakeRow:
    def __init__(
        self,
        *,
        session_id: str,
        flags: Optional[dict],
        age_seconds: int,
        turn_id: Optional[str] = None,
    ):
        self.session_id = session_id
        self.project_id = _PROJECT_ID
        self.id = session_id
        self.turn_id = turn_id
        self.deleted_at = None
        self.flags = flags
        self.created_at = datetime.now(timezone.utc) - timedelta(days=1)
        self.updated_at = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
        self.terminal_outcome = None
        self.ending_written_at = None
        self.settled_at = None


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
    def __init__(self, rows, before_update=None):
        self._rows = rows
        self._before_update = before_update

    async def execute(self, stmt):
        if isinstance(stmt, Update):
            if self._before_update is not None:
                self._before_update()
                self._before_update = None
            matched = [
                row for row in self._rows if _evaluate(stmt.whereclause, row) is True
            ]
            for row in matched:
                for column, value in stmt._values.items():
                    key = column if isinstance(column, str) else column.key
                    setattr(row, key, _value(value, row))
            return _FakeResult([], rowcount=len(matched))
        matched = [
            row for row in self._rows if _evaluate(stmt.whereclause, row) is True
        ]
        return _FakeResult(matched)

    async def commit(self):
        pass


class _FakeTransactionsEngine:
    def __init__(self, rows, before_update=None):
        self._rows = rows
        self._before_update = before_update

    @asynccontextmanager
    async def session(self):
        yield _FakePgSession(self._rows, self._before_update)


class _FakeRedis:
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


def _swept(row: _FakeRow) -> bool:
    return row.flags == {"is_alive": False, "is_running": False, "is_attached": False}


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _OrderedCommandsService:
    def __init__(self) -> None:
        self.calls = []

    async def settle_abandoned_commands(self, *, now):
        self.calls.append("settle")
        return 0

    async def repair_terminal_redis(self):
        self.calls.append("repair")
        return 0


class _CompletedRecords:
    async def settled_turns(self, *, project_id, keys):
        return set(keys)

    async def runner_completed_turns(self, *, project_id, keys):
        return set(keys)


class _CompletionLookupFailure(_CompletedRecords):
    async def runner_completed_turns(self, *, project_id, keys):
        raise RuntimeError("records database unavailable")


class _CompletionCommands(_OrderedCommandsService):
    def __init__(self, *, succeeds: bool) -> None:
        super().__init__()
        self.succeeds = succeeds

    async def settle_execution_completed(self, **kwargs):
        self.calls.append(("completed", kwargs["execution_id"]))
        return self.succeeds


@pytest.mark.anyio
async def test_redis_repair_runs_after_the_sweeps_main_work(anyio_backend):
    commands = _OrderedCommandsService()

    await run_orphan_sweep(
        _FakeTransactionsEngine([]),
        _FakeRedis(),
        commands_service=commands,
    )

    assert commands.calls == ["settle", "repair"]


@pytest.mark.anyio
async def test_running_row_is_swept_at_the_short_threshold(anyio_backend):
    row = _FakeRow(
        session_id="sess-running-stale",
        flags={"is_alive": True, "is_running": True, "is_attached": False},
        age_seconds=360,
    )

    await run_orphan_sweep(_FakeTransactionsEngine([row]), _FakeRedis())

    assert _swept(row), (
        "6 minutes of silence from a turn that beats every 30s means the runner died"
    )


@pytest.mark.anyio
async def test_persisted_done_is_terminalized_before_stale_ownership_is_cleared(
    anyio_backend,
    monkeypatch,
):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    row = _FakeRow(
        session_id="sess-completed-continuation",
        flags={"is_alive": True, "is_running": True, "is_attached": False},
        age_seconds=360,
        turn_id="continuation-1",
    )
    commands = _CompletionCommands(succeeds=True)

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_CompletedRecords(),
        commands_service=commands,
    )

    assert ("completed", "continuation-1") in commands.calls
    assert _swept(row)


@pytest.mark.anyio
async def test_completion_settlement_failure_keeps_ownership_blocking_replay(
    anyio_backend,
    monkeypatch,
):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    row = _FakeRow(
        session_id="sess-completion-race",
        flags={"is_alive": True, "is_running": True, "is_attached": False},
        age_seconds=360,
        turn_id="continuation-1",
    )

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_CompletedRecords(),
        commands_service=_CompletionCommands(succeeds=False),
    )

    assert not _swept(row)


@pytest.mark.anyio
async def test_completion_lookup_failure_keeps_ownership_blocking_replay(
    anyio_backend,
    monkeypatch,
):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)
    row = _FakeRow(
        session_id="sess-completion-lookup-race",
        flags={"is_alive": True, "is_running": True, "is_attached": False},
        age_seconds=360,
        turn_id="continuation-1",
    )

    await run_orphan_sweep(
        _FakeTransactionsEngine([row]),
        _FakeRedis(),
        records_service=_CompletionLookupFailure(),
        commands_service=_CompletionCommands(succeeds=True),
    )

    assert not _swept(row)


@pytest.mark.anyio
async def test_idle_row_survives_the_short_threshold(anyio_backend):
    """The regression: a turn parked awaiting approval stops beating but stays resumable."""
    row = _FakeRow(
        session_id="sess-parked",
        flags={"is_alive": True, "is_running": False, "is_attached": False},
        age_seconds=360,
    )

    await run_orphan_sweep(_FakeTransactionsEngine([row]), _FakeRedis())

    assert not _swept(row), (
        "an alive-but-idle session was declared dead 5 minutes in, while the user still had "
        "25 minutes of approval TTL to resume it"
    )
    assert row.flags["is_alive"] is True


@pytest.mark.anyio
async def test_idle_row_is_swept_at_the_long_threshold(anyio_backend):
    row = _FakeRow(
        session_id="sess-idle-dead",
        flags={"is_alive": True, "is_running": False, "is_attached": False},
        age_seconds=IDLE_THRESHOLD_SECONDS + 60,
    )

    await run_orphan_sweep(_FakeTransactionsEngine([row]), _FakeRedis())

    assert _swept(row), (
        "past the approval TTL the sandbox is gone; the row must not stay alive forever"
    )


@pytest.mark.anyio
async def test_the_running_threshold_is_three_missed_heartbeats(anyio_backend):
    """90 seconds of heartbeat age, not lease expiry.

    The Redis alive/running keys carry a ONE HOUR TTL, so a rule phrased as "shortly after the
    lease expires" would leave a dead turn running for an hour. The runner beats every 30
    seconds and mirrors the beat onto `updated_at`, so three missed beats is the signal. The
    old value was 300s, which was defensible while the sweep only collapsed flags and nobody
    ever saw the result; it is too long now that the sweep writes a real ending.
    """
    assert (ORPHAN_THRESHOLD_SECONDS, IDLE_THRESHOLD_SECONDS) == (90, 1800)


@pytest.mark.anyio
async def test_partial_flags_are_treated_as_idle_not_running(anyio_backend):
    """`flags @> '{"is_running": true}'` is FALSE (not NULL) for a row whose JSON simply lacks
    the key, so `not_(...)` puts it on the idle branch rather than dropping it from both."""
    young = _FakeRow(
        session_id="sess-partial-young", flags={"is_alive": True}, age_seconds=360
    )
    old = _FakeRow(
        session_id="sess-partial-old",
        flags={"is_alive": True},
        age_seconds=IDLE_THRESHOLD_SECONDS + 60,
    )

    await run_orphan_sweep(_FakeTransactionsEngine([young, old]), _FakeRedis())

    assert not _swept(young)
    assert _swept(old), "a row lacking is_running must still be reclaimable"


@pytest.mark.anyio
async def test_rows_that_never_claimed_alive_are_never_swept(anyio_backend):
    """NULL flags (a row created by rename alone) make every `@>` test NULL, and a row that
    says is_alive=false was never the sweep's business."""
    null_flags = _FakeRow(session_id="sess-null", flags=None, age_seconds=99_999)
    not_alive = _FakeRow(
        session_id="sess-ended",
        flags={"is_alive": False, "is_running": False, "is_attached": False},
        age_seconds=99_999,
    )

    await run_orphan_sweep(
        _FakeTransactionsEngine([null_flags, not_alive]), _FakeRedis()
    )

    assert null_flags.flags is None
    assert not_alive.flags["is_alive"] is False


@pytest.mark.anyio
async def test_sweep_clears_redis_for_the_long_threshold_branch(anyio_backend):
    """Whichever branch selected a row, the Redis nest must follow the row — otherwise the
    SEND gate keeps reading `alive` from a session the sweep just declared dead."""
    session_id = "sess-idle-dead-redis"
    redis = _FakeRedis()
    await redis.set(f"alive:{_PROJECT_ID}:session:{session_id}", b"turn-1", ex=3600)
    await redis.set(f"owner:{_PROJECT_ID}:session:{session_id}", b"replica-1", ex=3600)
    row = _FakeRow(
        session_id=session_id,
        flags={"is_alive": True, "is_running": False, "is_attached": False},
        age_seconds=IDLE_THRESHOLD_SECONDS + 60,
        turn_id="turn-1",
    )

    await run_orphan_sweep(_FakeTransactionsEngine([row]), redis)

    assert await redis.get(f"alive:{_PROJECT_ID}:session:{session_id}") is None
    assert await redis.get(f"owner:{_PROJECT_ID}:session:{session_id}") is None


@pytest.mark.anyio
async def test_turn_advance_during_sweep_prevents_collapse_and_redis_cleanup(
    anyio_backend,
):
    session_id = "sess-advanced-during-sweep"
    row = _FakeRow(
        session_id=session_id,
        flags={"is_alive": True, "is_running": True, "is_attached": False},
        age_seconds=360,
        turn_id="turn-old",
    )
    redis = _FakeRedis()
    await redis.set(f"alive:{_PROJECT_ID}:session:{session_id}", b"turn-new")
    await redis.set(f"running:{_PROJECT_ID}:session:{session_id}", b"turn-new")
    await redis.set(f"owner:{_PROJECT_ID}:session:{session_id}", b"runner-new")

    def advance_row():
        row.turn_id = "turn-new"
        row.updated_at = datetime.now(timezone.utc)

    await run_orphan_sweep(
        _FakeTransactionsEngine([row], before_update=advance_row), redis
    )

    assert row.flags["is_alive"] is True
    assert row.flags["is_running"] is True
    assert await redis.get(f"alive:{_PROJECT_ID}:session:{session_id}") == b"turn-new"
    assert await redis.get(f"running:{_PROJECT_ID}:session:{session_id}") == b"turn-new"
    assert await redis.get(f"owner:{_PROJECT_ID}:session:{session_id}") == b"runner-new"


@pytest.mark.anyio
async def test_heartbeat_during_sweep_prevents_collapse(anyio_backend):
    row = _FakeRow(
        session_id="sess-heartbeat-during-sweep",
        flags={"is_alive": True, "is_running": True, "is_attached": False},
        age_seconds=360,
        turn_id="turn-current",
    )

    def heartbeat():
        row.updated_at = datetime.now(timezone.utc)

    await run_orphan_sweep(
        _FakeTransactionsEngine([row], before_update=heartbeat), _FakeRedis()
    )

    assert row.flags["is_alive"] is True
    assert row.flags["is_running"] is True
