"""The agent's own drive: `create_agent_drive`, `fetch_agent_drive`, `fetch_mount_by_slug`."""

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from oss.src.core.mounts.dtos import Mount, MountCreate
from oss.src.core.mounts.service import MountsService, mint_agent_id
from oss.src.core.mounts.types import (
    MountArtifactIdInvalid,
    MountSlugConflict,
    MountSlugReserved,
)
from oss.src.core.sharing.dtos import OWNERLESS_PROJECT_POLICY, AccessPolicy, Visibility


class InMemoryMountsDAO:
    def __init__(self):
        self.mounts = {}
        self.visibility = {}
        self.upsert_calls = 0
        self.create_agent_calls = 0
        self.taken_once = set()

    async def create_mount(self, *, project_id, user_id, mount_create, visibility=None):
        key = (project_id, mount_create.slug)
        if key in self.mounts:
            raise MountSlugConflict()
        mount = self._mount(project_id, mount_create)
        self.mounts[key] = mount
        if visibility is not None:
            self.visibility[mount.id] = visibility
        return mount

    async def upsert_mount(self, *, project_id, user_id, mount_create):
        self.upsert_calls += 1
        key = (project_id, mount_create.slug)
        if key not in self.mounts:
            self.mounts[key] = self._mount(project_id, mount_create)
        else:
            self.mounts[key] = self.mounts[key].model_copy(
                update={"deleted_at": None, "deleted_by_id": None}
            )
        return self.mounts[key]

    async def create_agent_mount(
        self, *, project_id, user_id, mount_create, visibility
    ):
        self.create_agent_calls += 1
        existing = await self.fetch_mount_by_agent_id(
            project_id=project_id,
            agent_id=mount_create.agent_id,
            include_archived=True,
        )
        if existing is not None:
            return existing
        # A slug another writer takes between the read and the insert.
        if mount_create.slug in self.taken_once:
            self.taken_once.discard(mount_create.slug)
            self.mounts[(project_id, mount_create.slug)] = self._mount(
                project_id, MountCreate(slug=mount_create.slug, name="raced")
            )
            raise MountSlugConflict()
        return await self.create_mount(
            project_id=project_id,
            user_id=user_id,
            mount_create=mount_create,
            visibility=visibility,
        )

    async def fetch_mount_by_agent_id(
        self, *, project_id, agent_id, include_archived=False
    ):
        return next(
            (
                mount
                for (mount_project_id, _), mount in self.mounts.items()
                if mount_project_id == project_id
                and mount.agent_id == agent_id
                and (include_archived or mount.deleted_at is None)
            ),
            None,
        )

    async def list_slugs_with_prefix(self, *, project_id, prefix):
        return [
            slug
            for (mount_project_id, slug) in self.mounts
            if mount_project_id == project_id and slug.startswith(prefix)
        ]

    async def fetch_mount(self, *, project_id, mount_id):
        return next(
            (
                mount
                for (mount_project_id, _), mount in self.mounts.items()
                if mount_project_id == project_id and mount.id == mount_id
            ),
            None,
        )

    async def fetch_mount_by_slug(self, *, project_id, slug):
        mount = self.mounts.get((project_id, slug))
        return mount if mount and mount.deleted_at is None else None

    async def archive_mount(self, *, project_id, user_id, mount_id):
        for key, mount in self.mounts.items():
            if mount.project_id == project_id and mount.id == mount_id:
                archived = mount.model_copy(
                    update={
                        "deleted_at": datetime.now(timezone.utc),
                        "deleted_by_id": user_id,
                    }
                )
                self.mounts[key] = archived
                return archived
        return None

    async def query_mounts(self, *, project_id, mount_query=None, windowing=None):
        results = [
            mount
            for (mount_project_id, _), mount in self.mounts.items()
            if mount_project_id == project_id
        ]
        if mount_query:
            if not mount_query.include_archived:
                results = [m for m in results if m.deleted_at is None]
            if mount_query.session_id is not None:
                results = [m for m in results if m.session_id == mount_query.session_id]
            if mount_query.agent_id is not None:
                results = [m for m in results if m.agent_id == mount_query.agent_id]
            if mount_query.slugs is not None:
                results = [m for m in results if m.slug in mount_query.slugs]
        else:
            results = [m for m in results if m.deleted_at is None]
        return results

    @staticmethod
    def _mount(project_id, mount_create):
        mount_id = uuid4()
        return Mount(
            id=mount_id,
            project_id=project_id,
            storage_prefix=f"mounts/{project_id}/{mount_id}",
            slug=mount_create.slug,
            name=mount_create.name,
            session_id=mount_create.session_id,
            agent_id=mount_create.agent_id,
        )


@pytest.fixture
def mount_context():
    dao = InMemoryMountsDAO()
    return MountsService(mounts_dao=dao), dao, uuid4(), uuid4()


