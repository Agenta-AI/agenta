"""A refused turn's final beat leaves the stream row on the turn that holds the session.

A runner whose admission beat is refused still sends the final `is_running: false` beat when it
releases its watchdog. That beat's turn never held `running`, so its release changes no lock.
It must not change the row's `turn_id` either: `GET /sessions/streams/` routes the next
follow-up to the pod bound to that turn, and the live turn's next beat reads it to decide
whether its own locks were established.

The contender is either another pod (a message that fell back to the Service URL) or the same
pod (a double send). Its final beat lands either while the live turn still runs or after the
live turn ended.
"""

from types import SimpleNamespace
from typing import Optional
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.apis.fastapi.sessions import router as router_module
from oss.src.apis.fastapi.sessions.router import SessionStreamsRouter
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
)
from oss.src.core.sessions.streams.service import (
    WATCH_LIFECYCLE_ENDED,
    WATCH_LIFECYCLE_RUNNING,
    SessionStreamsService,
)
from oss.src.dbs.redis.sessions.locks import (
    clear_running,
    get_alive_owner,
    get_running_owner,
)
from oss.src.utils.env import env

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = UUID("00000000-0000-0000-0000-0000000000cc")
_USER = UUID("00000000-0000-0000-0000-0000000000dd")
_SESSION = "session_refused_final_beat"
_PID = str(_PROJECT)
_TOKEN = "runner-secret"

_POD_A = "agenta-runner-6f9c7d5b8-aaaaa"
_POD_B = "agenta-runner-6f9c7d5b8-bbbbb"
_ADDRESS_A = "http://10.8.2.17:8765"
_ADDRESS_B = "http://10.8.2.18:8765"

_LIVE = "turn-live"
_REFUSED = "turn-refused"


class _FakeDAO:
    """Honours the `expected_turn_id` fence the way the Postgres update does: the write lands
    only while the row still carries that turn and still says it is alive and running."""

    def __init__(self):
        self.row: Optional[SessionStream] = None
        self.fences: list = []

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
        self.fences.append(stream.expected_turn_id)
        prior = self.row
        if stream.expected_turn_id is not None and (
            prior is None
            or prior.turn_id != stream.expected_turn_id
            or not (prior.flags and prior.flags.is_alive and prior.flags.is_running)
        ):
            return None
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

    async def fill_missing(self, **_):
        return None

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


