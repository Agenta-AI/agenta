"""A turn ending must clear only ITS OWN `running` lock.

The arming half of the heartbeat already refuses a turn that no longer owns the session
(`test_heartbeat_parked_zombie.py`): `acquire_running` overwrites, so a superseded turn's beat
would stamp its dead id over the live turn's.

The clearing half had the mirror hole. `clear_running` deletes unconditionally, so a stale
turn's final `is_running=False` beat deleted whatever id was there — including a LIVE turn's —
and then published `lifecycle: ended` underneath it. Clients watching that session would see it
go idle while it was still running.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import SessionHeartbeatRequest, SessionStream
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.dbs.redis.sessions.locks import acquire_running, get_running_owner

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "session_stale_turn_end"


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


class _RecordingWatch:
    def __init__(self):
        self.lifecycle_states = []

    async def lifecycle(self, *, project_id, session_id, state):
        self.lifecycle_states.append(state)

    async def records_changed(self, **kwargs):
        return None


def _service(lock_engine, watch=None):
    return SessionStreamsService(
        streams_dao=_FakeStreamsDAO(),
        lock_engine=lock_engine,
        watch_publisher=watch,
    )


@pytest.mark.asyncio
async def test_stale_turn_end_does_not_clear_the_live_turns_running_lock(lock_engine):
    live_turn = str(uuid4())
    stale_turn = str(uuid4())

    await acquire_running(
        lock_engine,
        project_id=str(_PROJECT),
        session_id=_SESSION,
        turn_id=live_turn,
    )

    watch = _RecordingWatch()
    service = _service(lock_engine, watch)

    # The stale turn reports that IT has ended.
    await service.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=_SESSION,
            turn_id=stale_turn,
            is_running=False,
            replica_id="replica-1",
        ),
    )

    owner = await get_running_owner(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION
    )
    assert owner == live_turn, "a stale turn's end deleted the live turn's running lock"
    assert "ended" not in watch.lifecycle_states, (
        "a stale turn's end published `ended` for a session that is still running"
    )


@pytest.mark.asyncio
async def test_a_turn_still_clears_its_own_running_lock(lock_engine):
    turn = str(uuid4())
    await acquire_running(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION, turn_id=turn
    )

    watch = _RecordingWatch()
    service = _service(lock_engine, watch)

    await service.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=_SESSION,
            turn_id=turn,
            is_running=False,
            replica_id="replica-1",
        ),
    )

    owner = await get_running_owner(
        lock_engine, project_id=str(_PROJECT), session_id=_SESSION
    )
    assert owner is None
    assert watch.lifecycle_states == ["ended"]
