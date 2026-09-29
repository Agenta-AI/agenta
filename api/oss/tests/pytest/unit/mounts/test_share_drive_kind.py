"""Which drives can share an app, and when a drive counts as archived for its shares."""

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.mounts.dtos import Mount
from oss.src.core.mounts.service import MountsService

PROJECT = uuid4()


class _Agents:
    def __init__(self, archived=False, missing=False):
        self.static_catalog = None
        self.archived = archived
        self.missing = missing

    async def fetch_workflow(self, *, project_id, workflow_ref, include_archived):
        if self.missing:
            return None
        return SimpleNamespace(
            deleted_at=datetime.now(timezone.utc) if self.archived else None
        )


def _mount(**kw):
    return Mount(id=uuid4(), project_id=PROJECT, slug="s", **kw)


def _service(agents=None):
    return MountsService(mounts_dao=None, workflows_service=agents or _Agents())


@pytest.mark.parametrize(
    "mount, kind",
    [
        (_mount(name="cwd", session_id="sess"), "session"),
        (_mount(name="default", agent_id=str(uuid4())), "agent"),
        (_mount(name="default"), None),
        (_mount(name="notes", session_id="sess"), None),
    ],
    ids=[
        "session working drive",
        "agent drive",
        "standalone drive",
        "other session mount",
    ],
)
def test_share_drive_kind(mount, kind):
    assert _service().share_drive_kind(mount) == kind


@pytest.mark.asyncio
async def test_an_agent_drive_is_archived_with_its_agent():
    mount = _mount(name="default", agent_id=str(uuid4()))
    assert not await _service(_Agents()).is_drive_archived(
        project_id=PROJECT, mount=mount
    )
    assert await _service(_Agents(archived=True)).is_drive_archived(
        project_id=PROJECT, mount=mount
    )
    assert await _service(_Agents(missing=True)).is_drive_archived(
        project_id=PROJECT, mount=mount
    )


@pytest.mark.asyncio
async def test_a_session_drive_is_archived_with_its_row():
    live = _mount(name="cwd", session_id="sess")
    gone = _mount(name="cwd", session_id="sess", deleted_at=datetime.now(timezone.utc))
    service = _service(_Agents(archived=True))
    assert not await service.is_drive_archived(project_id=PROJECT, mount=live)
    assert await service.is_drive_archived(project_id=PROJECT, mount=gone)
