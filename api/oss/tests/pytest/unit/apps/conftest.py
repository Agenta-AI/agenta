from __future__ import annotations

from types import SimpleNamespace
from typing import Dict, List, Optional
from uuid import uuid4

import pytest

from oss.src.core.mounts.dtos import (
    MountFile,
    MountFileContent,
    MountFileList,
    MountFileWritten,
)
from oss.src.core.mounts.types import MountFileNotFound


class FakeMountsService:
    """The four ``MountsService`` calls the apps code makes, over an in-memory dict."""

    def __init__(self, files: Optional[Dict[str, str]] = None) -> None:
        self.files: Dict[str, str] = dict(files or {})
        self.writes: List[str] = []
        self.session_mount_id = uuid4()
        self.agent_mount_id = uuid4()
        self.session_calls: List[dict] = []
        self.agent_calls: List[dict] = []

    async def read_file(self, *, project_id, mount_id, path):
        if path not in self.files:
            raise MountFileNotFound()
        return MountFileContent(path=path, content=self.files[path])

    async def write_file(self, *, project_id, mount_id, path, content: bytes):
        self.files[path] = content.decode("utf-8")
        self.writes.append(path)
        return MountFileWritten(path=path, size=len(content))

    async def list_files(self, *, project_id, mount_id, path=None, **_):
        prefix = f"{path.strip('/')}/" if path else ""
        files = [MountFile(path=p) for p in sorted(self.files) if p.startswith(prefix)]
        return MountFileList(files=files, total=len(files))

    async def get_or_create_session_mount(self, *, project_id, user_id, session_id):
        self.session_calls.append({"project_id": project_id, "session_id": session_id})
        return SimpleNamespace(id=self.session_mount_id)

    async def get_or_create_agent_mount(self, *, project_id, user_id, artifact_id):
        self.agent_calls.append({"project_id": project_id, "artifact_id": artifact_id})
        return SimpleNamespace(id=self.agent_mount_id)


@pytest.fixture
def fake_mounts() -> FakeMountsService:
    return FakeMountsService()
