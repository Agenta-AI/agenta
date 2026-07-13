from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from oss.src.core.mounts.dtos import Mount, MountCreate
from oss.src.core.mounts.service import MountsService, mint_agent_slug
from oss.src.core.mounts.types import MountArtifactIdInvalid, MountSlugReserved


class InMemoryMountsDAO:
    def __init__(self):
        self.mounts = {}
        self.upsert_calls = 0
        self.fetch_by_slug_calls = 0

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

    async def fetch_mount_by_slug(self, *, project_id, slug):
        self.fetch_by_slug_calls += 1
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

    @staticmethod
    def _mount(project_id, mount_create):
        return Mount(
            id=uuid4(),
            project_id=project_id,
            slug=mount_create.slug,
            name=mount_create.name,
            session_id=mount_create.session_id,
        )


@pytest.fixture
def mount_context():
    dao = InMemoryMountsDAO()
    return MountsService(mounts_dao=dao), dao, uuid4(), uuid4()


def test_agent_slug_is_canonical_and_slugifies_name():
    artifact_id = "A0B1C2D3-E4F5-4678-9ABC-DEF012345678"
    slug = mint_agent_slug(artifact_id=artifact_id, name="My Files")
    assert slug == "__ag__agent__a0b1c2d3-e4f5-4678-9abc-def012345678__my-files"
    assert UUID(slug.removeprefix("__ag__agent__").split("__", 1)[0]) == UUID(
        artifact_id
    )


def test_non_uuid_artifact_id_raises_typed_exception():
    with pytest.raises(MountArtifactIdInvalid):
        mint_agent_slug(artifact_id="not-a-uuid", name="default")


@pytest.mark.asyncio
async def test_agent_mount_upsert_is_idempotent(mount_context):
    service, dao, project_id, user_id = mount_context
    artifact_id = str(uuid4())
    first = await service.get_or_create_agent_mount(
        project_id=project_id, user_id=user_id, artifact_id=artifact_id
    )
    second = await service.get_or_create_agent_mount(
        project_id=project_id, user_id=user_id, artifact_id=artifact_id
    )
    assert first.id == second.id
    assert first.session_id is None
    assert dao.upsert_calls == 2
    assert len(dao.mounts) == 1


@pytest.mark.asyncio
async def test_sign_and_query_derivations_are_byte_identical(mount_context):
    service, _, project_id, user_id = mount_context
    artifact_id = "A0B1C2D3-E4F5-4678-9ABC-DEF012345678"
    signed = await service.get_or_create_agent_mount(
        project_id=project_id, user_id=user_id, artifact_id=artifact_id
    )
    queried = await service.fetch_agent_mount(
        project_id=project_id, artifact_id=artifact_id.lower()
    )
    assert queried is not None
    assert queried.id == signed.id
    assert queried.slug == signed.slug


@pytest.mark.asyncio
async def test_agent_mount_name_is_symmetric_between_sign_and_query(mount_context):
    service, _, project_id, user_id = mount_context
    artifact_id = str(uuid4())
    signed = await service.get_or_create_agent_mount(
        project_id=project_id,
        user_id=user_id,
        artifact_id=artifact_id,
        name="notes",
    )

    notes = await service.fetch_agent_mount(
        project_id=project_id, artifact_id=artifact_id, name="notes"
    )
    default = await service.fetch_agent_mount(
        project_id=project_id, artifact_id=artifact_id
    )

    assert notes is not None
    assert notes.id == signed.id
    assert default is None


@pytest.mark.asyncio
async def test_archived_agent_mount_is_absent_until_signed_again(mount_context):
    service, _, project_id, user_id = mount_context
    artifact_id = str(uuid4())
    signed = await service.get_or_create_agent_mount(
        project_id=project_id, user_id=user_id, artifact_id=artifact_id
    )

    await service.archive_mount(
        project_id=project_id, user_id=user_id, mount_id=signed.id
    )
    assert (
        await service.fetch_agent_mount(project_id=project_id, artifact_id=artifact_id)
        is None
    )

    resigned = await service.get_or_create_agent_mount(
        project_id=project_id, user_id=user_id, artifact_id=artifact_id
    )
    queried = await service.fetch_agent_mount(
        project_id=project_id, artifact_id=artifact_id
    )

    assert resigned.id == signed.id
    assert queried is not None
    assert queried.id == signed.id


@pytest.mark.asyncio
async def test_agent_query_returns_empty_without_creating(mount_context):
    service, dao, project_id, _ = mount_context
    mount = await service.fetch_agent_mount(
        project_id=project_id, artifact_id=str(uuid4())
    )
    assert mount is None
    assert dao.fetch_by_slug_calls == 1
    assert dao.upsert_calls == 0
    assert dao.mounts == {}


@pytest.mark.asyncio
async def test_create_rejects_forged_agent_slug(mount_context):
    service, _, project_id, user_id = mount_context
    with pytest.raises(MountSlugReserved):
        await service.create_mount(
            project_id=project_id,
            user_id=user_id,
            mount_create=MountCreate(
                slug=f"__ag__agent__{uuid4()}__default", name="forged"
            ),
        )
