import asyncio
from uuid import uuid4

import pytest

from oss.src.core.mounts.dtos import Mount, MountFileSeed
from oss.src.core.mounts.service import MountsService
from oss.src.core.mounts.types import MountPathInvalid, MountStorageUnavailable
from oss.src.core.store.dtos import StoreObject


PROJECT_ID = uuid4()
USER_ID = uuid4()
WORKFLOW_ID = uuid4()
BUCKET = "mounts-test"


class _MemoryLock:
    def __init__(self):
        self.values = {}
        self.guard = asyncio.Lock()

    async def set(self, key, value, *, nx, ex):
        async with self.guard:
            if nx and key in self.values:
                return False
            self.values[key] = value
            return True

    async def eval(self, script, number_of_keys, key, token):
        async with self.guard:
            if self.values.get(key) != token:
                return 0
            del self.values[key]
            return 1


class _MountsDAO:
    def __init__(self):
        self.mount = None
        self.upsert_calls = 0

    async def upsert_mount(self, *, project_id, user_id, mount_create):
        self.upsert_calls += 1
        if self.mount is None:
            self.mount = Mount(
                id=uuid4(),
                project_id=project_id,
                slug=mount_create.slug,
                name=mount_create.name,
                agent_id=mount_create.agent_id,
            )
        return self.mount

    async def fetch_mount(self, *, project_id, mount_id):
        if self.mount and self.mount.id == mount_id:
            return self.mount
        return None


class _Store:
    def __init__(self, *, fail_on_put=None):
        self.objects = {}
        self.puts = []
        self.fail_on_put = fail_on_put
        self.put_attempts = 0

    async def list_objects_v2(self, *, bucket, prefix):
        return [
            StoreObject(key=key, size=len(value))
            for key, value in self.objects.items()
            if key.startswith(prefix)
        ]

    async def put_object_if_absent(self, *, bucket, key, body):
        self.put_attempts += 1
        if self.fail_on_put == self.put_attempts:
            raise RuntimeError("injected storage failure")
        await asyncio.sleep(0.005)
        if key in self.objects:
            return False
        self.objects[key] = body
        self.puts.append(key)
        return True


def _service(*, fail_on_put=None):
    dao = _MountsDAO()
    store = _Store(fail_on_put=fail_on_put)
    service = MountsService(
        mounts_dao=dao,
        mounts_store=store,
        bucket=BUCKET,
        lock_engine=_MemoryLock(),
    )
    return service, dao, store


def _files():
    return [
        MountFileSeed(path="target-profile.md", content=b"# Target\n"),
        MountFileSeed(path="reports/example.md", content=b"# Example\n"),
    ]


@pytest.mark.asyncio
async def test_materialize_creates_directories_before_files():
    service, dao, store = _service()

    result = await service.materialize_entries_if_absent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_id=WORKFLOW_ID,
        directories=["reports"],
        files=_files(),
    )

    assert result.created == [
        "reports/",
        "reports/example.md",
        "target-profile.md",
    ]
    assert result.preserved == []
    base = f"mounts/{PROJECT_ID}/{dao.mount.id}/"
    assert store.puts == [
        base + "reports/",
        base + "reports/example.md",
        base + "target-profile.md",
    ]
    assert store.objects[base + "target-profile.md"] == b"# Target\n"


@pytest.mark.asyncio
async def test_retry_preserves_an_edited_existing_file():
    service, dao, store = _service()
    first = await service.materialize_entries_if_absent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_id=WORKFLOW_ID,
        directories=["reports"],
        files=_files(),
    )
    base = f"mounts/{PROJECT_ID}/{dao.mount.id}/"
    store.objects[base + "target-profile.md"] = b"user edit"

    replay = await service.materialize_entries_if_absent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_id=WORKFLOW_ID,
        directories=["reports"],
        files=_files(),
    )

    assert first.mount_id == replay.mount_id
    assert replay.created == []
    assert replay.preserved == [
        "reports/",
        "reports/example.md",
        "target-profile.md",
    ]
    assert store.objects[base + "target-profile.md"] == b"user edit"
    assert len(store.puts) == 3


@pytest.mark.asyncio
async def test_retry_repairs_only_entries_missing_after_partial_failure():
    service, dao, store = _service(fail_on_put=2)

    with pytest.raises(RuntimeError, match="injected storage failure"):
        await service.materialize_entries_if_absent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            workflow_id=WORKFLOW_ID,
            directories=["reports"],
            files=_files(),
        )

    result = await service.materialize_entries_if_absent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_id=WORKFLOW_ID,
        directories=["reports"],
        files=_files(),
    )

    assert result.preserved == ["reports/"]
    assert result.created == ["reports/example.md", "target-profile.md"]
    base = f"mounts/{PROJECT_ID}/{dao.mount.id}/"
    assert store.objects[base + "reports/"] == b""
    assert store.objects[base + "reports/example.md"] == b"# Example\n"
    assert store.objects[base + "target-profile.md"] == b"# Target\n"


@pytest.mark.asyncio
async def test_concurrent_materializers_write_each_path_once():
    service, _, store = _service()

    first, second = await asyncio.gather(
        service.materialize_entries_if_absent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            workflow_id=WORKFLOW_ID,
            directories=["reports"],
            files=_files(),
        ),
        service.materialize_entries_if_absent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            workflow_id=WORKFLOW_ID,
            directories=["reports"],
            files=_files(),
        ),
    )

    assert len(store.puts) == 3
    assert {len(first.created), len(second.created)} == {0, 3}
    assert {len(first.preserved), len(second.preserved)} == {0, 3}


@pytest.mark.asyncio
async def test_configured_lock_failure_refuses_an_unsafe_write():
    service, dao, store = _service()

    class _UnavailableLock:
        async def set(self, *args, **kwargs):
            raise ConnectionError("redis unavailable")

    service.lock_engine = _UnavailableLock()
    with pytest.raises(MountStorageUnavailable):
        await service.materialize_entries_if_absent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            workflow_id=WORKFLOW_ID,
            directories=["reports"],
            files=_files(),
        )

    assert dao.upsert_calls == 0
    assert store.puts == []


@pytest.mark.asyncio
async def test_invalid_declarations_fail_before_mount_or_storage_writes():
    service, dao, store = _service()

    with pytest.raises(MountPathInvalid):
        await service.materialize_entries_if_absent(
            project_id=PROJECT_ID,
            user_id=USER_ID,
            workflow_id=WORKFLOW_ID,
            directories=["reports"],
            files=[MountFileSeed(path="../escape", content=b"bad")],
        )

    assert dao.upsert_calls == 0
    assert store.puts == []


@pytest.mark.asyncio
async def test_writer_between_listing_and_put_keeps_its_content():
    service, _, store = _service()
    original = store.put_object_if_absent

    async def race(**kwargs):
        store.objects[kwargs["key"]] = b"user edit won"
        return await original(**kwargs)

    store.put_object_if_absent = race
    result = await service.materialize_entries_if_absent(
        project_id=PROJECT_ID,
        user_id=USER_ID,
        workflow_id=WORKFLOW_ID,
        directories=[],
        files=[MountFileSeed(path="race.md", content=b"seed")],
    )
    assert result.created == []
    assert result.preserved == ["race.md"]
    assert list(store.objects.values()) == [b"user edit won"]
