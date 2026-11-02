from __future__ import annotations

from hashlib import sha256
from types import SimpleNamespace
from uuid import uuid4

import pytest
from oss.src.core.mounts.dtos import (
    MountFile,
    MountFileContent,
    MountFileList,
    MountFileWritten,
)
from oss.src.core.mounts.types import MountFileNotFound, MountPreconditionFailed


class FakeMountsService:
    """The four ``MountsService`` calls the apps code makes, over an in-memory dict."""

    def __init__(self, files: dict[str, str] | None = None) -> None:
        self.files: dict[str, str] = dict(files or {})
        self.writes: list[str] = []
        self.session_mount_id = uuid4()
        self.agent_mount_id = uuid4()
        self.session_calls: list[dict] = []
        self.agent_calls: list[dict] = []

    async def read_file(self, *, project_id, mount_id, path):
        if path not in self.files:
            raise MountFileNotFound()
        return MountFileContent(
            path=path, content=self.files[path], etag=self.etag(path)
        )

    def etag(self, path):
        return (
            sha256(self.files[path].encode()).hexdigest()
            if path in self.files
            else None
        )

    async def write_file(
        self,
        *,
        project_id,
        mount_id,
        path,
        content: bytes,
        if_match=None,
        if_none_match_any=False,
    ):
        if (if_match is not None and self.etag(path) != if_match) or (
            if_none_match_any and path in self.files
        ):
            raise MountPreconditionFailed(self.etag(path))
        self.files[path] = content.decode("utf-8")
        self.writes.append(path)
        return MountFileWritten(path=path, size=len(content), etag=self.etag(path))

    async def delete_path(self, *, project_id, mount_id, path, if_match):
        if self.etag(path) != if_match:
            raise MountPreconditionFailed(self.etag(path))
        del self.files[path]

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
