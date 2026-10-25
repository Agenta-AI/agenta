"""The route resource checks (`check_resource`, `allow_resource`) and the hidden ==
unknown rule at the agent and session entry points.

A real `AccessService` with `SharingService` as its resource policy, over in-memory
DAOs, decides every check. Alice owns a private session and a private agent; Bob is
an editor of the same project. For each route family, Bob's answer for Alice's
private id equals his answer for an id that does not exist (Review Focus 2).
"""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import oss.src.core.access.service as access_module
from oss.src.apis.fastapi.sessions.router import (
    RecordsRouter,
    SessionMountsRouter,
    SessionsRootRouter,
    SessionStreamsRouter,
)
from oss.src.apis.fastapi.sharing.utils import (
    NOT_FOUND_ERROR,
    ResourceCheck,
    agent_resource,
    check_resource,
    session_resource,
)
from oss.src.apis.fastapi.workflows.router import WorkflowsRouter
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import (
    PrincipalKind,
    PrincipalRef,
    RequestAccess,
    RequestCredentialKind,
    RunAuthority,
    RunContext,
    RunEnvelope,
    RunOrigin,
    RunSender,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.sessions.records.dtos import SessionRecord, SessionRecordsReadState
from oss.src.core.sessions.streams.dtos import SessionStream
from oss.src.core.sharing.dtos import (
    AccessPolicy,
    SessionRole,
    Visibility,
)
from oss.src.core.workflows.dtos import Workflow, WorkflowRevision
from oss.src.utils.env import env
from oss.tests.pytest.utils.memberships import RecordingRbac
from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO
from oss.tests.pytest.utils.sharing import SharingWorld
from oss.tests.pytest.utils.sharing import NoopRunAdmission

pytestmark = pytest.mark.real_resource_checks


def _private(owner: UUID) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


class _World:
    """One project: Alice owns a private session (Vic holds a viewer grant on it), a
    project session and a private agent; Bob and Vic are editors."""

    def __init__(self) -> None:
        self.world = SharingWorld()
        self.project_id = self.world.project_id
        self.alice = self.world.add_member(uuid4())
        self.bob = self.world.add_member(uuid4())
        self.vic = self.world.add_member(uuid4())
        self.principals = InMemoryPrincipalsDAO()
        for user in (self.alice, self.bob, self.vic):
            self.principals.human(user)
        self.access = AccessService(
            memberships=self.world.service._memberships,
            rbac=RecordingRbac(enforced=True),
            principals=self.principals,
            resource_policy=self.world.service,
        )
        self.private_session = self.world.add_session(policy=_private(self.alice))
        self.world.add_grant(
            state=self.private_session, user_id=self.vic, role=SessionRole.VIEWER
        )
        self.project_session = self.world.add_session(
            policy=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=None)
        )
        self.private_agent = self.world.dao.add_agent(
            project_id=self.project_id, policy=_private(self.alice)
        )

    def request_access(
        self, user_id: UUID, credential: str = "bearer"
    ) -> RequestAccess:
        organization_id = self.world.organization_id
        if credential == "api_key":
            principal = self.principals.api_key(
                project_id=self.project_id, created_by_id=user_id
            )
        else:
            principal = PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)
        # A browser session's authority names no project of the request: the decision
        # must take the request's project.
        authority_project = uuid4() if credential == "bearer" else self.project_id
        authority = RunAuthority(
            principal=principal,
            organization_id=organization_id,
            project_id=authority_project,
        )
        kind = {
            "bearer": RequestCredentialKind.BEARER_SESSION,
            "api_key": RequestCredentialKind.API_KEY,
            "secret": RequestCredentialKind.RUN_CREDENTIAL,
        }[credential]
        envelope = (
            RunEnvelope(
                authority=authority,
                context=RunContext(origin=RunOrigin.WEB),
                sender=RunSender(user_id=user_id),
            )
            if kind == RequestCredentialKind.RUN_CREDENTIAL
            else None
        )
        return RequestAccess(
            principal=principal,
            authority=authority,
            credential_kind=kind,
            acting_user_id=user_id,
            envelope=envelope,
        )


class _RecordingAccess:
    """The real `AccessService`, recording each `check_request` call."""

    def __init__(self, service: AccessService) -> None:
        self._service = service
        self.calls: list = []

    async def check_request(self, **kwargs):
        self.calls.append(kwargs)
        return await self._service.check_request(**kwargs)

    def __getattr__(self, name):
        return getattr(self._service, name)


@pytest.fixture
def world(monkeypatch) -> _World:
    world = _World()
    monkeypatch.setattr(access_module, "_access_service", world.access)
    import oss.src.apis.fastapi.sharing.utils as utils_module  # noqa: PLC0415

    monkeypatch.setattr(
        utils_module, "get_sharing_service", lambda: world.world.service
    )
    return world


@contextmanager
def _as(access: RequestAccess):
    token = set_request_access(access)
    try:
        yield
    finally:
        reset_request_access(token)


def _request(project_id: UUID, user_id: UUID):
    return SimpleNamespace(
        state=SimpleNamespace(project_id=str(project_id), user_id=str(user_id))
    )


# -- check_resource -------------------------------------------------------------------


