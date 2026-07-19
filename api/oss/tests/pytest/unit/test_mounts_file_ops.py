"""Unit tests for mount file ops.

Two layers:
1. Path-traversal rejection on file/folder paths (pure, no storage).
2. create/upload/list/read/delete roundtrip + folder-marker hiding + cascade
   delete + file-vs-folder distinction, against an in-memory fake that
   implements the ObjectStore interface.

The fake exercises all service-side logic (key namespacing, marker hiding,
cascade, file-vs-folder); the real miniopy-async adapter is thin. Live
SeaweedFS coverage lands in the acceptance suite against the docker-compose
stack.
"""

from typing import List, Tuple
from uuid import UUID, uuid4

import pytest

from oss.src.core.mounts.dtos import Mount
from oss.src.core.mounts.service import MountsService, validate_file_path
from oss.src.core.store.dtos import StoreObject
from oss.src.core.mounts.types import (
    MountFileNotFound,
    MountPathInvalid,
)


# ---------------------------------------------------------------------------
# Path validation (pure)
# ---------------------------------------------------------------------------


class TestFilePathValidation:
    def test_valid_filename(self):
        validate_file_path("notes.txt")

    def test_valid_nested(self):
        validate_file_path("src/main.py")

    def test_valid_dotted_dirs(self):
        validate_file_path("a.b/c.d/file.txt")

    def test_rejects_dotdot(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("../secret")

    def test_rejects_dotdot_middle(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("a/../../etc/passwd")

    def test_rejects_absolute(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("/etc/passwd")

    def test_rejects_empty(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("")

    def test_rejects_special_chars(self):
        with pytest.raises(MountPathInvalid):
            validate_file_path("file;rm -rf")


# ---------------------------------------------------------------------------
# In-memory fake storage (same interface as ObjectStore)
# ---------------------------------------------------------------------------


class FakeMountStorage:
    def __init__(self):
        # {bucket: {key: bytes}}
        self._store: dict[str, dict[str, bytes]] = {}

    async def list_objects_v2(self, *, bucket: str, prefix: str) -> List[StoreObject]:
        b = self._store.get(bucket, {})
        return [
            StoreObject(key=k, size=len(v))
            for k, v in b.items()
            if k.startswith(prefix)
        ]

    async def get_object(self, *, bucket: str, key: str) -> bytes:
        b = self._store.get(bucket, {})
        if key not in b:
            raise MountFileNotFound()
        return b[key]

    async def put_object(self, *, bucket: str, key: str, body: bytes) -> int:
        self._store.setdefault(bucket, {})[key] = body
        return len(body)

    async def delete_keys(self, *, bucket: str, keys: List[str]) -> int:
        b = self._store.get(bucket, {})
        n = 0
        for k in keys:
            if k in b:
                del b[k]
                n += 1
        return n

    async def delete_prefix(self, *, bucket: str, prefix: str) -> int:
        objects = await self.list_objects_v2(bucket=bucket, prefix=prefix)
        return await self.delete_keys(bucket=bucket, keys=[o.key for o in objects])


_BUCKET = "agenta-test"


class _StubDAO:
    def __init__(self, mount: Mount):
        self._mount = mount

    async def fetch_mount(self, *, project_id, mount_id):
        return self._mount


def _make_mount() -> Mount:
    return Mount(
        id=uuid4(),
        project_id=uuid4(),
        slug="m",
    )


def _make_service(mount: Mount) -> Tuple[MountsService, UUID, UUID]:
    service = MountsService(
        mounts_dao=_StubDAO(mount),
        mounts_store=FakeMountStorage(),
        bucket=_BUCKET,
    )
    return service, mount.project_id, mount.id


# ---------------------------------------------------------------------------
# Roundtrip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestMountFileOpsRoundtrip:
    async def test_write_read_list_delete_file(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        written = await service.write_file(
            project_id=pid, mount_id=mid, path="notes.txt", content=b"hello"
        )
        assert written.path == "notes.txt"
        assert written.size == 5

        content = await service.read_file(
            project_id=pid, mount_id=mid, path="notes.txt"
        )
        assert content.content == "hello"

        listing = await service.list_files(project_id=pid, mount_id=mid)
        assert {f.path for f in listing.files} == {"notes.txt"}

        deleted = await service.delete_path(
            project_id=pid, mount_id=mid, path="notes.txt"
        )
        assert deleted.count == 1

        with pytest.raises(MountFileNotFound):
            await service.read_file(project_id=pid, mount_id=mid, path="notes.txt")

    async def test_key_is_namespaced_under_mount_prefix(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        await service.write_file(
            project_id=pid, mount_id=mid, path="notes.txt", content=b"x"
        )
        stored_keys = list(service.mounts_store._store[_BUCKET].keys())
        # Key is derived from identity: mounts/<project_id>/<mount_id>/<path>.
        assert stored_keys == [f"mounts/{pid}/{mid}/notes.txt"]

    async def test_create_folder_hidden_from_files_listing(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        created = await service.create_folder(
            project_id=pid, mount_id=mid, path="workspace"
        )
        assert created.path == "workspace"

        listing = await service.list_files(project_id=pid, mount_id=mid)
        # The bare trailing-slash marker must NOT appear as a file row.
        file_rows = [f for f in listing.files if not f.is_folder]
        assert all(not f.path.endswith("/") for f in file_rows)
        assert not file_rows
        # It surfaces as a folder entry instead.
        folder_rows = [f for f in listing.files if f.is_folder]
        assert any(f.path == "workspace" for f in folder_rows)

    async def test_upload_into_folder_then_cascade_delete(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        await service.create_folder(project_id=pid, mount_id=mid, path="workspace")
        await service.write_file(
            project_id=pid,
            mount_id=mid,
            path="workspace/data.bin",
            content=b"\x00\x01\x02",
        )

        listing = await service.list_files(
            project_id=pid, mount_id=mid, path="workspace"
        )
        assert any(f.path == "workspace/data.bin" for f in listing.files)

        deleted = await service.delete_path(
            project_id=pid, mount_id=mid, path="workspace"
        )
        # Cascades: marker + contained file.
        assert deleted.count >= 2

        after = await service.list_files(project_id=pid, mount_id=mid)
        assert not any(f.path.startswith("workspace") for f in after.files)

    async def test_delete_missing_raises(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        with pytest.raises(MountFileNotFound):
            await service.delete_path(project_id=pid, mount_id=mid, path="nope.txt")

    async def test_delete_file_does_not_match_sibling_prefix(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        await service.write_file(project_id=pid, mount_id=mid, path="foo", content=b"a")
        await service.write_file(
            project_id=pid, mount_id=mid, path="foobar", content=b"b"
        )

        deleted = await service.delete_path(project_id=pid, mount_id=mid, path="foo")
        assert deleted.count == 1

        # foobar must survive (foo must not prefix-match it).
        content = await service.read_file(project_id=pid, mount_id=mid, path="foobar")
        assert content.content == "b"

    async def test_traversal_rejected_before_storage(self):
        mount = _make_mount()
        service, pid, mid = _make_service(mount)

        with pytest.raises(MountPathInvalid):
            await service.read_file(
                project_id=pid, mount_id=mid, path="../../etc/passwd"
            )
        with pytest.raises(MountPathInvalid):
            await service.write_file(
                project_id=pid, mount_id=mid, path="../escape", content=b"x"
            )
        with pytest.raises(MountPathInvalid):
            await service.delete_path(project_id=pid, mount_id=mid, path="/abs")