def _private(owner) -> AccessPolicy:
    return AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner)


async def _create(service, project_id, user_id, artifact_id, *, slug="quote", **kw):
    return await service.create_agent_drive(
        project_id=project_id,
        user_id=user_id,
        artifact_id=artifact_id,
        agent_slug=slug,
        agent_name=kw.get("name", "Quote"),
        visibility=kw.get("visibility", OWNERLESS_PROJECT_POLICY),
    )


def test_non_uuid_artifact_id_raises_typed_exception():
    with pytest.raises(MountArtifactIdInvalid):
        mint_agent_id(artifact_id="not-a-uuid")


async def test_create_agent_drive_names_it_after_the_agent(mount_context):
    service, dao, project_id, user_id = mount_context
    artifact_id = "A0B1C2D3-E4F5-4678-9ABC-DEF012345678"
    owner = uuid4()
    mount = await _create(
        service, project_id, user_id, artifact_id, visibility=_private(owner)
    )
    assert mount.slug == "quote-files"
    assert mount.name == "Quote"
    assert mount.agent_id == "a0b1c2d3-e4f5-4678-9abc-def012345678"
    assert dao.visibility[mount.id] == _private(owner)


async def test_a_retried_create_returns_the_same_drive(mount_context):
    service, dao, project_id, user_id = mount_context
    artifact_id = str(uuid4())
    first = await _create(service, project_id, user_id, artifact_id)
    second = await _create(service, project_id, user_id, artifact_id)
    assert first.id == second.id
    assert len(dao.mounts) == 1


async def test_a_taken_slug_gets_a_suffix(mount_context):
    service, dao, project_id, user_id = mount_context
    await service.create_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(slug="quote-files", name="taken"),
    )
    mount = await _create(service, project_id, user_id, str(uuid4()))
    assert mount.slug == "quote-files-2"


async def test_a_slug_taken_during_the_create_is_retried_once(mount_context):
    service, dao, project_id, user_id = mount_context
    dao.taken_once.add("quote-files")
    mount = await _create(service, project_id, user_id, str(uuid4()))
    assert mount.slug == "quote-files-2"
    assert dao.create_agent_calls == 2


async def test_fetch_agent_drive_finds_by_agent_id_and_never_creates(mount_context):
    service, dao, project_id, user_id = mount_context
    artifact_id = str(uuid4())
    assert (
        await service.fetch_agent_drive(project_id=project_id, artifact_id=artifact_id)
        is None
    )
    assert dao.mounts == {}
    created = await _create(service, project_id, user_id, artifact_id)
    found = await service.fetch_agent_drive(
        project_id=project_id, artifact_id=artifact_id.upper()
    )
    assert found.id == created.id


async def test_fetch_mount_by_slug_finds_a_reserved_agent_slug(mount_context):
    service, dao, project_id, user_id = mount_context
    artifact_id = str(uuid4())
    legacy = await dao.upsert_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(
            slug=f"__ag__agent__{artifact_id}__default",
            name="default",
            agent_id=artifact_id,
        ),
    )
    found = await service.fetch_mount_by_slug(project_id=project_id, slug=legacy.slug)
    assert found.id == legacy.id


async def test_fetch_mount_by_slug_never_returns_a_session_drive(mount_context):
    service, _, project_id, user_id = mount_context
    session = await service.get_or_create_session_mount(
        project_id=project_id, user_id=user_id, session_id="sess-1"
    )
    assert (
        await service.fetch_mount_by_slug(project_id=project_id, slug=session.slug)
        is None
    )


async def test_create_rejects_a_reserved_slug(mount_context):
    service, _, project_id, user_id = mount_context
    with pytest.raises(MountSlugReserved):
        await service.create_mount(
            project_id=project_id,
            user_id=user_id,
            mount_create=MountCreate(
                slug=f"__ag__agent__{uuid4()}__default", name="forged"
            ),
        )


async def test_create_mount_writes_a_shared_row_without_owner(mount_context):
    service, dao, project_id, user_id = mount_context
    drive = await service.create_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(slug="price-lists", name="Price lists"),
    )
    assert dao.visibility[drive.id] == OWNERLESS_PROJECT_POLICY
    session = await service.create_mount(
        project_id=project_id,
        user_id=user_id,
        mount_create=MountCreate(slug="cwd", name="cwd", session_id="sess-2"),
    )
    assert session.id not in dao.visibility


async def test_session_mount_leaves_agent_id_null(mount_context):
    service, _, project_id, user_id = mount_context
    mount = await service.get_or_create_session_mount(
        project_id=project_id, user_id=user_id, session_id="sess-1"
    )
    assert mount.session_id is not None
    assert mount.agent_id is None


def test_agent_id_is_canonical():
    assert mint_agent_id(artifact_id=str(UUID(int=1)).upper()) == str(UUID(int=1))