@pytest.mark.parametrize("credential", ["bearer", "api_key", "secret"])
async def test_check_resource_passes_the_request_project(
    world, monkeypatch, credential
):
    recording = _RecordingAccess(world.access)
    monkeypatch.setattr(access_module, "_access_service", recording)
    resource = session_resource(world.project_session.session_id)

    with _as(world.request_access(world.bob, credential)):
        check = await check_resource(
            _request(world.project_id, world.bob),
            action=Permission.VIEW_SESSIONS,
            resource=resource,
        )

    # No DecisionInputMissing for a Bearer request (authority None in the decision).
    assert check == ResourceCheck.ALLOWED
    assert [call["project_id"] for call in recording.calls] == [world.project_id]
    assert recording.calls[0]["resource"] == resource


async def test_check_resource_maps_each_outcome(world):
    private = session_resource(world.private_session.session_id)
    request = _request(world.project_id, world.bob)

    # Allowed: the owner.
    with _as(world.request_access(world.alice)):
        assert (
            await check_resource(
                _request(world.project_id, world.alice),
                action=Permission.RUN_SESSIONS,
                resource=private,
            )
            == ResourceCheck.ALLOWED
        )

    # A capability the role does not have: today's FORBIDDEN_EXCEPTION.
    with _as(world.request_access(world.bob)):
        assert (
            await check_resource(
                request, action=Permission.MANAGE_AGENT_OWNERSHIP, resource=private
            )
            == ResourceCheck.NO_CAPABILITY
        )
        # RESOURCE_DENIED on a read: hidden.
        assert (
            await check_resource(
                request, action=Permission.VIEW_SESSIONS, resource=private
            )
            == ResourceCheck.HIDDEN
        )
        # RESOURCE_DENIED on a run, and the read is denied too: hidden.
        assert (
            await check_resource(
                request, action=Permission.RUN_SESSIONS, resource=private
            )
            == ResourceCheck.HIDDEN
        )
        # A private agent: hidden whatever the action.
        assert (
            await check_resource(
                request,
                action=Permission.EDIT_WORKFLOWS,
                resource=agent_resource(world.private_agent),
            )
            == ResourceCheck.HIDDEN
        )

    # RESOURCE_DENIED on a run, and the read is allowed (a viewer grant): forbidden.
    with _as(world.request_access(world.vic)):
        assert (
            await check_resource(
                _request(world.project_id, world.vic),
                action=Permission.RUN_SESSIONS,
                resource=private,
            )
            == ResourceCheck.FORBIDDEN
        )


async def test_api_key_of_the_owner_does_not_open_her_private_session(world):
    with _as(world.request_access(world.alice, "api_key")):
        assert (
            await check_resource(
                _request(world.project_id, world.alice),
                action=Permission.VIEW_SESSIONS,
                resource=session_resource(world.private_session.session_id),
            )
            == ResourceCheck.HIDDEN
        )


# -- routes ------------------------------------------------------------------------------


def _client(world: _World, router, *, user_id: UUID, prefix: str = "") -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def scope(request: Request, call_next):
        request.state.project_id = str(world.project_id)
        request.state.user_id = str(user_id)
        token = set_request_access(world.request_access(user_id))
        try:
            return await call_next(request)
        finally:
            reset_request_access(token)

    app.include_router(router.router, prefix=prefix)
    return TestClient(app)


def _stream(world: _World, session_id: str) -> SessionStream:
    return SessionStream(
        id=uuid4(),
        project_id=world.project_id,
        session_id=session_id,
        name="Alice's chat",
        visibility=Visibility.PRIVATE,
        owner_user_id=world.alice,
    )


def _streams_service(world: _World) -> AsyncMock:
    """Knows Alice's private session only; any other id is unknown."""

    known = world.private_session.session_id

    async def fetch(*, project_id, session_id):
        return _stream(world, session_id) if session_id == known else None

    service = AsyncMock()
    service.fetch.side_effect = fetch
    return service


def _records_service(world: _World) -> AsyncMock:
    known = world.private_session.session_id

    async def get_records(*, project_id, session_id):
        if session_id != known:
            return []
        return [
            SessionRecord(
                record_id=uuid4(),
                session_id=session_id,
                project_id=world.project_id,
                record_type="message",
                attributes={"text": "secret"},
            )
        ]

    async def get_read_state(*, project_id, session_id):
        return SessionRecordsReadState(latest_sequence=0, history_complete=True)

    service = AsyncMock()
    service.get_records.side_effect = get_records
    service.get_records_incomplete.return_value = False
    service.get_read_state.side_effect = get_read_state
    return service


def _session_routes(world: _World):
    """(name, client factory, request for an id) per session route family."""

    streams = _streams_service(world)
    records = _records_service(world)
    interactions = AsyncMock()
    interactions.query_interactions.return_value = []
    inputs = AsyncMock()
    inputs.list_pending.return_value = []
    turns = AsyncMock()
    turns.latest_turn.return_value = None
    mounts = AsyncMock()

    return [
        (
            "session_fetch",
            SessionStreamsRouter(
                service=streams,
                interactions_service=interactions,
                run_admission=NoopRunAdmission(),
            ),
            "",
            lambda client, sid: client.get(f"/sessions/streams/?session_id={sid}"),
        ),
        (
            "session_snapshot",
            SessionsRootRouter(
                sessions_service=AsyncMock(),
                streams_service=streams,
                records_service=records,
                interactions_service=interactions,
                turns_service=turns,
                inputs_service=inputs,
            ),
            "",
            lambda client, sid: client.get(f"/sessions/{sid}"),
        ),
        (
            "records",
            RecordsRouter(records_service=records),
            "/sessions/records",
            lambda client, sid: client.post(
                "/sessions/records/query", json={"session_id": sid}
            ),
        ),
        (
            "mounts_query",
            SessionMountsRouter(session_mounts_service=mounts, mounts_service=mounts),
            "/sessions",
            lambda client, sid: client.get(f"/sessions/mounts/?session_id={sid}"),
        ),
    ]