@pytest.fixture(autouse=True)
def _allowed(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(env.runner, "token", _TOKEN)


class _Harness:
    def __init__(self, lock_engine):
        self.lock = lock_engine
        self.dao = _FakeDAO()
        self.service = SessionStreamsService(
            streams_dao=self.dao, lock_engine=lock_engine
        )
        self.router = SessionStreamsRouter(
            service=self.service, interactions_service=None
        )
        self.lifecycle = AsyncMock()

    async def beat(self, replica, address, turn, *, running=True):
        with patch.object(self.service, "_publish_lifecycle", self.lifecycle):
            return await self.service.heartbeat(
                project_id=_PROJECT,
                request=SessionHeartbeatRequest(
                    session_id=_SESSION,
                    replica_id=replica,
                    replica_address=address,
                    turn_id=turn,
                    is_running=running,
                ),
                runner_verified=True,
            )

    async def read(self):
        """The streams read the services layer makes before it posts a follow-up."""
        return await self.router.fetch_session_stream(
            SimpleNamespace(
                state=SimpleNamespace(project_id=_PROJECT, user_id=_USER),
                headers={"X-Agenta-Runner-Token": _TOKEN},
            ),
            session_id=_SESSION,
        )

    async def nest(self):
        alive = await get_alive_owner(self.lock, project_id=_PID, session_id=_SESSION)
        running = await get_running_owner(
            self.lock, project_id=_PID, session_id=_SESSION
        )
        return alive, running

    def published(self, state):
        return [
            call
            for call in self.lifecycle.await_args_list
            if call.kwargs.get("state") == state
        ]


_CONTENDERS = pytest.mark.parametrize(
    "contender",
    [(_POD_B, _ADDRESS_B), (_POD_A, _ADDRESS_A)],
    ids=["other-pod", "same-pod"],
)


async def _live_turn_then_refused_contender(h: _Harness, contender):
    live = await h.beat(_POD_A, _ADDRESS_A, _LIVE)
    refused = await h.beat(*contender, _REFUSED)
    assert live.is_current_turn is True
    assert refused.is_current_turn is False
    assert h.dao.row.turn_id == _LIVE


@pytest.mark.asyncio
@_CONTENDERS
async def test_a_refused_final_beat_while_the_live_turn_runs_changes_nothing(
    lock_engine, contender
):
    h = _Harness(lock_engine)
    await _live_turn_then_refused_contender(h, contender)

    refused_end = await h.beat(*contender, _REFUSED, running=False)

    assert h.dao.row.turn_id == _LIVE, "the refused turn stamped its id on the row"
    assert refused_end.is_current_turn is False
    assert await h.nest() == (_LIVE, _LIVE)
    assert not h.published(WATCH_LIFECYCLE_ENDED)
    read = await h.read()
    assert (read.runner_replica_id, read.runner_address) == (_POD_A, _ADDRESS_A)

    # The live turn's next beat still sees its own turn on the row: it takes the fenced write
    # and does not announce `running` a second time.
    h.dao.fences.clear()
    running_before = len(h.published(WATCH_LIFECYCLE_RUNNING))
    next_beat = await h.beat(_POD_A, _ADDRESS_A, _LIVE)

    assert next_beat.is_current_turn is True
    assert h.dao.fences == [_LIVE]
    assert len(h.published(WATCH_LIFECYCLE_RUNNING)) == running_before

    live_end = await h.beat(_POD_A, _ADDRESS_A, _LIVE, running=False)

    assert live_end.is_current_turn is True
    assert await h.nest() == (_LIVE, None)
    assert h.dao.row.turn_id == _LIVE
    read = await h.read()
    assert (read.runner_replica_id, read.runner_address) == (_POD_A, _ADDRESS_A)


@pytest.mark.asyncio
@_CONTENDERS
async def test_a_refused_final_beat_after_the_live_turn_ended_changes_nothing(
    lock_engine, contender
):
    h = _Harness(lock_engine)
    await _live_turn_then_refused_contender(h, contender)
    live_end = await h.beat(_POD_A, _ADDRESS_A, _LIVE, running=False)
    assert live_end.is_current_turn is True
    assert await h.nest() == (_LIVE, None)

    refused_end = await h.beat(*contender, _REFUSED, running=False)

    assert h.dao.row.turn_id == _LIVE, "the refused turn stamped its id on the row"
    assert refused_end.is_current_turn is False
    assert await h.nest() == (_LIVE, None)
    assert len(h.published(WATCH_LIFECYCLE_ENDED)) == 1
    read = await h.read()
    assert (read.runner_replica_id, read.runner_address) == (_POD_A, _ADDRESS_A), (
        "the next follow-up would go to a pod that holds no warm session"
    )


@pytest.mark.asyncio
async def test_a_repeated_final_beat_of_an_ended_turn_keeps_the_row(lock_engine):
    """A final beat whose `running` is already gone (a retried release) has nothing left to
    stamp: the turn's running beats already put its id on the row."""
    h = _Harness(lock_engine)
    await h.beat(_POD_A, _ADDRESS_A, _LIVE)
    await h.beat(_POD_A, _ADDRESS_A, _LIVE, running=False)

    again = await h.beat(_POD_A, _ADDRESS_A, _LIVE, running=False)

    assert again.is_current_turn is False
    assert h.dao.row.turn_id == _LIVE
    assert await h.nest() == (_LIVE, None)
    assert len(h.published(WATCH_LIFECYCLE_ENDED)) == 1
    read = await h.read()
    assert (read.runner_replica_id, read.runner_address) == (_POD_A, _ADDRESS_A)


@pytest.mark.asyncio
async def test_a_final_beat_after_running_expired_still_mirrors_the_row(lock_engine):
    """A turn whose `running` lapsed releases nothing, yet its final beat must still write the
    row: the fenced write clears `is_running` and refreshes `updated_at`, which the orphan
    sweep reads, and keeps the turn's id for the next follow-up."""
    h = _Harness(lock_engine)
    await h.beat(_POD_A, _ADDRESS_A, _LIVE)
    await clear_running(lock_engine, project_id=_PID, session_id=_SESSION)
    h.dao.fences.clear()

    end = await h.beat(_POD_A, _ADDRESS_A, _LIVE, running=False)

    assert end.is_current_turn is False
    assert h.dao.fences == [_LIVE]
    assert h.dao.row.turn_id == _LIVE
    assert h.dao.row.flags.is_running is False
    assert await h.nest() == (_LIVE, None)
    read = await h.read()
    assert (read.runner_replica_id, read.runner_address) == (_POD_A, _ADDRESS_A)
