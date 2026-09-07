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


@pytest.mark.asyncio
async def test_new_turn_on_a_previously_run_session_is_current(lock_engine):
    """The row records the LATEST turn, so a fresh turn always finds a different turn_id on
    it. That alone must not read as a takeover: after the previous turn ended and its alive
    lock lapsed, the new turn is simply establishing the nest — exactly the state a brand-new
    turn is in. Only a lock still held by another turn (the failed nx acquire) means takeover.
    """
    svc = _service(lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-1"))
    await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-1", running=False)
    )
    # The previous turn's alive lock lapses (TTL) / is cleared before the next turn starts.
    await force_cancel_alive(lock_engine, project_id=str(_PROJECT), session_id=_SESSION)

    fresh = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-2")
    )

    assert fresh.is_current_turn is True, (
        "a new turn must not be aborted just because the row still named the old one"
    )


@pytest.mark.asyncio
async def test_second_turn_on_a_RUNNING_session_is_refused(lock_engine):
    """Single-turn admission (#6417, #5539, #5538): the answer the runner's edge now acts on.

    A second user message on a session with a turn in flight reaches the runner as its own turn.
    Its FIRST beat is the admission request, and this is what must come back: `is_current_turn`
    False, with the running turn's locks untouched. The API already answered this correctly; the
    runner used to read it only as "abort later", walk into the keepalive pool, and destroy the
    running turn's environment on the way. It now stops at the edge, so this answer is the whole
    gate and it needs its own test.
    """
    svc = _service(lock_engine)

    # turn-1 is live: it holds both `alive` and `running`.
    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-1"))

    # The second message arrives on the SAME replica as its own turn. Nothing cancelled turn-1,
    # so `running` still names it — the discriminator that separates this from a handover.
    second = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-2")
    )

    assert second.is_current_turn is False, (
        "a turn that arrives while a DIFFERENT turn holds `running` must be refused"
    )
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-1"
    ), "the refused turn must not take the running turn's alive lock"

    # And the live turn's own next beat is unaffected: it was never displaced.
    still_live = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-1")
    )
    assert still_live.is_current_turn is True


@pytest.mark.asyncio
async def test_a_refused_turns_end_beat_cannot_clear_the_live_turns_running(
    lock_engine,
):
    """The refused turn's watchdog release sends `is_running: false`. That beat must be inert.

    The runner stops a refused turn by releasing its watchdog, which sends one end beat under the
    REFUSED turn's id. Releasing `running` on behalf of whoever holds it would end the live turn
    from under itself, which is the failure this whole slice exists to remove. The release is
    owner-scoped, so it is a no-op here.
    """
    svc = _service(lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-1"))
    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-2"))

    # The refused turn's end beat.
    await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-2", running=False)
    )

    live = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-1")
    )
    assert live.is_current_turn is True, (
        "the refused turn's end beat released the LIVE turn's locks"
    )
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-1"
    )


@pytest.mark.asyncio
async def test_a_resume_is_admitted_while_the_previous_turn_is_PARKED(lock_engine):
    """The case a naive "is anything alive?" gate gets wrong, and the reason `running` exists.

    A turn parked awaiting approval still holds `alive` — that is what makes the session
    reattachable — but its turn-end beat released `running`. The approval resume arrives as a NEW
    turn and must be admitted, or every approval in the product stops resuming. `alive` alone
    cannot tell this apart from the refusal case above; the absent `running` owner is what does.
    """
    svc = _service(lock_engine)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-1"))
    # Park: the turn ends its execution but the session stays alive.
    await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-1", running=False)
    )

    resume = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-2")
    )

    assert resume.is_current_turn is True, (
        "an approval resume must be admitted while the previous turn is parked, not running"
    )
    assert (
        await get_alive_owner(
            lock_engine, project_id=str(_PROJECT), session_id=_SESSION
        )
        == "turn-2"
    ), "the resume takes the nest as a legitimate handover"