def _normalized(response, session_id: str):
    return response.status_code, response.text.replace(session_id, "<id>")


@pytest.mark.parametrize("family", range(4))
async def test_private_and_unknown_ids_answer_the_same(world, monkeypatch, family):
    monkeypatch.setattr(env.sessions, "shared_reader", True)
    name, router, prefix, call = _session_routes(world)[family]
    if name == "mounts_query":
        known = world.private_session.session_id

        async def query_mounts(*, project_id, mount_query, windowing):
            if mount_query.session_id != known:
                return []
            return [
                {
                    "id": str(uuid4()),
                    "project_id": str(project_id),
                    "session_id": known,
                    "slug": "cwd",
                }
            ]

        router.session_mounts_service.query_mounts.side_effect = query_mounts

    client = _client(world, router, user_id=world.bob, prefix=prefix)
    private_id = world.private_session.session_id
    unknown_id = f"s-{uuid4().hex}"

    private_answer = call(client, private_id)
    unknown_answer = call(client, unknown_id)

    assert _normalized(private_answer, private_id) == _normalized(
        unknown_answer, unknown_id
    ), name
    assert "secret" not in private_answer.text
    assert "Alice's chat" not in private_answer.text

    # The owner still reads her own session through the same route.
    owner_answer = call(
        _client(world, router, user_id=world.alice, prefix=prefix), private_id
    )
    assert owner_answer.status_code == 200


def _workflows_router(world: _World) -> WorkflowsRouter:
    known = world.private_agent
    service = AsyncMock()

    async def fetch_workflow(*, project_id, workflow_ref, **_):
        if workflow_ref.id != known:
            return None
        return Workflow(id=known, slug="alice-agent", name="Alice's agent")

    revision = WorkflowRevision(
        id=uuid4(), slug="r1", workflow_id=known, workflow_variant_id=uuid4()
    )

    async def retrieve_workflow_revision(*, workflow_ref=None, **_):
        if workflow_ref is None or workflow_ref.id != known:
            return None, None, None
        return revision, None, None

    service.fetch_workflow.side_effect = fetch_workflow
    service.retrieve_workflow_revision.side_effect = retrieve_workflow_revision
    return WorkflowsRouter(workflows_service=service, environments_service=AsyncMock())


@pytest.mark.parametrize("family", ["agent_fetch", "revision_retrieve"])
async def test_private_and_unknown_agents_answer_the_same(world, monkeypatch, family):
    import oss.src.apis.fastapi.workflows.router as workflows_router  # noqa: PLC0415

    monkeypatch.setattr(workflows_router, "publish_revision_event", AsyncMock())
    router = _workflows_router(world)

    def call(client, artifact_id):
        if family == "agent_fetch":
            return client.get(f"/workflows/{artifact_id}")
        return client.post(
            "/workflows/revisions/retrieve",
            json={"workflow_ref": {"id": str(artifact_id)}},
        )

    client = _client(world, router, user_id=world.bob, prefix="/workflows")
    private_answer = call(client, world.private_agent)
    unknown_answer = call(client, uuid4())

    assert (private_answer.status_code, private_answer.json()) == (
        unknown_answer.status_code,
        unknown_answer.json(),
    )
    assert "Alice" not in private_answer.text

    owner = _client(world, router, user_id=world.alice, prefix="/workflows")
    assert call(owner, world.private_agent).json()["count"] == 1


async def test_hidden_send_and_mount_sign_answer_the_canonical_not_found(world):
    """A send, a header call and a mount sign create what an unknown id names, so a
    hidden session answers the one canonical not-found body (never a 500, never the
    session's data)."""

    streams = _streams_service(world)
    mounts = AsyncMock()
    streams_client = _client(
        world,
        SessionStreamsRouter(
            service=streams,
            interactions_service=AsyncMock(),
            run_admission=NoopRunAdmission(),
        ),
        user_id=world.bob,
    )
    mounts_client = _client(
        world,
        SessionMountsRouter(session_mounts_service=mounts, mounts_service=mounts),
        user_id=world.bob,
        prefix="/sessions",
    )
    private_id = world.private_session.session_id

    send = streams_client.post(
        "/sessions/streams/",
        json={"session_id": private_id, "data": {"inputs": {"text": "hi"}}},
    )
    sign = mounts_client.post(f"/sessions/mounts/sign?session_id={private_id}")

    for answer in (send, sign):
        assert answer.status_code == 404
        assert answer.json()["detail"] == NOT_FOUND_ERROR.model_dump(exclude_none=True)
    streams.command.assert_not_awaited()
    mounts.get_or_create_session_mount.assert_not_awaited()


