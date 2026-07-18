"""WP7 (W7.4): the control signal from cancel/steer/kill must reach the runner's heartbeat.

Before this, `heartbeat()`'s acquire-then-refresh fallback silently re-acquired a lost alive
lock under the SAME turn_id (nx=True is a no-op only when the key is gone) — a cancel/steer/
kill that raced a heartbeat was invisible to the runner: the beat still looked like a normal
`ok` heartbeat. `is_current_turn` on `SessionHeartbeatResult` surfaces the interruption so the
runner's watchdog can abort the in-flight run (`services/runner/src/sessions/alive.ts`'s
`onInterrupted`).

Covers:
  - a normal heartbeat sequence (no interruption) reports is_current_turn=True throughout;
  - a cancel between two heartbeats of the SAME turn_id flips the next beat's
    is_current_turn to False (the lock was gone, then silently re-acquired);
  - a steer (different turn_id takes the lock) also reports the OLD turn's next beat as
    is_current_turn=False, and does not steal the lock back for the old turn;
  - a replica that lost the owner claim entirely reports is_current_turn=False.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.locks import force_cancel_alive, get_alive_owner

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_interrupt"


class _FakeStreamsDAO:
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


def _beat(replica: str, turn: str, running: bool = True) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=_SESSION, replica_id=replica, turn_id=turn, is_running=running
    )


@pytest.mark.asyncio
async def test_uninterrupted_heartbeats_stay_current(lock_engine):
    svc = _service(lock_engine)

    r1 = await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-1"))
    r2 = await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-1"))

    assert r1.is_current_turn is True
    assert r2.is_current_turn is True


@pytest.mark.asyncio
async def test_cancel_between_beats_flips_next_beat_to_not_current(lock_engine):
    svc = _service(lock_engine)

    first = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-1")
    )
    assert first.is_current_turn is True

    # A cancel/kill force-clears the alive lock out from under the still-running turn.
    await force_cancel_alive(lock_engine, project_id=str(_PROJECT), session_id=_SESSION)

    second = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-1")
    )

    assert second.is_current_turn is False, (
        "a beat after the lock was force-cancelled must report the interruption, even "
        "though the nx=True re-acquire silently re-establishes the SAME lock"
    )
    # The re-acquire still happens (the session stays alive/reattachable) — only the
    # bookkeeping bit changes.
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-1"
    )


@pytest.mark.asyncio
async def test_steer_flips_the_old_turns_next_beat_to_not_current(lock_engine):
    svc = _service(lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-1"))

    # Simulate a steer: a new turn steals the alive/running locks (force_cancel + a fresh
    # acquire under turn-2), mirroring what command()'s steer branch does.
    await force_cancel_alive(lock_engine, project_id=str(_PROJECT), session_id=_SESSION)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-2"))

    # The OLD turn's own heartbeat (still in flight on the runner) must see the takeover.
    old_turn_beat = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-1")
    )

    assert old_turn_beat.is_current_turn is False
    # And it must NOT have stolen the lock back for turn-1 (nx=True fails because turn-2
    # already holds it) — the new turn keeps the lock.
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-2"
    )


@pytest.mark.asyncio
async def test_losing_owner_claim_reports_not_current(lock_engine):
    svc = _service(lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-1"))

    # A second replica heartbeats the same session; claim_owner never steals, so it loses.
    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-b", "turn-2")
    )

    assert result.is_current_turn is False
    assert result.replica_id == "replica-a"
