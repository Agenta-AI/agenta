"""Project drives: `fetch_project_mount`, `POST /mounts/projects/sign` and the `slugs` filter."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from oss.src.apis.fastapi.mounts.router import MountsRouter
from oss.src.core.access.permissions.types import Permission
from oss.src.core.mounts.dtos import MountCreate, MountQuery
from oss.src.core.mounts.service import MountsService
from oss.src.core.mounts.types import MountSlugReserved
from oss.src.dbs.postgres.mounts.dao import MountsDAO

from unit.mounts.test_agent_mounts import InMemoryMountsDAO


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


async def _project_with_drives():
    dao = InMemoryMountsDAO()
    store = _RecordingStore()
    service = MountsService(mounts_dao=dao, mounts_store=store, bucket="mounts")
    project_id, user_id = uuid4(), uuid4()
    drive = await dao.upsert_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(slug="price-lists", name="Price lists"),
    )
    archived = await dao.upsert_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(slug="old-notes", name="Old notes"),
    )
    await dao.archive_mount(
        project_id=project_id, user_id=user_id, mount_id=archived.id
    )
    await service.get_or_create_session_mount(
        project_id=project_id, user_id=user_id, session_id="sess-1"
    )
    other_project = uuid4()
    await dao.upsert_mount(
        project_id=other_project,
        user_id=user_id,
        mount_create=MountCreate(slug="elsewhere", name="Elsewhere"),
    )
    return service, dao, store, project_id, drive


@pytest.mark.asyncio
class TestFetchProjectMount:
    async def test_returns_the_active_project_drive(self):
        service, _, _, project_id, drive = await _project_with_drives()
        found = await service.fetch_project_mount(
            project_id=project_id, slug="price-lists"
        )
        assert found.id == drive.id

    async def test_missing_archived_and_other_project_drives_are_none(self):
        service, dao, _, project_id, _ = await _project_with_drives()
        for slug in ("missing", "old-notes", "elsewhere"):
            assert (
                await service.fetch_project_mount(project_id=project_id, slug=slug)
                is None
            )
        assert dao.upsert_calls == 4

    async def test_a_reserved_slug_is_refused(self):
        service, _, _, project_id, _ = await _project_with_drives()
        session = next(
            m
            for m in (await service.query_mounts(project_id=project_id))
            if m.session_id
        )
        with pytest.raises(MountSlugReserved):
            await service.fetch_project_mount(project_id=project_id, slug=session.slug)

    async def test_a_row_with_a_session_or_agent_is_not_a_project_drive(self):
        dao = InMemoryMountsDAO()
        service = MountsService(mounts_dao=dao)
        project_id = uuid4()
        await dao.upsert_mount(
            project_id=project_id,
            user_id=uuid4(),
            mount_create=MountCreate(slug="scoped", name="s", agent_id="a"),
        )
        assert (
            await service.fetch_project_mount(project_id=project_id, slug="scoped")
            is None
        )


def _client(service, project_id):
    app = FastAPI()

    @app.middleware("http")
    async def set_request_scope(request: Request, call_next):
        request.state.project_id = str(project_id)
        request.state.user_id = str(uuid4())
        return await call_next(request)

    app.include_router(MountsRouter(mounts_service=service).router, prefix="/mounts")
    return TestClient(app)


@pytest.fixture
def allow_access():
    with patch(
        "oss.src.apis.fastapi.mounts.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ) as check:
        yield check


@pytest.mark.asyncio
class TestSignRoute:
    @pytest.mark.parametrize(
        "query, read_only",
        [("", False), ("&access=read-write", False), ("&access=read", True)],
    )
    async def test_signs_the_drive_with_its_access(
        self, allow_access, query, read_only
    ):
        service, _, store, project_id, drive = await _project_with_drives()
        response = _client(service, project_id).post(
            f"/mounts/projects/sign?slug=price-lists{query}"
        )
        assert response.status_code == 200
        assert response.json()["mount"]["id"] == str(drive.id)
        assert store.signed == [
            {"prefix": drive.storage_prefix, "read_only": read_only}
        ]
        assert allow_access.await_args.kwargs["permission"] == Permission.USE_MOUNTS

    @pytest.mark.parametrize("slug", ["missing", "old-notes", "elsewhere"])
    async def test_missing_archived_or_foreign_drive_is_404_and_creates_nothing(
        self, allow_access, slug
    ):
        service, dao, store, project_id, _ = await _project_with_drives()
        before = len(dao.mounts)
        response = _client(service, project_id).post(
            f"/mounts/projects/sign?slug={slug}"
        )
        assert response.status_code == 404
        assert len(dao.mounts) == before
        assert store.signed == []

    async def test_a_reserved_slug_is_refused(self, allow_access):
        service, _, store, project_id, _ = await _project_with_drives()
        response = _client(service, project_id).post(
            "/mounts/projects/sign?slug=__ag__session__sess-1"
        )
        assert response.status_code == 422
        assert store.signed == []

    async def test_an_unknown_access_is_refused(self, allow_access):
        service, _, store, project_id, _ = await _project_with_drives()
        response = _client(service, project_id).post(
            "/mounts/projects/sign?slug=price-lists&access=write"
        )
        assert response.status_code == 422
        assert store.signed == []

    async def test_the_route_is_not_captured_by_mount_id(self, allow_access):
        service, _, _, project_id, _ = await _project_with_drives()
        routes = [
            route.path for route in MountsRouter(mounts_service=service).router.routes
        ]
        assert routes.index("/projects/sign") < routes.index("/{mount_id}")


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


@pytest.mark.asyncio
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