async def test_viewer_send_is_403_access_denied(world):
    streams = _streams_service(world)
    client = _client(
        world,
        SessionStreamsRouter(
            service=streams,
            interactions_service=AsyncMock(),
            run_admission=NoopRunAdmission(),
        ),
        user_id=world.vic,
    )

    answer = client.post(
        "/sessions/streams/",
        json={
            "session_id": world.private_session.session_id,
            "data": {"inputs": {"text": "hi"}},
        },
    )

    assert answer.status_code == 403
    detail = answer.json()["detail"]
    assert detail["code"] == "access_denied"
    assert detail["details"]["reason"] == "resource_denied"
    streams.command.assert_not_awaited()


async def test_session_delete_invalidates_policy_and_grantee_caches(world, monkeypatch):
    import oss.src.core.sessions.streams.service as streams_module  # noqa: PLC0415
    import oss.src.core.sharing.service as sharing_module  # noqa: PLC0415
    from oss.src.core.sessions.streams.service import (  # noqa: PLC0415
        SessionStreamsService,
    )

    monkeypatch.setattr(sharing_module, "_sharing_service", world.world.service)
    invalidated = []

    async def _invalidate(**kwargs):
        invalidated.append(kwargs)

    monkeypatch.setattr(streams_module, "invalidate_sharing_caches", _invalidate)
    state = world.private_session
    dao = AsyncMock()
    dao.get_by_session_id_including_archived.return_value = SessionStream(
        id=state.stream_id, project_id=world.project_id, session_id=state.session_id
    )
    dao.hard_delete_by_session_id.return_value = True
    service = SessionStreamsService(streams_dao=dao, lock_engine=AsyncMock())

    await service.hard_delete(project_id=world.project_id, session_id=state.session_id)

    # The grantees were read before the delete, and cleared after it.
    assert invalidated == [
        {
            "project_id": world.project_id,
            "session_ids": [state.session_id],
            "grant_user_ids": [world.vic],
        }
    ]
    dao.hard_delete_by_session_id.assert_awaited_once()


# -- runner write routes (rule S2) -------------------------------------------------------
#
# Records ingest and incomplete, interaction create, transition and cancel-stale, turn
# append and complete. The admitted runner of a turn passes on its admission record (one
# Redis read, no decision); every other caller is checked with RUN_SESSIONS.

import oss.src.apis.fastapi.sharing.utils as sharing_utils  # noqa: E402
import oss.src.utils.caching as caching_module  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

from fastapi import HTTPException  # noqa: E402

from oss.src.apis.fastapi.sessions.models import (  # noqa: E402
    SessionInteractionCancelStaleRequest,
    SessionInteractionCreateRequest,
    SessionInteractionTransitionRequest,
    SessionRecordIngestRequest,
    SessionRecordsIncompleteRequest,
    SessionTurnAppendRequest,
    SessionTurnCompleteRequest,
)
from oss.src.apis.fastapi.sessions.router import (  # noqa: E402
    InteractionsRouter,
    SessionTurnsRouter,
)
from oss.src.core.sessions.interactions.dtos import SessionInteraction  # noqa: E402
from oss.src.core.sessions.interactions.types import InteractionNotFound  # noqa: E402
from oss.src.core.sessions.turns.dtos import SessionTurn  # noqa: E402
from oss.src.core.sessions.turns.types import SessionTurnNotFound  # noqa: E402
from oss.src.dbs.redis.sessions.contract import running_key  # noqa: E402
from oss.src.dbs.redis.sessions.locks import record_turn_admission  # noqa: E402

_TURN = str(uuid4())
_OLD_TURN = str(uuid4())


class _Lock:
    """The volatile Redis's admission and `running` keys: `set`, `delete`, the current
    turn admission script and `MGET` (the request's one cache read, which reads the two
    keys of a runner write), counting their round trips."""

    def __init__(self, *, fail: bool = False) -> None:
        self.values: dict = {}
        self.round_trips = 0
        self.scripts = 0
        self.fail = fail

    async def set(self, key, value, ex=None, **_):
        self.values[key] = value
        return True

    async def delete(self, *keys):
        for key in keys:
            self.values.pop(key.decode() if isinstance(key, bytes) else key, None)
        return len(keys)

    async def eval(self, script, numkeys, *keys_and_args):
        assert "AGENTA_CURRENT_TURN_ADMISSION" in script
        self.round_trips += 1
        self.scripts += 1
        if self.fail:
            raise ConnectionError("redis down")
        keys = [k.decode() if isinstance(k, bytes) else k for k in keys_and_args[:2]]
        turn_id = keys_and_args[2]
        turn_id = turn_id.decode() if isinstance(turn_id, bytes) else turn_id
        running = self.values.get(keys[0])
        running = running.decode() if isinstance(running, bytes) else running
        if running != turn_id:
            return None
        return self.values.get(keys[1])

    async def mget(self, names):
        self.round_trips += 1
        if self.fail:
            raise ConnectionError("redis down")
        return [self.values.get(name) for name in names]


@pytest.fixture
def lock(monkeypatch) -> _Lock:
    lock = _Lock()
    monkeypatch.setattr(sharing_utils, "get_lock_engine", lambda: lock)
    monkeypatch.setattr(caching_module, "_cache_engine", lock)
    return lock


async def _admit(
    world: _World,
    lock: _Lock,
    *,
    user_id: UUID,
    session_id: str,
    turn_id: str = _TURN,
    current: bool = True,
):
    """The heartbeat admitted `user_id`'s run for `turn_id` of the session; with
    `current`, that turn holds the session's `running` lock."""
    await record_turn_admission(
        lock,
        project_id=str(world.project_id),
        session_id=session_id,
        turn_id=turn_id,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id),
    )
    if current:
        await lock.set(running_key(str(world.project_id), session_id), turn_id)


