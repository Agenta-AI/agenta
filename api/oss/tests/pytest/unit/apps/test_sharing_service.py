"""The share service over in-memory fakes: publish, update, visibility, stop, and the viewer."""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.apps.share_capture import CaptureFailed
from oss.src.core.apps.sharing import AppShareError, AppSharesService
from oss.src.core.mounts.dtos import Mount, MountData, MountFile, MountFileList

PROJECT = uuid4()
USER = uuid4()

APP = {
    "apps/board/app.json": b'{"agenta_app": 1, "name": "Board"}',
    "apps/board/index.html": b"<h1>Board</h1>",
    "apps/board/data.json": b'{"items": []}',
    "apps/board/sub/app.json": b'{"agenta_app": 1, "name": "Nested"}',
    "apps/board/sub/index.html": b"<p>nested</p>",
}


@pytest.fixture(autouse=True)
def _real_key(monkeypatch):
    from oss.src.utils.env import env

    monkeypatch.setattr(env.agenta, "crypt_key", "a-test-crypt-key")


class FakeMounts:
    def __init__(self, files, *, session=True, archived=False):
        self.files = dict(files)
        self.mount = Mount(
            id=uuid4(),
            project_id=PROJECT,
            slug="s",
            name="cwd" if session else "default",
            session_id="sess" if session else None,
            deleted_at=datetime.now(timezone.utc) if archived else None,
        )
        # The drive row was deleted by the time publish takes the lock.
        self.gone = False

    def share_storage_key(self, *, project_id, mount_id, path=""):
        return f"shares/{project_id}/{mount_id}/{path}"

    async def fetch_mount_for_share(self, *, project_id, mount_id):
        return self.mount if mount_id == self.mount.id else None

    def is_session_cwd_mount(self, mount):
        return mount.session_id is not None and mount.name == "cwd"

    async def read_file_bytes(self, *, project_id, mount_id, path):
        return self.files[path]

    async def read_files_bytes(self, *, project_id, mount_id, paths):
        return {path: self.files[path] for path in paths}

    async def list_files(self, *, project_id, mount_id, path=None):
        return MountFileList(
            files=[
                MountFile(path=p, size=len(b), is_folder=False)
                for p, b in self.files.items()
                if path is None or p.startswith(f"{path}/")
            ]
        )

    async def update_app_share(self, *, project_id, mount_id, path, mutate):
        if self.gone:
            return None
        current = self.mount.data.shares.get(path)
        updated = await mutate(self.mount, current)
        shares = dict(self.mount.data.shares)
        if updated is None:
            shares.pop(path, None)
        else:
            shares[path] = updated
        self.mount = self.mount.model_copy(update={"data": MountData(shares=shares)})
        return updated


class FakeStore:
    def __init__(self):
        self.objects = {}

    async def put_object_if_absent(self, *, bucket, key, body):
        if key in self.objects:
            return False
        self.objects[key] = body
        return True

    async def put_object(self, *, bucket, key, body):
        self.objects[key] = body
        return SimpleNamespace()

    async def get_object(self, *, bucket, key):
        return self.objects[key]

    async def delete_prefix(self, *, bucket, prefix):
        for key in [k for k in self.objects if k.startswith(prefix)]:
            del self.objects[key]


async def _no_web(url, max_bytes):
    raise CaptureFailed("no network in tests")


def _service(mounts):
    return AppSharesService(
        mounts_service=mounts, store=FakeStore(), bucket="b", fetch=_no_web
    )


async def _publish(service, mounts, **kw):
    return await service.publish(
        project_id=PROJECT, user_id=USER, mount_id=mounts.mount.id, path="apps/board", **kw
    )


async def _index(service, token):
    snapshot = await service.open_shared_app(token=token)
    async for key, _meta, content in service.iter_blobs(snapshot, "files"):
        if key == "index.html":
            return content.decode()


@pytest.mark.asyncio
async def test_publish_snapshots_the_app_and_leaves_nested_apps_out():
    mounts = FakeMounts(APP)
    service = _service(mounts)
    result = await _publish(service, mounts, visibility="link")

    snapshot = await service.open_shared_app(token=result.token)
    assert snapshot.manifest.version == 1 and result.share.visibility == "link"
    assert set(snapshot.manifest.files) == {"app.json", "index.html", "data.json"}


@pytest.mark.asyncio
async def test_the_link_keeps_the_published_snapshot_until_update():
    mounts = FakeMounts(APP)
    service = _service(mounts)
    token = (await _publish(service, mounts)).token

    mounts.files["apps/board/index.html"] = b"<h1>Changed</h1>"
    assert await _index(service, token) == "<h1>Board</h1>"

    updated = await _publish(service, mounts)
    assert updated.share.latest == 2 and updated.token == token
    assert await _index(service, token) == "<h1>Changed</h1>"


