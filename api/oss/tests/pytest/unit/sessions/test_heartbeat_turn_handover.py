"""A second turn on a WARM session is a handover, not a takeover.

`alive` outlives the turn that took it — `release_alive` has no callers and the turn-end beat
clears only `running` — and the runner mints a fresh uuid turn id for every message. So the
FIRST beat of turn 2 (and 3, and 4...) always finds turn 1's `alive` key still there and its
nx acquire always fails. Treating that failed acquire as the takeover signal reported
`is_current_turn: false` to a turn that nothing had interrupted, and the runner's watchdog
(`services/runner/src/sessions/alive.ts` -> `onInterrupted` -> `controller.abort()`) aborted
every follow-up turn before it emitted a token, for the whole ~5-minute window before the
orphan sweep cleared the stale key.

`running` is the discriminator: a real takeover (steer / `_start_turn`) holds it under the
usurper's turn id, whereas a session that is merely warm holds no `running` at all. These
tests pin the four states the failed-acquire branch has to tell apart.
"""

from typing import Optional
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.locks import (
    acquire_alive,
    get_alive_owner,
    get_running_owner,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_warm_handover"


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


@pytest.mark.asyncio
async def test_second_turn_on_a_warm_session_is_current(lock_engine):
    """The bug that shipped: turn 2's first beat, with turn 1's `alive` still in place."""
    svc = _service(lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    # Turn end: `release()` beats once with is_running=false. It clears ONLY `running` —
    # `alive` is what keeps the session warm/reattachable, so it survives by design.
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1", running=False))
    assert await _alive(lock_engine) == "turn-1"
    assert await _running(lock_engine) is None

    second = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-2"))

    assert second.is_current_turn is True, (
        "turn 2 was aborted before its first token: a stale `alive` from this session's own "
        "previous turn is a handover, not a takeover"
    )
    assert await _alive(lock_engine) == "turn-2", (
        "the handover must actually transfer the lock, or turn 2 never owns the nest"
    )
    assert await _running(lock_engine) == "turn-2"


@pytest.mark.asyncio
async def test_a_live_different_turn_holding_running_is_still_a_takeover(lock_engine):
    """The signal `is_current_turn` exists for: another turn owns the session RIGHT NOW."""
    svc = _service(lock_engine)

    # turn-2 nests first and stays running (both locks held under its id).
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-2"))
    assert await _alive(lock_engine) == "turn-2"
    assert await _running(lock_engine) == "turn-2"

    # turn-1's watchdog beat, still in flight on the runner, must learn it lost the session.
    old_turn = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    assert old_turn.is_current_turn is False
    assert await _alive(lock_engine) == "turn-2", (
        "a superseded turn must not force-cancel the live turn's alive lock"
    )
    assert await _running(lock_engine) == "turn-2", (
        "`acquire_running` overwrites, so a beat that was just told it is not the current "
        "turn must not stamp its dead id over the live turn's — that key is what the "
        "takeover check reads, and clobbering it makes the LIVE turn look superseded"
    )

    # And the live turn keeps running: the discriminator survived the zombie's beat.
    live = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-2"))
    assert live.is_current_turn is True


@pytest.mark.asyncio
async def test_overlapping_beats_of_the_same_turn_stay_current(lock_engine):
    """Self-race: two beats of ONE turn overlap, so the second sees its own id on `alive`
    between its refresh (which read the key as absent/foreign) and its acquire. Same-turn
    ownership is not a takeover, and it must not force-cancel a lock we already hold.
    """
    svc = _service(lock_engine)

    # `_start_turn` (or this turn's own in-flight first beat) already nested turn-1.
    await acquire_alive(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id="turn-1"
    )

    # refresh_alive returning False while the key holds OUR id is exactly the interleaving:
    # the GET raced the concurrent beat's write.
    with patch(
        "oss.src.core.sessions.streams.service.refresh_alive",
        new=AsyncMock(return_value=False),
    ):
        result = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    assert result.is_current_turn is True
    assert await _alive(lock_engine) == "turn-1"


@pytest.mark.asyncio
async def test_resume_after_a_parked_turn_is_current(lock_engine):
    """A turn parked awaiting approval ends its run (so `running` clears) but keeps the
    sandbox — and the `alive` key — warm for the approval TTL. The resume mints a NEW turn id,
    whose first beat therefore finds the parked turn's `alive` still held.
    """
    svc = _service(lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-parked"))
    # Park: the run returns, `release()` beats is_running=false, the runner stops beating.
    await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-parked", running=False)
    )
    assert await _alive(lock_engine) == "turn-parked"

    resumed = await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-resume"))

    assert resumed.is_current_turn is True, (
        "an approval resume must not be aborted by the parked turn's own alive key"
    )
    assert await _running(lock_engine) == "turn-resume", (
        "the resumed turn must own `running` — it is the takeover discriminator for the "
        "next turn, and the mirror the watch relay reads"
    )
    assert await _alive(lock_engine) == "turn-resume"
    assert resumed.stream is not None
    assert resumed.stream.turn_id == "turn-resume"
    assert resumed.stream.flags.is_running is True
