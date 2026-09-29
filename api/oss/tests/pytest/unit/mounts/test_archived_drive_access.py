"""An archived session drive is read-only: reads keep the history, changes are refused."""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, status

from oss.src.apis.fastapi.mounts.router import handle_mount_exceptions
from oss.src.core.mounts.dtos import Mount, MountEdit
from oss.src.core.mounts.service import MountsService, mint_session_slug
from oss.src.core.mounts.types import (
    ATTACHMENTS_MOUNT_NAME,
    ATTACHMENTS_MOUNT_PURPOSE,
    MountArchived,
)
from oss.src.core.store.dtos import StorePutResult

_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "archived-drive"
_BUCKET = "test-bucket"


def _mount(*, name: str = "cwd", purpose=None, archived: bool = True) -> Mount:
    return Mount(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=_SESSION,
        slug=mint_session_slug(session_id=_SESSION, name=name),
        name=name,
        purpose=purpose,
        deleted_at=datetime.now(timezone.utc) if archived else None,
    )


class _DAO:
    def __init__(self, mounts):
        self.mounts = {mount.id: mount for mount in mounts}

    async def fetch_mount(self, *, project_id, mount_id):
        return self.mounts.get(mount_id)

    async def upsert_mount(self, *, project_id, user_id, mount_create, reactivate):
        existing = next(
            (m for m in self.mounts.values() if m.slug == mount_create.slug), None
        )
        if existing and reactivate:
            existing = existing.model_copy(update={"deleted_at": None})
            self.mounts[existing.id] = existing
        return existing

    async def edit_mount(self, *, project_id, user_id, mount_edit):
        return self.mounts.get(mount_edit.id)

    async def archive_mount(self, *, project_id, user_id, mount_id):
        return self.mounts.get(mount_id)

    async def unarchive_mount(self, *, project_id, user_id, mount_id):
        mount = self.mounts[mount_id].model_copy(update={"deleted_at": None})
        self.mounts[mount_id] = mount
        return mount


class _Store:
    endpoint_url = "http://store"
    region = "test-region"

    def __init__(self):
        self.objects: dict[str, bytes] = {}

    async def put_object(self, *, bucket, key, body, **_conditions):
        self.objects[key] = body
        return StorePutResult(size=len(body), etag="etag")

    async def get_object(self, *, bucket, key):
        return self.objects[key]

    async def get_object_with_etag(self, *, bucket, key):
        return self.objects[key], "etag"

    async def stat_object(self, *, bucket, key):
        return SimpleNamespace(size=len(self.objects[key]), etag="etag")

    async def list_objects_v2(self, *, bucket, prefix):
        return [
            SimpleNamespace(key=key, size=len(body), mtime=1, etag="etag")
            for key, body in self.objects.items()
            if key.startswith(prefix)
        ]

    async def delete_keys(self, *, bucket, keys):
        for key in keys:
            self.objects.pop(key, None)
        return len(keys)

    async def sign_temp_credentials(self, *, bucket, prefix, duration_seconds):
        return SimpleNamespace(access_key="a", secret_key="s", session_token="t")


def _service(*mounts):
    store = _Store()
    service = MountsService(mounts_dao=_DAO(mounts), mounts_store=store, bucket=_BUCKET)
    for mount in mounts:
        key = service._storage_key(project_id=_PROJECT, mount=mount, path="notes.txt")
        store.objects[key] = b"history"
    return service


@pytest.mark.asyncio
async def test_reads_still_work_on_an_archived_drive():
    mount = _mount()
    service = _service(mount)

    content = await service.read_file(
        project_id=_PROJECT, mount_id=mount.id, path="notes.txt"
    )
    listing = await service.list_files(project_id=_PROJECT, mount_id=mount.id)

    assert content.content == "history"
    assert [f.path for f in listing.files] == ["notes.txt"]


@pytest.mark.asyncio
async def test_attachment_originals_still_read_on_an_archived_session():
    mount = _mount(name=ATTACHMENTS_MOUNT_NAME, purpose=ATTACHMENTS_MOUNT_PURPOSE)
    service = _service(mount)

    data = await service.read_attachment_original(
        project_id=_PROJECT, mount_id=mount.id, path="notes.txt"
    )

    assert data == b"history"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "call",
    [
        lambda s, m: s.write_file(
            project_id=_PROJECT, mount_id=m.id, path="notes.txt", content=b"new"
        ),
        lambda s, m: s.create_folder(project_id=_PROJECT, mount_id=m.id, path="new"),
        lambda s, m: s.delete_path(
            project_id=_PROJECT, mount_id=m.id, path="notes.txt"
        ),
        lambda s, m: s.sign_mount_credentials(project_id=_PROJECT, mount_id=m.id),
        lambda s, m: s.edit_mount(
            project_id=_PROJECT, user_id=_USER, mount_edit=MountEdit(id=m.id, name="x")
        ),
    ],
    ids=["write", "create_folder", "delete", "sign", "edit"],
)
async def test_changes_are_refused_on_an_archived_drive(call):
    mount = _mount()
    service = _service(mount)

    with pytest.raises(MountArchived):
        await call(service, mount)


@pytest.mark.asyncio
async def test_binding_does_not_unarchive_a_session_drive():
    mount = _mount()
    service = _service(mount)

    with pytest.raises(MountArchived):
        await service.get_or_create_session_mount(
            project_id=_PROJECT, user_id=_USER, session_id=_SESSION
        )

    assert service.mounts_dao.mounts[mount.id].deleted_at is not None


@pytest.mark.asyncio
async def test_unarchive_restores_writes():
    mount = _mount()
    service = _service(mount)

    await service.unarchive_mount(project_id=_PROJECT, user_id=_USER, mount_id=mount.id)
    written = await service.write_file(
        project_id=_PROJECT, mount_id=mount.id, path="notes.txt", content=b"new"
    )

    assert written.path == "notes.txt"


@pytest.mark.asyncio
async def test_the_router_reports_an_archived_drive_as_a_conflict():
    @handle_mount_exceptions()
    async def refuse():
        raise MountArchived()

    with pytest.raises(HTTPException) as caught:
        await refuse()

    assert caught.value.status_code == status.HTTP_409_CONFLICT
    assert caught.value.detail["code"] == "archived"
