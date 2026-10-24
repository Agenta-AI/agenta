"""Only a run creates a session by heartbeat (M2, flow F11)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import SessionHeartbeatRequest, SessionStream
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.streams.types import SessionCreationRequiresRunCredential
from oss.tests.pytest.utils.principals import make_envelope
from unit.sessions.test_project_scoped_locks import _FakeRedis

_PROJECT = uuid4()


class _DAO:
    def __init__(self, existing=None):
        self.row = existing
        self.creates = 0

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.creates += 1
        self.row = SessionStream(
            id=uuid4(), project_id=project_id, session_id=stream.session_id
        )
        return self.row

    async def update(self, *, project_id, user_id, session_id, stream):
        return self.row

    async def fill_missing(self, **kwargs):
        return self.row

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    engine = LockEngine()
    with patch.object(engine, "_client", return_value=_FakeRedis()):
        yield engine


def _beat(session_id: str) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=session_id, replica_id="replica-a", turn_id="turn-1", is_running=True
    )


async def test_headless_invoke_creates_its_session(lock_engine):
    dao = _DAO()
    service = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)
    result = await service.heartbeat(
        project_id=_PROJECT, request=_beat("headless"), envelope=make_envelope()
    )
    assert dao.creates == 1 and result.stream is not None


async def test_create_without_run_credential_is_refused(lock_engine):
    dao = _DAO()
    service = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)
    with pytest.raises(SessionCreationRequiresRunCredential):
        await service.heartbeat(
            project_id=_PROJECT, request=_beat("browser"), envelope=None
        )
    assert dao.creates == 0


async def test_existing_stream_heartbeat_without_envelope_still_works(lock_engine):
    existing = SessionStream(id=uuid4(), project_id=_PROJECT, session_id="known")
    dao = _DAO(existing=existing)
    service = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)
    result = await service.heartbeat(
        project_id=_PROJECT, request=_beat("known"), envelope=None
    )
    assert dao.creates == 0 and result.stream is not None


async def test_the_route_maps_the_refusal_to_403():
    from fastapi import HTTPException

    import oss.src.apis.fastapi.sessions.router as router_module

    with patch.object(
        router_module, "check_action_access", AsyncMock(return_value=True)
    ):
        service = SimpleNamespace(
            heartbeat=AsyncMock(side_effect=SessionCreationRequiresRunCredential("s"))
        )
        router = router_module.SessionStreamsRouter.__new__(
            router_module.SessionStreamsRouter
        )
        router._service = service
        request = SimpleNamespace(
            state=SimpleNamespace(project_id=_PROJECT, user_id=uuid4()),
            headers={},
        )
        with pytest.raises(HTTPException) as error:
            await router.heartbeat_session_stream(request, _beat("s"))
    assert error.value.status_code == 403
    assert error.value.detail["code"] == "session_requires_run_credential"


async def test_a_refused_create_binds_no_turn(lock_engine):
    """The refusal comes before the first-writer-wins turn binding, so a refused
    beat cannot claim the turn for its replica."""

    import oss.src.core.sessions.streams.service as service_module

    dao = _DAO()
    service = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)
    bind = AsyncMock()
    with patch.object(service_module, "bind_turn", bind):
        with pytest.raises(SessionCreationRequiresRunCredential):
            await service.heartbeat(
                project_id=_PROJECT, request=_beat("browser-2"), envelope=None
            )
    bind.assert_not_awaited()
