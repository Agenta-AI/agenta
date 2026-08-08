"""The parked-session lock ambiguity (approvals plan §6) and its close.

`alive` outlives its turn (`release_alive` has no callers; the turn-end beat clears only
`running`) and a turn parked awaiting approval also clears `running`. So the state
"`alive` held by a DIFFERENT turn + no `running`" is genuinely ambiguous between

  (a) a lapsed previous turn — the common case, which MUST be a legitimate handover or
      every follow-up turn on a warm session aborts (that shipped once as a Critical
      regression; `test_heartbeat_turn_handover.py` guards it), and
  (b) a live-but-parked holder.

We still resolve it as (a) — but a beat can only reach that branch if its turn has never
been displaced. Every displacement (handover, cancel, steer, kill, orphan sweep) tombstones
the turn it displaced, and a tombstoned turn's beats are refused before they touch a lock or
the row. A zombie is by definition a turn that already lost the nest, so the tombstone is
exactly the discriminator the locks alone cannot provide.

These tests pin both horns: the zombie must not take a parked session's nest, and the
legitimate handover/steer/resume paths must keep working.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from agenta.sdk.models.workflows import WorkflowServiceRequestData

from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamCommandRequest,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.locks import (
    get_alive_owner,
    get_running_owner,
    is_turn_superseded,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "session_parked_zombie"


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


def _beat(turn: str, *, running: bool = True) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=_SESSION, replica_id="replica-a", turn_id=turn, is_running=running
    )


async def _alive(lock_engine) -> Optional[str]:
    return await get_alive_owner(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION
    )


async def _running(lock_engine) -> Optional[str]:
    return await get_running_owner(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION
    )


async def _superseded(lock_engine, turn: str) -> bool:
    return await is_turn_superseded(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id=turn
    )


async def _park_a_session(svc, lock_engine) -> None:
    """Drive the session to: turn-old ran and was handed over to turn-live, which then
    parked awaiting approval (its run returned, so `release()` beat is_running=false)."""
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-old"))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-old", running=False))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-live"))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-live", running=False))
    assert await _alive(lock_engine) == "turn-live"
    assert await _running(lock_engine) is None


# --------------------------------------------------------------------------- #
# Horn (b): the zombie
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_handover_tombstones_the_turn_it_displaced(lock_engine):
    svc = _service(lock_engine)
    await _park_a_session(svc, lock_engine)

    assert await _superseded(lock_engine, "turn-old") is True
    assert await _superseded(lock_engine, "turn-live") is False, (
        "the turn that WON the handover must stay alive-eligible"
    )


@pytest.mark.asyncio
async def test_zombie_beat_cannot_take_the_nest_of_a_parked_session(lock_engine):
    """The gap, precisely: a late beat from an older turn used to find the parked holder's
    `alive` with no `running`, read that as a lapsed turn, and take the whole nest."""
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    await _park_a_session(svc, lock_engine)

    zombie = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-old"))

    assert zombie.is_current_turn is False, (
        "a turn that already lost the nest must be told it is not current"
    )
    assert await _alive(lock_engine) == "turn-live", (
        "the zombie took the parked session's alive lock — the approval resume then "
        "reports is_current_turn=false and aborts"
    )
    assert await _running(lock_engine) is None, (
        "the zombie must not arm `running`: that key is the takeover discriminator the "
        "resume reads, and stamping it makes the resume look superseded"
    )
    assert dao.row is not None and dao.row.turn_id == "turn-live", (
        "a refused beat must not stamp its dead turn id on the durable row"
    )


@pytest.mark.asyncio
async def test_approval_resume_survives_a_zombie_beat(lock_engine):
    """End to end: park, zombie beat, then the user approves and the resume turn starts."""
    svc = _service(lock_engine)
    await _park_a_session(svc, lock_engine)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-old"))

    resumed = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-resume"))

    assert resumed.is_current_turn is True, (
        "the approval resume must not be aborted — this is the user-visible failure"
    )
    assert await _alive(lock_engine) == "turn-resume"
    assert await _running(lock_engine) == "turn-resume"


@pytest.mark.asyncio
async def test_zombie_turn_end_beat_cannot_clear_the_live_turns_running(lock_engine):
    """`clear_running` is unconditional, so a superseded turn's own is_running=false beat
    used to end the LIVE turn's run. Refusing the beat before the branch fixes that too."""
    svc = _service(lock_engine)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-old"))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-old", running=False))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-live"))
    assert await _running(lock_engine) == "turn-live"

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-old", running=False))

    assert await _running(lock_engine) == "turn-live"
    assert await _alive(lock_engine) == "turn-live"


