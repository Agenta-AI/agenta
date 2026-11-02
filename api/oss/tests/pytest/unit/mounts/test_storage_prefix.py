"""Every mount key, credential scope and teardown is built from the row's stored prefix.

`Mount.storage_prefix` is written once, at insert, and is internal: it is never serialized.
`MountsService._storage_key` is the only place that turns it into an object key, so a row
whose `project_id` changes later still finds its files.
"""

from typing import List, Optional
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.mounts.models import MountResponse
from oss.src.core.mounts.dtos import Mount, MountQuery
from oss.src.core.mounts.service import MountsService
from oss.src.core.mounts.types import MOUNTS_KEY_ROOT, project_storage_prefix
from oss.src.core.sessions.mounts.dtos import SessionMountQuery
from oss.src.core.sessions.mounts.service import SessionMountsService


_BUCKET = "agenta-test"


def _mount(
    *,
    storage_prefix: str,
    project_id=None,
    mount_id=None,
    session_id: Optional[str] = None,
) -> Mount:
    return Mount(
        id=mount_id or uuid4(),
        project_id=project_id or uuid4(),
        slug=f"s-{uuid4().hex[:8]}",
        session_id=session_id,
        storage_prefix=storage_prefix,
    )


class _FakeCredentials:
    access_key = "SCOPED-ACCESS"
    secret_key = "SCOPED-SECRET"
    session_token = "SCOPED-TOKEN"
    _expiration = None


class _RecordingStore:
    def __init__(self):
        self.signed_with: Optional[dict] = None
        self.deleted_prefixes: List[str] = []
        self.endpoint_url = "http://seaweedfs:8333"
        self.region = "us-east-1"

    async def sign_temp_credentials(self, *, bucket, prefix, duration_seconds):
        self.signed_with = {"bucket": bucket, "prefix": prefix}
        return _FakeCredentials()

    async def delete_prefix(self, *, bucket, prefix):
        self.deleted_prefixes.append(prefix)
        return 0


class _FakeDAO:
    def __init__(self, mounts: List[Mount]):
        self.mounts = {m.id: m for m in mounts}

    async def fetch_mount(self, *, project_id, mount_id):
        return self.mounts.get(mount_id)

    async def query_mounts(
        self, *, project_id, mount_query: Optional[MountQuery] = None, windowing=None
    ):
        rows = list(self.mounts.values())
        if mount_query and mount_query.session_id is not None:
            rows = [m for m in rows if m.session_id == mount_query.session_id]
        return rows

    async def delete_by_session_id(self, *, project_id, session_id):
        matched = [m for m in self.mounts.values() if m.session_id == session_id]
        for m in matched:
            del self.mounts[m.id]
        return matched


def _service(mounts: List[Mount], *, namespace=None):
    store = _RecordingStore()
    service = MountsService(
        mounts_dao=_FakeDAO(mounts),
        mounts_store=store,
        bucket=_BUCKET,
        namespace=namespace,
    )
    return service, store


def test_project_storage_prefix_has_no_namespace_and_no_trailing_slash():
    project_id, mount_id = uuid4(), uuid4()

    prefix = project_storage_prefix(project_id=project_id, mount_id=mount_id)

    assert MOUNTS_KEY_ROOT == "mounts"
    assert prefix == f"mounts/{project_id}/{mount_id}"


def test_storage_key_uses_the_stored_prefix():
    other_scope, mount_id = uuid4(), uuid4()
    mount = _mount(
        mount_id=mount_id,
        storage_prefix=f"mounts/{other_scope}/{mount_id}",
    )
    service, _ = _service([mount])

    assert service._storage_key(mount=mount) == f"mounts/{other_scope}/{mount_id}/"
    assert (
        service._storage_key(mount=mount, path="a/b.txt")
        == f"mounts/{other_scope}/{mount_id}/a/b.txt"
    )


def test_storage_key_ignores_the_project_id():
    # The M6 move: the row changes project, the files stay where they were written.
    old_project, new_project, mount_id = uuid4(), uuid4(), uuid4()
    mount = _mount(
        project_id=new_project,
        mount_id=mount_id,
        storage_prefix=f"mounts/{old_project}/{mount_id}",
    )
    service, _ = _service([mount])

    assert service._storage_key(mount=mount, path="x").startswith(
        f"mounts/{old_project}/{mount_id}/"
    )


@pytest.mark.parametrize("namespace", ["", None, "/"])
def test_storage_key_without_namespace_has_no_leading_slash(namespace):
    mount = _mount(storage_prefix="mounts/P/M")
    service, _ = _service([mount], namespace=namespace)

    assert service._storage_key(mount=mount) == "mounts/P/M/"
    assert service._storage_key(mount=mount, path="/f.txt") == "mounts/P/M/f.txt"


@pytest.mark.asyncio
async def test_sign_scopes_the_namespaced_stored_prefix():
    # The stored scope differs from the row's project, so a signer that rebuilt the
    # project layout would fail here.
    project_id, stored_scope, mount_id = uuid4(), uuid4(), uuid4()
    mount = _mount(
        project_id=project_id,
        mount_id=mount_id,
        storage_prefix=f"mounts/{stored_scope}/{mount_id}",
    )
    service, store = _service([mount], namespace="pr-123")

    creds = await service.sign_mount_credentials(
        project_id=project_id,
        mount_id=mount_id,
    )

    expected = f"pr-123/mounts/{stored_scope}/{mount_id}"
    assert store.signed_with == {"bucket": _BUCKET, "prefix": expected}
    assert creds.prefix == expected


def test_mount_dump_has_no_storage_prefix():
    mount = _mount(storage_prefix="mounts/P/M")

    dumped = MountResponse(count=1, mount=mount).model_dump()

    assert "storage_prefix" not in dumped["mount"]
    assert "storage_prefix" not in mount.model_dump()


@pytest.mark.asyncio
async def test_session_mount_view_keeps_storage_prefix():
    project_id = uuid4()
    mount = _mount(
        project_id=project_id,
        session_id="sess-1",
        storage_prefix="mounts/X/M",
    )
    service, _ = _service([mount])

    result = await SessionMountsService(mounts_service=service).query_mounts(
        project_id=project_id,
        mount_query=SessionMountQuery(session_id="sess-1"),
    )

    assert len(result) == 1
    assert result[0].storage_prefix == "mounts/X/M"


@pytest.mark.asyncio
async def test_delete_session_mounts_deletes_the_stored_prefix():
    project_id = uuid4()
    first = _mount(project_id=project_id, session_id="s", storage_prefix="mounts/X/M1")
    second = _mount(project_id=project_id, session_id="s", storage_prefix="mounts/Y/M2")
    service, store = _service([first, second])

    await service.delete_session_mounts(project_id=project_id, session_id="s")

    assert sorted(store.deleted_prefixes) == ["mounts/X/M1/", "mounts/Y/M2/"]
