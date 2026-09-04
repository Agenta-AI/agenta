"""The Stop guard: a cancel must not kill a turn the caller never meant to cancel.

Before this, CANCEL called `_displace_turns` unconditionally, which tombstones whichever turn
holds `alive`/`running` at that instant. A Stop pressed for turn one but applied after turn one
ended and turn two started therefore killed turn two, and the tombstone lives for
SUPERSEDED_TTL_SECONDS with a refresh on every read — so the session stays wedged (#6417).

Two guards close it, in order of strength:

  1. `expected_execution_id` on the request names the turn. The public DTO keeps the RFC's
     name; internally it IS a turn id. A different turn holding the session means the turn the
     caller meant is gone: refuse with `SessionTurnMismatch` (409) and touch nothing.
  2. With no id, refuse when a holding turn started AFTER the request arrived. This needs the
     turn-start key the coordination plane now records, because nothing else knows when a turn
     began early enough to be useful.

Also covered: cancel reports the turns it ended, which is what lets the router cancel exactly
those turns' pending gates.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamCommandRequest,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionTurnMismatch
from oss.src.dbs.redis.sessions.locks import (
    acquire_alive,
    acquire_running,
    get_alive_owner,
    get_running_owner,
    is_turn_superseded,
    record_turn_start,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "session_stop-guard"


class _FakeStreamsDAO:
    """Enough of the streams DAO for the cancel path: read, create, update."""

    def __init__(self, existing: Optional[SessionStream] = None):
        self.row = existing

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.row = SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            flags=stream.flags,
            turn_id=stream.turn_id,
        )
        return self.row

    async def update(self, *, project_id, user_id, session_id, stream):
        prior = self.row
        self.row = SessionStream(
            id=prior.id if prior else uuid4(),
            project_id=project_id,
            session_id=session_id,
            flags=stream.flags
            if stream.flags is not None
            else (prior.flags if prior else None),
            turn_id=stream.turn_id
            if stream.turn_id is not None
            else (prior.turn_id if prior else None),
        )
        return self.row

    async def fill_missing(self, *, project_id, session_id, name=None, references=None):
        return self.row

    async def unarchive_by_session_id(self, *, project_id, user_id, session_id):
        return self.row

    async def clear_archived_by_session_id(self, *, project_id, user_id, session_id):
        return self.row

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


def _service(lock_engine, dao=None):
    return SessionStreamsService(
        streams_dao=dao or _FakeStreamsDAO(), lock_engine=lock_engine
    )


def _cancel(expected: Optional[str] = None) -> SessionStreamCommandRequest:
    """A Stop: no inputs, force=False. That is what the browser sends."""
    return SessionStreamCommandRequest(
        session_id=_SESSION,
        expected_execution_id=expected,
    )


async def _seat_turn(lock_engine, turn_id: str, started_at_ms: Optional[int] = None):
    """Put `turn_id` in the nest the way a running turn holds it, with a start time."""
    await acquire_alive(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id=turn_id
    )
    await acquire_running(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id=turn_id
    )
    await record_turn_start(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id=turn_id,
        started_at_ms=started_at_ms,
    )


# --------------------------------------------------------------------------- #
# Guard 1 — expected_execution_id
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_cancel_with_matching_expected_id_cancels_that_turn(lock_engine):
    svc = _service(lock_engine)
    await _seat_turn(lock_engine, "turn-1", started_at_ms=1_000)

    result = await svc.command(
        project_id=_PROJECT, user_id=_USER, request=_cancel("turn-1")
    )

    assert result.mode == CommandMode.cancel
    assert result.turn_id == "turn-1"
    assert result.cancelled_turn_ids == ["turn-1"]
    assert await is_turn_superseded(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-1"
    )
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        is None
    )


@pytest.mark.asyncio
async def test_cancel_with_stale_expected_id_is_refused_and_touches_nothing(
    lock_engine,
):
    """The headline case: the Stop names turn one, turn two now holds the session."""
    svc = _service(lock_engine)
    await _seat_turn(lock_engine, "turn-2", started_at_ms=2_000)

    with pytest.raises(SessionTurnMismatch) as excinfo:
        await svc.command(project_id=_PROJECT, user_id=_USER, request=_cancel("turn-1"))

    assert excinfo.value.expected_turn_id == "turn-1"
    assert excinfo.value.actual_turn_id == "turn-2"

    # Turn two keeps the whole nest and is NOT tombstoned — that is the bug this closes.
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-2"
    )
    assert (
        await get_running_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-2"
    )
    assert not await is_turn_superseded(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-2"
    )


@pytest.mark.asyncio
async def test_cancel_with_expected_id_tombstones_a_turn_that_holds_nothing(
    lock_engine,
):
    """A named turn whose beat is still in flight must not be able to re-take the session."""
    svc = _service(lock_engine)

    result = await svc.command(
        project_id=_PROJECT, user_id=_USER, request=_cancel("turn-1")
    )

    assert result.cancelled_turn_ids == ["turn-1"]
    assert await is_turn_superseded(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-1"
    )


@pytest.mark.asyncio
async def test_blank_expected_id_is_read_as_absent(lock_engine):
    """A whitespace guard is a client bug. Reading it as "no guard" is the safe failure."""
    request = SessionStreamCommandRequest(
        session_id=_SESSION, expected_execution_id="   "
    )
    assert request.expected_execution_id is None


# --------------------------------------------------------------------------- #
# Guard 2 — arrival time, for callers that send no id
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_cancel_without_id_refuses_a_turn_that_started_after_it_arrived(
    lock_engine,
):
    svc = _service(lock_engine)
    # Far in the future relative to this cancel's arrival: the turn began after the ask.
    await _seat_turn(lock_engine, "turn-2", started_at_ms=4_000_000_000_000)

    with pytest.raises(SessionTurnMismatch) as excinfo:
        await svc.command(project_id=_PROJECT, user_id=_USER, request=_cancel())

    assert excinfo.value.expected_turn_id is None
    assert excinfo.value.actual_turn_id == "turn-2"
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-2"
    )
    assert not await is_turn_superseded(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-2"
    )


@pytest.mark.asyncio
async def test_cancel_without_id_still_cancels_a_turn_that_started_earlier(lock_engine):
    svc = _service(lock_engine)
    await _seat_turn(lock_engine, "turn-1", started_at_ms=1_000)

    result = await svc.command(project_id=_PROJECT, user_id=_USER, request=_cancel())

    assert result.cancelled_turn_ids == ["turn-1"]
    assert await is_turn_superseded(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-1"
    )


@pytest.mark.asyncio
async def test_cancel_without_id_still_cancels_a_turn_with_no_recorded_start(
    lock_engine,
):
    """Unknown must mean unknown, never "new". A turn from before this shipped stays stoppable."""
    svc = _service(lock_engine)
    await acquire_alive(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-old"
    )

    result = await svc.command(project_id=_PROJECT, user_id=_USER, request=_cancel())

    assert result.cancelled_turn_ids == ["turn-old"]


# --------------------------------------------------------------------------- #
# The turn-start record itself
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_start_turn_records_a_start_time(lock_engine):
    from oss.src.dbs.redis.sessions.locks import get_turn_start

    svc = _service(lock_engine)
    turn_id = await svc._start_turn(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert (
        await get_turn_start(
            lock_engine,
            project_id=str(_PROJECT),
            session_id=_SESSION,
            turn_id=turn_id,
        )
        is not None
    )


@pytest.mark.asyncio
async def test_heartbeat_records_a_start_time_for_a_runner_minted_turn(lock_engine):
    """A browser turn's id is minted by the runner, so its first beat is where it is stamped."""
    from oss.src.dbs.redis.sessions.locks import get_turn_start

    svc = _service(lock_engine)
    await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=_SESSION, replica_id="replica-a", turn_id="turn-runner"
        ),
    )

    assert (
        await get_turn_start(
            lock_engine,
            project_id=str(_PROJECT),
            session_id=_SESSION,
            turn_id="turn-runner",
        )
        is not None
    )


@pytest.mark.asyncio
async def test_turn_start_is_written_once(lock_engine):
    """Later beats refresh the record, never move it: the guard needs the FIRST start."""
    from oss.src.dbs.redis.sessions.locks import get_turn_start

    first = await record_turn_start(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id="turn-1",
        started_at_ms=1_000,
    )
    second = await record_turn_start(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id="turn-1",
        started_at_ms=9_000,
    )

    assert first == 1_000
    assert second == 1_000
    assert (
        await get_turn_start(
            lock_engine,
            project_id=str(_PROJECT),
            session_id=_SESSION,
            turn_id="turn-1",
        )
        == 1_000
    )


# --------------------------------------------------------------------------- #
# Steer and kill are not guarded — both mean "take this session from whoever has it"
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_steer_is_not_subject_to_the_guard(lock_engine):
    svc = _service(lock_engine)
    await _seat_turn(lock_engine, "turn-2", started_at_ms=4_000_000_000_000)

    result = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=_SESSION,
            force=True,
            data={"inputs": {"messages": [{"role": "user", "content": "again"}]}},
        ),
    )

    assert result.mode == CommandMode.steer
    assert await is_turn_superseded(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-2"
    )
