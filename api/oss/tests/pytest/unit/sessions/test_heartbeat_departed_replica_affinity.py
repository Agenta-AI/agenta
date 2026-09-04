"""A runner that dies ungracefully must not lock its sessions out for the owner lease.

Live failure this pins (matrix run 3, cell `runner-gone-late`, harness codex, session
2fdf43f0-c728-42e5-987e-2371501fe748): a Stop settled, the runner reported the outcome, and
the runner was then killed with no grace period. Nothing released `owner:session:<id>`, so it
stayed pointing at the dead replica for the rest of OWNER_TTL_SECONDS. The replacement replica
picked up the user's next message 6 s later, its first heartbeat lost the non-stealing
`claim_owner`, the API answered `is_current_turn: false`, and the runner turned that into
"This session is already running a turn" although no turn was running anywhere.

`running` is what tells a serving replica from a departed one, so these tests drive both
sides of it:

  - no running turn -> the new replica takes affinity and its first beat is current;
  - a different turn holding `running` -> the claim is honoured and the newcomer is refused;
  - the caller's OWN turn holding `running` (the `_start_turn` path) -> reclaim allowed;
  - a turn-end beat never reclaims;
  - the reclaim survives the alive lock the dead turn left behind (the whole point: the next
    message has to actually run).
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
from oss.src.dbs.redis.sessions.locks import (
    get_alive_owner,
    get_owner,
    get_running_owner,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_departed_replica"

_DEAD = "replica-that-was-killed"
_FRESH = "replica-that-replaced-it"


class _FakeDAO:
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
    return SessionStreamsService(streams_dao=dao or _FakeDAO(), lock_engine=lock_engine)


def _beat(replica: str, turn: Optional[str], running: bool = True):
    return SessionHeartbeatRequest(
        session_id=_SESSION, replica_id=replica, turn_id=turn, is_running=running
    )


async def _replay_the_killed_runner(svc):
    """The exact state the live failure left: a turn that ran, was stopped, reported
    `is_running: false`, and whose replica then died without releasing affinity."""
    await svc.heartbeat(project_id=_PROJECT, request=_beat(_DEAD, "turn-stopped"))
    await svc.heartbeat(
        project_id=_PROJECT, request=_beat(_DEAD, "turn-stopped", running=False)
    )


@pytest.mark.asyncio
async def test_next_turn_is_admitted_after_the_owning_runner_is_killed(lock_engine):
    svc = _service(lock_engine)
    pid = str(_PROJECT)
    await _replay_the_killed_runner(svc)

    # Preconditions: affinity still names the dead replica, nothing is running, and the dead
    # turn's `alive` lock outlives it by design.
    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == _DEAD
    assert (
        await get_running_owner(lock_engine, project_id=pid, session_id=_SESSION)
    ) is None
    assert await get_alive_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "turn-stopped"
    )

    recovery = await svc.heartbeat(
        project_id=_PROJECT, request=_beat(_FRESH, "turn-recovery")
    )

    assert recovery.is_current_turn is True, (
        "the replacement replica was refused, so the user's next message is rejected as "
        "'this session is already running a turn' for the rest of the owner lease"
    )
    assert recovery.replica_id == _FRESH
    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == _FRESH


@pytest.mark.asyncio
async def test_recovery_turn_takes_the_nest_the_dead_turn_left(lock_engine):
    """Admission is not enough: the recovery turn must end up owning alive and running, or
    the next beat sees a foreign nest and aborts the turn it just started."""
    svc = _service(lock_engine)
    pid = str(_PROJECT)
    await _replay_the_killed_runner(svc)

    await svc.heartbeat(project_id=_PROJECT, request=_beat(_FRESH, "turn-recovery"))

    assert await get_alive_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "turn-recovery"
    )
    assert await get_running_owner(
        lock_engine, project_id=pid, session_id=_SESSION
    ) == ("turn-recovery")

    second = await svc.heartbeat(
        project_id=_PROJECT, request=_beat(_FRESH, "turn-recovery")
    )
    assert second.is_current_turn is True


@pytest.mark.asyncio
async def test_a_live_turn_on_another_replica_still_refuses_the_newcomer(lock_engine):
    """The guard this reclaim relaxes must still hold where it matters: a replica running a
    turn keeps its session, and a second replica's turn is refused rather than admitted
    alongside it."""
    svc = _service(lock_engine)
    pid = str(_PROJECT)

    await svc.heartbeat(project_id=_PROJECT, request=_beat(_DEAD, "turn-live"))

    intruder = await svc.heartbeat(
        project_id=_PROJECT, request=_beat(_FRESH, "turn-intruder")
    )

    assert intruder.is_current_turn is False
    assert intruder.replica_id == _DEAD
    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == _DEAD
    assert await get_alive_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "turn-live"
    )
    assert await get_running_owner(
        lock_engine, project_id=pid, session_id=_SESSION
    ) == ("turn-live")


@pytest.mark.asyncio
async def test_a_turn_that_already_holds_running_may_reclaim(lock_engine):
    """`_start_turn` arms alive and running before the runner beats at all, so an API-minted
    turn reaches the heartbeat with its own `running` lock already held. That must not read as
    'another turn is live here'."""
    from oss.src.dbs.redis.sessions.locks import acquire_alive, acquire_running

    svc = _service(lock_engine)
    pid = str(_PROJECT)
    await _replay_the_killed_runner(svc)
    # The API starts the recovery turn itself, then the replacement replica beats for it.
    from oss.src.dbs.redis.sessions.locks import force_cancel_alive

    await force_cancel_alive(lock_engine, project_id=pid, session_id=_SESSION)
    await acquire_alive(
        lock_engine, project_id=pid, session_id=_SESSION, turn_id="turn-api-minted"
    )
    await acquire_running(
        lock_engine, project_id=pid, session_id=_SESSION, turn_id="turn-api-minted"
    )

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat(_FRESH, "turn-api-minted")
    )

    assert result.is_current_turn is True
    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == _FRESH


@pytest.mark.asyncio
async def test_a_turn_end_beat_never_reclaims_affinity(lock_engine):
    """A beat that reports a turn ENDING asserts nothing about who should serve the session
    next, so it must leave affinity alone."""
    svc = _service(lock_engine)
    pid = str(_PROJECT)
    await _replay_the_killed_runner(svc)

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat(_FRESH, "turn-recovery", running=False)
    )

    assert result.is_current_turn is False
    assert result.replica_id == _DEAD
    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == _DEAD


@pytest.mark.asyncio
async def test_a_beat_with_no_turn_never_reclaims_affinity(lock_engine):
    """The ownership-probe beat carries no turn id. It reads affinity; it may not move it."""
    svc = _service(lock_engine)
    pid = str(_PROJECT)
    await _replay_the_killed_runner(svc)

    result = await svc.heartbeat(project_id=_PROJECT, request=_beat(_FRESH, None))

    assert result.replica_id == _DEAD
    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == _DEAD
