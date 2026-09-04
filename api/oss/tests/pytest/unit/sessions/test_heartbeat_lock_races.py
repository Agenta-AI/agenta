"""Interleavings between a heartbeat and the edits that displace it.

`test_heartbeat_parked_zombie.py` pins the case where the tombstone has already been
written. These are the narrower windows around it: a beat that is not current but is not
(yet) tombstoned, and the read-then-write gaps inside the displacement paths themselves.
Each one is a state the locks alone cannot distinguish, so each is pinned by a test rather
than by a comment.
"""

from typing import Optional
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStreamCommandRequest,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.locks import (
    force_clear_owner,
    get_alive_owner,
    get_owner,
    get_running_owner,
    is_turn_superseded,
)

from unit.sessions.test_heartbeat_parked_zombie import _FakeStreamsDAO
from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "session_lock_races"


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


def _beat(
    turn: str, *, running: bool = True, replica: str = "replica-a"
) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=_SESSION, replica_id=replica, turn_id=turn, is_running=running
    )


def _cancel() -> SessionStreamCommandRequest:
    return SessionStreamCommandRequest(session_id=_SESSION)


async def _alive(lock_engine) -> Optional[str]:
    return await get_alive_owner(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION
    )


async def _running(lock_engine) -> Optional[str]:
    return await get_running_owner(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION
    )


async def _owner(lock_engine) -> Optional[str]:
    return await get_owner(lock_engine, project_id=str(_PROJECT), session_id=_SESSION)


async def _superseded(lock_engine, turn: str) -> bool:
    return await is_turn_superseded(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id=turn
    )


# --------------------------------------------------------------------------- #
# Replica affinity
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_dead_turns_beat_does_not_reclaim_replica_affinity(lock_engine):
    """`claim_owner` never steals, so an owner key that keeps getting renewed locks the
    session out of every other replica for as long as the renewals continue. A tombstoned
    turn's beat must read affinity, not claim it — otherwise a killed session's trailing
    beats pin it to the replica that no longer runs anything."""
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-a"))
    assert await _owner(lock_engine) == "replica-a"

    await svc.command(project_id=_PROJECT, user_id=_USER, request=_cancel())
    assert await _superseded(lock_engine, "turn-a") is True
    # What kill does to affinity, so another replica can take the session over.
    await force_clear_owner(lock_engine, project_id=str(_PROJECT), session_id=_SESSION)

    late = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-a"))

    assert late.is_current_turn is False
    assert await _owner(lock_engine) is None, (
        "a dead turn's beat re-pinned the session to its replica for a full OWNER_TTL"
    )
    assert late.replica_id == "replica-a", (
        "the caller still needs an owner back; reporting the beat's own replica is fine "
        "because is_current_turn=False already tells it to stop"
    )


# --------------------------------------------------------------------------- #
# The handover's read-then-delete
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_handover_will_not_evict_a_turn_that_took_the_lock_mid_read(lock_engine):
    """The handover branch reads the `alive` owner, then clears it. A real `_start_turn` can
    land in that gap. Clearing unconditionally would delete the incoming turn's lock and
    tombstone it — killing a turn that had just legitimately taken the session."""
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    # A parked holder: alive=turn-live, running cleared.
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-live"))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-live", running=False))
    assert await _alive(lock_engine) == "turn-live"
    assert await _running(lock_engine) is None

    # turn-new reads a value that is already stale by the time it writes.
    with patch(
        "oss.src.core.sessions.streams.service.get_alive_owner",
        new=AsyncMock(return_value="turn-ghost"),
    ):
        result = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-new"))

    assert await _alive(lock_engine) == "turn-live", (
        "the handover evicted the holder on the strength of a stale read"
    )
    assert await _superseded(lock_engine, "turn-live") is False, (
        "worse than the eviction: the holder was tombstoned, so it can never beat back in"
    )
    assert result.is_current_turn is False, (
        "losing the race is not an error — it just means this turn is not current"
    )


# --------------------------------------------------------------------------- #
# Displacement ordering
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_cancel_atomically_tombstones_and_clears_the_locks(lock_engine):
    """The displaced turn cannot re-arm the session after the atomic operation returns."""
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-a"))
    assert await _alive(lock_engine) == "turn-a"
    redis = lock_engine._client()
    original_eval = redis.eval

    async def _beat_after_atomic_displacement(script, numkeys, *keys_and_args):
        result = await original_eval(script, numkeys, *keys_and_args)
        if "AGENTA_DISPLACE_TURNS" in script:
            late = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-a"))
            assert late.is_current_turn is False
        return result

    with patch.object(redis, "eval", new=_beat_after_atomic_displacement):
        await svc.command(project_id=_PROJECT, user_id=_USER, request=_cancel())

    assert await _alive(lock_engine) is None, (
        "the cancelled turn's own beat re-armed `alive`; the session stays 'alive' until "
        "the TTL expires and a follow-up send 409s"
    )
    assert await _running(lock_engine) is None
    assert await _superseded(lock_engine, "turn-a") is True
