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
            SessionStreamsRouter(service=streams, interactions_service=interactions),
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
        SessionStreamsRouter(service=streams, interactions_service=AsyncMock()),
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
        SessionStreamsRouter(service=streams, interactions_service=AsyncMock()),
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
