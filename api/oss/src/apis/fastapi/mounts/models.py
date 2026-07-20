from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.mounts.dtos import (
    Mount,
    MountCreate,
    MountCredentials,
    MountEdit,
    MountFile,
    MountQuery,
)
from oss.src.core.shared.dtos import Windowing


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class MountCreateRequest(BaseModel):
    mount: MountCreate


class MountEditRequest(BaseModel):
    mount: MountEdit


class MountQueryRequest(BaseModel):
    mount: Optional[MountQuery] = None
    windowing: Optional[Windowing] = None


class AgentMountQueryRequest(BaseModel):
    artifact_id: str
    name: str = "default"


class ArchiveMount(BaseModel):
    """One mount to include in an archive. `path` scopes it to a folder within the mount ("" = the
    whole mount); `prefix` places its files under `prefix/` in the zip (the folded drive layout)."""

    mount_id: UUID
    prefix: str = ""
    path: str = ""


class MountArchiveRequest(BaseModel):
    """Zip several mounts into ONE archive (the drive folds cwd + agent-files into one tree)."""

    mounts: List[ArchiveMount] = Field(default_factory=list)
    filename: str = "files.zip"


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class MountResponse(BaseModel):
    count: int = 0
    mount: Optional[Mount] = None


class MountsResponse(BaseModel):
    count: int = 0
    mounts: List[Mount] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# File-op response models
# ---------------------------------------------------------------------------


class MountFileListResponse(BaseModel):
    count: int = 0
    # Entries this view would return BEFORE any limit — so a limited "latest N" listing still reports
    # the true total (the UI badge). Its unit follows the view: leaf files only in the recency listing
    # (order/limit set), files-plus-folders in the shallow (depth=1) and browse modes.
    total: int = 0
    # `total` is a FLOOR (the count-only scan hit its cap) — the UI shows "N+". False when exact.
    total_capped: bool = False
    files: List[MountFile] = Field(default_factory=list)


class MountFileContentResponse(BaseModel):
    path: str
    content: str


class MountFileWrittenResponse(BaseModel):
    path: str
    size: int = 0


class MountFolderCreatedResponse(BaseModel):
    path: str


class MountFileDeletedResponse(BaseModel):
    deleted: str
    count: int = 0


# ---------------------------------------------------------------------------
# Signed-credentials response (sandbox injection)
# ---------------------------------------------------------------------------


class MountCredentialsResponse(BaseModel):
    count: int = 0
    mount: Optional[Mount] = None
    credentials: Optional[MountCredentials] = None
