"""WP5 (S7/F1/F2): MountsService session-scoped teardown/archive fan-out.

Unit-level: fakes MountsDAOInterface + ObjectStore so the orchestration (which
DAO calls happen, which store prefixes get torn down) is pinned without a real
DB or store. delete_session_mounts must call ObjectStore.delete_prefix once per
deleted mount, using the same `_storage_key` prefix the mount's own file ops
use. archive/unarchive_session_mounts must only touch mount rows (soft), never
the store.
"""

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID, uuid4

import pytest

from oss.src.core.mounts.dtos import Mount, MountCreate, MountEdit, MountQuery
from oss.src.core.mounts.service import MountsService


_PROJECT = uuid4()
_USER = uuid4()
_SESSION = "session-wp5-mounts"
_BUCKET = "test-bucket"


def _mount(*, session_id: Optional[str], slug: str, deleted: bool = False) -> Mount:
    return Mount(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=session_id,
        slug=slug,
        name=slug,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )


class _FakeMountsDAO:
    def __init__(self, mounts: Optional[List[Mount]] = None):
        self.mounts = {m.id: m for m in (mounts or [])}
        self.archive_calls: list[UUID] = []
        self.unarchive_calls: list[UUID] = []
        self.deleted_session_ids: list[str] = []

    async def create_mount(
        self, *, project_id, user_id, mount_create: MountCreate
    ) -> Mount:
        raise NotImplementedError

    async def upsert_mount(
        self, *, project_id, user_id, mount_create: MountCreate
    ) -> Mount:
        raise NotImplementedError

    async def fetch_mount(self, *, project_id, mount_id) -> Optional[Mount]:
        return self.mounts.get(mount_id)

    async def fetch_mount_by_slug(self, *, project_id, slug) -> Optional[Mount]:
        raise NotImplementedError

    async def edit_mount(
        self, *, project_id, user_id, mount_edit: MountEdit
    ) -> Optional[Mount]:
        raise NotImplementedError

    async def archive_mount(self, *, project_id, user_id, mount_id) -> Optional[Mount]:
        self.archive_calls.append(mount_id)
        mount = self.mounts.get(mount_id)
        if mount is None:
            return None
        mount = mount.model_copy(update={"deleted_at": datetime.now(timezone.utc)})
        self.mounts[mount_id] = mount
        return mount

    async def unarchive_mount(
        self, *, project_id, user_id, mount_id
    ) -> Optional[Mount]:
        self.unarchive_calls.append(mount_id)
        mount = self.mounts.get(mount_id)
        if mount is None:
            return None
        mount = mount.model_copy(update={"deleted_at": None})
        self.mounts[mount_id] = mount
        return mount

    async def query_mounts(
        self, *, project_id, mount_query: Optional[MountQuery] = None, windowing=None
    ) -> List[Mount]:
        rows = list(self.mounts.values())
        if mount_query:
            if mount_query.session_id is not None:
                rows = [m for m in rows if m.session_id == mount_query.session_id]
            if not mount_query.include_archived:
                rows = [m for m in rows if m.deleted_at is None]
        return rows

    async def delete_by_session_id(self, *, project_id, session_id) -> List[Mount]:
        self.deleted_session_ids.append(session_id)
        matched = [m for m in self.mounts.values() if m.session_id == session_id]
        for m in matched:
            del self.mounts[m.id]
        return matched


class _FakeObjectStore:
    def __init__(self):
        self.delete_prefix_calls: list[dict] = []

    async def delete_prefix(self, *, bucket: str, prefix: str) -> int:
        self.delete_prefix_calls.append({"bucket": bucket, "prefix": prefix})
        return 3


def _service(mounts: List[Mount]):
    dao = _FakeMountsDAO(mounts)
    store = _FakeObjectStore()
    svc = MountsService(mounts_dao=dao, mounts_store=store, bucket=_BUCKET)
    return svc, dao, store


# ---------------------------------------------------------------------------
# delete_session_mounts — hard delete + object-store prefix teardown
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_session_mounts_deletes_rows_and_object_store_prefixes():
    mount = _mount(session_id=_SESSION, slug="s1")
    svc, dao, store = _service([mount])

    deleted = await svc.delete_session_mounts(project_id=_PROJECT, session_id=_SESSION)

    assert deleted == [mount]
    assert dao.deleted_session_ids == [_SESSION]
    assert len(store.delete_prefix_calls) == 1
    call = store.delete_prefix_calls[0]
    assert call["bucket"] == _BUCKET
    assert call["prefix"] == f"mounts/{_PROJECT}/{mount.id}/"


@pytest.mark.asyncio
async def test_delete_session_mounts_tears_down_every_bound_mount():
    mount_a = _mount(session_id=_SESSION, slug="cwd")
    mount_b = _mount(session_id=_SESSION, slug="claude-projects")
    other = _mount(session_id="other-session", slug="cwd-other")
    svc, dao, store = _service([mount_a, mount_b, other])

    deleted = await svc.delete_session_mounts(project_id=_PROJECT, session_id=_SESSION)

    assert {m.id for m in deleted} == {mount_a.id, mount_b.id}
    assert len(store.delete_prefix_calls) == 2
    # the untouched session's mount survives
    assert other.id in dao.mounts


@pytest.mark.asyncio
async def test_delete_session_mounts_no_bound_mounts_is_a_noop():
    svc, dao, store = _service([])

    deleted = await svc.delete_session_mounts(project_id=_PROJECT, session_id=_SESSION)

    assert deleted == []
    assert store.delete_prefix_calls == []


# ---------------------------------------------------------------------------
# archive_session_mounts / unarchive_session_mounts — soft, reversible
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_archive_session_mounts_soft_archives_and_never_touches_store():
    mount = _mount(session_id=_SESSION, slug="cwd")
    svc, dao, store = _service([mount])

    archived = await svc.archive_session_mounts(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert len(archived) == 1
    assert archived[0].deleted_at is not None
    assert dao.archive_calls == [mount.id]
    assert store.delete_prefix_calls == []
    # the row still exists (soft) -- not removed from the DAO's backing map
    assert mount.id in dao.mounts


@pytest.mark.asyncio
async def test_unarchive_session_mounts_reverses_archive_round_trip():
    mount = _mount(session_id=_SESSION, slug="cwd")
    svc, dao, store = _service([mount])

    await svc.archive_session_mounts(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )
    unarchived = await svc.unarchive_session_mounts(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert len(unarchived) == 1
    assert unarchived[0].deleted_at is None
    assert dao.unarchive_calls == [mount.id]
    assert store.delete_prefix_calls == []


@pytest.mark.asyncio
async def test_archive_session_mounts_only_touches_bound_mounts():
    bound = _mount(session_id=_SESSION, slug="cwd")
    unbound = _mount(session_id=None, slug="agent-mount")
    svc, dao, _ = _service([bound, unbound])

    await svc.archive_session_mounts(
        project_id=_PROJECT, user_id=_USER, session_id=_SESSION
    )

    assert dao.archive_calls == [bound.id]