def _write_request(world: _World, access: RequestAccess) -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    state = request.state
    state.project_id = str(world.project_id)
    state.user_id = str(access.acting_user_id)
    state.organization_id = str(world.world.organization_id)
    state.principal = access.principal
    state.authority = access.authority
    state.credential_kind = access.credential_kind
    state.run_envelope = access.envelope
    return request


def _runner_routers(world: _World):
    records = AsyncMock()
    interactions = AsyncMock()
    interactions.create_interaction.return_value = SessionInteraction.model_construct()
    interactions.transition_interaction.side_effect = InteractionNotFound("unknown")
    interactions.cancel_session_pending.return_value = 0
    turns = AsyncMock()
    turns.append_turn.return_value = SessionTurn.model_construct()

    async def _complete(*, project_id, turn):
        raise SessionTurnNotFound(turn.session_id, turn.turn_index)

    turns.complete_turn.side_effect = _complete
    return SimpleNamespace(
        world=world,
        records=RecordsRouter(records_service=records),
        interactions=InteractionsRouter(
            interactions_service=interactions, commands_service=AsyncMock()
        ),
        turns=SessionTurnsRouter(turns_service=turns),
        records_service=records,
        interactions_service=interactions,
        turns_service=turns,
    )


def _runner_writes(routers, session_id: str):
    """(name, call) per runner write route; every body names `_TURN` where it can, and
    a turn names its session's row (a random one for a session with no row)."""
    now = datetime.now(timezone.utc)
    state = routers.world.world.dao.sessions.get((routers.world.project_id, session_id))
    stream_id = state.stream_id if state is not None else uuid4()
    return [
        (
            "record_ingest",
            lambda r: routers.records.ingest_record_event(
                request=r,
                body=SessionRecordIngestRequest(
                    session_id=session_id,
                    record_type="message",
                    attributes={"text": "x"},
                    turn_id=_TURN,
                ),
            ),
        ),
        (
            "records_incomplete",
            lambda r: routers.records.mark_records_incomplete(
                request=r,
                body=SessionRecordsIncompleteRequest(
                    session_id=session_id, turn_id=_TURN
                ),
            ),
        ),
        (
            "interaction_create",
            lambda r: routers.interactions.create_interaction(
                request=r,
                body=SessionInteractionCreateRequest(
                    session_id=session_id,
                    turn_id=_TURN,
                    token="t1",
                    kind="user_input",
                ),
            ),
        ),
        (
            "interaction_transition",
            lambda r: routers.interactions.transition_interaction(
                request=r,
                body=SessionInteractionTransitionRequest(
                    session_id=session_id, token="t1", status="cancelled"
                ),
            ),
        ),
        (
            "interactions_cancel_stale",
            lambda r: routers.interactions.cancel_stale_interactions(
                request=r,
                body=SessionInteractionCancelStaleRequest(
                    session_id=session_id, turn_id=_TURN
                ),
            ),
        ),
        (
            "turn_append",
            lambda r: routers.turns.append_turn(
                request=r,
                body=SessionTurnAppendRequest(
                    session_id=session_id,
                    turn_id=_TURN,
                    stream_id=stream_id,
                    turn_index=0,
                    harness_kind="mock",
                ),
            ),
        ),
        (
            "turn_complete",
            lambda r: routers.turns.complete_turn(
                request=r,
                body=SessionTurnCompleteRequest(
                    session_id=session_id, turn_index=0, end_time=now
                ),
            ),
        ),
    ]


async def _answer(call, request):
    try:
        return 200, await call(request)
    except HTTPException as error:
        return error.status_code, error.detail


def _service_calls(routers) -> int:
    return sum(
        len(service.mock_calls)
        for service in (
            routers.records_service,
            routers.interactions_service,
            routers.turns_service,
        )
    )


# The answer of each route for an id that names no session (today's answer), or the
# canonical not-found body where an unknown id creates something (Task 12 decision).
_UNKNOWN_ANSWERS = {
    "interaction_transition": (404, "Interaction not found or already terminal"),
    "interactions_cancel_stale": (200, {"cancelled": 0}),
}


@pytest.mark.parametrize("credential", ["bearer", "api_key", "secret"])
@pytest.mark.parametrize("route", range(7))
async def test_bob_cannot_write_into_alice_private_session(
    world, lock, monkeypatch, credential, route
):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.sessions.router.publish_record", AsyncMock()
    )
    private_id = world.private_session.session_id
    # Alice's run is admitted for the turn Bob names; Bob's own credential is not.
    await _admit(world, lock, user_id=world.alice, session_id=private_id)
    routers = _runner_routers(world)
    name, call = _runner_writes(routers, private_id)[route]

    access = world.request_access(world.bob, credential)
    with _as(access):
        status_code, detail = await _answer(call, _write_request(world, access))

    if name == "turn_complete":
        expected = (404, SessionTurnNotFound(private_id, 0).message)
    else:
        expected = _UNKNOWN_ANSWERS.get(
            name, (404, NOT_FOUND_ERROR.model_dump(exclude_none=True))
        )
    assert (status_code, detail) == expected, name
    assert _service_calls(routers) == 0, name


