"""WP7 (W7.3): kill must reach the runner's sandbox teardown, not just the Redis/row edit.

Before this, `SessionStreamsService.kill()` only force-cleared the Redis nest and soft-deleted
the stream row — nothing called the runner's `POST /kill` (`services/runner/src/server.ts`),
so a live sandbox kept running until its own idle-TTL eviction. `kill_runner_sandbox`
(core/sessions/streams/runner_client.py) closes that gap; these tests pin:
  - kill() calls it exactly once, scoped to (project_id, session_id);
  - a runner-client failure never blocks kill's Redis/row edit (best-effort);
  - kill remains idempotent when the runner call fails.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.sessions.streams.service import SessionStreamsService

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "session_kill_teardown"


class _FakeStreamsDAO:
    def __init__(self, existing: Optional[SessionStream] = None):
        self.row = existing
        self.deleted = 0

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
        )
        return self.row

    async def delete_by_session_id(self, *, project_id, session_id):
        self.deleted += 1
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


@pytest.mark.asyncio
async def test_kill_calls_runner_client_scoped_to_project_and_session(lock_engine):
    dao = _FakeStreamsDAO()
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    with patch(
        "oss.src.core.sessions.streams.service.kill_runner_sandbox"
    ) as mock_kill:
        mock_kill.return_value = True
        ok = await svc.kill(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert ok is True
    mock_kill.assert_awaited_once_with(project_id=str(_PROJECT), session_id=_SESSION)
    assert dao.deleted == 1


@pytest.mark.asyncio
async def test_kill_still_succeeds_when_runner_call_fails(lock_engine):
    """Best-effort: the runner being unreachable must not block the Redis/row edit."""
    dao = _FakeStreamsDAO()
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    with patch(
        "oss.src.core.sessions.streams.service.kill_runner_sandbox"
    ) as mock_kill:
        mock_kill.return_value = False
        ok = await svc.kill(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert ok is True, (
        "kill's Redis/row edit must succeed regardless of runner reachability"
    )
    assert dao.deleted == 1


@pytest.mark.asyncio
async def test_kill_is_idempotent_across_repeated_calls(lock_engine):
    dao = _FakeStreamsDAO()
    svc = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)

    with patch(
        "oss.src.core.sessions.streams.service.kill_runner_sandbox"
    ) as mock_kill:
        mock_kill.return_value = True
        first = await svc.kill(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)
        second = await svc.kill(project_id=_PROJECT, user_id=_USER, session_id=_SESSION)

    assert first is True
    assert second is True
    assert mock_kill.await_count == 2
