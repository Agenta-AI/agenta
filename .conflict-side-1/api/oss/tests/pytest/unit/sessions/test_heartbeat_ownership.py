"""A heartbeat from a replica that lost the owner claim must not mutate anything.

`claim_owner` is non-stealing, so when a session owned by replica A is routed to replica B,
B's claim returns A. Before the fix `owner` was computed and never read: B went on to acquire
or refresh the alive/running locks with its own turn_id, and to stamp the stream row's flags
and turn_id, stomping A's live turn. B must now report the true owner and stop.

Also pins kill's owner drop: `claim_owner` never steals, so a kill that leaves the owner key
behind locks the session out of every other replica for the rest of OWNER_TTL_SECONDS.
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
    claim_owner,
    get_alive_owner,
    get_owner,
    get_running_owner,
)

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_shared"


class _FakeDAO:
    """Records every write so a test can assert the loser wrote nothing."""

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


@pytest.mark.asyncio
async def test_owner_heartbeat_establishes_the_nest(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-a")
    )

    assert result.replica_id == "replica-a"
    pid = str(_PROJECT)
    assert await get_alive_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "turn-a"
    )
    assert await get_running_owner(
        lock_engine, project_id=pid, session_id=_SESSION
    ) == ("turn-a")
    assert dao.creates == 1


@pytest.mark.asyncio
async def test_losing_replica_does_not_overwrite_turn_locks(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    # A owns the session and holds a live turn.
    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))
    writes_after_a = dao.creates + dao.updates

    # B heartbeats the same session. It loses the claim.
    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-b", "turn-b")
    )

    assert result.replica_id == "replica-a", "the loser must learn the true owner"
    assert await get_alive_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "turn-a"
    ), "replica B overwrote A's alive lock"
    assert await get_running_owner(
        lock_engine, project_id=pid, session_id=_SESSION
    ) == ("turn-a"), "replica B overwrote A's running lock"
    assert dao.creates + dao.updates == writes_after_a, (
        "replica B stamped the owner's stream row"
    )


@pytest.mark.asyncio
async def test_losing_replica_release_beat_does_not_clear_running(lock_engine):
    """The release beat (is_running=False) unconditionally cleared `running` before the fix."""
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))
    await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-b", "turn-b", running=False)
    )

    assert await get_running_owner(
        lock_engine, project_id=pid, session_id=_SESSION
    ) == ("turn-a"), "replica B cleared A's running lock"


@pytest.mark.asyncio
async def test_owner_release_beat_clears_only_running(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))
    await svc.heartbeat(
        project_id=_PROJECT, request=_beat("replica-a", "turn-a", running=False)
    )

    assert (
        await get_running_owner(lock_engine, project_id=pid, session_id=_SESSION)
    ) is None
    assert await get_alive_owner(lock_engine, project_id=pid, session_id=_SESSION) == (
        "turn-a"
    ), "alive must outlive the turn (reattachable)"


@pytest.mark.asyncio
async def test_kill_frees_affinity_so_another_replica_can_serve(lock_engine):
    dao = _FakeDAO()
    svc = _service(lock_engine, dao)
    pid = str(_PROJECT)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("replica-a", "turn-a"))
    await svc.kill(project_id=_PROJECT, user_id=None, session_id=_SESSION)

    assert (
        await get_owner(lock_engine, project_id=pid, session_id=_SESSION)
    ) is None, (
        "kill left a stale owner: the session is locked out for OWNER_TTL_SECONDS"
    )

    # A different replica may immediately take the session.
    assert (
        await claim_owner(
            lock_engine, project_id=pid, session_id=_SESSION, replica_id="replica-b"
        )
    ) == "replica-b"
