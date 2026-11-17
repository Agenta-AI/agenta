"""The drive routes: `POST /mounts/sign` (by slug), the legacy `POST /mounts/agents/sign`,
`POST /mounts/` and the `POST /mounts/query` filter."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from oss.src.apis.fastapi.mounts import router as router_module
from oss.src.apis.fastapi.mounts.router import MountsRouter
from oss.src.core.access.permissions.types import Permission
from oss.src.core.mounts.dtos import MountCreate, MountQuery
from oss.src.core.mounts.service import MountsService
from oss.src.core.sharing.dtos import AccessPolicy, MountVisibility, Visibility
from oss.src.core.workflows import service as workflows_module
from oss.src.core.workflows.service import WorkflowsService
from oss.src.dbs.postgres.mounts.dao import MountsDAO
from oss.tests.pytest.utils.sharing import SharingWorld

from unit.mounts.test_agent_drives import InMemoryMountsDAO


class _FakeCredentials:
    access_key = "SCOPED-ACCESS"
    secret_key = "SCOPED-SECRET"
    session_token = "SCOPED-TOKEN"
    _expiration = None


class _RecordingStore:
    endpoint_url = "http://store:8333"
    region = "us-east-1"

    def __init__(self):
        self.signed = []

    async def sign_temp_credentials(
        self, *, bucket, prefix, duration_seconds, read_only=False
    ):
        self.signed.append({"prefix": prefix, "read_only": read_only})
        return _FakeCredentials()


class _Workflows:
    """What the legacy route reads from the workflows service, with the real
    `ensure_agent_drive`."""

    static_catalog = None
    _mount_lookup = None
    ensure_agent_drive = WorkflowsService.ensure_agent_drive
    _agent_policy = WorkflowsService._agent_policy
    _require_mount_lookup = WorkflowsService._require_mount_lookup

    def __init__(self, *, states_drives=False):
        self.states_drives = states_drives

    async def has_revision_with_drives(self, *, project_id, artifact_id):
        return self.states_drives

    async def fetch_workflow(self, *, project_id, workflow_ref, include_archived=True):
        return SimpleNamespace(slug="quote", name="Quote")


def _private(owner) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


class _Project:
    def __init__(self, *, states_drives=False):
        self.dao = InMemoryMountsDAO()
        self.store = _RecordingStore()
        self.workflows = _Workflows(states_drives=states_drives)
        self.service = MountsService(
            mounts_dao=self.dao,
            mounts_store=self.store,
            bucket="mounts",
            workflows_service=self.workflows,
        )
        self.workflows._mount_lookup = self.service
        self.sharing = SharingWorld()
        self.project_id = self.sharing.project_id
        self.user_id = uuid4()
        self.run_agent_id = None
        self.allowed = True
        self.sharing.dao.fetch_mount_visibility = self._fetch_mount_visibility

    async def _fetch_mount_visibility(self, *, project_id, mount_id):
        """The sharing read of a drive, over the mounts DAO rows and visibility rows."""
        mount = await self.dao.fetch_mount(project_id=project_id, mount_id=mount_id)
        if mount is None:
            return None
        return MountVisibility(
            mount_id=mount.id,
            slug=mount.slug,
            session_id=mount.session_id,
            agent_id=mount.agent_id,
            policy=self.dao.visibility.get(mount.id),
        )

    async def drive(self, slug, *, policy=None, agent_id=None):
        mount = await self.dao.upsert_mount(
            project_id=self.project_id,
            user_id=self.user_id,
            mount_create=MountCreate(slug=slug, name=slug, agent_id=agent_id),
        )
        if policy is not None:
            self.dao.visibility[mount.id] = policy
        return mount

    def agent(self, policy=None) -> UUID:
        return self.sharing.dao.add_agent(project_id=self.project_id, policy=policy)

    def client(self):
        app = FastAPI()

        @app.middleware("http")
        async def set_request_scope(request: Request, call_next):
            request.state.project_id = str(self.project_id)
            request.state.user_id = str(self.user_id)
            request.state.run_agent_id = self.run_agent_id
            return await call_next(request)

        app.include_router(
            MountsRouter(mounts_service=self.service).router, prefix="/mounts"
        )
        return TestClient(app)


@pytest.fixture
def project(monkeypatch):
    project = _Project()

    async def allow_mount(request, *, scope, permission):
        return project.allowed

    async def allow_resource(request, *, action, resource):
        return True

    monkeypatch.setattr(router_module, "allow_mount", allow_mount)
    monkeypatch.setattr(router_module, "allow_resource", allow_resource)
    monkeypatch.setattr(
        router_module, "get_sharing_service", lambda: project.sharing.service
    )
    monkeypatch.setattr(
        workflows_module, "get_sharing_service", lambda: project.sharing.service
    )
    with patch(
        "oss.src.apis.fastapi.mounts.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ) as check:
        project.check = check
        yield project


# -- POST /mounts/sign ----------------------------------------------------------------


@pytest.mark.parametrize(
    "query, read_only",
    [("", False), ("&access=read-write", False), ("&access=read", True)],
)
async def test_sign_by_slug_signs_with_the_access(project, query, read_only):
    drive = await project.drive("price-lists")
    response = project.client().post(f"/mounts/sign?slug=price-lists{query}")
    assert response.status_code == 200
    assert response.json()["mount"]["id"] == str(drive.id)
    assert project.store.signed == [
        {"prefix": drive.storage_prefix, "read_only": read_only}
    ]
    assert project.check.await_args.kwargs["permission"] == Permission.USE_MOUNTS


async def test_sign_by_slug_signs_an_agent_drive_with_a_reserved_slug(project):
    agent = project.agent()
    slug = f"__ag__agent__{agent}__default"
    await project.drive(slug, agent_id=str(agent))
    response = project.client().post(f"/mounts/sign?slug={slug}")
    assert response.status_code == 200


async def test_missing_archived_session_or_hidden_drive_is_404(project):
    await project.drive("old-notes")
    old = await project.dao.fetch_mount_by_slug(
        project_id=project.project_id, slug="old-notes"
    )
    await project.dao.archive_mount(
        project_id=project.project_id, user_id=project.user_id, mount_id=old.id
    )
    session = await project.service.get_or_create_session_mount(
        project_id=project.project_id, user_id=project.user_id, session_id="sess-1"
    )
    before = len(project.dao.mounts)
    for slug in ("missing", "old-notes", session.slug):
        assert project.client().post(f"/mounts/sign?slug={slug}").status_code == 404
    await project.drive("private-notes")
    project.allowed = False
    assert project.client().post("/mounts/sign?slug=private-notes").status_code == 404
    assert len(project.dao.mounts) == before + 1
    assert project.store.signed == []


async def test_an_unknown_access_is_refused(project):
    await project.drive("price-lists")
    response = project.client().post("/mounts/sign?slug=price-lists&access=write")
    assert response.status_code == 422
    assert project.store.signed == []


async def test_the_route_is_not_captured_by_mount_id(project):
    paths = [
        route.path
        for route in MountsRouter(mounts_service=project.service).router.routes
    ]
    assert paths.index("/sign") < paths.index("/{mount_id}")
    assert "/projects/sign" not in paths


async def test_a_home_sign_passes_the_home_rule(project):
    owner = uuid4()
    project.run_agent_id = project.agent(_private(owner))
    await project.drive("my-notes", policy=_private(owner))
    response = project.client().post("/mounts/sign?slug=my-notes&is_home=true")
    assert response.status_code == 200


@pytest.mark.parametrize("case", ["shared_home", "no_claim"])
async def test_a_refused_home_sign_is_403(project, case):
    owner = uuid4()
    agent = project.agent(_private(owner))
    project.run_agent_id = None if case == "no_claim" else agent
    await project.drive(
        "team-notes",
        policy=AccessPolicy(visibility=Visibility.PROJECT)
        if case == "shared_home"
        else _private(owner),
    )
    response = project.client().post("/mounts/sign?slug=team-notes&is_home=true")
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "home_drive_not_allowed"
    assert project.store.signed == []
    # Not a home: the same drive signs.
    assert project.client().post("/mounts/sign?slug=team-notes").status_code == 200


# -- POST /mounts/agents/sign (legacy) ------------------------------------------------


async def test_the_legacy_route_creates_and_signs_the_run_agents_drive(project):
    agent = project.agent()
    project.run_agent_id = agent
    response = project.client().post(f"/mounts/agents/sign?artifact_id={agent}")
    assert response.status_code == 200
    assert response.json()["mount"]["slug"] == "quote-files"
    again = project.client().post(f"/mounts/agents/sign?artifact_id={agent}")
    assert again.json()["mount"]["id"] == response.json()["mount"]["id"]
    assert len(project.dao.mounts) == 1


async def test_the_legacy_route_gives_a_private_agent_a_private_drive(project):
    owner = uuid4()
    project.user_id = owner
    agent = project.agent(_private(owner))
    project.run_agent_id = agent
    response = project.client().post(f"/mounts/agents/sign?artifact_id={agent}")
    assert response.status_code == 200
    mount_id = UUID(response.json()["mount"]["id"])
    assert project.dao.visibility[mount_id] == _private(owner)


async def test_the_legacy_route_signs_an_existing_reserved_drive(project):
    agent = project.agent()
    project.run_agent_id = agent
    legacy = await project.drive(f"__ag__agent__{agent}__default", agent_id=str(agent))
    response = project.client().post(f"/mounts/agents/sign?artifact_id={agent}")
    assert response.json()["mount"]["id"] == str(legacy.id)


@pytest.mark.parametrize("case", ["no_claim", "other_agent", "states_drives"])
async def test_the_legacy_route_refuses_and_creates_nothing(project, case):
    agent = project.agent()
    project.run_agent_id = {
        "no_claim": None,
        "other_agent": uuid4(),
        "states_drives": agent,
    }[case]
    project.workflows.states_drives = case == "states_drives"
    response = project.client().post(f"/mounts/agents/sign?artifact_id={agent}")
    assert response.status_code == 404
    assert project.dao.mounts == {}
    assert project.store.signed == []


# -- POST /mounts/ and POST /mounts/query ---------------------------------------------


async def test_create_refuses_a_caller_agent_id(project):
    response = project.client().post(
        "/mounts/",
        json={"mount": {"slug": "x", "name": "x", "agent_id": str(uuid4())}},
    )
    assert response.status_code == 422
    assert project.dao.mounts == {}


async def test_create_writes_a_shared_row(project):
    response = project.client().post(
        "/mounts/", json={"mount": {"slug": "notes", "name": "Notes"}}
    )
    assert response.status_code == 200
    mount_id = UUID(response.json()["mount"]["id"])
    assert project.dao.visibility[mount_id].visibility == Visibility.PROJECT
    assert project.dao.visibility[mount_id].owner_user_id is None


async def test_query_drops_drives_the_caller_may_not_open(project, monkeypatch):
    open_drive = await project.drive("open")
    hidden = await project.drive("hidden")

    async def allow_mount(request, *, scope, permission):
        return scope.id != hidden.id

    monkeypatch.setattr(router_module, "allow_mount", allow_mount)
    response = project.client().post(
        "/mounts/query", json={"mount": {"slugs": ["open", "hidden"]}}
    )
    assert [m["id"] for m in response.json()["mounts"]] == [str(open_drive.id)]


class _CapturingEngine:
    def __init__(self):
        self.statements = []

    @asynccontextmanager
    async def session(self):
        engine = self

        class _Result:
            def scalars(self):
                return self

            def all(self):
                return []

        class _Session:
            async def execute(self, stmt):
                engine.statements.append(stmt)
                return _Result()

        yield _Session()


async def test_the_dao_filters_by_slugs():
    engine = _CapturingEngine()
    dao = MountsDAO(engine=engine)
    await dao.query_mounts(
        project_id=uuid4(), mount_query=MountQuery(slugs=["price-lists", "team-notes"])
    )
    await dao.query_mounts(project_id=uuid4(), mount_query=MountQuery())
    with_slugs, without = (
        str(stmt.compile(dialect=postgresql.dialect())) for stmt in engine.statements
    )
    assert "mounts.slug IN" in with_slugs
    assert "mounts.slug IN" not in without