@pytest.mark.parametrize("route", ["interaction_transition", "turn_complete"])
async def test_hidden_write_answers_what_an_unknown_id_answers(world, lock, route):
    """The routes that answer an unknown id without creating anything: Bob's answer
    for Alice's private id equals his answer for an id that does not exist."""
    routers = _runner_routers(world)
    access = world.request_access(world.bob, "secret")
    private_id = world.private_session.session_id
    unknown_id = f"s-{uuid4().hex}"

    def call_for(session_id):
        return dict(_runner_writes(routers, session_id))[route]

    with _as(access):
        private = await _answer(call_for(private_id), _write_request(world, access))
        unknown = await _answer(call_for(unknown_id), _write_request(world, access))

    def normalized(answer, session_id):
        return answer[0], str(answer[1]).replace(session_id, "<id>")

    assert normalized(private, private_id) == normalized(unknown, unknown_id)


async def test_bob_frames_into_alice_running_turn_are_refused(world, lock, monkeypatch):
    """Bob names the running execution of Alice's private session: the same 403 an
    unknown session answers (no running owner), and nothing is published."""
    import oss.src.apis.fastapi.sessions.router as router_module  # noqa: PLC0415

    private_id = world.private_session.session_id
    await _admit(world, lock, user_id=world.alice, session_id=private_id)
    monkeypatch.setattr(
        router_module, "get_running_owner", AsyncMock(return_value=_TURN)
    )
    publish = AsyncMock(return_value=True)
    monkeypatch.setattr(router_module, "publish_live_frame", publish)
    routers = _runner_routers(world)
    frame = SessionRecordIngestRequest(
        version=1,
        kind="frame",
        session_id=private_id,
        execution_id=_TURN,
        frame_or_event_id=f"{_TURN}:0",
        frame_index=0,
        entity_id="m1",
        type="text-delta",
        payload={"delta": "x"},
        created_at=datetime.now(timezone.utc),
    )

    access = world.request_access(world.bob, "secret")
    with _as(access):
        bob = await _answer(
            lambda r: routers.records.ingest_record_event(request=r, body=frame),
            _write_request(world, access),
        )
    monkeypatch.setattr(
        router_module, "get_running_owner", AsyncMock(return_value=None)
    )
    with _as(access):
        unknown = await _answer(
            lambda r: routers.records.ingest_record_event(request=r, body=frame),
            _write_request(world, access),
        )

    assert bob == unknown
    assert bob[0] == 403
    publish.assert_not_awaited()

    # Alice's admitted run publishes the same frame.
    monkeypatch.setattr(
        router_module, "get_running_owner", AsyncMock(return_value=_TURN)
    )
    alice = world.request_access(world.alice, "secret")
    with _as(alice):
        answer = await routers.records.ingest_record_event(
            request=_write_request(world, alice), body=frame
        )
    assert answer == {"ok": True}
    publish.assert_awaited_once()


@pytest.mark.parametrize("route", range(7))
async def test_admitted_runner_writes_without_a_decision(
    world, lock, monkeypatch, route
):
    """Alice's run, admitted at the heartbeat for this turn, writes with one Redis read
    of the admission record where the body names the turn, and no access decision."""
    publish = AsyncMock(return_value=True)
    monkeypatch.setattr("oss.src.apis.fastapi.sessions.router.publish_record", publish)
    private_id = world.private_session.session_id
    await _admit(world, lock, user_id=world.alice, session_id=private_id)
    routers = _runner_routers(world)
    name, call = _runner_writes(routers, private_id)[route]
    recording = _RecordingAccess(world.access)
    monkeypatch.setattr(access_module, "_access_service", recording)

    access = world.request_access(world.alice, "secret")
    with _as(access):
        status_code, _ = await _answer(call, _write_request(world, access))

    resource_checks = [c for c in recording.calls if c.get("resource") is not None]
    if name in ("interaction_transition", "turn_complete"):
        # No turn id in the body: the plain check, which allows the owner.
        assert len(resource_checks) == 1, name
        assert lock.round_trips == 0, name
    else:
        assert status_code == 200, name
        assert resource_checks == [], name
        # The two admission keys ride in the request's one cache read: no script.
        assert lock.round_trips == 1, name
        assert lock.scripts == 0, name
    assert _service_calls(routers) + publish.await_count >= 1, name


async def test_admission_record_of_another_session_does_not_open_this_one(
    world, lock, monkeypatch
):
    """Bob's run is admitted for turn `_TURN` of his own session; that record names
    another session, so his write into Alice's private session is checked and hidden."""
    monkeypatch.setattr(
        "oss.src.apis.fastapi.sessions.router.publish_record", AsyncMock()
    )
    bob_session = world.world.add_session(policy=_private(world.bob))
    await _admit(world, lock, user_id=world.bob, session_id=bob_session.session_id)
    routers = _runner_routers(world)
    _, call = _runner_writes(routers, world.private_session.session_id)[0]

    access = world.request_access(world.bob, "secret")
    with _as(access):
        answer = await _answer(call, _write_request(world, access))

    assert answer == (404, NOT_FOUND_ERROR.model_dump(exclude_none=True))
    assert _service_calls(routers) == 0


