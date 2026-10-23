"""Every session insert path writes a server-derived initial policy (M3 Task 8).

The create arm of `set_header`, `heartbeat` and `_start_turn` writes the `access` it is
given; the arms that find an existing row never write it. The routes derive the policy
from the request credential, and the channel commands use the ownerless policy.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from pydantic import ValidationError

from oss.src.core.access.dtos import RequestCredentialKind
from oss.src.core.channels.commands import dispatch_stop
from oss.src.core.channels.dtos import (
    ChannelThread,
    ChannelThreadData,
    ChannelThreadFlags,
)
from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamCommandRequest,
    SessionStreamCommandResponse,
    SessionStreamCreate,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    SharedItemKind,
    Visibility,
)
from oss.src.dbs.postgres.sessions.streams.mappings import (
    map_stream_dto_to_dbe_create,
)
from oss.tests.pytest.utils.principals import make_envelope
from unit.sessions.test_project_scoped_locks import _FakeRedis
from oss.tests.pytest.utils.sharing import NoopRunAdmission

_PROJECT = uuid4()
_ALICE = uuid4()
_BOB = uuid4()
_PRIVATE_BOB = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=_BOB)


class _DAO:
    """Records which writes ran and with what payload."""

    def __init__(self, existing=None):
        self.row = existing
        self.created: list = []
        self.updates: list = []
        self.fills: list = []
        self.header_updates = 0

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        self.created.append(stream)
        self.row = SessionStream(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            visibility=stream.access.visibility,
            owner_user_id=stream.access.owner_user_id,
        )
        return self.row

    async def update(self, *, project_id, user_id, session_id, stream):
        self.updates.append(stream)
        return self.row

    async def fill_missing(self, **kwargs):
        self.fills.append(kwargs)
        return self.row

    async def update_header(self, *, project_id, user_id, session_id, header, **kw):
        self.header_updates += 1
        return self.row

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest.fixture(autouse=True)
def _registered_sharing_service(monkeypatch):
    from oss.tests.pytest.utils.sharing import register_sharing_service_for_tests

    return register_sharing_service_for_tests(monkeypatch)


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    engine = LockEngine()
    with patch.object(engine, "_client", return_value=_FakeRedis()):
        yield engine


def _existing(session_id: str) -> SessionStream:
    return SessionStream(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=session_id,
        visibility=Visibility.PRIVATE,
        owner_user_id=_ALICE,
    )


def _service(dao, lock_engine) -> SessionStreamsService:
    service = SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)
    service._publish_changed = AsyncMock()
    return service


def _beat(session_id: str) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=session_id,
        replica_id="replica-a",
        turn_id="turn-1",
        is_running=True,
        name="A name",
    )


# -- the DTO and the mapping -------------------------------------------------------------


def test_session_stream_create_requires_access():
    with pytest.raises(ValidationError):
        SessionStreamCreate(session_id="s")


def test_create_mapping_writes_the_policy():
    dbe = map_stream_dto_to_dbe_create(
        project_id=_PROJECT,
        user_id=None,
        stream=SessionStreamCreate(session_id="s", access=_PRIVATE_BOB),
    )
    assert dbe.visibility == "private"
    assert dbe.owner_user_id == _BOB

    dbe = map_stream_dto_to_dbe_create(
        project_id=_PROJECT,
        user_id=None,
        stream=SessionStreamCreate(session_id="s", access=OWNERLESS_PROJECT_POLICY),
    )
    assert dbe.visibility == "project"
    assert dbe.owner_user_id is None


# -- create arms write it, conflict arms never do ----------------------------------------


async def test_conflict_arms_never_write_access(lock_engine):
    dao = _DAO(existing=_existing("known"))
    service = _service(dao, lock_engine)

    await service.set_header(
        project_id=_PROJECT,
        user_id=_BOB,
        session_id="known",
        header=SessionStreamHeaderEdit(name="Renamed"),
        access=_PRIVATE_BOB,
    )
    assert dao.header_updates == 1
    assert dao.created == []
    assert dao.row.owner_user_id == _ALICE

    await service.heartbeat(
        project_id=_PROJECT,
        request=_beat("known"),
        envelope=make_envelope(),
        access=_PRIVATE_BOB,
        run_admission=NoopRunAdmission(),
        admission_envelope=make_envelope(),
    )
    assert dao.created == []
    for fill in dao.fills:
        assert "access" not in fill
        assert "visibility" not in fill and "owner_user_id" not in fill
    for update in dao.updates:
        assert "access" not in type(update).model_fields
        assert "visibility" not in type(update).model_fields
    assert dao.row.visibility == Visibility.PRIVATE
    assert dao.row.owner_user_id == _ALICE


async def test_header_create_arm_writes_access(lock_engine):
    dao = _DAO()
    service = _service(dao, lock_engine)
    await service.set_header(
        project_id=_PROJECT,
        user_id=_BOB,
        session_id="new-by-header",
        header=SessionStreamHeaderEdit(name="Named first"),
        access=_PRIVATE_BOB,
    )
    assert [stream.access for stream in dao.created] == [_PRIVATE_BOB]


async def test_heartbeat_create_arm_writes_access(lock_engine):
    dao = _DAO()
    service = _service(dao, lock_engine)
    await service.heartbeat(
        project_id=_PROJECT,
        request=_beat("new-by-beat"),
        envelope=make_envelope(),
        access=OWNERLESS_PROJECT_POLICY,
        run_admission=NoopRunAdmission(),
        admission_envelope=make_envelope(),
    )
    assert [stream.access for stream in dao.created] == [OWNERLESS_PROJECT_POLICY]


async def test_send_create_arm_writes_access(lock_engine):
    dao = _DAO()
    service = _service(dao, lock_engine)
    service._publish_list_changed = AsyncMock()
    with patch(
        "oss.src.core.sessions.streams.service.get_session_liveness",
        AsyncMock(return_value={"alive": False, "running": False, "attached": False}),
    ):
        await service.command(
            project_id=_PROJECT,
            user_id=_BOB,
            request=SessionStreamCommandRequest(
                session_id="new-by-send", data={"inputs": {"q": "hi"}}
            ),
            access=_PRIVATE_BOB,
        )
    assert [stream.access for stream in dao.created] == [_PRIVATE_BOB]


# -- the routes derive the policy from the credential ------------------------------------


def _router(service):
    import oss.src.apis.fastapi.sessions.router as router_module

    router = router_module.SessionStreamsRouter.__new__(
        router_module.SessionStreamsRouter
    )
    router._service = service
    router._run_admission = NoopRunAdmission()
    return router_module, router


def _bearer_request(user_id: UUID):
    envelope = make_envelope(principal_id=user_id, project_id=_PROJECT)
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(_PROJECT),
            user_id=str(user_id),
            authority=envelope.authority,
            credential_kind=RequestCredentialKind.BEARER_SESSION,
        ),
        headers={},
    )


def _api_key_request():
    envelope = make_envelope(kind="api_key", project_id=_PROJECT)
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(_PROJECT),
            user_id=str(_ALICE),
            authority=envelope.authority,
            credential_kind=RequestCredentialKind.API_KEY,
        ),
        headers={},
    )


async def test_header_create_arm_uses_requested_visibility():
    stream = SessionStream(id=uuid4(), project_id=_PROJECT, session_id="s")
    service = SimpleNamespace(set_header=AsyncMock(return_value=stream))
    router_module, router = _router(service)

    with patch.object(
        router_module, "check_action_access", AsyncMock(return_value=True)
    ):
        await router.set_session_stream_header(
            _bearer_request(_ALICE),
            header=SessionStreamHeaderEdit(name="x"),
            session_id="s",
            name_source=None,
            author=None,
            visibility=Visibility.PROJECT,
        )
        await router.set_session_stream_header(
            _bearer_request(_ALICE),
            header=SessionStreamHeaderEdit(name="x"),
            session_id="s",
            name_source=None,
            author=None,
            visibility=None,
        )

    calls = [call.kwargs["access"] for call in service.set_header.await_args_list]
    assert calls == [
        AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=_ALICE),
        AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=_ALICE),
    ]


async def test_api_key_send_creates_ownerless():
    response = SessionStreamCommandResponse(
        mode=CommandMode.send, session_id="s", turn_id="t"
    )
    service = SimpleNamespace(
        clock_ms=AsyncMock(return_value=0),
        check_runner_concurrency_limit=AsyncMock(),
        command=AsyncMock(return_value=response),
    )
    router_module, router = _router(service)
    with patch.object(
        router_module, "check_action_access", AsyncMock(return_value=True)
    ):
        await router.set_session_stream(
            _api_key_request(),
            SessionStreamCommandRequest(session_id="s", data={"inputs": {"q": "hi"}}),
        )
    assert service.command.await_args.kwargs["access"] == OWNERLESS_PROJECT_POLICY


async def test_bearer_heartbeat_passes_the_request_policy():
    stream = SessionStream(id=uuid4(), project_id=_PROJECT, session_id="s")
    service = SimpleNamespace(
        heartbeat=AsyncMock(return_value=SimpleNamespace(model_copy=lambda **_: None))
    )
    service.heartbeat.return_value.stream = stream
    router_module, router = _router(service)
    with patch.object(
        router_module, "check_action_access", AsyncMock(return_value=True)
    ):
        await router.heartbeat_session_stream(_bearer_request(_BOB), _beat("s"))
    assert service.heartbeat.await_args.kwargs["access"] == AccessPolicy(
        visibility=Visibility.PRIVATE, owner_user_id=_BOB
    )


# -- policy_for_request ------------------------------------------------------------------


def test_policy_for_request_without_an_envelope_is_ownerless():
    from oss.src.apis.fastapi.sharing.utils import policy_for_request

    request = SimpleNamespace(state=SimpleNamespace())
    assert (
        policy_for_request(request, kind=SharedItemKind.SESSION)
        == OWNERLESS_PROJECT_POLICY
    )


def test_policy_for_request_installation_session_is_a_channel_session():
    from oss.src.apis.fastapi.sharing.utils import policy_for_request

    envelope = make_envelope(
        kind="installation", origin="installation", sender=None, linked_user_id=_ALICE
    )
    request = SimpleNamespace(state=SimpleNamespace(run_envelope=envelope))
    assert (
        policy_for_request(
            request, kind=SharedItemKind.SESSION, requested=Visibility.PRIVATE
        )
        == OWNERLESS_PROJECT_POLICY
    )


# -- channels ----------------------------------------------------------------------------


async def test_channel_command_session_is_ownerless():
    response = SessionStreamCommandResponse(mode=CommandMode.cancel, session_id="c")
    streams_service = SimpleNamespace(command=AsyncMock(return_value=response))
    thread = ChannelThread(
        id=uuid4(),
        space_id=uuid4(),
        agent_id=uuid4(),
        session_id="c",
        data=ChannelThreadData(),
        flags=ChannelThreadFlags(),
    )
    await dispatch_stop(
        streams_service=streams_service,
        project_id=_PROJECT,
        user_id=_ALICE,
        thread=thread,
    )
    assert (
        streams_service.command.await_args.kwargs["access"] == OWNERLESS_PROJECT_POLICY
    )