@pytest.mark.asyncio
async def test_repeated_zombie_beats_stay_refused(lock_engine):
    """The tombstone is refreshed on every hit, so a zombie that keeps beating for longer
    than the tombstone TTL never outlives its own death certificate."""
    svc = _service(lock_engine)
    await _park_a_session(svc, lock_engine)

    for _ in range(3):
        beat = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-old"))
        assert beat.is_current_turn is False
    assert await _alive(lock_engine) == "turn-live"


# --------------------------------------------------------------------------- #
# Horn (a): the common case must keep working (the Critical regression guard)
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_never_displaced_turn_still_takes_a_lapsed_nest(lock_engine):
    """The regression to fear: if a follow-up turn on a warm session stopped being able to
    take the previous turn's stale `alive`, every follow-up turn would abort."""
    svc = _service(lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1", running=False))

    second = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-2"))

    assert second.is_current_turn is True
    assert await _alive(lock_engine) == "turn-2"
    assert await _running(lock_engine) == "turn-2"


@pytest.mark.asyncio
async def test_a_live_different_turn_is_still_a_real_takeover(lock_engine):
    """The tombstone must not weaken the `running` discriminator: a turn superseded by a
    genuinely live one still learns it lost, without any tombstone being involved."""
    svc = _service(lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-2"))
    old = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    assert old.is_current_turn is False
    assert await _alive(lock_engine) == "turn-2"
    assert await _running(lock_engine) == "turn-2"


@pytest.mark.asyncio
async def test_two_overlapping_beats_of_one_turn_stay_current(lock_engine):
    """A turn is never tombstoned by its own beats, however they interleave."""
    svc = _service(lock_engine)

    first = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    second = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    third = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    assert (first.is_current_turn, second.is_current_turn, third.is_current_turn) == (
        True,
        True,
        True,
    )
    assert await _superseded(lock_engine, "turn-1") is False


# --------------------------------------------------------------------------- #
# The explicit control-plane displacements
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_cancel_tombstones_the_cancelled_turn(lock_engine):
    svc = _service(lock_engine)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=_SESSION, data=None, force=False
        ),
    )

    assert await _superseded(lock_engine, "turn-1") is True
    beat = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    assert beat.is_current_turn is False
    assert await _alive(lock_engine) is None, (
        "a cancelled turn's beat must not re-nest the session it was just cancelled out of"
    )


@pytest.mark.asyncio
async def test_steer_tombstones_the_displaced_turn_and_frees_the_new_one(lock_engine):
    svc = _service(lock_engine)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    steered = await svc.command(
        project_id=_PROJECT,
        user_id=_USER,
        request=SessionStreamCommandRequest(
            session_id=_SESSION,
            data=WorkflowServiceRequestData(inputs={"messages": ["steer"]}),
            force=True,
        ),
    )

    assert await _superseded(lock_engine, "turn-1") is True
    assert steered.turn_id is not None
    assert await _superseded(lock_engine, steered.turn_id) is False
    assert (
        await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    ).is_current_turn is False
    # The steered-in turn owns the nest and keeps it.
    assert await _alive(lock_engine) == steered.turn_id
    assert await _running(lock_engine) == steered.turn_id


@pytest.mark.asyncio
async def test_kill_tombstones_the_killed_turn(lock_engine):
    svc = _service(lock_engine)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    with patch(
        "oss.src.core.sessions.streams.service.kill_runner_sandbox",
        new=_noop_kill,
    ):
        await svc.kill(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert await _superseded(lock_engine, "turn-1") is True
    beat = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    assert beat.is_current_turn is False
    assert await _alive(lock_engine) is None


async def _noop_kill(*, project_id: str, session_id: str) -> None:
    return None