def _replay_writes(routers, session_id: str):
    """Records ingest and cancel-stale, naming `_OLD_TURN`."""
    return [
        (
            "record_ingest",
            lambda r: routers.records.ingest_record_event(
                request=r,
                body=SessionRecordIngestRequest(
                    session_id=session_id,
                    record_type="message",
                    attributes={"text": "x"},
                    turn_id=_OLD_TURN,
                ),
            ),
            (404, NOT_FOUND_ERROR.model_dump(exclude_none=True)),
        ),
        (
            "interactions_cancel_stale",
            lambda r: routers.interactions.cancel_stale_interactions(
                request=r,
                body=SessionInteractionCancelStaleRequest(
                    session_id=session_id, turn_id=_OLD_TURN
                ),
            ),
            (200, {"cancelled": 0}),
        ),
    ]


@pytest.mark.parametrize("successor", ["new_turn", "ended"])
@pytest.mark.parametrize("route", range(2))
async def test_old_turn_replay_after_grant_removal_is_refused(
    world, lock, monkeypatch, successor, route
):
    """Bob was admitted for `_OLD_TURN` while he held a participant grant; the grant is
    gone now. His old turn's admission record survives, but the turn is not the
    session's current one (Alice's `_TURN` runs, or nothing runs): his replay of the
    old turn id takes the full check and is refused, and nothing is written or
    cancelled."""
    monkeypatch.setattr(
        "oss.src.apis.fastapi.sessions.router.publish_record", AsyncMock()
    )
    private_id = world.private_session.session_id
    await _admit(
        world,
        lock,
        user_id=world.bob,
        session_id=private_id,
        turn_id=_OLD_TURN,
        current=False,
    )
    if successor == "new_turn":
        await _admit(world, lock, user_id=world.alice, session_id=private_id)
    routers = _runner_routers(world)
    name, call, expected = _replay_writes(routers, private_id)[route]

    access = world.request_access(world.bob, "secret")
    with _as(access):
        answer = await _answer(call, _write_request(world, access))

    assert answer == expected, name
    assert _service_calls(routers) == 0, name
    assert lock.round_trips == 1, name


async def test_admission_record_error_fails_closed(world, monkeypatch):
    """A Redis error on the admission read is a full check, never continuity: Bob is
    refused, Alice is allowed by the check."""
    monkeypatch.setattr(
        "oss.src.apis.fastapi.sessions.router.publish_record",
        AsyncMock(return_value=True),
    )
    broken = _Lock(fail=True)
    monkeypatch.setattr(sharing_utils, "get_lock_engine", lambda: broken)
    monkeypatch.setattr(caching_module, "_cache_engine", broken)
    private_id = world.private_session.session_id
    routers = _runner_routers(world)
    _, call = _runner_writes(routers, private_id)[0]

    bob = world.request_access(world.bob, "secret")
    with _as(bob):
        assert (await _answer(call, _write_request(world, bob)))[0] == 404
    alice = world.request_access(world.alice, "secret")
    with _as(alice):
        assert await _answer(call, _write_request(world, alice)) == (
            200,
            {"ok": True},
        )


@pytest.mark.parametrize("route", range(7))
async def test_viewer_write_is_403_access_denied(world, lock, route):
    """Vic holds a viewer grant on Alice's private session: he reads it, so a write is
    403 `access_denied` (`resource_denied`), and nothing is written."""
    routers = _runner_routers(world)
    name, call = _runner_writes(routers, world.private_session.session_id)[route]

    access = world.request_access(world.vic, "secret")
    with _as(access):
        status_code, detail = await _answer(call, _write_request(world, access))

    assert status_code == 403, name
    assert detail["code"] == "access_denied", name
    assert detail["details"]["reason"] == "resource_denied", name
    assert _service_calls(routers) == 0, name


# -- admission renewal: the heartbeats renew, the writes do not -----------------------------
#
# Defaults: a runner beats every HEARTBEAT_INTERVAL_SECONDS (30 s); the admission record
# and `running` live TURN_BOUND_TTL_SECONDS / RUNNING_TTL_SECONDS (3600 s each) after the
# last beat that renewed them, so a turn may miss 119 beats in a row and keep its free path.
# A runner write reads the two keys in its one cache read and renews neither.

from oss.src.dbs.redis.sessions.contract import (  # noqa: E402
    HEARTBEAT_INTERVAL_SECONDS,
    RUNNING_TTL_SECONDS,
    TURN_BOUND_TTL_SECONDS,
)
from oss.src.dbs.redis.sessions.locks import get_turn_admission  # noqa: E402


class _ClockLock(_Lock):
    """`_Lock` with key expiry on a clock the test moves (`advance`)."""

    def __init__(self) -> None:
        super().__init__()
        self.now = 0.0
        self.expires: dict = {}

    def advance(self, seconds: float) -> None:
        self.now += seconds
        for key, at in list(self.expires.items()):
            if at <= self.now:
                self.values.pop(key, None)
                self.expires.pop(key, None)

    async def set(self, key, value, ex=None, **_):
        key = key.decode() if isinstance(key, bytes) else key
        self.values[key] = value
        if ex:
            self.expires[key] = self.now + int(ex)
        return True

    async def eval(self, script, numkeys, *keys_and_args):
        value = await super().eval(script, numkeys, *keys_and_args)
        if value is not None:  # the script's EXPIRE of the admission record
            key = keys_and_args[1]
            key = key.decode() if isinstance(key, bytes) else key
            self.expires[key] = self.now + int(keys_and_args[3])
        return value


