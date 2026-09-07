"""The shutdown beat: a departing runner hands its `owner:session:<id>` affinity key back.

`claim_owner` never steals, and nothing released the key, so a replica that exited while
holding claims locked each of those sessions out of its replacement for the rest of
OWNER_TTL_SECONDS. On the local sandbox provider that is a two-minute outage after every
runner restart, because the replacement refuses to cold-start a session it does not own.

`release_owner` is deliberately narrow, and these tests pin exactly how narrow: it releases
only while the caller still owns the session, it touches no turn lock and no stream row, and a
beat from a replica that lost the session is a no-op rather than a takeover in reverse.
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
_SESSION = "session_shutdown"


class _FakeDAO:
    """Records every write, so a test can assert the release beat wrote nothing."""

    def __init__(self, existing: Optional[SessionStream] = None):
        self.row = existing
        self.creates = 0
        self.updates = 0

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.creates += 1
        self.row = SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            flags=stream.flags,
        )
        return self.row

    async def update(self, *, project_id, user_id, session_id, stream):
        self.updates += 1
        self.row = SessionStream(
            id=self.row.id if self.row else uuid4(),
            project_id=project_id,
            session_id=session_id,
            flags=stream.flags,
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


def _service(lock_engine, dao):
    return SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)


def _beat(replica: str, turn: str, running: bool = True) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=_SESSION, replica_id=replica, turn_id=turn, is_running=running
    )


def _shutdown_beat(replica: str) -> SessionHeartbeatRequest:
    """What the runner sends per owned session as it exits: no turn, no liveness."""
    return SessionHeartbeatRequest(
        session_id=_SESSION, replica_id=replica, release_owner=True
    )


@pytest.mark.asyncio
async def test_owner_release_drops_the_affinity_key(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))
    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "replica-a"
    )

    await svc.heartbeat(project_id=_PROJECT, request=_shutdown_beat("replica-a"))

    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) is None, (
        "the departing replica still owns the session"
    )


@pytest.mark.asyncio
async def test_the_next_replica_can_claim_the_session_at_once(lock_engine):
    """The whole point: no waiting out OWNER_TTL_SECONDS after a restart."""
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))
    await svc.heartbeat(project_id=_PROJECT, request=_shutdown_beat("replica-a"))

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-b", "turn-b")
    )

    assert result.replica_id == "replica-b"
    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "replica-b"
    )


@pytest.mark.asyncio
async def test_release_touches_no_turn_lock_and_no_row(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))
    writes_before = dao.creates + dao.updates

    await svc.heartbeat(project_id=_PROJECT, request=_shutdown_beat("replica-a"))

    assert await get_alive_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "turn-a"
    ), "the release beat cleared the alive lock"
    assert await get_running_owner(
        lock_engine, project_id=pid, session_id=_SESSION
    ) == ("turn-a"), "the release beat cleared the running lock"
    assert dao.creates + dao.updates == writes_before, (
        "the release beat stamped the stream row"
    )


@pytest.mark.asyncio
async def test_a_replica_that_lost_the_session_releases_nothing(lock_engine):
    """Release-if-owner: a stale runner must not free a session a live one now holds."""
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_shutdown_beat("replica-b")
    )

    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "replica-a"
    ), "replica B released a session it never owned"
    assert result.replica_id == "replica-a", "the loser must learn the true owner"


@pytest.mark.asyncio
async def test_release_is_idempotent(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))
    await svc.heartbeat(project_id=_PROJECT, request=_shutdown_beat("replica-a"))
    result = await svc.heartbeat(
        project_id=_PROJECT, request=_shutdown_beat("replica-a")
    )

    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) is None
    assert result.replica_id == "replica-a", "an unowned session reports the caller"
    assert result.is_current_turn is False, "a release beat refreshes no turn"


@pytest.mark.asyncio
async def test_release_of_a_session_nobody_owns_is_harmless(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_shutdown_beat("replica-a")
    )

    assert result.stream is None
    assert dao.creates + dao.updates == 0


@pytest.mark.asyncio
async def test_an_ordinary_beat_still_claims(lock_engine):
    """The default must not change: `release_owner` is False unless a caller asks for it."""
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    assert _beat("replica-a", "turn-a").release_owner is False
    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))

    assert await get_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "replica-a"
    )
