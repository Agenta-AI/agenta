from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Slug,
)


class MountData(BaseModel):
    # Storage location is derived server-side (bucket from env, key = project_id/mount_id),
    # never caller-supplied. Kept as an (empty) model for forward-compatible mount metadata.
    pass


class MountFlags(BaseModel):
    pass


class Mount(Identifier, Slug, Header, Lifecycle):
    project_id: UUID
    session_id: Optional[str] = None
    #
    data: MountData = Field(default_factory=MountData)
    #
    flags: MountFlags = Field(default_factory=MountFlags)


class MountCreate(Slug, Header):
    session_id: Optional[str] = None
    #
    flags: MountFlags = Field(default_factory=MountFlags)


class MountEdit(Identifier, Header):
    flags: MountFlags = Field(default_factory=MountFlags)


class MountQuery(BaseModel):
    session_id: Optional[str] = None
    include_archived: bool = False


# --- File ops (durable store contents, sandbox-independent) ----------------- #


class MountFile(BaseModel):
    # path is relative to the mount prefix; is_folder marks prefix entries.
    path: str
    size: int = 0
    is_folder: bool = False


class MountFileList(BaseModel):
    files: List[MountFile] = Field(default_factory=list)


class MountFileContent(BaseModel):
    path: str
    content: str


class MountFileWritten(BaseModel):
    path: str
    size: int = 0


class MountFolderCreated(BaseModel):
    path: str


class MountFileDeleted(BaseModel):
    deleted: str
    count: int = 0


# --- Signed credentials (sandbox injection) --------------------------------- #


class MountCredentials(BaseModel):
    """Short-lived, prefix-scoped credentials for a single mount.

    Signed API-side from the store's STS endpoint; the master key never leaves the
    API. Scoped to `<bucket>/<project_id>/<mount_id>/*` and expires within minutes,
    so a leak grants only this mount's prefix for a short window.
    """

    endpoint: Optional[str] = None
    region: str = "us-east-1"
    bucket: str
    # geesefs key suffix: `<project_id>/<mount_id>` (mount prefix, slug-independent).
    prefix: str
    access_key: str
    secret_key: str
    session_token: Optional[str] = None
    expires_at: Optional[datetime] = None