@pytest.fixture
def clock_lock(monkeypatch) -> _ClockLock:
    lock = _ClockLock()
    monkeypatch.setattr(sharing_utils, "get_lock_engine", lambda: lock)
    monkeypatch.setattr(caching_module, "_cache_engine", lock)
    return lock


async def _beat(world: _World, lock: _ClockLock, *, session_id: str) -> None:
    """One steady running beat of `_TURN`: the runner renews `running`, and the API's
    verified-continuity read (`get_turn_admission`, what `_admit_heartbeat` calls for a
    steady beat) renews the admission record."""
    key = running_key(str(world.project_id), session_id)
    await lock.set(key, _TURN, ex=RUNNING_TTL_SECONDS)
    assert await get_turn_admission(
        lock,
        project_id=str(world.project_id),
        session_id=session_id,
        turn_id=_TURN,
    )


async def _bob_ingest(world: _World, routers, session_id: str):
    _, call = _runner_writes(routers, session_id)[0]
    access = world.request_access(world.bob, "secret")
    with _as(access):
        return await _answer(call, _write_request(world, access))


def test_the_admission_record_outlives_many_missed_beats():
    assert TURN_BOUND_TTL_SECONDS >= 10 * HEARTBEAT_INTERVAL_SECONDS
    assert RUNNING_TTL_SECONDS >= 10 * HEARTBEAT_INTERVAL_SECONDS


async def test_a_turn_longer_than_one_ttl_stays_admitted_while_it_beats(
    world, clock_lock, monkeypatch
):
    """Bob's run was admitted on Alice's private session (his access is gone since: a
    full check hides the session). His turn runs two TTLs and beats every interval: his
    write at the end still takes the free path."""
    monkeypatch.setattr(
        "oss.src.apis.fastapi.sessions.router.publish_record",
        AsyncMock(return_value=True),
    )
    private_id = world.private_session.session_id
    await _admit(world, clock_lock, user_id=world.bob, session_id=private_id)
    await _beat(world, clock_lock, session_id=private_id)
    elapsed = 0
    while elapsed < 2 * TURN_BOUND_TTL_SECONDS:
        clock_lock.advance(HEARTBEAT_INTERVAL_SECONDS)
        elapsed += HEARTBEAT_INTERVAL_SECONDS
        await _beat(world, clock_lock, session_id=private_id)

    routers = _runner_routers(world)
    assert await _bob_ingest(world, routers, private_id) == (200, {"ok": True})


async def test_writes_after_the_beats_stop_lose_the_free_path_at_the_ttl(
    world, clock_lock, monkeypatch
):
    """The beats stop. Bob's runner keeps writing every minute: the writes renew
    nothing, so the first write past one TTL after the last beat takes the full check,
    which hides Alice's session (the not-found body), and nothing is stored."""
    monkeypatch.setattr(
        "oss.src.apis.fastapi.sessions.router.publish_record",
        AsyncMock(return_value=True),
    )
    private_id = world.private_session.session_id
    await _admit(world, clock_lock, user_id=world.bob, session_id=private_id)
    await _beat(world, clock_lock, session_id=private_id)

    elapsed = 0
    while elapsed + 60 < TURN_BOUND_TTL_SECONDS:
        clock_lock.advance(60)
        elapsed += 60
        routers = _runner_routers(world)
        assert await _bob_ingest(world, routers, private_id) == (200, {"ok": True})

    clock_lock.advance(TURN_BOUND_TTL_SECONDS - elapsed)
    routers = _runner_routers(world)
    assert await _bob_ingest(world, routers, private_id) == (
        404,
        NOT_FOUND_ERROR.model_dump(exclude_none=True),
    )
    assert _service_calls(routers) == 0


# -- a turn names its own session's row ------------------------------------------------------


def _append(routers, *, session_id: str, stream_id):
    return lambda r: routers.turns.append_turn(
        request=r,
        body=SessionTurnAppendRequest(
            session_id=session_id,
            turn_id=_TURN,
            stream_id=stream_id,
            turn_index=0,
            harness_kind="mock",
        ),
    )


@pytest.mark.parametrize("target", ["another_session", "no_row"])
async def test_a_turn_naming_another_session_s_stream_is_refused(
    world, lock, monkeypatch, target
):
    """Alice may write her private session, but her turn names the project session's
    row (or a session id with no row and that row): the not-found body, and nothing is
    appended. Otherwise the turn would be read under a session it does not belong to."""
    routers = _runner_routers(world)
    session_id = (
        world.private_session.session_id
        if target == "another_session"
        else f"s-{uuid4().hex}"
    )
    call = _append(
        routers, session_id=session_id, stream_id=world.project_session.stream_id
    )

    access = world.request_access(world.alice, "secret")
    with _as(access):
        answer = await _answer(call, _write_request(world, access))

    assert answer == (404, NOT_FOUND_ERROR.model_dump(exclude_none=True))
    routers.turns_service.append_turn.assert_not_awaited()


async def test_a_turn_naming_its_session_s_stream_is_appended(world, lock):
    routers = _runner_routers(world)
    call = _append(
        routers,
        session_id=world.private_session.session_id,
        stream_id=world.private_session.stream_id,
    )

    access = world.request_access(world.alice, "secret")
    with _as(access):
        status_code, _ = await _answer(call, _write_request(world, access))

    assert status_code == 200
    routers.turns_service.append_turn.assert_awaited_once()