@pytest.mark.asyncio
async def test_visibility_changes_keep_the_link():
    mounts = FakeMounts(APP)
    service = _service(mounts)
    first = await _publish(service, mounts)
    share = await service.edit(
        project_id=PROJECT, mount_id=mounts.mount.id, path="apps/board", visibility="link"
    )
    assert share.visibility == "link"
    assert (
        service.link_token(project_id=PROJECT, mount_id=mounts.mount.id, path="apps/board", share=share)
        == first.token
    )


@pytest.mark.asyncio
async def test_stop_kills_the_link_and_sharing_again_makes_a_new_one():
    mounts = FakeMounts(APP)
    service = _service(mounts)
    old = (await _publish(service, mounts)).token

    await service.stop(project_id=PROJECT, mount_id=mounts.mount.id, path="apps/board")
    with pytest.raises(AppShareError) as stopped:
        await service.open_shared_app(token=old)
    assert stopped.value.code == "share_not_found"

    again = await _publish(service, mounts)
    assert again.token != old and again.share.latest == 2
    with pytest.raises(AppShareError):
        await service.open_shared_app(token=old)
    assert (await service.open_shared_app(token=again.token)).manifest.version == 2


@pytest.mark.asyncio
async def test_an_archived_session_pauses_the_link():
    mounts = FakeMounts(APP)
    service = _service(mounts)
    token = (await _publish(service, mounts)).token
    mounts.mount = mounts.mount.model_copy(update={"deleted_at": datetime.now(timezone.utc)})

    with pytest.raises(AppShareError) as paused:
        await service.open_shared_app(token=token)
    assert paused.value.code == "share_unavailable"


@pytest.mark.asyncio
async def test_a_missing_manifest_is_a_storage_failure_not_a_pause():
    mounts = FakeMounts(APP)
    service = _service(mounts)
    token = (await _publish(service, mounts)).token
    for key in [k for k in service.store.objects if k.endswith(".json")]:
        del service.store.objects[key]

    with pytest.raises(AppShareError) as failed:
        await service.open_shared_app(token=token)
    assert failed.value.code == "storage_unavailable"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mounts, path, code",
    [
        (FakeMounts(APP, session=False), "apps/board", "not_shareable"),
        (FakeMounts(APP, archived=True), "apps/board", "session_archived"),
        (FakeMounts(APP), "", "not_shareable"),
        (FakeMounts({"apps/x/index.html": b"<p>"}), "apps/x", "not_an_app"),
    ],
    ids=["agent drive", "archived session", "drive root", "no manifest"],
)
async def test_what_cannot_be_shared(mounts, path, code):
    service = _service(mounts)
    with pytest.raises(AppShareError) as refused:
        await service.publish(
            project_id=PROJECT, user_id=USER, mount_id=mounts.mount.id, path=path
        )
    assert refused.value.code == code


@pytest.mark.asyncio
async def test_an_app_over_the_limit_is_refused_and_the_live_snapshot_stays():
    mounts = FakeMounts(APP)
    service = _service(mounts)
    token = (await _publish(service, mounts)).token
    mounts.files["apps/board/big.bin"] = b"x" * (5 * 1024 * 1024 + 1)

    with pytest.raises(AppShareError) as refused:
        await _publish(service, mounts)
    assert refused.value.code == "too_large"
    assert (await service.open_shared_app(token=token)).manifest.version == 1


@pytest.mark.asyncio
async def test_a_session_archived_during_publish_gets_no_new_snapshot():
    mounts = FakeMounts(APP)
    service = _service(mounts)
    token = (await _publish(service, mounts)).token
    mounts.files["apps/board/index.html"] = b"<h1>Changed</h1>"

    locked = mounts.update_app_share

    async def archive_then_lock(**kw):
        mounts.mount = mounts.mount.model_copy(update={"deleted_at": datetime.now(timezone.utc)})
        return await locked(**kw)

    mounts.update_app_share = archive_then_lock
    with pytest.raises(AppShareError) as refused:
        await _publish(service, mounts)
    assert refused.value.code == "session_archived"
    assert mounts.mount.data.shares["apps/board"].latest == 1
    mounts.mount = mounts.mount.model_copy(update={"deleted_at": None})
    assert await _index(service, token) == "<h1>Board</h1>"


@pytest.mark.asyncio
async def test_a_session_deleted_during_publish_leaves_no_share_objects():
    mounts = FakeMounts(APP)
    service = _service(mounts)
    mounts.gone = True

    with pytest.raises(AppShareError) as refused:
        await _publish(service, mounts)
    assert refused.value.code == "not_found"
    assert service.store.objects == {}


def test_share_settings_never_leave_through_a_drive_response():
    mounts = FakeMounts(APP)
    dumped = mounts.mount.model_copy(
        update={"data": MountData.model_validate({"shares": {"apps/board": {
            "enabled": True, "visibility": "link", "nonce": "secret", "latest": 1,
            "created_by_id": str(USER), "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }}})}
    ).model_dump(mode="json")
    assert "shares" not in dumped["data"]
